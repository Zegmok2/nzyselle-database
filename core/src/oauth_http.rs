//! Shared helpers for real (non-sandbox) OAuth adapters: PKCE generation
//! and mapping `reqwest`/HTTP failures onto `AdapterError` consistently, so
//! each platform adapter doesn't reinvent this.
//!
//! UNVERIFIED: written against each platform's public API docs, never run
//! against a live account (no developer credentials exist in this
//! environment) -- see README.md for the same caveat applied elsewhere in
//! this project (e.g. `credentials::WindowsCredentialStore`).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

use crate::adapter::AdapterError;

/// A PKCE (RFC 7636) verifier/challenge pair, S256 method.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn generate_pkce() -> Pkce {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    Pkce { verifier, challenge }
}

pub fn generate_state() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Maps a `reqwest::Error` (transport-level failure, not an HTTP error
/// status) onto the adapter contract's error type.
pub fn map_transport_error(e: reqwest::Error) -> AdapterError {
    if e.is_timeout() || e.is_connect() {
        AdapterError::Network(e.to_string())
    } else {
        AdapterError::Retryable(e.to_string())
    }
}

/// Maps an HTTP response status + body onto the adapter contract's error
/// type using the conventional meaning of each status range. Platform
/// adapters can override specific codes with more precise variants (e.g. a
/// documented rate-limit header) after calling this as a fallback.
pub fn map_http_status(status: reqwest::StatusCode, body: &str) -> AdapterError {
    match status.as_u16() {
        401 => AdapterError::ReauthorizationRequired,
        403 => AdapterError::PaidAccessRequired(body.to_string()),
        404 => AdapterError::Permanent(format!("Not found: {body}")),
        408 | 425 | 429 => AdapterError::RateLimited { retry_after_seconds: None },
        400..=499 => AdapterError::Permanent(body.to_string()),
        500..=599 => AdapterError::Retryable(body.to_string()),
        _ => AdapterError::Permanent(body.to_string()),
    }
}

/// Reads the client_id/client_secret a real adapter needs to make any
/// request, stored via the same `CredentialStore` OAuth tokens use (never
/// SQLite) under a fixed per-platform key. Returns a clear, actionable
/// error rather than panicking or silently no-op'ing when the user hasn't
/// configured a developer app yet.
pub fn client_config_ref(platform_id: &str) -> String {
    format!("nzyselle:oauth_client:{platform_id}")
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClientConfig {
    pub client_id: String,
    pub client_secret: String,
}

pub fn load_client_config(
    credentials: &dyn crate::credentials::CredentialStore,
    platform_id: &str,
) -> Result<ClientConfig, AdapterError> {
    let raw = credentials.get(&client_config_ref(platform_id)).map_err(|_| {
        AdapterError::Permanent(format!(
            "No {platform_id} developer app credentials configured yet. Add a Client ID/Secret in Workspace Settings first."
        ))
    })?;
    serde_json::from_str(&raw).map_err(|e| AdapterError::Permanent(format!("Stored {platform_id} credentials are corrupt: {e}")))
}

/// Stores an OAuth token pair for a connection, keyed by `credential_ref`,
/// as a single JSON blob -- the only place a real access/refresh token
/// exists outside the platform's own servers.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub fn save_tokens(
    credentials: &dyn crate::credentials::CredentialStore,
    credential_ref: &str,
    tokens: &StoredTokens,
) -> Result<(), AdapterError> {
    let json = serde_json::to_string(tokens).map_err(|e| AdapterError::Permanent(e.to_string()))?;
    credentials.set(credential_ref, &json).map_err(|e| AdapterError::Permanent(e.to_string()))
}

pub fn load_tokens(credentials: &dyn crate::credentials::CredentialStore, credential_ref: &str) -> Result<StoredTokens, AdapterError> {
    let raw = credentials.get(credential_ref).map_err(|_| AdapterError::ReauthorizationRequired)?;
    serde_json::from_str(&raw).map_err(|_| AdapterError::ReauthorizationRequired)
}
