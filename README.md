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

## Status

Step 1 of the plan: the cat on the desktop — the three modes, dragging, snapping to the
left or right screen edge, click-through on transparent pixels, petting. The card shows sample
sessions; real ones are step 2.
