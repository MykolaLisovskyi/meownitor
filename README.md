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

## Limits

`src-tauri/src/limits.rs` makes the request Claude Code's `/usage` makes (`GET /api/oauth/usage`) once
a minute — an account query, not a model call. It uses Claude Code's sign-in from
`~/.claude/.credentials.json` (run `claude` and `/login` once) and refreshes the token the way Claude
Code does, writing it back. The endpoint is rate-limited per account (Claude Code and Desktop query
it too): a 429 or a 5xx keeps the last numbers on the card and doubles the pause, up to 10 minutes;
only a 401/403 that a fresh token does not cure means the sign-in is gone.

## Questions

A session asks through the widget with the `widget-round` skill (`skill/widget-round`, installed in
`~/.claude/skills`): it writes one self-contained HTML page into its round folder
(`claude-widget-hook.exe where`) and runs `claude-widget-hook.exe wait <name>` in the background. The
widget shows the session as asking and chirps; «Відповісти» opens the page in a window centred on the
widget's monitor (served through the `round` scheme, `src-tauri/src/rounds.rs`); the page's
«Надіслати» POSTs `/answer`, the answer lands in `<name>.answer.md` and the waiter hands it back.
While a round window is in front, it and its page keep one keyboard layout: the page types in
WebView2's own process, and Windows hands a layout to one of the two threads at a time, so the
language bar and switchers that read the foreground window (CtrlShiftLangFixer) would otherwise
see a stale one.

## Settings

The gear in the card's header turns the card over: the character (live miniatures), the ask sound,
start with Windows (`tauri-plugin-autostart`), and the Claude Code hook — installed or removed with a
confirmation; `src-tauri/src/hooks.rs` touches only its own entries, keeps the file's key order and
backs the file up before every write (`cargo test --bin claude-widget hooks`). The character, the
sound, the idle group and where the widget was left (mode, edge, position) live in
`%LOCALAPPDATA%\ClaudeWidget\config.json`.

The everyday copy runs from `%LOCALAPPDATA%\ClaudeWidget\app\` (`claude-widget.exe` and
`claude-widget-hook.exe` from `target\release`), so start-with-Windows points at a place a rebuild
does not touch.

## Status

Steps 1–5 of the plan: the cat on the desktop, the real sessions, the plan limits, questions
through the widget and the settings. Next: macOS.
