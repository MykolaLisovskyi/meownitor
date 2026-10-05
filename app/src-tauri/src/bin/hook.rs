// Claude Code hook relay: records what a session is doing into a small per-session JSON file that
// the widget reads (sessions/<session_id>.json under the widget's data folder). It must never slow
// Claude down or fail it — on any problem it just exits 0 without output.
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn state_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("HOME")
        .map(|h| PathBuf::from(h).join("Library").join("Application Support"));
    base.map(|b| b.join("ClaudeWidget").join("sessions"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// First line, trimmed to `n` characters.
fn short(s: &str, n: usize) -> String {
    let line = s.lines().next().unwrap_or("").trim();
    let mut out: String = line.chars().take(n).collect();
    if line.chars().count() > n {
        out.push('…');
    }
    out
}

fn base_name(p: &str) -> String {
    p.rsplit(['/', '\\']).next().unwrap_or(p).to_string()
}

/// The tool as the widget names it, and the one detail worth a glance: the command's own
/// description, the file, the pattern, the host.
fn describe(tool: &str, input: &Value) -> (String, String) {
    let s = |k: &str| input.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let name = match tool.strip_prefix("mcp__") {
        Some(rest) => rest.rsplit("__").next().unwrap_or(rest).to_string(),
        None => tool.to_string(),
    };
    let detail = match tool {
        "Bash" | "PowerShell" => short(
            if s("description").is_empty() {
                s("command")
            } else {
                s("description")
            },
            80,
        ),
        "Read" | "Edit" | "Write" | "MultiEdit" => base_name(s("file_path")),
        "NotebookEdit" => base_name(s("notebook_path")),
        "Grep" | "Glob" => short(s("pattern"), 60),
        "WebFetch" => s("url").split('/').nth(2).unwrap_or("").to_string(),
        "WebSearch" => short(s("query"), 60),
        "Task" | "Agent" => short(s("description"), 60),
        "Skill" => short(s("skill"), 40),
        "AskUserQuestion" => input
            .pointer("/questions/0/question")
            .and_then(|v| v.as_str())
            .map(|q| short(q, 80))
            .unwrap_or_default(),
        _ => String::new(),
    };
    (name, detail)
}

/// One line per event in ClaudeWidget/events.log, so what Claude actually sends can be checked;
/// the log starts over once it passes 512 KB.
fn log_event(dir: &std::path::Path, now: u64, sid: &str, event: &str, tool: &str) {
    use std::io::Write;
    let Some(base) = dir.parent() else { return };
    let path = base.join("events.log");
    if std::fs::metadata(&path)
        .map(|m| m.len() > 512 * 1024)
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "{now} {} {event} {tool}", &sid[..sid.len().min(8)]);
    }
}

/// `where` and `wait`: the two calls a Claude session makes to ask through the widget.
/// `where` prints (and creates) this session's round folder; the session writes <name>.html there.
/// `wait <name>` blocks until the user sends the answer, prints it and exits — run it in the
/// background, its exit is what brings the session back. The session id comes from the
/// CLAUDE_CODE_SESSION_ID that Claude Code gives every command it runs.
fn round_command(args: &[String]) -> Option<i32> {
    let cmd = args.get(1)?.as_str();
    if cmd != "where" && cmd != "wait" {
        return None;
    }
    let sid = std::env::var("CLAUDE_CODE_SESSION_ID").unwrap_or_default();
    if sid.is_empty()
        || !sid
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        eprintln!("CLAUDE_CODE_SESSION_ID is not set — run this from a Claude Code session");
        return Some(2);
    }
    let dir = state_dir()?.parent()?.join("rounds").join(&sid);
    let _ = std::fs::create_dir_all(&dir);
    if cmd == "where" {
        println!("{}", dir.display());
        return Some(0);
    }
    let name = args
        .get(2)
        .map(|n| n.trim_end_matches(".html").to_string())
        .unwrap_or_default();
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        eprintln!("usage: claude-widget-hook wait <round-name>   (letters, digits, - and _)");
        return Some(2);
    }
    if !dir.join(format!("{name}.html")).exists() {
        eprintln!("no round {name}.html in {}", dir.display());
        return Some(2);
    }
    let answer = dir.join(format!("{name}.answer.md"));
    let hours: u64 = args.get(3).and_then(|h| h.parse().ok()).unwrap_or(8);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(hours * 3600);
    while std::time::Instant::now() < deadline {
        if let Ok(text) = std::fs::read_to_string(&answer) {
            println!(
                "ANSWER to {name}:
{text}"
            );
            return Some(0);
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    println!("No answer to {name} — gave up waiting.");
    Some(1)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(code) = round_command(&args) {
        std::process::exit(code);
    }
    let mut buf = String::new();
    if std::io::stdin().read_to_string(&mut buf).is_err() {
        return;
    }
    let Ok(ev) = serde_json::from_str::<Value>(&buf) else {
        return;
    };
    let str_of = |k: &str| ev.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let sid = str_of("session_id");
    if sid.is_empty()
        || !sid
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return;
    }
    let Some(dir) = state_dir() else { return };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(format!("{sid}.json"));
    let mut st: Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}));
    let prev = |k: &str| st.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let (prev_state, prev_what, prev_detail) = (prev("state"), prev("what"), prev("detail"));

    let event = str_of("hook_event_name");
    let tool = str_of("tool_name");
    let input = ev.get("tool_input").cloned().unwrap_or(Value::Null);
    let (state, what, detail): (String, String, String) = match event.as_str() {
        "SessionStart" => ("idle".into(), String::new(), String::new()),
        "UserPromptSubmit" => ("run".into(), "Думає".into(), String::new()),
        "PreToolUse" if tool == "AskUserQuestion" => (
            "wait".into(),
            "Питає тебе".into(),
            describe(&tool, &input).1,
        ),
        "PreToolUse" => {
            let (n, d) = describe(&tool, &input);
            ("run".into(), n, d)
        }
        // A background agent can finish after the turn has ended: that must not wake a finished session.
        "SubagentStop" if prev_state == "done" || prev_state == "idle" => {
            (prev_state.clone(), prev_what.clone(), prev_detail.clone())
        }
        "PostToolUse" | "PostToolUseFailure" | "SubagentStop" => {
            ("run".into(), "Думає".into(), String::new())
        }
        "SubagentStart" => ("run".into(), "Агент".into(), str_of("agent_type")),
        "PermissionRequest" => {
            let (n, d) = describe(&tool, &input);
            ("wait".into(), format!("Чекає дозволу · {n}"), d)
        }
        "Notification" if str_of("message").contains("permission") => (
            "wait".into(),
            "Чекає дозволу".into(),
            short(&str_of("message"), 80),
        ),
        // "Claude is waiting for your input" and the like change nothing.
        "Notification" => (prev_state.clone(), prev_what.clone(), prev_detail.clone()),
        "Stop" => ("done".into(), "Готово — твоя черга".into(), String::new()),
        "StopFailure" => ("done".into(), "Зупинилась з помилкою".into(), String::new()),
        "SessionEnd" => ("ended".into(), String::new(), String::new()),
        _ => return,
    };

    let now = now_ms();
    // The clock shows how long the session has been in its state — working since your message,
    // waiting since it asked — not how long the current tool has been running.
    // A new message starts a new turn even if the previous turn's Stop never arrived.
    let changed = state != prev_state || event == "UserPromptSubmit";
    st["sid"] = json!(sid);
    st["cwd"] = json!(str_of("cwd"));
    // The widget reads its tail: stopping a turn fires no hook and shows only there.
    st["transcript"] = json!(str_of("transcript_path"));
    st["event"] = json!(event);
    st["updated"] = json!(now);
    if changed || st.get("since").is_none() {
        st["since"] = json!(now);
    }
    st["state"] = json!(state);
    st["what"] = json!(what);
    st["detail"] = json!(detail);

    log_event(&dir, now, &sid, &event, &tool);

    let tmp = dir.join(format!("{sid}.{}.tmp", std::process::id()));
    if std::fs::write(&tmp, st.to_string()).is_ok() && std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}
