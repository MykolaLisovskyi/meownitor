# Claude Widget

A pixel-art cat that lives on the desktop and keeps an eye on your Claude Code sessions and
plan limits. Windows first, macOS next.

- `app/` — the Tauri 2 app. The look is plain HTML and canvas (`app/src`): `pixel.js` is the
  sprite engine (cat, blob, ghost; moods, idle life, dragging, petting), `widget.js` the window
  modes. Rust (`app/src-tauri`) owns the window geometry in physical pixels and the tray menu.

## Build and run (Windows)

Needs Rust (rustup), Node 20+ and the MSVC build tools; WebView2 ships with Windows 10/11.

```powershell
cd app
npm install
cd src-tauri
cargo build            # debug: target\debug\claude-widget.exe
cargo build --release  # release: target\release\claude-widget.exe
```

The tray icon has the mood and character switches (for trying them out) and Quit.

## Sessions

`claude-widget-hook.exe` (`src-tauri/src/bin/hook.rs`) is a Claude Code hook: for every session
event it writes what the session is doing into `%LOCALAPPDATA%\ClaudeWidget\sessions\<id>.json`
and exits in milliseconds; it never blocks or fails Claude. The widget (`src-tauri/src/sessions.rs`)
merges those files with Claude Desktop's own session records (`%APPDATA%\Claude\claude-code-sessions`:
title, archived, the local id behind the `claude://claude.ai/epitaxy/<id>` link) and shows every
session active in the last 24 hours, grouped: waiting for you, working, your turn, idle.

Installing the hook by hand (until the settings window does it):

1. copy `target\debug\claude-widget-hook.exe` to `%LOCALAPPDATA%\ClaudeWidget\bin\`;
2. in `~/.claude/settings.json`, for SessionStart, SessionEnd, UserPromptSubmit, PreToolUse,
   PostToolUse, PostToolUseFailure, Notification, PermissionRequest, Stop, SubagentStart and
   SubagentStop add `{"matcher": "", "hooks": [{"type": "command", "command":
   "\"C:/Users/<you>/AppData/Local/ClaudeWidget/bin/claude-widget-hook.exe\"", "timeout": 5}]}`.

## Status

Steps 1–2 of the plan: the cat on the desktop (three modes, dragging, snapping to the left
or right screen edge, click-through on transparent pixels, petting) and the real sessions (live
state and current action, Desktop titles, a click opens the session in Desktop). Limits are still
samples — step 3.
