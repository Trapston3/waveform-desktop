<#
.SYNOPSIS
    WaveForm Desktop Windows Installer (NSIS Setup or Portable executable).
.DESCRIPTION
    Queries GitHub Releases for trapston3/waveform-desktop, downloads the target
    Windows x64 executable and SHA256SUMS.txt to an isolated temp directory,
    verifies the SHA-256 cryptographic hash, and either runs the NSIS installer
    or deploys the Portable executable.
.EXAMPLE
    irm https://raw.githubusercontent.com/trapston3/waveform-desktop/main/scripts/install.ps1 | iex
.EXAMPLE
    .\scripts\install.ps1 -Portable -InstallDir "$env:LOCALAPPDATA\Programs\WaveForm"
.EXAMPLE
    .\scripts\install.ps1 -Version v1.0.0 -Silent
#>
[CmdletBinding()]
param(
    [switch]$Portable,
    [string]$Version,
    [switch]$Silent,
    [string]$InstallDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoOwner = 'trapston3'
$RepoName = 'waveform-desktop'
$esc = [char]27
$cCyan = "$esc[36m"
$cGreen = "$esc[32m"
$cYellow = "$esc[33m"
$cRed = "$esc[31m"
$cBold = "$esc[1m"
$cReset = "$esc[0m"

function Write-Step([string]$Message) {
    Write-Host "${cCyan}${cBold}==> ${cReset}${cBold}$Message${cReset}"
}

function Write-Ok([string]$Message) {
    Write-Host "${cGreen}${cBold}  [OK]${cReset} $Message"
}

function Write-Warn([string]$Message) {
    Write-Host "${cYellow}${cBold}  [WARN]${cReset} $Message"
}

function Write-Fail([string]$Message) {
    Write-Host "${cRed}${cBold}  [FAIL]${cReset} $Message"
}

$tempDir = Join-Path $env:TEMP ("waveform-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    if ([string]::IsNullOrWhiteSpace($Version)) {
        $releaseApiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
        Write-Step "Fetching latest WaveForm release metadata from GitHub..."
    } else {
        $normalizedTag = if ($Version.StartsWith('v')) { $Version } else { "v$Version" }
        $releaseApiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/tags/$normalizedTag"
        Write-Step "Fetching WaveForm release '$normalizedTag' metadata from GitHub..."
    }

    $headers = @{
        'User-Agent' = 'WaveForm-PowerShell-Installer/1.0'
        'Accept'     = 'application/vnd.github+json'
    }

    $release = Invoke-RestMethod -Uri $releaseApiUrl -Headers $headers -Method Get
    if (-not $release -or -not $release.assets) {
        throw "No release assets found at $releaseApiUrl"
    }

    $tagName = $release.tag_name
    $assetPattern = if ($Portable) { '^WaveForm-Portable-.*\.exe$' } else { '^WaveForm-Setup-.*\.exe$' }
    $exeAsset = $release.assets | Where-Object { $_.name -match $assetPattern } | Select-Object -First 1

    if (-not $exeAsset) {
        $modeLabel = if ($Portable) { 'Portable' } else { 'Setup' }
        throw "Could not find a matching WaveForm $modeLabel .exe asset in release $tagName."
    }

    $sumsAsset = $release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
    if (-not $sumsAsset) {
        throw "Release $tagName is missing SHA256SUMS.txt for cryptographic verification."
    }

    $exePath = Join-Path $tempDir $exeAsset.name
    $sumsPath = Join-Path $tempDir 'SHA256SUMS.txt'

    Write-Step "Downloading $($exeAsset.name) ($tagName)..."
    Invoke-WebRequest -Uri $exeAsset.browser_download_url -Headers $headers -OutFile $exePath -UseBasicParsing
    Write-Ok "Downloaded $($exeAsset.name)"

    Write-Step "Downloading SHA256SUMS.txt..."
    Invoke-WebRequest -Uri $sumsAsset.browser_download_url -Headers $headers -OutFile $sumsPath -UseBasicParsing

    Write-Step "Verifying SHA-256 checksum..."
    $expectedHash = $null
    foreach ($line in (Get-Content -Path $sumsPath)) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^([a-fA-F0-9]{64})\s+\*?(.+)$') {
            $hashCandidate = $Matches[1].ToLowerInvariant()
            $fileCandidate = $Matches[2].Trim()
            if ($fileCandidate -eq $exeAsset.name) {
                $expectedHash = $hashCandidate
                break
            }
        }
    }

    if (-not $expectedHash) {
        throw "No SHA-256 entry found for $($exeAsset.name) inside SHA256SUMS.txt."
    }

    $actualHash = (Get-FileHash -Path $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        Write-Fail "SHA-256 mismatch for $($exeAsset.name)!"
        Write-Fail "Expected: $expectedHash"
        Write-Fail "Actual:   $actualHash"
        throw "SHA-256 checksum verification failed. Aborting installation."
    }
    Write-Ok "SHA-256 verified ($actualHash)"

    if ($Portable) {
        $targetDir = if (-not [string]::IsNullOrWhiteSpace($InstallDir)) {
            $InstallDir
        } else {
            Join-Path $env:LOCALAPPDATA 'Programs\WaveForm'
        }

        if (-not (Test-Path -Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }

        $targetExe = Join-Path $targetDir 'WaveForm.exe'
        Write-Step "Installing WaveForm Portable to $targetExe..."
        Copy-Item -Path $exePath -Destination $targetExe -Force
        Write-Ok "WaveForm Portable installed to $targetExe"

        if (-not $Silent) {
            try {
                $wsh = New-Object -ComObject WScript.Shell
                $startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
                $shortcutPath = Join-Path $startMenuDir 'WaveForm.lnk'
                $shortcut = $wsh.CreateShortcut($shortcutPath)
                $shortcut.TargetPath = $targetExe
                $shortcut.WorkingDirectory = $targetDir
                $shortcut.Description = 'WaveForm Music Player'
                $shortcut.Save()
                Write-Ok "Created Start Menu shortcut ($shortcutPath)"
            } catch {
                Write-Warn "Skipped Start Menu shortcut creation: $($_.Exception.Message)"
            }
        }
    } else {
        Write-Step "Launching WaveForm Setup installer..."
        $nsisArgs = New-Object System.Collections.Generic.List[string]
        if ($Silent) {
            $nsisArgs.Add('/S')
        }
        if (-not [string]::IsNullOrWhiteSpace($InstallDir)) {
            # NSIS requires /D=path to be the last parameter without surrounding quotes
            $nsisArgs.Add("/D=$InstallDir")
        }

        if ($nsisArgs.Count -gt 0) {
            $proc = Start-Process -FilePath $exePath -ArgumentList ($nsisArgs -join ' ') -Wait -PassThru
        } else {
            $proc = Start-Process -FilePath $exePath -Wait -PassThru
        }

        if ($proc.ExitCode -ne 0) {
            throw "WaveForm Setup installer exited with code $($proc.ExitCode)."
        }
        Write-Ok "WaveForm Setup completed successfully!"
    }

    Write-Host ""
    Write-Host "${cGreen}${cBold}WaveForm Desktop ($tagName) is ready!${cReset}"
} finally {
    if (Test-Path -Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
