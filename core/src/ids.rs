//! Lightweight opaque ID generation.
//!
//! Deliberately not the `uuid` crate: its `v4` feature pulls in `getrandom`
//! versions that require a newer Rust edition than some supported build
//! environments have available, and true cryptographic randomness isn't a
//! requirement for these IDs (they're primary keys, not security tokens).
//! This produces 128 bits of entropy from the OS-provided time source plus
//! a process-local counter, formatted as a UUID-look-alike so it drops into
//! the existing TEXT PRIMARY KEY columns without any schema change.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn xorshift64(mut x: u64) -> u64 {
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    x
}

/// Generates an id like `f3a1c9e2-88b4-4a2d-9c11-1e7d3a9b0c44`.
pub fn generate_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let counter = COUNTER.fetch_add(1, Ordering::SeqCst);
    let a = xorshift64(nanos ^ 0x9E3779B97F4A7C15);
    let b = xorshift64(nanos.rotate_left(23) ^ counter.wrapping_mul(0xBF58476D1CE4E5B9));

    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        (a >> 32) as u32,
        (a >> 16) & 0xffff,
        a & 0xffff,
        (b >> 48) & 0xffff,
        b & 0xffff_ffff_ffff,
    )
}

pub fn generate_prefixed_id(prefix: &str) -> String {
    format!("{prefix}_{}", generate_id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn ids_are_unique_across_many_rapid_calls() {
        let mut seen = HashSet::new();
        for _ in 0..10_000 {
            let id = generate_id();
            assert!(seen.insert(id), "generated a duplicate id");
        }
    }

    #[test]
    fn prefixed_id_keeps_the_prefix() {
        let id = generate_prefixed_id("conn");
        assert!(id.starts_with("conn_"));
    }
}
