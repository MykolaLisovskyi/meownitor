// The widget's own settings and memory: the character, the ask sound, where it was left (mode,
// docked edge, position) and whether the idle group was open — config.json in the data folder.
// The web side owns the shape; this side only reads and merges.
use serde_json::{json, Value};
use std::path::PathBuf;

fn path() -> Option<PathBuf> {
    crate::sessions::data_dir().map(|d| d.join("config.json"))
}

pub fn read() -> Value {
    path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({}))
}

/// Merges `patch` (top-level keys) into the stored config.
pub fn merge(patch: &Value) -> Value {
    let mut cfg = read();
    if let (Some(obj), Some(p)) = (cfg.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            obj.insert(k.clone(), v.clone());
        }
    }
    if let Some(p) = path() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = p.with_extension("json.tmp");
        if std::fs::write(&tmp, serde_json::to_string_pretty(&cfg).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
    cfg
}
