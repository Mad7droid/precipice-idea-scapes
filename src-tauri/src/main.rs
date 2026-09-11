#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
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
            read_api_key,
            save_api_key,
            remove_api_key
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
