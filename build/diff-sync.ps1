param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$NewManifest,
    [Parameter(Mandatory = $true)][string]$ChangedListOut,
    [Parameter(Mandatory = $true)][string]$RemovedListOut,
    [Parameter(Mandatory = $true)][string]$SummaryOut
)

$ErrorActionPreference = 'Stop'

function Parse-Manifest([string]$Path) {
    $map = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::OrdinalIgnoreCase)
    if (-not (Test-Path -LiteralPath $Path)) {
        return $map
    }
    foreach ($rawLine in [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrEmpty($line) -or $line.StartsWith('#')) { continue }
        $parts = $line -split "`t"
        if ($parts.Length -lt 3) { continue }
        $rel = $parts[0].Trim().Replace('/', '\').TrimStart('\')
        $hash = $parts[1].Trim().ToLowerInvariant()
        $size = 0L
        if (-not [long]::TryParse($parts[2].Trim(), [ref]$size)) { continue }
        if ($rel -and $hash.Length -eq 64) {
            $map[$rel] = @{ Hash = $hash; Size = $size }
        }
    }
    return $map
}

function Get-Sha256Hex([string]$FilePath) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($FilePath)
        try {
            $bytes = $sha.ComputeHash($stream)
            return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
        } finally {
            $stream.Dispose()
        }
    } finally {
        $sha.Dispose()
    }
}

$newMap = Parse-Manifest $NewManifest
if ($newMap.Count -eq 0) {
    throw "Incoming install-manifest.tsv is empty or invalid: $NewManifest"
}

$oldManifestPath = Join-Path $InstallDir 'resources\install-manifest.tsv'
$hasOldManifest = Test-Path -LiteralPath $oldManifestPath
$oldMap = if ($hasOldManifest) { Parse-Manifest $oldManifestPath } else { $null }

$changed = [System.Collections.Generic.List[string]]::new()
$removed = [System.Collections.Generic.List[string]]::new()
$unchangedCount = 0

foreach ($kvp in $newMap.GetEnumerator()) {
    $rel = $kvp.Key
    $newMeta = $kvp.Value
    $diskPath = Join-Path $InstallDir $rel
    $diskExists = [System.IO.File]::Exists($diskPath)

    if ($hasOldManifest -and $oldMap.Count -gt 0) {
        if ($oldMap.ContainsKey($rel)) {
            $oldMeta = $oldMap[$rel]
            if ($oldMeta.Hash -eq $newMeta.Hash -and $oldMeta.Size -eq $newMeta.Size -and $diskExists) {
                $diskSize = (Get-Item -LiteralPath $diskPath).Length
                if ($diskSize -eq $newMeta.Size) {
                    $unchangedCount++
                    continue
                }
            }
        }
        $changed.Add($rel)
    } else {
        # First-time upgrade from legacy install without install-manifest.tsv: hash existing disk files
        if ($diskExists) {
            $diskSize = (Get-Item -LiteralPath $diskPath).Length
            if ($diskSize -eq $newMeta.Size) {
                $diskHash = Get-Sha256Hex $diskPath
                if ($diskHash -eq $newMeta.Hash) {
                    $unchangedCount++
                    continue
                }
            }
        }
        $changed.Add($rel)
    }
}

# Always update resources\install-manifest.tsv so the installed manifest reflects the new version
$changed.Add('resources\install-manifest.tsv')

if ($hasOldManifest -and $oldMap.Count -gt 0) {
    foreach ($oldRel in $oldMap.Keys) {
        if (-not $newMap.ContainsKey($oldRel)) {
            if ($oldRel -notmatch '^(?i)uninstall\s+.*\.exe$' -and $oldRel -ine 'uninstallerIcon.ico' -and $oldRel -ine 'resources\install-manifest.tsv') {
                $removed.Add($oldRel)
            }
        }
    }
}

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllLines($ChangedListOut, $changed, $utf8NoBom)
[System.IO.File]::WriteAllLines($RemovedListOut, $removed, $utf8NoBom)

$changedFileCount = [Math]::Max(0, $changed.Count - 1)
$summary = "Updating WaveForm: $changedFileCount changed/new files, $unchangedCount unchanged files skipped, $($removed.Count) obsolete files removed"
[System.IO.File]::WriteAllText($SummaryOut, $summary, $utf8NoBom)
