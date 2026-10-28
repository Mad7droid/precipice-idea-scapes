//! Every desktop secret lives in one Keychain item, read at most once per launch.
//!
//! macOS asks for Keychain access per item and per code signature. Ad-hoc builds change their
//! signature on every build, so six separate items meant up to six prompts after each update,
//! and per-request reads meant prompts mid-typing. One cached item means at most one prompt
//! per launch, and none at all until a feature that needs a secret is used.
use security_framework::passwords::{
    delete_generic_password_options, generic_password, set_generic_password_options,
};
use std::{
    collections::BTreeMap,
    sync::{Condvar, Mutex},
};

const ACCOUNT: &str = "credentials";
/// The identity whose legacy per-secret items are moved into its vault. Other identities, such
/// as a preview build, start empty so they never take the installed app's credentials.
const MIGRATING_IDENTITY: &str = "dev.precipice.desktop";
const LEGACY: [(&str, &str, &str); 6] = [
    ("dev.precipice.desktop.anthropic", "api-key", "anthropic"),
    ("dev.precipice.desktop.typesafe", "api-key", "typesafe"),
    ("dev.precipice.desktop.agent", "session", "agent"),
    (
        "dev.precipice.desktop.chatgpt",
        "session",
        "chatgpt.session",
    ),
    (
        "dev.precipice.desktop.chatgpt",
        "registration",
        "chatgpt.registration",
    ),
    ("dev.precipice.desktop.chatgpt", "host", "chatgpt.host"),
];

pub const DENIED: &str =
    "Keychain access was not allowed. Choose Allow Keychain access in Settings → AI.";
/// The stored item exists but cannot be parsed. Treated as an empty vault that must be rewritten.
const INVALID: &str = "Saved credentials are invalid.";

enum State {
    Unloaded,
    /// One thread is reading the Keychain without holding the lock; others wait on `loaded`.
    Loading,
    /// `dirty` means the stored item is known to differ from `secrets` (it was unreadable), so
    /// the next change must overwrite it even when the in-memory map looks unchanged.
    Ready {
        secrets: BTreeMap<String, String>,
        dirty: bool,
    },
    /// Remembered until the person asks to retry, so a refusal is never re-asked on its own.
    Denied,
}

pub struct Vault {
    service: String,
    state: Mutex<State>,
    loaded: Condvar,
}

impl Vault {
    fn new(service: String) -> Self {
        Self {
            service,
            state: Mutex::new(State::Unloaded),
            loaded: Condvar::new(),
        }
    }
}

static VAULT: std::sync::OnceLock<Vault> = std::sync::OnceLock::new();

pub fn init(identifier: &str) {
    let _ = VAULT.set(Vault::new(identifier.to_string()));
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
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| INVALID),
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
        apply: impl FnOnce(&mut BTreeMap<String, String>, &mut bool) -> Result<T, &'static str>,
    ) -> Result<T, &'static str> {
        self.with_loader(|| self.load(), apply)
    }

    /// The Keychain read can block on a macOS prompt, so it runs without the lock held. Other
    /// callers wait for that single read instead of starting their own.
    fn with_loader<T>(
        &self,
        load: impl FnOnce() -> Result<BTreeMap<String, String>, &'static str>,
        apply: impl FnOnce(&mut BTreeMap<String, String>, &mut bool) -> Result<T, &'static str>,
    ) -> Result<T, &'static str> {
        const POISONED: &str = "Keychain is unavailable.";
        let mut state = self.state.lock().map_err(|_| POISONED)?;
        while matches!(*state, State::Loading) {
            state = self.loaded.wait(state).map_err(|_| POISONED)?;
        }
        if matches!(*state, State::Unloaded) {
            *state = State::Loading;
            drop(state);
            let result = load();
            state = self.state.lock().map_err(|_| POISONED)?;
            let (next, failure) = match result {
                Ok(secrets) => (
                    State::Ready {
                        secrets,
                        dirty: false,
                    },
                    None,
                ),
                // Unreadable contents: start empty and overwrite on the next save. Cached, so a
                // corrupt item never causes a prompt per read.
                Err(INVALID) => (
                    State::Ready {
                        secrets: BTreeMap::new(),
                        dirty: true,
                    },
                    None,
                ),
                Err(DENIED) => (State::Denied, None),
                Err(error) => (State::Unloaded, Some(error)),
            };
            *state = next;
            self.loaded.notify_all();
            if let Some(error) = failure {
                return Err(error);
            }
        }
        match &mut *state {
            State::Ready { secrets, dirty } => apply(secrets, dirty),
            _ => Err(DENIED),
        }
    }
}

pub fn get(name: &str) -> Result<Option<String>, &'static str> {
    vault()?.with(|secrets, _| Ok(secrets.get(name).cloned()))
}

pub fn set(name: &str, value: Option<&str>) -> Result<(), &'static str> {
    let vault = vault()?;
    vault.with(|secrets, dirty| {
        let Some(next) = changed(secrets, *dirty, name, value) else {
            return Ok(());
        };
        if next.is_empty() {
            vault.delete()?;
        } else {
            vault.write(&next)?;
        }
        *secrets = next;
        *dirty = false;
        Ok(())
    })
}

/// The map to store after a change, or `None` when the stored item is already correct.
fn changed(
    secrets: &BTreeMap<String, String>,
    dirty: bool,
    name: &str,
    value: Option<&str>,
) -> Option<BTreeMap<String, String>> {
    let mut next = secrets.clone();
    match value {
        Some(value) => next.insert(name.to_string(), value.to_string()),
        None => next.remove(name),
    };
    (dirty || next != *secrets).then_some(next)
}

impl Vault {
    fn delete(&self) -> Result<(), &'static str> {
        match delete_generic_password_options(Self::options(&self.service, ACCOUNT)) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == crate::NOT_FOUND => Ok(()),
            Err(_) => Err("Could not remove credentials from Keychain."),
        }
    }
}

/// Removes every saved desktop credential, including an unreadable item, and starts empty.
/// Only called from an explicit click.
#[tauri::command(async)]
pub fn keychain_reset() -> Result<(), &'static str> {
    let vault = vault()?;
    let mut state = vault.state.lock().map_err(|_| "Keychain is unavailable.")?;
    while matches!(*state, State::Loading) {
        state = vault
            .loaded
            .wait(state)
            .map_err(|_| "Keychain is unavailable.")?;
    }
    vault.delete()?;
    *state = State::Ready {
        secrets: BTreeMap::new(),
        dirty: false,
    };
    Ok(())
}

/// Forgets a refusal so the next read asks macOS again. Only called from an explicit click.
/// Async so it never blocks the main thread while another caller holds the vault lock.
#[tauri::command(async)]
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
    fn vault() -> Vault {
        Vault::new("dev.precipice.desktop.unit".into())
    }
    #[test]
    fn corrupt_item_reads_as_empty_and_is_cached() {
        let vault = vault();
        let mut loads = 0;
        let len = vault.with_loader(
            || {
                loads += 1;
                Err(INVALID)
            },
            |s, dirty| Ok((s.len(), *dirty)),
        );
        assert_eq!(len.unwrap(), (0, true));
        // Cached: a second read never calls the loader (no second Keychain prompt).
        let again = vault.with_loader(|| panic!("reloaded"), |s, _| Ok(s.len()));
        assert_eq!(again.unwrap(), 0);
        assert_eq!(loads, 1);
    }
    #[test]
    fn dirty_vault_overwrites_even_when_unchanged() {
        let empty = BTreeMap::new();
        assert!(changed(&empty, false, "a", None).is_none());
        assert_eq!(changed(&empty, true, "a", None), Some(BTreeMap::new()));
    }
    #[test]
    fn denial_is_cached_until_retry() {
        let vault = vault();
        assert_eq!(
            vault.with_loader(|| Err(DENIED), |_, _| Ok(())),
            Err(DENIED)
        );
        assert_eq!(
            vault.with_loader(|| panic!("re-asked"), |_, _| Ok(())),
            Err(DENIED)
        );
    }
    #[test]
    fn concurrent_readers_share_one_load() {
        let vault = std::sync::Arc::new(vault());
        let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let (vault, count) = (vault.clone(), count.clone());
                std::thread::spawn(move || {
                    vault
                        .with_loader(
                            || {
                                count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                                std::thread::sleep(std::time::Duration::from_millis(30));
                                Ok(BTreeMap::from([("a".to_string(), "1".to_string())]))
                            },
                            |s, _| Ok(s.get("a").cloned()),
                        )
                        .unwrap()
                })
            })
            .collect();
        for thread in threads {
            assert_eq!(thread.join().unwrap().as_deref(), Some("1"));
        }
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
    #[test]
    #[ignore = "writes a disposable vault to the local login Keychain"]
    fn persists_once_and_answers_from_cache() {
        let vault = Vault::new(format!(
            "dev.precipice.desktop.test-vault-{}",
            std::process::id()
        ));
        assert_eq!(vault.with(|s, _| Ok(s.len())).unwrap(), 0);
        vault
            .with(|s, _| {
                s.insert("a".into(), "1".into());
                vault.write(s)
            })
            .unwrap();
        let fresh = Vault::new(vault.service.clone());
        assert_eq!(
            fresh
                .with(|s, _| Ok(s.get("a").cloned()))
                .unwrap()
                .as_deref(),
            Some("1")
        );
        delete_generic_password_options(Vault::options(&vault.service, ACCOUNT)).unwrap();
        // The cached copy keeps answering without another Keychain read.
        assert_eq!(
            fresh
                .with(|s, _| Ok(s.get("a").cloned()))
                .unwrap()
                .as_deref(),
            Some("1")
        );
    }
    #[test]
    fn other_identities_never_migrate_the_installed_apps_items() {
        let vault = Vault::new("dev.precipice.desktop.preview".into());
        assert!(vault.migrate().unwrap().is_empty());
    }
}
