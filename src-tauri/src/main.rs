#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp;

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
        .setup(|app| {
            mcp::start_listener(app.handle().clone());
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
            read_agent_session,
            save_agent_session,
            open_agent_signin,
            read_api_key,
            save_api_key,
            remove_api_key,
            mcp::mcp_ready,
            mcp::mcp_send,
            mcp::mcp_install_client,
            mcp::mcp_helper_path
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
