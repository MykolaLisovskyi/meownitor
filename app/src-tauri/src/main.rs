// Claude session widget: a transparent always-on-top window whose geometry the web side drives
// through a few commands in physical pixels, so dragging, snapping to a screen edge and the
// cursor-following eyes behave the same on any monitor and any DPI.
#![windows_subsystem = "windows"]

mod limits;
mod sessions;

use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, PhysicalPosition, PhysicalSize, State, WebviewWindow};

/// Cursor-to-window offset captured when a drag starts.
#[derive(Default)]
struct DragOffset(Mutex<Option<(f64, f64)>>);

#[derive(Serialize, Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Serialize)]
struct Poll {
    cursor: (f64, f64),
    win: Rect,
    work: Rect,
    scale: f64,
}

fn snapshot(w: &WebviewWindow) -> Poll {
    let cursor = w
        .cursor_position()
        .map(|p| (p.x, p.y))
        .unwrap_or((-1e9, -1e9));
    let pos = w.outer_position().unwrap_or_default();
    let size = w.outer_size().unwrap_or_default();
    let monitor = w
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| w.primary_monitor().ok().flatten());
    let (work, scale) = match monitor {
        Some(m) => {
            let a = m.work_area();
            (
                Rect {
                    x: a.position.x as f64,
                    y: a.position.y as f64,
                    w: a.size.width as f64,
                    h: a.size.height as f64,
                },
                m.scale_factor(),
            )
        }
        None => (
            Rect {
                x: 0.0,
                y: 0.0,
                w: 1920.0,
                h: 1080.0,
            },
            1.0,
        ),
    };
    Poll {
        cursor,
        win: Rect {
            x: pos.x as f64,
            y: pos.y as f64,
            w: size.width as f64,
            h: size.height as f64,
        },
        work,
        scale,
    }
}

#[tauri::command]
fn poll(window: WebviewWindow) -> Poll {
    snapshot(&window)
}

#[tauri::command]
fn place(window: WebviewWindow, x: i32, y: i32, w: u32, h: u32) {
    let _ = window.set_size(PhysicalSize::new(w, h));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// How to start: `CLAUDE_WIDGET_START` (card, dock-l, dock-r, dock-r-open) and `CLAUDE_WIDGET_MOOD` —
/// so every mode can be opened and captured without touching the mouse.
#[tauri::command]
fn start_hint() -> (Option<String>, Option<String>) {
    (
        std::env::var("CLAUDE_WIDGET_START").ok(),
        std::env::var("CLAUDE_WIDGET_MOOD").ok(),
    )
}

#[tauri::command]
fn sessions(latest: State<sessions::Latest>) -> Vec<sessions::Session> {
    latest.0.lock().unwrap().clone()
}

#[tauri::command]
fn limits(latest: State<limits::Latest>) -> limits::Limits {
    latest.0.lock().unwrap().clone()
}

#[tauri::command]
fn open_session(local: String) {
    sessions::open_in_desktop(&local);
}

#[tauri::command]
fn show(window: WebviewWindow) {
    let _ = window.show();
}

#[tauri::command]
fn ignore(window: WebviewWindow, on: bool) {
    let _ = window.set_ignore_cursor_events(on);
}

#[tauri::command]
fn drag_start(window: WebviewWindow, drag: State<DragOffset>) {
    let p = snapshot(&window);
    *drag.0.lock().unwrap() = Some((p.cursor.0 - p.win.x, p.cursor.1 - p.win.y));
}

#[tauri::command]
fn drag_move(window: WebviewWindow, drag: State<DragOffset>) {
    let offset = *drag.0.lock().unwrap();
    if let (Some((dx, dy)), Ok(c)) = (offset, window.cursor_position()) {
        let _ = window.set_position(PhysicalPosition::new(
            (c.x - dx).round() as i32,
            (c.y - dy).round() as i32,
        ));
    }
}

#[tauri::command]
fn drag_end(window: WebviewWindow, drag: State<DragOffset>) -> Poll {
    *drag.0.lock().unwrap() = None;
    snapshot(&window)
}

fn main() {
    tauri::Builder::default()
        .manage(DragOffset::default())
        .manage(sessions::Latest(Mutex::new(Vec::new())))
        .manage(limits::Latest(Mutex::new(limits::Limits::default())))
        .invoke_handler(tauri::generate_handler![
            poll,
            place,
            start_hint,
            sessions,
            limits,
            open_session,
            show,
            ignore,
            drag_start,
            drag_move,
            drag_end
        ])
        .setup(|app| {
            let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
            let moods = Submenu::with_items(
                app,
                "Настрій",
                true,
                &[
                    &item("mood:auto", "Авто — за сесіями")?,
                    &item("mood:idle", "Відпочиває")?,
                    &item("mood:work", "Працює")?,
                    &item("mood:ask", "Питає тебе")?,
                    &item("mood:done", "Готово")?,
                    &item("mood:sleep", "Спить")?,
                    &item("mood:tired", "Ліміт під межею")?,
                ],
            )?;
            let kinds = Submenu::with_items(
                app,
                "Персонаж",
                true,
                &[
                    &item("kind:cat", "Котик")?,
                    &item("kind:blob", "Краплинка")?,
                    &item("kind:ghost", "Привидок")?,
                ],
            )?;
            let quit = item("quit", "Вийти")?;
            let menu = Menu::with_items(
                app,
                &[&moods, &kinds, &PredefinedMenuItem::separator(app)?, &quit],
            )?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Claude Widget")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    if id == "quit" {
                        app.exit(0);
                    } else {
                        let _ = app.emit("tray", id.to_string());
                    }
                })
                .build(app)?;
            sessions::spawn(app.handle().clone());
            limits::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the widget");
}
