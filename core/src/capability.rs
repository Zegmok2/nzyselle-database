//! Capability registry types.
//!
//! These mirror the `platform_definition` / `connection_capability` tables
//! (see db/migrations/0001_init.sql, 0002_seed_platform_registry.sql).
//! The registry is *data*, loaded at runtime — adding or correcting a
//! platform capability means adding a row, not shipping a new build.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability {
    pub key: String,
    pub supported: bool,
    pub requires_review: bool,
    pub requires_paid_access: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformCapabilities {
    pub platform_id: String,
    pub registry_version: u32,
    pub instructions_reviewed_at: String, // ISO date
    pub docs_url: String,
    pub capabilities: HashMap<String, Capability>,
}

impl PlatformCapabilities {
    pub fn supports(&self, key: &str) -> bool {
        self.capabilities.get(key).map(|c| c.supported).unwrap_or(false)
    }

    pub fn requires_review(&self, key: &str) -> bool {
        self.capabilities.get(key).map(|c| c.requires_review).unwrap_or(false)
    }

    pub fn requires_paid_access(&self, key: &str) -> bool {
        self.capabilities.get(key).map(|c| c.requires_paid_access).unwrap_or(false)
    }

    /// Returns a human-readable reason a capability is unavailable, for the
    /// "Not provided by this platform" / setup-assistant UI. Never returns
    /// None for an unsupported capability — there's always something to
    /// tell the user.
    pub fn unavailable_reason(&self, key: &str) -> Option<String> {
        match self.capabilities.get(key) {
            None => Some(format!("'{key}' is not part of this platform's registered capabilities.")),
            Some(c) if c.supported => None,
            Some(c) => Some(c.notes.clone().unwrap_or_else(|| {
                "Not provided by this platform's current official API.".to_string()
            })),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PlatformCapabilities {
        let mut caps = HashMap::new();
        caps.insert(
            "watch_time_metric".to_string(),
            Capability {
                key: "watch_time_metric".to_string(),
                supported: false,
                requires_review: false,
                requires_paid_access: false,
                notes: Some("Not provided by this platform.".to_string()),
            },
        );
        caps.insert(
            "direct_publish".to_string(),
            Capability {
                key: "direct_publish".to_string(),
                supported: true,
                requires_review: true,
                requires_paid_access: false,
                notes: Some("Requires app audit.".to_string()),
            },
        );
        PlatformCapabilities {
            platform_id: "tiktok".to_string(),
            registry_version: 1,
            instructions_reviewed_at: "2026-08-01".to_string(),
            docs_url: "https://developers.tiktok.com".to_string(),
            capabilities: caps,
        }
    }

    #[test]
    fn unsupported_capability_never_silently_true() {
        let caps = sample();
        assert!(!caps.supports("watch_time_metric"));
        assert_eq!(
            caps.unavailable_reason("watch_time_metric"),
            Some("Not provided by this platform.".to_string())
        );
    }

    #[test]
    fn supported_capability_still_flags_review_requirement() {
        let caps = sample();
        assert!(caps.supports("direct_publish"));
        assert!(caps.requires_review("direct_publish"));
    }

    #[test]
    fn unknown_capability_key_is_treated_as_unsupported_not_a_panic() {
        let caps = sample();
        assert!(!caps.supports("does_not_exist"));
        assert!(caps.unavailable_reason("does_not_exist").is_some());
    }
}
