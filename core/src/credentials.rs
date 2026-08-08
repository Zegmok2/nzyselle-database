//! Credential storage abstraction.
//!
//! Domain code never touches Windows Credential Manager directly — it goes
//! through this trait. That's what makes "tokens are never stored in
//! SQLite or plaintext files" a testable property instead of a promise:
//! anything that violates it shows up as calling the wrong trait method
//! or, worse, constructing a token string outside this module at all.
//!
//! The real implementation (`WindowsCredentialStore`, gated behind
//! `target_os = "windows"`) wraps the `keyring` crate, which talks to
//! Credential Manager's DPAPI-backed vault. It cannot be exercised in this
//! Linux build environment, so it's written but unverified until it runs
//! on actual Windows — that limitation is intentional to call out rather
//! than paper over with a same-looking Linux implementation pretending to
//! be equivalent security.
//!
//! `InMemoryCredentialStore` is the test double every other layer's tests
//! run against, so the *contract* (store/retrieve/delete, never logged,
//! never serialized to JSON) is fully covered even though the OS-specific
//! backend isn't.

use std::collections::HashMap;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("no credential found for reference '{0}'")]
    NotFound(String),
    #[error("the OS credential store rejected this operation: {0}")]
    Backend(String),
}

pub trait CredentialStore: Send + Sync {
    fn set(&self, credential_ref: &str, secret: &str) -> Result<(), CredentialError>;
    fn get(&self, credential_ref: &str) -> Result<String, CredentialError>;
    fn delete(&self, credential_ref: &str) -> Result<(), CredentialError>;
    fn exists(&self, credential_ref: &str) -> bool;
}

/// Builds the credential_ref key used across the app. Centralized so every
/// caller produces the same shape, e.g. `nzyselle:tiktok:<connection-id>`.
pub fn build_credential_ref(platform_id: &str, connection_id: &str) -> String {
    format!("nzyselle:{platform_id}:{connection_id}")
}

// ---------------------------------------------------------------------
// In-memory test double
// ---------------------------------------------------------------------
#[derive(Default)]
pub struct InMemoryCredentialStore {
    data: Mutex<HashMap<String, String>>,
}

impl InMemoryCredentialStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl CredentialStore for InMemoryCredentialStore {
    fn set(&self, credential_ref: &str, secret: &str) -> Result<(), CredentialError> {
        self.data.lock().unwrap().insert(credential_ref.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, credential_ref: &str) -> Result<String, CredentialError> {
        self.data
            .lock()
            .unwrap()
            .get(credential_ref)
            .cloned()
            .ok_or_else(|| CredentialError::NotFound(credential_ref.to_string()))
    }

    fn delete(&self, credential_ref: &str) -> Result<(), CredentialError> {
        self.data.lock().unwrap().remove(credential_ref);
        Ok(())
    }

    fn exists(&self, credential_ref: &str) -> bool {
        self.data.lock().unwrap().contains_key(credential_ref)
    }
}

// ---------------------------------------------------------------------
// Windows Credential Manager backend.
//
// NOT compiled or tested in this session (Linux sandbox). Written against
// the `keyring` crate's stable API, which uses Credential Manager on
// Windows, Keychain on macOS, and Secret Service on Linux — but only the
// Windows target is in scope for this product per the spec. Treat this as
// reviewed-but-unverified until it's actually run on Windows.
// ---------------------------------------------------------------------
#[cfg(target_os = "windows")]
pub struct WindowsCredentialStore {
    service_name: &'static str,
}

#[cfg(target_os = "windows")]
impl WindowsCredentialStore {
    pub fn new() -> Self {
        Self { service_name: "NzyselleDatabase" }
    }
}

#[cfg(target_os = "windows")]
impl Default for WindowsCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "windows")]
impl CredentialStore for WindowsCredentialStore {
    fn set(&self, credential_ref: &str, secret: &str) -> Result<(), CredentialError> {
        let entry = keyring::Entry::new(self.service_name, credential_ref)
            .map_err(|e| CredentialError::Backend(e.to_string()))?;
        entry.set_password(secret).map_err(|e| CredentialError::Backend(e.to_string()))
    }

    fn get(&self, credential_ref: &str) -> Result<String, CredentialError> {
        let entry = keyring::Entry::new(self.service_name, credential_ref)
            .map_err(|e| CredentialError::Backend(e.to_string()))?;
        entry.get_password().map_err(|_| CredentialError::NotFound(credential_ref.to_string()))
    }

    fn delete(&self, credential_ref: &str) -> Result<(), CredentialError> {
        let entry = keyring::Entry::new(self.service_name, credential_ref)
            .map_err(|e| CredentialError::Backend(e.to_string()))?;
        match entry.delete_password() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // already gone is not an error
            Err(e) => Err(CredentialError::Backend(e.to_string())),
        }
    }

    fn exists(&self, credential_ref: &str) -> bool {
        self.get(credential_ref).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_secret_through_the_store() {
        let store = InMemoryCredentialStore::new();
        let key = build_credential_ref("tiktok", "conn_1");
        store.set(&key, "refresh-token-value").unwrap();
        assert_eq!(store.get(&key).unwrap(), "refresh-token-value");
    }

    #[test]
    fn missing_credential_is_a_typed_error_not_a_panic() {
        let store = InMemoryCredentialStore::new();
        let result = store.get("nzyselle:tiktok:does_not_exist");
        assert!(matches!(result, Err(CredentialError::NotFound(_))));
    }

    #[test]
    fn delete_removes_the_secret_and_is_idempotent() {
        let store = InMemoryCredentialStore::new();
        let key = build_credential_ref("youtube", "conn_2");
        store.set(&key, "secret").unwrap();
        assert!(store.exists(&key));
        store.delete(&key).unwrap();
        assert!(!store.exists(&key));
        // deleting again must not error — disconnect flows call this
        // defensively and shouldn't have to check existence first.
        store.delete(&key).unwrap();
    }

    #[test]
    fn credential_ref_is_stable_and_namespaced_per_platform() {
        let a = build_credential_ref("tiktok", "conn_1");
        let b = build_credential_ref("instagram", "conn_1");
        assert_ne!(a, b, "same connection id on different platforms must not collide");
        assert!(a.starts_with("nzyselle:tiktok:"));
    }
}
