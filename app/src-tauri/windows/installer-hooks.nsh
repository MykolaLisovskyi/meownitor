; Hooks into the NSIS installer Tauri builds (tauri.conf.json > bundle > windows > nsis > installerHooks).
; The widget does the work itself, with no window (src/lifecycle.rs).

!macro NSIS_HOOK_POSTINSTALL
  ; Back what an earlier uninstall took away: the Claude Code hook and starting with Windows.
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Not on an in-place update. The widget takes its hook out of Claude Code's settings and drops the
  ; start-with-Windows entry, and remembers both for the next install.
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; «Delete the application data» takes the widget's own folder too: sessions, settings, the hook's copy
  ; (~\.meownitor; ~\.claude-widget and %LOCALAPPDATA%\ClaudeWidget are where it kept them as Claude Widget).
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$PROFILE\.meownitor"
    RMDir /r "$PROFILE\.claude-widget"
    RMDir /r "$LOCALAPPDATA\ClaudeWidget"
  ${EndIf}
!macroend
