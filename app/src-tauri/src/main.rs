// A transparent, always-on-top window for a Claude Code desktop pet.
#![windows_subsystem = "windows"]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the widget");
}
