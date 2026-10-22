//! Every desktop secret lives in one Keychain item, read at most once per launch.
//!
//! macOS asks for Keychain access per item and per code signature. Ad-hoc builds change their
//! signature on every build, so six separate items meant up to six prompts after each update,
//! and per-request reads meant prompts mid-typing. One cached item means at most one prompt
//! per launch, and none at all until a feature that needs a secret is used.
use security_framework::passwords::{
    delete_generic_password_options, generic_password, set_generic_password_options,
};
use std::{collections::BTreeMap, sync::Mutex};

const ACCOUNT: &str = "credentials";
/// The identity whose legacy per-secret items are moved into its vault. Other identities, such
/// as a preview build, start empty so they never take the installed app's credentials.
const MIGRATING_IDENTITY: &str = "dev.precipice.desktop";
const LEGACY: [(&str, &str, &str); 6] = [
    ("dev.precipice.desktop.anthropic", "api-key", "anthropic"),
    ("dev.precipice.desktop.typesafe", "api-key", "typesafe"),
    ("dev.precipice.desktop.agent", "session", "agent"),
    ("dev.precipice.desktop.chatgpt", "session", "chatgpt.session"),
    ("dev.precipice.desktop.chatgpt", "registration", "chatgpt.registration"),
    ("dev.precipice.desktop.chatgpt", "host", "chatgpt.host"),
];

pub const DENIED: &str = "Keychain access was not allowed. Choose Allow Keychain access in Settings → AI.";

enum State {
    Unloaded,
    Ready(BTreeMap<String, String>),
    /// Remembered until the person asks to retry, so a refusal is never re-asked on its own.
    Denied,
}

pub struct Vault {
    service: String,
    state: Mutex<State>,
}

static VAULT: std::sync::OnceLock<Vault> = std::sync::OnceLock::new();

pub fn init(identifier: &str) {
    let _ = VAULT.set(Vault {
        service: identifier.to_string(),
        state: Mutex::new(State::Unloaded),
    });
}

fn vault() -> Result<&'static Vault, &'static str> {
    VAULT.get().ok_or("Keychain is not ready yet.")
}

impl Vault {
    fn options(service: &str, account: &str) -> security_framework::passwords::PasswordOptions {
        crate::credential_options(service, account)
    }

    fn load(&self) -> Result<BTreeMap<String, String>, &'static str> {
        match generic_password(Self::options(&self.service, ACCOUNT)) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Saved credentials are invalid."),
            Err(error) if error.code() == crate::NOT_FOUND => self.migrate(),
            Err(_) => Err(DENIED),
        }
    }

    fn migrate(&self) -> Result<BTreeMap<String, String>, &'static str> {
        let mut secrets = BTreeMap::new();
        if self.service != MIGRATING_IDENTITY {
            return Ok(secrets);
        }
        for (service, account, name) in LEGACY {
            match generic_password(Self::options(service, account)) {
                Ok(bytes) => {
                    if let Ok(value) = String::from_utf8(bytes) {
                        secrets.insert(name.to_string(), value);
                    }
                }
                Err(error) if error.code() == crate::NOT_FOUND => {}
                Err(_) => return Err(DENIED),
            }
        }
        if !secrets.is_empty() {
            self.write(&secrets)?;
        }
        for (service, account, _) in LEGACY {
            let _ = delete_generic_password_options(Self::options(service, account));
        }
        Ok(secrets)
    }

    fn write(&self, secrets: &BTreeMap<String, String>) -> Result<(), &'static str> {
        let bytes = serde_json::to_vec(secrets).map_err(|_| "Could not save credentials.")?;
        set_generic_password_options(&bytes, Self::options(&self.service, ACCOUNT))
            .map_err(|_| "Could not save credentials in Keychain.")
    }

    fn with<T>(
        &self,
        apply: impl FnOnce(&mut BTreeMap<String, String>) -> Result<T, &'static str>,
    ) -> Result<T, &'static str> {
        let mut state = self.state.lock().map_err(|_| "Keychain is unavailable.")?;
        if matches!(*state, State::Unloaded) {
            *state = match self.load() {
                Ok(secrets) => State::Ready(secrets),
                Err(DENIED) => State::Denied,
                Err(error) => return Err(error),
            };
        }
        match &mut *state {
            State::Ready(secrets) => apply(secrets),
            _ => Err(DENIED),
        }
    }
}

pub fn get(name: &str) -> Result<Option<String>, &'static str> {
    vault()?.with(|secrets| Ok(secrets.get(name).cloned()))
}

pub fn set(name: &str, value: Option<&str>) -> Result<(), &'static str> {
    let vault = vault()?;
    vault.with(|secrets| {
        let mut next = secrets.clone();
        match value {
            Some(value) => next.insert(name.to_string(), value.to_string()),
            None => next.remove(name),
        };
        if next == *secrets {
            return Ok(());
        }
        if next.is_empty() {
            match delete_generic_password_options(Vault::options(&vault.service, ACCOUNT)) {
                Ok(()) => {}
                Err(error) if error.code() == crate::NOT_FOUND => {}
                Err(_) => return Err("Could not remove credentials from Keychain."),
            }
        } else {
            vault.write(&next)?;
        }
        *secrets = next;
        Ok(())
    })
}

/// Forgets a refusal so the next read asks macOS again. Only called from an explicit click.
#[tauri::command]
pub fn keychain_retry() -> Result<(), &'static str> {
    let vault = vault()?;
    let mut state = vault.state.lock().map_err(|_| "Keychain is unavailable.")?;
    if matches!(*state, State::Denied) {
        *state = State::Unloaded;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "writes a disposable vault to the local login Keychain"]
    fn persists_once_and_answers_from_cache() {
        let vault = Vault {
            service: format!("dev.precipice.desktop.test-vault-{}", std::process::id()),
            state: Mutex::new(State::Unloaded),
        };
        assert_eq!(vault.with(|s| Ok(s.len())).unwrap(), 0);
        vault.with(|s| { s.insert("a".into(), "1".into()); vault.write(s) }).unwrap();
        let fresh = Vault { service: vault.service.clone(), state: Mutex::new(State::Unloaded) };
        assert_eq!(fresh.with(|s| Ok(s.get("a").cloned())).unwrap().as_deref(), Some("1"));
        delete_generic_password_options(Vault::options(&vault.service, ACCOUNT)).unwrap();
        // The cached copy keeps answering without another Keychain read.
        assert_eq!(fresh.with(|s| Ok(s.get("a").cloned())).unwrap().as_deref(), Some("1"));
    }
    #[test]
    fn other_identities_never_migrate_the_installed_apps_items() {
        let vault = Vault {
            service: "dev.precipice.desktop.preview".into(),
            state: Mutex::new(State::Unloaded),
        };
        assert!(vault.migrate().unwrap().is_empty());
    }
}
