# Meownitor

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
cargo build            # debug: target\debug\meownitor.exe
cargo build --release  # release: target\release\meownitor.exe
```

The installer, per user and with no admin rights:

```powershell
cargo build --release --bin meownitor-hook
cd ..
npx tauri build --bundles nsis --config src-tauri/tauri.bundle.conf.json
```

The tray icon has the mood and character switches (for trying them out) and Quit.

## Sessions

`meownitor-hook.exe` (`src-tauri/src/bin/hook.rs`) is a Claude Code hook: for every session
event it writes what the session is doing into `~\.meownitor\sessions\<id>.json`
and exits in milliseconds; it never blocks or fails Claude. The widget (`src-tauri/src/sessions.rs`)
merges those files with Claude Desktop's own session records (`%APPDATA%\Claude\claude-code-sessions`:
title, archived, the local id behind the `claude://claude.ai/epitaxy/<id>` link) and shows every
session active in the last 24 hours, grouped: waiting for you, working, your turn, idle.

Installing the hook by hand (until the settings window does it):

1. copy `target\debug\meownitor-hook.exe` to `~\.meownitor\bin\`;
2. in `~/.claude/settings.json`, for SessionStart, SessionEnd, UserPromptSubmit, PreToolUse,
   PostToolUse, PostToolUseFailure, Notification, PermissionRequest, Stop, SubagentStart and
   SubagentStop add `{"matcher": "", "hooks": [{"type": "command", "command":
   "\"C:/Users/<you>/.meownitor/bin/meownitor-hook.exe\"", "timeout": 5}]}`.

## Limits

`src-tauri/src/limits.rs` makes the request Claude Code's `/usage` makes (`GET /api/oauth/usage`) once
a minute — an account query, not a model call. It uses Claude Code's sign-in from
`~/.claude/.credentials.json` (run `claude` and `/login` once) and refreshes the token the way Claude
Code does, writing it back. The endpoint is rate-limited per account (Claude Code and Desktop query
it too): a 429 or a 5xx keeps the last numbers on the card and doubles the pause, up to 10 minutes;
only a 401/403 that a fresh token does not cure means the sign-in is gone.

## Questions

A session asks through the widget with the `meownitor-round` skill (`skill/meownitor-round`, copied to
`~/.claude/skills/meownitor-round`): it writes one HTML page into its round folder
(`meownitor-hook.exe where`) next to the skill's kit — `round-kit.css` and `round-kit.js`: the look
in Dark and Light, picking, zoom, numbered markers and frames drawn on the element or the screenshot
pixel they point at, and the send — starting from `template-choice.html` or `template-review.html`, and
runs `meownitor-hook.exe wait <name>` in the background. The
widget shows the session as asking and chirps; «Answer» opens the page in a window centred on the
widget's monitor (served through the `round` scheme, `src-tauri/src/rounds.rs`); the page's
«Send» POSTs `/answer`, the answer lands in `<name>.answer.md` and the waiter hands it back.
A session withdraws a round the user answered in the chat (`meownitor-hook drop <name>`), and an
answer sent after its waiter stopped comes with the user's next message.
While a round window is in front, it and its page keep one keyboard layout: the page types in
WebView2's own process, and Windows hands a layout to one of the two threads at a time, so the
language bar and switchers that read the foreground window (CtrlShiftLangFixer) would otherwise
see a stale one.

## Settings

The gear in the card's header turns the card over: the character (live miniatures), the ask sound,
start with Windows (`tauri-plugin-autostart`), and the Claude Code hook — installed or removed with a
confirmation; `src-tauri/src/hooks.rs` touches only its own entries, keeps the file's key order and
backs the file up before every write (`cargo test --bin meownitor hooks`). The character, the
sound, the idle group and where the widget was left (mode, edge, position) live in
`~\.meownitor\config.json` — not under AppData, which Claude Desktop's MSIX package redirects
for everything it starts.

The card speaks English by default; Ukrainian is a click away on its back (`src/i18n.js`,
`src-tauri/src/i18n.rs`).

The everyday copy runs from `%LOCALAPPDATA%\ClaudeWidget\app\` (`meownitor.exe` and
`meownitor-hook.exe` from `target\release`), so start-with-Windows points at a place a rebuild
does not touch.

## Watchdog

When the page stops polling, `src-tauri/src/watchdog.rs` steps in: after 4 s the window takes the
mouse back, after 8 s the WebView2 processes are resumed, after 30 s they are restarted (not while a
round window is open). `widget.log` in the data folder says when.

## Status

Steps 1–5 of the plan: the cat on the desktop, the real sessions, the plan limits, questions
through the widget and the settings. Next: macOS.
