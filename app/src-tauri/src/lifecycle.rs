// What the installer asks of the widget (windows/installer-hooks.nsh), with no window: uninstalling
// takes our hook out of Claude Code's settings and drops the start-with-Windows entry, and remembers
// both in restore.json in the data folder; the next install puts them back. An upgrade that
// uninstalls the old version first therefore keeps both, and so does installing again later.
use serde_json::{json, Value};
use std::path::PathBuf;

fn marker() -> Option<PathBuf> {
    crate::sessions::data_dir().map(|d| d.join("restore.json"))
}

/// The start-with-Windows entry as tauri-plugin-autostart makes it: named after the app, this exe, no args.
#[cfg(windows)]
pub fn autolaunch(name: &str) -> Option<auto_launch::AutoLaunch> {
    let exe = std::env::current_exe().ok()?;
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name(name)
        .set_app_path(&exe.display().to_string())
        .build()
        .ok()
}

#[cfg(not(windows))]
pub fn autolaunch(_: &str) -> Option<auto_launch::AutoLaunch> {
    None
}

/// `--uninstall`
pub fn uninstall(name: &str) {
    let hook = crate::hooks::status().installed && crate::hooks::uninstall().is_ok();
    let autostart =
        autolaunch(name).is_some_and(|a| a.is_enabled().unwrap_or(false) && a.disable().is_ok());
    if let (true, Some(p)) = (hook || autostart, marker()) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(
            &p,
            json!({ "hook": hook, "autostart": autostart }).to_string(),
        );
    }
}

/// `--restore`
pub fn restore(name: &str) {
    let Some(p) = marker() else { return };
    let Some(v) = std::fs::read_to_string(&p)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
    else {
        return;
    };
    let _ = std::fs::remove_file(&p);
    if v["hook"] == true && !crate::hooks::status().installed {
        let _ = crate::hooks::install();
    }
    if v["autostart"] == true {
        if let Some(a) = autolaunch(name) {
            let _ = a.enable();
        }
    }
}
