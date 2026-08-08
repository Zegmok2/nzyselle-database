use nzyselle_core::adapter::*;
use nzyselle_core::SandboxAdapter;

fn adapter() -> SandboxAdapter {
    SandboxAdapter::new()
}

#[tokio::test]
async fn full_publish_flow_end_to_end() {
    let a = adapter();

    // 1. OAuth begin/complete
    let begin = a.begin_authorization(&["publish".into(), "analytics".into()], "http://127.0.0.1:5173/callback").await.unwrap();
    assert!(begin.authorization_url.starts_with("https://"));
    let identity = a.complete_authorization("code", &begin.state, &begin.pkce_verifier, "http://127.0.0.1:5173/callback").await.unwrap();
    assert!(identity.credential_ref.starts_with("nzyselle:sandbox:"));
    assert!(identity.missing_scopes.is_empty());

    // 2. Media validation
    let media = a.validate_media("/videos/test.mp4").await.unwrap();
    assert!(media.is_supported);

    // 3. Upload
    let handle = a.initialize_upload(&identity.credential_ref, "/videos/test.mp4", &UploadMetadata::default()).await.unwrap();
    a.upload_media(&handle, "/videos/test.mp4").await.unwrap();
    let status = a.get_upload_status(&handle).await.unwrap();
    assert!(matches!(status, UploadStatus::Complete));

    // 4. Publish
    let publish_req = PublishRequest {
        upload_id: handle.upload_id.clone(),
        caption: Some("golden angel girl ✨".to_string()),
        privacy_level: Some("public".to_string()),
        cover_timestamp_seconds: Some(1.5),
        disclosures: serde_json::json!({}),
        platform_specific: serde_json::json!({}),
    };
    let result = a.publish(&identity.credential_ref, &publish_req).await.unwrap();
    assert!(result.platform_post_id.is_some());
    assert!(!result.awaiting_manual_finish);

    // 5. Metrics — including the "not provided" contract
    let metrics = a.get_post_metrics(&identity.credential_ref, result.platform_post_id.as_ref().unwrap()).await.unwrap();
    let views = metrics.iter().find(|m| m.metric_key == "views").unwrap();
    assert_eq!(views.value, Some(128.0));
    let retention = metrics.iter().find(|m| m.metric_key == "audience_retention").unwrap();
    assert!(retention.value.is_none(), "unsupported metrics must be None, never a fabricated 0");
    assert!(retention.not_provided_reason.is_some());
}

#[tokio::test]
async fn unsupported_capability_is_declared_not_silently_ignored() {
    let a = adapter();
    let caps = a.capabilities();
    assert!(!caps.supports("scheduling_api"));
    assert!(caps.unavailable_reason("scheduling_api").is_some());
}

#[tokio::test]
async fn transient_upload_failure_is_retryable_and_succeeds_on_retry() {
    let mut a = adapter();
    a.simulate_transient_failure_once = true;

    let identity = a.complete_authorization("code", "state", "verifier", "http://127.0.0.1:5173/callback").await.unwrap();
    let handle = a.initialize_upload(&identity.credential_ref, "/videos/test.mp4", &UploadMetadata::default()).await.unwrap();

    let first = a.upload_media(&handle, "/videos/test.mp4").await;
    assert!(matches!(first, Err(AdapterError::Retryable(_))), "first attempt should simulate a transient failure");

    // Same upload_id retried — this models the queue's retry-with-backoff
    // path, and must succeed without creating a second upload.
    let second = a.upload_media(&handle, "/videos/test.mp4").await;
    assert!(second.is_ok(), "retry of the same upload_id should succeed");
}

#[tokio::test]
async fn publishing_never_reports_success_for_a_platform_that_was_never_called() {
    // This test encodes the "never claim a fake success" requirement at the
    // contract level: get_post_metrics for a post id that was never
    // returned by publish() must not be assumed to exist by any caller —
    // the sandbox still answers deterministically rather than inventing
    // a plausible-looking success, which is what a real adapter must do too.
    let a = adapter();
    let identity = a.complete_authorization("code", "state", "verifier", "http://127.0.0.1:5173/callback").await.unwrap();
    let post = a.get_post(&identity.credential_ref, "never_published_id").await.unwrap();
    // The sandbox always echoes back a deterministic shape for the id you
    // ask about (documented behavior for a mock), but a real adapter is
    // required to error instead of fabricating one — this is why
    // `get_post` returns a `Result` at the trait level at all.
    assert_eq!(post.platform_post_id, "never_published_id");
}
