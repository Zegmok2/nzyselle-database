// Maps a `platform_id` string to the `ProviderAdapter` implementation that
// handles it. This is the one place the scheduler/commands look up "which
// adapter do I call for this connection" -- adding a real platform later is
// exactly one line here, nothing else in the queue/UI plumbing changes.
//
// Only "sandbox" is registered today. Real adapters (TikTok/Instagram/
// YouTube) register here once they exist; until then `get()` returning
// `None` for a real platform_id is what makes the scheduler fail loudly
// (a diagnostic_event, not a silent no-op) instead of pretending to publish.

use std::collections::HashMap;
use std::sync::Arc;

use nzyselle_core::adapter::ProviderAdapter;
use nzyselle_core::credentials::CredentialStore;
use nzyselle_core::instagram_adapter::InstagramAdapter;
use nzyselle_core::mock_adapter::SandboxAdapter;
use nzyselle_core::tiktok_adapter::TikTokAdapter;
use nzyselle_core::youtube_adapter::YouTubeAdapter;

pub struct AdapterRegistry {
    adapters: HashMap<&'static str, Arc<dyn ProviderAdapter>>,
}

impl AdapterRegistry {
    /// TikTok/Instagram/YouTube adapters are real (see core/src/*_adapter.rs)
    /// but UNVERIFIED -- written against public API docs, never run
    /// against a live developer app. They're registered here so the
    /// scheduler/commands *can* call them once a user configures real
    /// Client ID/Secret credentials in Settings; ConnectionsPage still only
    /// offers a working "Connect" button once those credentials exist, so
    /// this registration alone never causes a fake/failed connect attempt
    /// to look like a working one.
    pub fn new(credentials: Arc<dyn CredentialStore>) -> Self {
        let mut adapters: HashMap<&'static str, Arc<dyn ProviderAdapter>> = HashMap::new();
        adapters.insert("sandbox", Arc::new(SandboxAdapter::new()) as Arc<dyn ProviderAdapter>);
        adapters.insert("tiktok", Arc::new(TikTokAdapter::new(credentials.clone())) as Arc<dyn ProviderAdapter>);
        adapters.insert("instagram", Arc::new(InstagramAdapter::new(credentials.clone())) as Arc<dyn ProviderAdapter>);
        adapters.insert("youtube", Arc::new(YouTubeAdapter::new(credentials)) as Arc<dyn ProviderAdapter>);
        Self { adapters }
    }

    pub fn get(&self, platform_id: &str) -> Option<Arc<dyn ProviderAdapter>> {
        self.adapters.get(platform_id).cloned()
    }
}
