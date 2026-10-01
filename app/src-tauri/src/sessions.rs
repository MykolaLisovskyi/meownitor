// The session list the card shows. Two sources, merged by Claude Code's session id:
// - what each session is doing, written by our hook (bin/hook.rs) into sessions/<id>.json;
// - Claude Desktop's own record of each session (title, its local id for the claude:// link,
//   archived or not), one JSON file per session under claude-code-sessions.
// A background thread re-reads both and emits "sessions" to the window whenever the list changes.
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// A session counts as open while it was active within this window; Desktop never forgets a
/// session that was not archived, so "open" has to mean "recent".
const OPEN_FOR_MS: u64 = 24 * 3600 * 1000;
/// A finished turn nobody came back to drops into the idle group after this long.
const DONE_TO_IDLE_MS: u64 = 30 * 60 * 1000;
/// A working or waiting session that has been silent this long is assumed gone.
const STALE_MS: u64 = 30 * 60 * 1000;

#[derive(Serialize, Clone, PartialEq)]
pub struct Session {
    sid: String,
    local: Option<String>,
    title: String,
    state: String,
    what: String,
    detail: String,
    since: u64,
    cwd: String,
}

pub struct Latest(pub Mutex<Vec<Session>>);

struct Hooked {
    cwd: String,
    state: String,
    what: String,
    detail: String,
    since: u64,
    updated: u64,
}

struct Desk {
    local: String,
    title: String,
    archived: bool,
    last: u64,
    cwd: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("HOME")
        .map(|h| PathBuf::from(h).join("Library").join("Application Support"));
    base.map(|b| b.join("ClaudeWidget"))
}

fn desktop_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("HOME")
        .map(|h| PathBuf::from(h).join("Library").join("Application Support"));
    base.map(|b| b.join("Claude").join("claude-code-sessions"))
}

fn str_of(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

fn mtime(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Files changed since the last pass, re-read; files gone, forgotten.
struct Cache<T> {
    seen: HashMap<PathBuf, (SystemTime, Option<(String, T)>)>,
}

impl<T> Cache<T> {
    fn new() -> Self {
        Cache {
            seen: HashMap::new(),
        }
    }
    fn refresh(&mut self, files: Vec<PathBuf>, parse: impl Fn(&Path) -> Option<(String, T)>) {
        let mut next = HashMap::new();
        for f in files {
            let Some(m) = mtime(&f) else { continue };
            match self.seen.remove(&f) {
                Some((old, v)) if old == m => {
                    next.insert(f, (old, v));
                }
                _ => {
                    let v = parse(&f);
                    next.insert(f, (m, v));
                }
            }
        }
        self.seen = next;
    }
    fn values(&self) -> impl Iterator<Item = &(String, T)> {
        self.seen.values().filter_map(|(_, v)| v.as_ref())
    }
}

fn list_json(dir: &Path, depth: u32, prefix: &str, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                list_json(&p, depth - 1, prefix, out);
            }
        } else if p.extension().map_or(false, |x| x == "json")
            && p.file_name()
                .and_then(|n| n.to_str())
                .map_or(false, |n| n.starts_with(prefix))
        {
            out.push(p);
        }
    }
}

fn parse_hooked(p: &Path) -> Option<(String, Hooked)> {
    let v = read_json(p)?;
    let num = |k: &str| v.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    Some((
        str_of(&v, "sid"),
        Hooked {
            cwd: str_of(&v, "cwd"),
            state: str_of(&v, "state"),
            what: str_of(&v, "what"),
            detail: str_of(&v, "detail"),
            since: num("since"),
            updated: num("updated"),
        },
    ))
}

fn parse_desk(p: &Path) -> Option<(String, Desk)> {
    let v = read_json(p)?;
    let cli = str_of(&v, "cliSessionId");
    if cli.is_empty() {
        return None;
    }
    Some((
        cli,
        Desk {
            local: str_of(&v, "sessionId"),
            title: str_of(&v, "title"),
            archived: v
                .get("isArchived")
                .and_then(|x| x.as_bool())
                .unwrap_or(false),
            last: v
                .get("lastActivityAt")
                .and_then(|x| x.as_u64())
                .unwrap_or(0),
            cwd: str_of(&v, "cwd"),
        },
    ))
}

fn folder_name(cwd: &str) -> String {
    cwd.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(cwd)
        .to_string()
}

fn compose(hooks: &Cache<Hooked>, desk: &Cache<Desk>, now: u64) -> Vec<Session> {
    let mut map: HashMap<String, Session> = HashMap::new();
    let mut archived: Vec<String> = Vec::new();
    for (cli, d) in desk.values() {
        if d.archived {
            archived.push(cli.clone());
            continue;
        }
        if now.saturating_sub(d.last) > OPEN_FOR_MS {
            continue;
        }
        map.insert(
            cli.clone(),
            Session {
                sid: cli.clone(),
                local: Some(d.local.clone()),
                title: if d.title.is_empty() {
                    folder_name(&d.cwd)
                } else {
                    d.title.clone()
                },
                state: "idle".into(),
                what: String::new(),
                detail: String::new(),
                since: d.last,
                cwd: d.cwd.clone(),
            },
        );
    }
    for (sid, h) in hooks.values() {
        if archived.contains(sid) || now.saturating_sub(h.updated) > OPEN_FOR_MS {
            continue;
        }
        if h.state == "ended" {
            map.remove(sid);
            continue;
        }
        let mut state = h.state.clone();
        if (state == "done" && now.saturating_sub(h.since) > DONE_TO_IDLE_MS)
            || ((state == "run" || state == "wait") && now.saturating_sub(h.updated) > STALE_MS)
        {
            state = "idle".into();
        }
        let e = map.entry(sid.clone()).or_insert_with(|| Session {
            sid: sid.clone(),
            local: None,
            title: format!("{} · термінал", folder_name(&h.cwd)),
            state: String::new(),
            what: String::new(),
            detail: String::new(),
            since: 0,
            cwd: h.cwd.clone(),
        });
        e.since = if state == "idle" {
            e.since.max(h.updated)
        } else {
            h.since
        };
        e.what = if state == "idle" {
            String::new()
        } else {
            h.what.clone()
        };
        e.detail = if state == "idle" {
            String::new()
        } else {
            h.detail.clone()
        };
        e.state = state;
    }
    let mut list: Vec<Session> = map.into_values().collect();
    list.sort_by(|a, b| b.since.cmp(&a.since));
    list
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let (Some(data), desk_dir) = (data_dir(), desktop_dir()) else {
            return;
        };
        let hook_dir = data.join("sessions");
        let mut hooks: Cache<Hooked> = Cache::new();
        let mut desk: Cache<Desk> = Cache::new();
        let mut last_desk = Instant::now() - Duration::from_secs(60);
        let mut last_sent: Option<Vec<Session>> = None;
        loop {
            let mut files = Vec::new();
            list_json(&hook_dir, 0, "", &mut files);
            hooks.refresh(files, parse_hooked);
            if last_desk.elapsed() >= Duration::from_secs(5) {
                if let Some(d) = &desk_dir {
                    let mut files = Vec::new();
                    list_json(d, 2, "local_", &mut files);
                    desk.refresh(files, parse_desk);
                }
                last_desk = Instant::now();
            }
            let list = compose(&hooks, &desk, now_ms());
            if last_sent.as_ref() != Some(&list) {
                if let Some(latest) = app.try_state::<Latest>() {
                    *latest.0.lock().unwrap() = list.clone();
                }
                let _ = app.emit("sessions", &list);
                last_sent = Some(list);
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    });
}

/// Opens a Desktop session by its local id through the claude:// link Desktop registers.
pub fn open_in_desktop(local: &str) {
    if !local.starts_with("local_")
        || !local[6..]
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return;
    }
    let url = format!("claude://claude.ai/epitaxy/{local}");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(0x0800_0000)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
}
