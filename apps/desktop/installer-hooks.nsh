!define DUMP_ELECTRON_GUID "f2f2ad60-6325-5f3c-af3b-5046ca44f4c3"
!define DUMP_ELECTRON_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DUMP_ELECTRON_GUID}"
!define DUMP_SQUIRREL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\dump_txt"

!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  !define DumpClosedID ${__LINE__}
  Push $R0
  dump_check_closed_${DumpClosedID}:
    nsis_tauri_utils::FindProcessCurrentUser "${executableName}"
    Pop $R0
    ${If} $R0 == 1
      Goto dump_closed_${DumpClosedID}
    ${EndIf}
    IfSilent dump_still_running_${DumpClosedID}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Close ${productName} normally so your edits finish saving, then click Retry." IDRETRY dump_check_closed_${DumpClosedID}
    dump_still_running_${DumpClosedID}:
      SetErrorLevel 2
      Abort "${productName} must be closed before installation can continue."
  dump_closed_${DumpClosedID}:
    Pop $R0
  !undef DumpClosedID
!macroend

Var DumpLegacyDirectory
Var DumpLegacyUninstaller
Var DumpLegacyCommand
Var DumpLegacyName
Var DumpLegacyPublisher
Var DumpLegacyVersion
Var DumpLegacyResult
Var DumpExpectedDirectory

Function DumpInvalidLegacy
  SetErrorLevel 2
  IfSilent +2
    MessageBox MB_OK|MB_ICONEXCLAMATION "The previous dump.txt installation could not be safely upgraded. Remove that installation through Windows Settings while keeping its app data, then try again."
  Abort "The previous dump.txt installation could not be safely upgraded."
FunctionEnd

Function DumpCheckLegacyIdentity
  ${If} $DumpLegacyPublisher != "Matt Cavender"
    Call DumpInvalidLegacy
  ${EndIf}
  ${If} $DumpLegacyName != "dump.txt"
  ${AndIf} $DumpLegacyName != "dump.txt $DumpLegacyVersion"
    Call DumpInvalidLegacy
  ${EndIf}
  GetFullPathName $DumpExpectedDirectory $DumpExpectedDirectory
  GetFullPathName $DumpLegacyDirectory $DumpLegacyDirectory
  ${If} $DumpLegacyDirectory != $DumpExpectedDirectory
    Call DumpInvalidLegacy
  ${EndIf}
  Push $0
  System::Call 'kernel32::GetFileAttributesW(w "$DumpLegacyDirectory")i.r0'
  IntOp $0 $0 & 0x400
  ${If} $0 != 0
    Call DumpInvalidLegacy
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$DumpLegacyUninstaller")i.r0'
  IntOp $0 $0 & 0x400
  ${If} $0 != 0
    Call DumpInvalidLegacy
  ${EndIf}
  Pop $0
  IfFileExists "$DumpLegacyUninstaller" +2
    Call DumpInvalidLegacy
FunctionEnd

Function DumpRemoveElectron
  ReadRegStr $DumpLegacyCommand HKCU "${DUMP_ELECTRON_KEY}" "UninstallString"
  ReadRegStr $DumpLegacyDirectory HKCU "Software\${DUMP_ELECTRON_GUID}" "InstallLocation"
  ${If} "$DumpLegacyCommand$DumpLegacyDirectory" == ""
    Return
  ${EndIf}
  ReadRegStr $DumpLegacyName HKCU "${DUMP_ELECTRON_KEY}" "DisplayName"
  ReadRegStr $DumpLegacyPublisher HKCU "${DUMP_ELECTRON_KEY}" "Publisher"
  ReadRegStr $DumpLegacyVersion HKCU "${DUMP_ELECTRON_KEY}" "DisplayVersion"
  StrCpy $DumpExpectedDirectory "$LOCALAPPDATA\Programs"
  Push $0
  Push $1
  StrCpy $1 0
  System::Call 'shell32::SHGetKnownFolderPath(g "{5CD7AEE2-2219-4A67-B85D-6C9CE15660CB}", i 0, p 0, *p .r1)i.r0'
  ${If} $0 == 0
    System::Call 'kernel32::lstrcpynW(w .r0, p r1, i ${NSIS_MAX_STRLEN})p'
    StrCpy $DumpExpectedDirectory $0
  ${EndIf}
  ${If} $1 != 0
    System::Call 'ole32::CoTaskMemFree(p r1)'
  ${EndIf}
  Pop $1
  Pop $0
  StrCpy $DumpExpectedDirectory "$DumpExpectedDirectory\dump-txt"
  StrCpy $DumpLegacyUninstaller "$DumpLegacyDirectory\Uninstall dump-txt.exe"
  ${If} $DumpLegacyCommand != '$\"$DumpLegacyUninstaller$\" /currentuser'
    Call DumpInvalidLegacy
  ${EndIf}
  Call DumpCheckLegacyIdentity
  InitPluginsDir
  ClearErrors
  CopyFiles /SILENT "$DumpLegacyUninstaller" "$PLUGINSDIR\dump-electron-uninstaller.exe"
  IfErrors 0 +2
    Call DumpInvalidLegacy
  SetOutPath $PLUGINSDIR
  ClearErrors
  ExecWait '$\"$PLUGINSDIR\dump-electron-uninstaller.exe$\" /S /KEEP_APP_DATA /currentuser --updated _?=$DumpLegacyDirectory' $DumpLegacyResult
  IfErrors 0 +2
    Call DumpInvalidLegacy
  ${If} $DumpLegacyResult != 0
    Call DumpInvalidLegacy
  ${EndIf}
  ReadRegStr $DumpLegacyCommand HKCU "${DUMP_ELECTRON_KEY}" "UninstallString"
  ReadRegStr $DumpLegacyDirectory HKCU "Software\${DUMP_ELECTRON_GUID}" "InstallLocation"
  ${If} "$DumpLegacyCommand$DumpLegacyDirectory" != ""
    Call DumpInvalidLegacy
  ${EndIf}
FunctionEnd

Function DumpRemoveSquirrel
  ReadRegStr $DumpLegacyCommand HKCU "${DUMP_SQUIRREL_KEY}" "UninstallString"
  ReadRegStr $DumpLegacyDirectory HKCU "${DUMP_SQUIRREL_KEY}" "InstallLocation"
  ${If} "$DumpLegacyCommand$DumpLegacyDirectory" == ""
    Return
  ${EndIf}
  ReadRegStr $DumpLegacyName HKCU "${DUMP_SQUIRREL_KEY}" "DisplayName"
  ReadRegStr $DumpLegacyPublisher HKCU "${DUMP_SQUIRREL_KEY}" "Publisher"
  ReadRegStr $DumpLegacyVersion HKCU "${DUMP_SQUIRREL_KEY}" "DisplayVersion"
  StrCpy $DumpExpectedDirectory "$LOCALAPPDATA\dump_txt"
  StrCpy $DumpLegacyUninstaller "$DumpLegacyDirectory\Update.exe"
  ${If} $DumpLegacyCommand != '$\"$DumpLegacyUninstaller$\" --uninstall'
    Call DumpInvalidLegacy
  ${EndIf}
  Call DumpCheckLegacyIdentity
  InitPluginsDir
  SetOutPath $PLUGINSDIR
  ClearErrors
  ExecWait '$\"$DumpLegacyUninstaller$\" --uninstall -s' $DumpLegacyResult
  IfErrors 0 +2
    Call DumpInvalidLegacy
  ${If} $DumpLegacyResult != 0
    Call DumpInvalidLegacy
  ${EndIf}
  ReadRegStr $DumpLegacyCommand HKCU "${DUMP_SQUIRREL_KEY}" "UninstallString"
  ${If} $DumpLegacyCommand != ""
    Call DumpInvalidLegacy
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CheckIfAppIsRunning "dump-txt.exe" "dump.txt"
  Call DumpRemoveSquirrel
  Call DumpRemoveElectron
  SetOutPath $INSTDIR
!macroend
