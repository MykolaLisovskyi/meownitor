// Plan limits: the request Claude Code's own /usage makes (GET /api/oauth/usage) — an account query,
// not a model call, so it costs nothing against the limits. It uses Claude Code's sign-in from
// ~/.claude/.credentials.json; when the access token is about to expire it is refreshed the way
// Claude Code refreshes it and written back, so a single `claude` login keeps the widget going.
// No token ever leaves this module and nothing here is logged.
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
/// Claude Code's production OAuth client.
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
/// Refresh this long before the token expires.
const EARLY_MS: u64 = 5 * 60 * 1000;

#[derive(Serialize, Clone, Default)]
pub struct Limits {
    /// "ok", or why there is no data: "login" (no usable Claude Code sign-in) or "net".
    status: String,
    /// The usage response as the server sent it (percentages and reset times, no secrets).
    data: Value,
    at: u64,
}

pub struct Latest(pub Mutex<Limits>);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn creds_path() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME");
    home.map(|h| PathBuf::from(h).join(".claude").join(".credentials.json"))
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .build()
}

/// A usable access token, refreshing it first when it is (nearly) expired or `force` is set.
fn token(force: bool) -> Result<String, &'static str> {
    let path = creds_path().ok_or("login")?;
    let mut creds: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).map_err(|_| "login")?)
            .map_err(|_| "login")?;
    let oauth = creds.get("claudeAiOauth").ok_or("login")?;
    let access = oauth
        .get("accessToken")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let expires = oauth.get("expiresAt").and_then(|v| v.as_u64()).unwrap_or(0);
    if !force && !access.is_empty() && expires > now_ms() + EARLY_MS {
        return Ok(access);
    }
    let refresh = oauth
        .get("refreshToken")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if refresh.is_empty() {
        return Err("login");
    }
    let resp = agent()
        .post(TOKEN_URL)
        .set("Content-Type", "application/json")
        .send_json(json!({ "grant_type": "refresh_token", "refresh_token": refresh, "client_id": CLIENT_ID }));
    let body: Value = match resp {
        Ok(r) => r.into_json().map_err(|_| "net")?,
        Err(ureq::Error::Status(_, _)) => return Err("login"),
        Err(_) => return Err("net"),
    };
    let new_access = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("login")?
        .to_string();
    let o = creds.get_mut("claudeAiOauth").ok_or("login")?;
    o["accessToken"] = json!(new_access);
    if let Some(r) = body.get("refresh_token").and_then(|v| v.as_str()) {
        o["refreshToken"] = json!(r);
    }
    if let Some(s) = body.get("expires_in").and_then(|v| v.as_u64()) {
        o["expiresAt"] = json!(now_ms() + s * 1000);
    }
    // Written back whole, so Claude Code itself keeps working with the rotated tokens.
    let tmp = path.with_extension("json.widget-tmp");
    if std::fs::write(
        &tmp,
        serde_json::to_string_pretty(&creds).unwrap_or_default(),
    )
    .is_ok()
    {
        if std::fs::rename(&tmp, &path).is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
    }
    Ok(new_access)
}

fn usage(tok: &str) -> Result<Value, (u16, &'static str)> {
    let resp = agent()
        .get(USAGE_URL)
        .set("Authorization", &format!("Bearer {tok}"))
        .set("anthropic-beta", "oauth-2025-04-20")
        .set("Content-Type", "application/json")
        .call();
    match resp {
        Ok(r) => r.into_json().map_err(|_| (0, "net")),
        Err(ureq::Error::Status(code, _)) => Err((code, "login")),
        Err(_) => Err((0, "net")),
    }
}

fn fetch() -> Result<Value, &'static str> {
    let tok = token(false)?;
    match usage(&tok) {
        Ok(v) => Ok(v),
        // The server may have revoked the token early: refresh once and retry.
        Err((401, _)) => usage(&token(true)?).map_err(|e| e.1),
        Err((_, why)) => Err(why),
    }
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        let (limits, wait) = match fetch() {
            Ok(data) => (
                Limits {
                    status: "ok".into(),
                    data,
                    at: now_ms(),
                },
                60,
            ),
            Err(why) => (
                Limits {
                    status: why.into(),
                    data: Value::Null,
                    at: now_ms(),
                },
                if why == "net" { 30 } else { 60 },
            ),
        };
        if let Some(latest) = app.try_state::<Latest>() {
            *latest.0.lock().unwrap() = limits.clone();
        }
        let _ = app.emit("limits", &limits);
        std::thread::sleep(Duration::from_secs(wait));
    });
}
