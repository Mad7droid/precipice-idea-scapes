#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_connection;
mod claude_connection;
mod dictation;
mod mcp;
mod vault;

use security_framework::passwords::PasswordOptions;
const NOT_FOUND: i32 = -25300;

fn credential_options(service: &str, account: &str) -> PasswordOptions {
    let mut options = PasswordOptions::new_generic_password(service, account);
    options.set_access_synchronized(Some(false));
    options
}

fn valid_key(key: &str) -> bool {
    key.starts_with("sk-ant-") && key.len() <= 4096 && !key.chars().any(char::is_whitespace)
}

fn read_secret(name: &str) -> Result<Option<String>, &'static str> {
    vault::get(name)
}

/// Async so Keychain prompts never block the main (UI) thread.
#[tauri::command(async)]
fn read_api_key() -> Result<Option<String>, &'static str> {
    read_secret("anthropic")
}

/// Async so Keychain prompts never block the main (UI) thread.
#[tauri::command(async)]
fn save_api_key(key: String) -> Result<(), &'static str> {
    let key = key.trim();
    if !valid_key(key) {
        return Err("Invalid Anthropic key");
    }
    vault::set("anthropic", Some(key))
}

/// Async so Keychain prompts never block the main (UI) thread.
#[tauri::command(async)]
fn remove_api_key() -> Result<(), &'static str> {
    vault::set("anthropic", None)
}

/// TypeSafe does not document a key prefix, so this checks shape only.
fn valid_typesafe_key(key: &str) -> bool {
    key.len() >= 8 && key.len() <= 4096 && !key.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Async so Keychain prompts never block the main (UI) thread.
#[tauri::command(async)]
fn read_typesafe_key() -> Result<bool, &'static str> {
    // Presence only: the key never crosses into the webview; `jev_route` reads it natively.
    Ok(read_secret("typesafe")?.is_some())
}

/// Async so Keychain prompts never block the main (UI) thread.
#[tauri::command(async)]
fn save_typesafe_key(key: String) -> Result<(), &'static str> {
    let key = key.trim();
    if !valid_typesafe_key(key) {
        return Err("Invalid TypeSafe key");
    }
    vault::set("typesafe", Some(key))
}

/// Async so Keychain prompts never block the main (UI) thread.
#[tauri::command(async)]
fn remove_typesafe_key() -> Result<(), &'static str> {
    vault::set("typesafe", None)
}

/// Jev routing from the Mac app. TypeSafe's API does not allow the app's `tauri://` origin in
/// CORS, so the request is made natively with the vault's cached key; the body is the bounded
/// routing request the webview built.
const TYPESAFE_URL: &str = "https://api.typesafe.ai/v1/systemone";
const JEV_MAX_BODY: usize = 64 * 1024;

fn jev_agent() -> &'static ureq::Agent {
    static AGENT: std::sync::OnceLock<ureq::Agent> = std::sync::OnceLock::new();
    // One pooled agent: a warm connection is most of the latency budget. The 4s ceiling
    // matches JEV_ONLY_TIMEOUT_MS in the webview.
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .https_only(true)
            .max_redirects(0)
            .http_status_as_error(false)
            .timeout_global(Some(std::time::Duration::from_millis(4_000)))
            .build()
            .into()
    })
}

#[tauri::command]
async fn jev_route(body: String) -> Result<String, &'static str> {
    if body.len() > JEV_MAX_BODY || serde_json::from_str::<serde_json::Value>(&body).is_err() {
        return Err("Invalid routing request");
    }
    tauri::async_runtime::spawn_blocking(move || {
        // The vault read may hit the Keychain, so it stays off the async executor too.
        let key = read_secret("typesafe")?.ok_or("Add a TypeSafe key in Settings")?;
        let mut response = jev_agent()
            .post(TYPESAFE_URL)
            .header("authorization", &format!("Bearer {key}"))
            .header("content-type", "application/json")
            .send(body.as_str())
            .map_err(|_| "Could not reach TypeSafe")?;
        if !response.status().is_success() {
            return Err("TypeSafe refused the routing request");
        }
        response
            .body_mut()
            .with_config()
            .limit(256 * 1024)
            .read_to_string()
            .map_err(|_| "Invalid TypeSafe response")
    })
    .await
    .map_err(|_| "Routing failed")?
}

/// Async so Keychain prompts never block the main (UI) thread.
#[tauri::command(async)]
fn read_agent_session() -> Result<Option<String>, &'static str> {
    read_secret("agent")
}

/// Async so Keychain prompts never block the main (UI) thread.
#[tauri::command(async)]
fn save_agent_session(value: Option<String>) -> Result<(), &'static str> {
    if let Some(value) = &value {
        if value.len() > 4096 {
            return Err("Invalid session");
        }
        let parsed: serde_json::Value =
            serde_json::from_str(value).map_err(|_| "Invalid session")?;
        let token = parsed["token"].as_str().ok_or("Invalid session")?;
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid session");
        }
    }
    vault::set("agent", value.as_deref())
}

/// Async so Keychain prompts never block the main (UI) thread.
const DEFAULT_MCP_HOST: &str = "precipice-mcp.precipice.workers.dev";

/// The sign-in host comes from the same build-time `VITE_MCP_URL` the webview is built with,
/// so a build pointed at another MCP deployment can sign in there and nowhere else.
fn agent_signin_host() -> &'static str {
    static HOST: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    HOST.get_or_init(|| {
        option_env!("VITE_MCP_URL")
            .and_then(|raw| tauri::Url::parse(raw).ok())
            .filter(|url| url.scheme() == "https")
            .and_then(|url| url.host_str().map(str::to_owned))
            .unwrap_or_else(|| DEFAULT_MCP_HOST.to_owned())
    })
}

/// Only plain http(s) URLs without credentials leave the app, and only to the default browser.
fn external_url(raw: &str) -> Option<tauri::Url> {
    if raw.len() > 8192 {
        return None;
    }
    let url = tauri::Url::parse(raw).ok()?;
    let web = matches!(url.scheme(), "http" | "https");
    (web && url.host_str().is_some_and(|h| !h.is_empty())
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}

#[tauri::command(async)]
fn open_external(url: String) -> Result<(), &'static str> {
    let url = external_url(&url).ok_or("Only web links can be opened")?;
    std::process::Command::new("/usr/bin/open")
        .arg(url.as_str())
        .status()
        .map_err(|_| "Could not open browser")?;
    Ok(())
}

/// Quit flush: the webview saves pending edits, then calls `quit_ready`. Bounded so a stuck
/// webview can never prevent quitting.
static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
const QUIT_FLUSH_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1_500);

fn begin_quit(app: &tauri::AppHandle) {
    use tauri::Emitter;
    if QUITTING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    if app.emit("app://flush-before-quit", ()).is_err() {
        app.exit(0);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_FLUSH_TIMEOUT);
        handle.exit(0);
    });
}

#[tauri::command]
fn quit_ready(app: tauri::AppHandle) {
    if QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
        app.exit(0);
    }
}

/// Blob downloads land in ~/Downloads under a name that never overwrites an existing file.
fn download_destination(dir: &std::path::Path, suggested: &std::path::Path) -> std::path::PathBuf {
    let name = suggested
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && !n.starts_with('.'))
        .unwrap_or("Precipice export");
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = std::path::Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = path.extension().and_then(|e| e.to_str());
    (2..10_000)
        .map(|n| {
            dir.join(match ext {
                Some(ext) => format!("{stem} {n}.{ext}"),
                None => format!("{stem} {n}"),
            })
        })
        .find(|p| !p.exists())
        .unwrap_or(candidate)
}

#[tauri::command(async)]
fn open_agent_signin(url: String) -> Result<(), &'static str> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid sign-in URL")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some(agent_signin_host())
        || parsed.path() != "/host/start"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
    {
        return Err("Invalid sign-in URL");
    }
    std::process::Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|_| "Could not open browser")?;
    Ok(())
}

fn main() {
    // Agents launch this same binary as their MCP command. That mode pipes stdio to the
    // running app and never opens a window.
    if std::env::args().any(|arg| arg == "--mcp") {
        std::process::exit(mcp::run_pipe());
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .manage(dictation::Dictation::default())
        .manage(ai_connection::Connections::default())
        .setup(|app| {
            vault::init(&app.config().identifier);
            // The `--mcp` helper derives the socket from the compile-time identifier.
            debug_assert_eq!(app.config().identifier, mcp::BUNDLE_ID);
            mcp::start_listener(app.handle().clone());
            dictation::start_idle_unloader(app.handle().clone());
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Precipice")
            .inner_size(1280.0, 850.0)
            .min_inner_size(800.0, 600.0)
            .on_navigation(|url| {
                (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                    || (cfg!(debug_assertions)
                        && url.origin().ascii_serialization() == "http://127.0.0.1:1420")
            })
            // target=_blank and window.open never create app windows; the webview routes
            // web links through `open_external` instead.
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, event| {
                match event {
                    tauri::webview::DownloadEvent::Requested { url, destination } => {
                        // Only the app's own blob/data exports; never remote downloads.
                        if !matches!(url.scheme(), "blob" | "data") {
                            return false;
                        }
                        let Some(home) = std::env::var_os("HOME") else {
                            return false;
                        };
                        let dir = std::path::PathBuf::from(home).join("Downloads");
                        *destination = download_destination(&dir, destination);
                        true
                    }
                    tauri::webview::DownloadEvent::Finished { path, success, .. } => {
                        if let (true, Some(path)) = (success, path) {
                            let _ = std::process::Command::new("/usr/bin/open")
                                .arg("-R")
                                .arg(path)
                                .status();
                        }
                        true
                    }
                    _ => true,
                }
            })
            .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_close();
                    begin_quit(&tauri::Manager::app_handle(window).clone());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ai_connection::chatgpt_status,
            ai_connection::chatgpt_connect,
            ai_connection::chatgpt_disconnect,
            ai_connection::chatgpt_cancel_login,
            ai_connection::chatgpt_select,
            ai_connection::chatgpt_request,
            ai_connection::ai_cancel,
            claude_connection::claude_status,
            claude_connection::claude_connect,
            claude_connection::claude_request,
            ai_connection::open_ai_settings,
            vault::keychain_retry,
            vault::keychain_reset,
            read_agent_session,
            save_agent_session,
            open_agent_signin,
            open_external,
            quit_ready,
            read_api_key,
            save_api_key,
            remove_api_key,
            read_typesafe_key,
            save_typesafe_key,
            remove_typesafe_key,
            jev_route,
            mcp::mcp_ready,
            mcp::mcp_send,
            mcp::mcp_install_client,
            mcp::mcp_helper_path,
            mcp::mcp_status,
            dictation::dictation_status,
            dictation::dictation_install,
            dictation::dictation_cancel_install,
            dictation::dictation_prepare,
            dictation::dictation_start,
            dictation::dictation_stop,
            dictation::dictation_cancel
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Precipice")
        .run(|app, event| {
            // Cmd+Q and app-menu Quit arrive with no code; `app.exit` (ours) carries one.
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                if !QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_exit();
                    begin_quit(app);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_without_echoing_credentials() {
        assert!(valid_key("sk-ant-test"));
        assert!(!valid_key(""));
        assert!(!valid_key("sk-ant-test\nother"));
        assert!(!valid_key(&format!("sk-ant-{}", "a".repeat(4096))));
    }
    #[test]
    fn validates_typesafe_key_shape() {
        assert!(valid_typesafe_key("ts_live_abcdef"));
        assert!(!valid_typesafe_key(""));
        assert!(!valid_typesafe_key("short"));
        assert!(!valid_typesafe_key("ts_live abc"));
        assert!(!valid_typesafe_key("ts_live_\u{7}abcdef"));
        assert!(!valid_typesafe_key(&"a".repeat(4097)));
    }
    #[test]
    fn external_links_are_web_only() {
        assert!(external_url("https://example.com/a?b=c").is_some());
        assert!(external_url("http://example.com").is_some());
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "tauri://localhost",
            "mailto:a@b.c",
            "https://user:pw@example.com",
            "https://user@example.com",
            "x-apple.systempreferences:",
            "not a url",
        ] {
            assert!(external_url(bad).is_none(), "{bad}");
        }
    }
    #[test]
    fn signin_host_defaults_to_the_hosted_connector() {
        if option_env!("VITE_MCP_URL").is_none() {
            assert_eq!(agent_signin_host(), DEFAULT_MCP_HOST);
        }
    }
    #[test]
    fn downloads_never_overwrite() {
        let dir = std::env::temp_dir().join(format!("precipice-dl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let first = download_destination(&dir, std::path::Path::new("/x/Scape.json"));
        assert_eq!(first, dir.join("Scape.json"));
        std::fs::write(&first, "a").unwrap();
        assert_eq!(
            download_destination(&dir, std::path::Path::new("Scape.json")),
            dir.join("Scape 2.json")
        );
        assert_eq!(
            download_destination(&dir, std::path::Path::new("../.hidden")),
            dir.join("Precipice export")
        );
    }
    #[test]
    #[ignore = "writes a disposable credential to the local login Keychain"]
    fn keychain_round_trip() {
        use security_framework::passwords::{
            delete_generic_password_options, generic_password, set_generic_password_options,
        };
        let service = "dev.precipice.desktop.test";
        let account = format!("test-{}", std::process::id());
        set_generic_password_options(b"test-value", credential_options(service, &account)).unwrap();
        assert_eq!(
            generic_password(credential_options(service, &account)).unwrap(),
            b"test-value"
        );
        set_generic_password_options(b"replacement", credential_options(service, &account))
            .unwrap();
        assert_eq!(
            generic_password(credential_options(service, &account)).unwrap(),
            b"replacement"
        );
        delete_generic_password_options(credential_options(service, &account)).unwrap();
        assert_eq!(
            generic_password(credential_options(service, &account))
                .unwrap_err()
                .code(),
            NOT_FOUND
        );
    }
}
