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

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CheckIfAppIsRunning "dump-txt.exe" "dump.txt"
  SetOutPath $INSTDIR
!macroend
