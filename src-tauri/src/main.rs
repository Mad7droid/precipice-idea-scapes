#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod dictation;
mod mcp;
mod ai_connection;
mod claude_connection;

use security_framework::passwords::{
    delete_generic_password_options, generic_password, set_generic_password_options,
    PasswordOptions,
};
const SERVICE: &str = "dev.precipice.desktop.anthropic";
const ACCOUNT: &str = "api-key";
const NOT_FOUND: i32 = -25300;

fn credential_options(service: &str, account: &str) -> PasswordOptions {
    let mut options = PasswordOptions::new_generic_password(service, account);
    options.set_access_synchronized(Some(false));
    options
}

fn valid_key(key: &str) -> bool {
    key.starts_with("sk-ant-") && key.len() <= 4096 && !key.chars().any(char::is_whitespace)
}

#[tauri::command]
fn read_api_key() -> Result<Option<String>, &'static str> {
    match generic_password(credential_options(SERVICE, ACCOUNT)) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "Invalid credential encoding"),
        Err(error) if error.code() == NOT_FOUND => Ok(None),
        Err(_) => Err("Keychain read failed"),
    }
}

#[tauri::command]
fn save_api_key(key: String) -> Result<(), &'static str> {
    let key = key.trim();
    if !valid_key(key) {
        return Err("Invalid Anthropic key");
    }
    set_generic_password_options(key.as_bytes(), credential_options(SERVICE, ACCOUNT))
        .map_err(|_| "Keychain save failed")
}

#[tauri::command]
fn remove_api_key() -> Result<(), &'static str> {
    match delete_generic_password_options(credential_options(SERVICE, ACCOUNT)) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == NOT_FOUND => Ok(()),
        Err(_) => Err("Keychain removal failed"),
    }
}

/// The optional TypeSafe (Jev) routing key. A separate Keychain item and separate commands, so
/// the routing key and the Anthropic key can never be read through each other's grant.
const TYPESAFE_SERVICE: &str = "dev.precipice.desktop.typesafe";

/// TypeSafe does not document a key prefix, so this checks shape only.
fn valid_typesafe_key(key: &str) -> bool {
    key.len() >= 8 && key.len() <= 4096 && !key.chars().any(|c| c.is_whitespace() || c.is_control())
}

#[tauri::command]
fn read_typesafe_key() -> Result<Option<String>, &'static str> {
    match generic_password(credential_options(TYPESAFE_SERVICE, ACCOUNT)) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "Invalid credential encoding"),
        Err(error) if error.code() == NOT_FOUND => Ok(None),
        Err(_) => Err("Keychain read failed"),
    }
}

#[tauri::command]
fn save_typesafe_key(key: String) -> Result<(), &'static str> {
    let key = key.trim();
    if !valid_typesafe_key(key) {
        return Err("Invalid TypeSafe key");
    }
    set_generic_password_options(key.as_bytes(), credential_options(TYPESAFE_SERVICE, ACCOUNT))
        .map_err(|_| "Keychain save failed")
}

#[tauri::command]
fn remove_typesafe_key() -> Result<(), &'static str> {
    match delete_generic_password_options(credential_options(TYPESAFE_SERVICE, ACCOUNT)) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == NOT_FOUND => Ok(()),
        Err(_) => Err("Keychain removal failed"),
    }
}

/// Jev routing from the Mac app. TypeSafe's API does not allow the app's `tauri://` origin in
/// CORS, so the request is made natively. The key is read from Keychain here and never passes
/// back through the webview; the body is the bounded routing request the webview built.
const TYPESAFE_URL: &str = "https://api.typesafe.ai/v1/systemone";
const JEV_MAX_BODY: usize = 64 * 1024;

fn jev_agent() -> &'static ureq::Agent {
    static AGENT: std::sync::OnceLock<ureq::Agent> = std::sync::OnceLock::new();
    // One pooled agent: a warm connection is most of the latency budget.
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .https_only(true)
            .max_redirects(0)
            .http_status_as_error(false)
            .timeout_global(Some(std::time::Duration::from_millis(2_000)))
            .build()
            .into()
    })
}

#[tauri::command]
async fn jev_route(body: String) -> Result<String, &'static str> {
    if body.len() > JEV_MAX_BODY || serde_json::from_str::<serde_json::Value>(&body).is_err() {
        return Err("Invalid routing request");
    }
    let key = read_typesafe_key()?.ok_or("Add a TypeSafe key in Settings")?;
    tauri::async_runtime::spawn_blocking(move || {
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

const AGENT_SERVICE: &str = "dev.precipice.desktop.agent";

#[tauri::command]
fn read_agent_session() -> Result<Option<String>, &'static str> {
    match generic_password(credential_options(AGENT_SERVICE, "session")) {
        Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| "Invalid session"),
        Err(error) if error.code() == NOT_FOUND => Ok(None),
        Err(_) => Err("Keychain read failed"),
    }
}

#[tauri::command]
fn save_agent_session(value: Option<String>) -> Result<(), &'static str> {
    if let Some(value) = value {
        if value.len() > 4096 { return Err("Invalid session"); }
        let parsed: serde_json::Value = serde_json::from_str(&value).map_err(|_| "Invalid session")?;
        let token = parsed["token"].as_str().ok_or("Invalid session")?;
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("Invalid session"); }
        set_generic_password_options(value.as_bytes(), credential_options(AGENT_SERVICE, "session")).map_err(|_| "Keychain save failed")
    } else {
        match delete_generic_password_options(credential_options(AGENT_SERVICE, "session")) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == NOT_FOUND => Ok(()),
            Err(_) => Err("Keychain removal failed"),
        }
    }
}

#[tauri::command]
fn open_agent_signin(url: String) -> Result<(), &'static str> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid sign-in URL")?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("precipice-mcp.precipice.workers.dev") || parsed.path() != "/host/start" || !parsed.username().is_empty() || parsed.password().is_some() || parsed.port().is_some() {
        return Err("Invalid sign-in URL");
    }
    std::process::Command::new("/usr/bin/open").arg(url).status().map_err(|_| "Could not open browser")?;
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
            .build()?;
            Ok(())
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
            read_agent_session,
            save_agent_session,
            open_agent_signin,
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
            dictation::dictation_status,
            dictation::dictation_install,
            dictation::dictation_cancel_install,
            dictation::dictation_prepare,
            dictation::dictation_start,
            dictation::dictation_stop,
            dictation::dictation_cancel
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Precipice");
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
    #[ignore = "writes a disposable credential to the local login Keychain"]
    fn keychain_round_trip() {
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
