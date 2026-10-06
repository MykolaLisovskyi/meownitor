# Contributing to Meownitor

Thanks for taking the time. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/kartatyi/meownitor/issues/new/choose) and pick the form that fits.
For a bug, the widget's log helps most: `%USERPROFILE%\.meownitor\widget.log`, and for sessions that
do not show up, `%USERPROFILE%\.meownitor\events.log`. They hold times and event and tool names,
nothing from your sessions' contents, but look them over before you attach them.

Security problems go to a private advisory instead, see [SECURITY.md](SECURITY.md).

## Building

You need Windows 10 or 11, [Rust](https://rustup.rs) (stable), Node 20+ and the MSVC build tools.

```powershell
cd app
npm install
cd src-tauri
cargo build      # target\debug\meownitor.exe and meownitor-hook.exe
```

Run `target\debug\meownitor.exe`. To try a mode without the mouse, set `MEOWNITOR_START` (`card`,
`settings`, `dock-l`, `dock-r`, `dock-r-open`) and `MEOWNITOR_MOOD` (`idle`, `work`, `ask`, `done`,
`sleep`, `tired`) before you start it.

## Before you open a pull request

CI runs the same three checks on every push; run them first:

```powershell
cd app/src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test -- --test-threads=1
```

The tests change environment variables, hence one thread.

If you change how the widget looks, attach a screenshot. The README pictures come from the app's own
pages on made-up data: `python docs/shoot.py` renders them again (Chrome or Edge and Pillow needed).

UI text lives in `app/src/i18n.js` (and `app/src-tauri/src/i18n.rs` for the tray menu); a new string
needs both English and Ukrainian.

## Commit messages

The history follows [Conventional Commits](https://www.conventionalcommits.org): a type, an optional
scope, and a subject in the imperative, up to 72 characters.

```
fix(limits): back off on 429 and 5xx, keep the last numbers

The body says what changed and why, wrapped at 72 characters.
```

Types used here: `feat`, `fix`, `refactor`, `build`, `ci`, `docs`, `chore`. Scopes: `sessions`,
`limits`, `rounds`, `settings`, `i18n`.

## Releasing

Maintainers only: set the version in `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml` and
`app/package.json`, add its section to [CHANGELOG.md](CHANGELOG.md), then push a `vX.Y.Z` tag. The
release workflow does the rest.
