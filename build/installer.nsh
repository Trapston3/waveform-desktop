; Custom NSIS Installer Script for WaveForm Desktop
; Hooks cleanly into electron-builder's assistedInstaller lifecycle:
; - Detects existing HKCU / HKLM / LocalAppData installations
; - Offers Update (changed-files-only) vs Clean Reinstall UI
; - Gracefully closes running WaveForm.exe before patching
; - Uses 7za.exe + diff-sync.ps1 to extract ONLY changed/added files and remove obsolete files

!ifndef WAVEFORM_INSTALLER_NSH_INCLUDED
!define WAVEFORM_INSTALLER_NSH_INCLUDED

!include "LogicLib.nsh"
!define WF_INSTALL_REG_KEY "Software\${APP_GUID}"
!define WF_UNINSTALL_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "Sections.nsh"

!ifndef BUILD_UNINSTALLER

Var /GLOBAL EXISTING_DIR
Var /GLOBAL EXISTING_VER
Var /GLOBAL EXISTING_SCOPE
Var /GLOBAL IS_EXISTING_INSTALL
Var /GLOBAL IS_UPDATE_MODE
Var /GLOBAL FORCE_FRESH_FLAG

Var /GLOBAL ModePageDialog
Var /GLOBAL RadioUpdate
Var /GLOBAL RadioFresh

; ---------------------------------------------------------------------------
; 1. Detect Existing Installation & Handle Silent /FRESH Flag
; ---------------------------------------------------------------------------
!macro customInit
  StrCpy $EXISTING_DIR ""
  StrCpy $EXISTING_VER ""
  StrCpy $EXISTING_SCOPE ""
  StrCpy $IS_EXISTING_INSTALL "0"
  StrCpy $IS_UPDATE_MODE "0"
  StrCpy $FORCE_FRESH_FLAG "0"

  ${GetParameters} $R0
  ${GetOptions} $R0 "/FRESH" $R1
  ${IfNot} ${Errors}
    StrCpy $FORCE_FRESH_FLAG "1"
  ${EndIf}

  ; Check HKCU Uninstall / Install registry first
  ReadRegStr $0 HKCU "${WF_UNINSTALL_REG_KEY}" "InstallLocation"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${WF_INSTALL_REG_KEY}" "InstallLocation"
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\WaveForm.exe"
    StrCpy $EXISTING_DIR "$0"
    StrCpy $EXISTING_SCOPE "user"
    ReadRegStr $EXISTING_VER HKCU "${WF_UNINSTALL_REG_KEY}" "DisplayVersion"
  ${EndIf}

  ; Check HKLM Uninstall / Install registry if not found per-user
  ${If} $EXISTING_DIR == ""
    ReadRegStr $0 HKLM "${WF_UNINSTALL_REG_KEY}" "InstallLocation"
    ${If} $0 == ""
      ReadRegStr $0 HKLM "${WF_INSTALL_REG_KEY}" "InstallLocation"
    ${EndIf}
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\WaveForm.exe"
      StrCpy $EXISTING_DIR "$0"
      StrCpy $EXISTING_SCOPE "machine"
      ReadRegStr $EXISTING_VER HKLM "${WF_UNINSTALL_REG_KEY}" "DisplayVersion"
    ${EndIf}
  ${EndIf}

  ; Fallback check Software\WaveForm
  ${If} $EXISTING_DIR == ""
    ReadRegStr $0 HKCU "Software\WaveForm" "InstallLocation"
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\WaveForm.exe"
      StrCpy $EXISTING_DIR "$0"
      StrCpy $EXISTING_SCOPE "user"
    ${EndIf}
  ${EndIf}

  ; Fallback check %LOCALAPPDATA%\Programs\WaveForm\WaveForm.exe
  ${If} $EXISTING_DIR == ""
  ${AndIf} ${FileExists} "$LOCALAPPDATA\Programs\WaveForm\WaveForm.exe"
    StrCpy $EXISTING_DIR "$LOCALAPPDATA\Programs\WaveForm"
    StrCpy $EXISTING_SCOPE "user"
  ${EndIf}

  ${If} $EXISTING_DIR != ""
    StrCpy $IS_EXISTING_INSTALL "1"
    StrCpy $INSTDIR "$EXISTING_DIR"
    ${If} $EXISTING_VER == ""
      GetDllVersion "$EXISTING_DIR\WaveForm.exe" $R0 $R1
      IntOp $R2 $R0 / 0x00010000
      IntOp $R3 $R0 & 0x0000FFFF
      IntOp $R4 $R1 / 0x00010000
      StrCpy $EXISTING_VER "$R2.$R3.$R4"
    ${EndIf}

    ${If} $FORCE_FRESH_FLAG != "1"
      StrCpy $IS_UPDATE_MODE "1"
      ${If} ${Silent}
        SectionSetFlags 0 ${SF_SELECTED}
        SectionSetFlags 1 0
      ${Else}
        SectionSetFlags 0 0
        SectionSetFlags 1 ${SF_SELECTED}
      ${EndIf}
    ${Else}
      StrCpy $IS_UPDATE_MODE "0"
      SectionSetFlags 0 0
      SectionSetFlags 1 ${SF_SELECTED}
    ${EndIf}
  ${Else}
    SectionSetFlags 0 0
    SectionSetFlags 1 ${SF_SELECTED}
  ${EndIf}
!macroend

; ---------------------------------------------------------------------------
; 2. Custom Welcome + Existing Installation Mode Page (Update vs Clean Reinstall)
; ---------------------------------------------------------------------------
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
  Page custom WaveFormModePageCreate WaveFormModePageLeave

  Function WaveFormUpdateCtaText
    ${NSD_GetState} $RadioUpdate $0
    GetDlgItem $1 $HWNDPARENT 1
    ${If} $0 == ${BST_CHECKED}
      SendMessage $1 ${WM_SETTEXT} 0 "STR:Update"
    ${Else}
      SendMessage $1 ${WM_SETTEXT} 0 "STR:Next >"
    ${EndIf}
  FunctionEnd

  Function WaveFormModePageCreate
    ${If} $IS_EXISTING_INSTALL != "1"
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "Existing WaveForm Installation Detected" "Choose whether to update changed files in-place or perform a clean reinstall."

    nsDialogs::Create 1018
    Pop $ModePageDialog
    ${If} $ModePageDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0u 0u 300u 26u "Installed version: v$EXISTING_VER  ->  New version: v${VERSION}$\r$\nLocation: $EXISTING_DIR"
    Pop $0

    ${NSD_CreateRadioButton} 0u 34u 300u 14u "Update existing installation (Recommended)"
    Pop $RadioUpdate
    ${NSD_SetState} $RadioUpdate ${BST_CHECKED}
    ${NSD_OnClick} $RadioUpdate WaveFormUpdateCtaText

    ${NSD_CreateLabel} 14u 50u 282u 28u "Only updates changed and new files, removes obsolete files, and preserves your local library cache, settings, and unchanged assets."
    Pop $0

    ${NSD_CreateRadioButton} 0u 84u 300u 14u "Clean reinstall / Change install location"
    Pop $RadioFresh
    ${NSD_OnClick} $RadioFresh WaveFormUpdateCtaText

    ${NSD_CreateLabel} 14u 100u 282u 28u "Removes the existing installation folder and performs a fresh install (your settings and library data in AppData are still preserved)."
    Pop $0

    Call WaveFormUpdateCtaText
    nsDialogs::Show
  FunctionEnd

  Function WaveFormModePageLeave
    ${NSD_GetState} $RadioUpdate $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $IS_UPDATE_MODE "1"
      StrCpy $INSTDIR "$EXISTING_DIR"
      SectionSetFlags 0 ${SF_SELECTED}
      SectionSetFlags 1 0
    ${Else}
      StrCpy $IS_UPDATE_MODE "0"
      SectionSetFlags 0 0
      SectionSetFlags 1 ${SF_SELECTED}
    ${EndIf}
  FunctionEnd
!macroend

; ---------------------------------------------------------------------------
; 3. Selective Changed-Files-Only Update Section (Section 0)
; ---------------------------------------------------------------------------
Section "-WaveFormUpdate" SEC_WAVEFORM_UPDATE
  ${If} $IS_UPDATE_MODE != "1"
    Return
  ${EndIf}

  InitPluginsDir
  SetDetailsPrint both

  ; Graceful running-app closure
  DetailPrint "Checking if WaveForm.exe is running..."
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq WaveForm.exe" /NH'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrCpy $2 ""
    ${ForEach} $3 0 0 + 1
    ${Next}
    ; Check if output contains WaveForm.exe
    Push $1
    Push "WaveForm.exe"
    Call StrContainsUpdate
    Pop $2
    ${If} $2 != ""
      DetailPrint "Attempting graceful close of WaveForm..."
      nsExec::Exec 'taskkill /IM "WaveForm.exe"'
      Sleep 1500
      nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq WaveForm.exe" /NH'
      Pop $0
      Pop $1
      Push $1
      Push "WaveForm.exe"
      Call StrContainsUpdate
      Pop $2
      ${If} $2 != ""
        ${IfNot} ${Silent}
          MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "WaveForm is currently running and must be closed before updating.$\r$\n$\r$\nClick OK to close WaveForm and continue, or Cancel to abort." /SD IDOK IDOK forceKillApp
          Abort
        ${EndIf}
        forceKillApp:
        DetailPrint "Closing WaveForm process..."
        nsExec::Exec 'taskkill /F /IM "WaveForm.exe"'
        Sleep 800
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; Stage 7za.exe, diff-sync.ps1, and embedded app-64.7z
  !ifdef APP_64
    SetCompress off
    File "/oname=$PLUGINSDIR\app-64.7z" "${APP_64}"
    SetCompress auto
  !endif
  File "/oname=$PLUGINSDIR\7za.exe" "${BUILD_RESOURCES_DIR}\7za.exe"
  File "/oname=$PLUGINSDIR\diff-sync.ps1" "${BUILD_RESOURCES_DIR}\diff-sync.ps1"

  ; Extract ONLY resources\install-manifest.tsv from incoming app-64.7z
  DetailPrint "Inspecting incoming package manifest..."
  nsExec::ExecToStack '"$PLUGINSDIR\7za.exe" e "$PLUGINSDIR\app-64.7z" "resources\install-manifest.tsv" -o"$PLUGINSDIR" -y'
  Pop $0
  Pop $1
  ${If} $0 != 0
  ${OrIfNot} ${FileExists} "$PLUGINSDIR\install-manifest.tsv"
    DetailPrint "Manifest inspect unavailable; falling back to full safe extraction..."
    Goto fullSafeFallback
  ${EndIf}

  ; Compute changed / unchanged / obsolete lists via diff-sync.ps1
  DetailPrint "Comparing incoming manifest against installed files..."
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\diff-sync.ps1" -InstallDir "$INSTDIR" -NewManifest "$PLUGINSDIR\install-manifest.tsv" -ChangedListOut "$PLUGINSDIR\changed.lst" -RemovedListOut "$PLUGINSDIR\removed.lst" -SummaryOut "$PLUGINSDIR\summary.txt"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "Diff calculation failed ($0); falling back to full safe extraction..."
    Goto fullSafeFallback
  ${EndIf}

  ; Print summary line
  ${If} ${FileExists} "$PLUGINSDIR\summary.txt"
    FileOpen $4 "$PLUGINSDIR\summary.txt" r
    ${If} $4 != ""
      FileRead $4 $5
      FileClose $4
      DetailPrint "$5"
    ${EndIf}
  ${EndIf}

  ; Selective extraction of ONLY changed/added files
  ${If} ${FileExists} "$PLUGINSDIR\changed.lst"
    FileOpen $4 "$PLUGINSDIR\changed.lst" r
    StrCpy $6 "0"
    ${If} $4 != ""
      FileRead $4 $5
      ${If} $5 != ""
        StrCpy $6 "1"
      ${EndIf}
      FileClose $4
    ${EndIf}
    ${If} $6 == "1"
      DetailPrint "Extracting changed and new files..."
      nsExec::ExecToLog '"$PLUGINSDIR\7za.exe" x "$PLUGINSDIR\app-64.7z" -o"$INSTDIR" -aoa -y -i@"$PLUGINSDIR\changed.lst"'
      Pop $0
      ${If} $0 != 0
        DetailPrint "Selective extraction returned error $0; falling back to full safe extraction..."
        Goto fullSafeFallback
      ${EndIf}
    ${Else}
      DetailPrint "All application files are already up to date."
    ${EndIf}
  ${EndIf}

  ; Delete obsolete files and prune empty directories
  ${If} ${FileExists} "$PLUGINSDIR\removed.lst"
    FileOpen $4 "$PLUGINSDIR\removed.lst" r
    ${If} $4 != ""
      loopRemove:
        ClearErrors
        FileRead $4 $5
        ${If} ${Errors}
          Goto doneRemove
        ${EndIf}
        ; Trim CR/LF
        StrCpy $6 $5 1 -1
        ${If} $6 == "$\n"
          StrCpy $5 $5 -1
        ${EndIf}
        StrCpy $6 $5 1 -1
        ${If} $6 == "$\r"
          StrCpy $5 $5 -1
        ${EndIf}
        ${If} $5 != ""
        ${AndIf} ${FileExists} "$INSTDIR\$5"
          DetailPrint "Removing obsolete file: $5"
          Delete "$INSTDIR\$5"
          ${GetParent} "$INSTDIR\$5" $6
          RMDir "$6"
        ${EndIf}
        Goto loopRemove
      doneRemove:
      FileClose $4
    ${EndIf}
  ${EndIf}
  Goto updateDone

fullSafeFallback:
  DetailPrint "Extracting all WaveForm files safely..."
  nsExec::ExecToLog '"$PLUGINSDIR\7za.exe" x "$PLUGINSDIR\app-64.7z" -o"$INSTDIR" -aoa -y'
  Pop $0

updateDone:
  ; Refresh Uninstaller, Registry Metadata & Shortcuts
  SetOutPath "$INSTDIR"
  File "/oname=Uninstall ${PRODUCT_FILENAME}.exe" "${UNINSTALLER_OUT_FILE}"
  StrCpy $7 "$INSTDIR\${PRODUCT_FILENAME}.exe"

  ${If} $EXISTING_SCOPE == "machine"
    SetShellVarContext all
  ${Else}
    SetShellVarContext current
  ${EndIf}

  WriteRegStr SHELL_CONTEXT "${WF_INSTALL_REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${WF_INSTALL_REG_KEY}" "KeepShortcuts" "true"
  WriteRegStr SHELL_CONTEXT "${WF_INSTALL_REG_KEY}" "ShortcutName" "${SHORTCUT_NAME}"
  WriteRegStr SHELL_CONTEXT "${WF_UNINSTALL_REG_KEY}" "DisplayName" "${UNINSTALL_DISPLAY_NAME}"
  WriteRegStr SHELL_CONTEXT "${WF_UNINSTALL_REG_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHELL_CONTEXT "${WF_UNINSTALL_REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${WF_UNINSTALL_REG_KEY}" "DisplayIcon" "$7,0"
  WriteRegStr SHELL_CONTEXT "${WF_UNINSTALL_REG_KEY}" "UninstallString" '"$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"'
  WriteRegStr SHELL_CONTEXT "${WF_UNINSTALL_REG_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe" /S'
  WriteRegStr SHELL_CONTEXT "Software\WaveForm" "InstallLocation" "$INSTDIR"

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHELL_CONTEXT "${WF_UNINSTALL_REG_KEY}" "EstimatedSize" "$0"

  CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$7" "" "$7" 0 "" "" "${APP_DESCRIPTION}"
  CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$7" "" "$7" 0 "" "" "${APP_DESCRIPTION}"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'

  DetailPrint "WaveForm Desktop v${VERSION} update complete."
SectionEnd

!macro customFinishPage
  Function WaveFormFinishRun
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${PRODUCT_FILENAME}.exe" "open" ""
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "WaveFormFinishRun"
  !insertmacro MUI_PAGE_FINISH
!macroend

Function StrContainsUpdate
  Exch $R1 ; needle
  Exch
  Exch $R2 ; haystack
  Push $R3
  Push $R4
  Push $R5
  StrLen $R3 $R1
  StrCpy $R4 0
  loopStrC:
    StrCpy $R5 $R2 $R3 $R4
    StrCmp $R5 $R1 foundStrC
    StrCmp $R5 "" notFoundStrC
    IntOp $R4 $R4 + 1
    Goto loopStrC
  foundStrC:
    StrCpy $R1 $R2 "" $R4
    Goto doneStrC
  notFoundStrC:
    StrCpy $R1 ""
  doneStrC:
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Exch $R1
FunctionEnd

!endif
!endif
