# Platform Limitations

This mirrors `db/migrations/0002_seed_platform_registry.sql` — the actual
seeded capability registry — in plain language. If this document and the
registry ever disagree, the registry (loaded at runtime) is the source of
truth; update both together.

**Last reviewed: 2026-08-01.** APIs change. Before relying on any line
below, check the linked official docs — this file records what was true
when last checked, not a permanent guarantee.

## OAuth redirect URI setup (read this before connecting TikTok or Instagram)

This app's OAuth flow opens your system browser and briefly listens on
`127.0.0.1` for the platform to redirect back with an authorization code
(RFC 8252's "loopback interface redirection" pattern).

- **YouTube (Google)**: uses a fresh, randomly-assigned port every time you
  connect. This is fine as long as your Google Cloud OAuth client is
  registered as a **Desktop app** (not "Web application") — Google's
  Desktop app type explicitly allows any `http://127.0.0.1:*` redirect URI.
- **TikTok**: TikTok's Developer Portal requires an *exact* registered
  redirect URI — it does not accept a wildcard port. This app therefore
  uses a **fixed port, 47983**, for TikTok specifically. When you register
  your TikTok app, add `http://127.0.0.1:47983/callback` as a registered
  redirect URI exactly. If that port happens to be in use by something
  else on your machine when you try to connect, the connection attempt
  will fail with a bind error — close whatever's using it and retry.
- **Instagram (Meta)**: same constraint as TikTok. This app uses **fixed
  port 47984** for Instagram — register `http://127.0.0.1:47984/callback`
  exactly in your Meta app's redirect URI settings.

(See `fixed_oauth_port_for` in `src-tauri/src/commands.rs` if you ever need
to change these port numbers — just keep the registered redirect URI in
each developer portal in sync with whatever you pick.)

## TikTok
- Docs: https://developers.tiktok.com/doc/content-posting-api-get-started/
- OAuth connection: supported.
- Direct publish / draft upload: supported by the API, **but gated by
  TikTok's app audit**. An unaudited ("unaudited" / test-mode) developer
  app is typically restricted to posting only to the developer's own
  connected account, not arbitrary users. A personal/internal utility like
  this one may not qualify for production audit approval — the app must
  detect and explain this honestly rather than claim posting works for
  every user.
- Scheduling via the API: **not currently offered.** Any "schedule" for
  TikTok in this product is a local reminder, not a server-side guarantee.
- Sound library search/attach: **no official endpoint exists** for
  searching or programmatically attaching TikTok's licensed/trending
  sounds. This is why the product has a "Sound Assistant" (saved
  references + manual finishing step) instead of a fake "auto-attach
  sound" button.
- Video metrics: available for videos posted through the API to an
  authorized account.
- Watch-time metric: not provided by this platform's Content Posting/
  Display API.

## Instagram
- Docs: https://developers.facebook.com/docs/instagram-platform/
- OAuth connection: supported.
- Direct publish: supported via the Graph API, but **requires a
  professional (business or creator) account linked to a Facebook Page.**
  A personal Instagram account cannot be used for API publishing at all.
- Native licensed-music selection: **not exposed via the Graph API.**
  There is no official way to programmatically pick Instagram's in-app
  music catalog for a Reel. Content with embedded/original audio can be
  published directly; native music requires the user to finish the post
  inside Instagram itself ("Finish in Instagram" mode).
- Reach, saves: available metrics for professional accounts.

## YouTube
- Docs: https://developers.google.com/youtube/v3/guides/uploading_a_video
- OAuth connection: supported.
- Resumable upload: supported (and used) via the Data API v3.
- Scheduling via the API: supported — set `privacyStatus=private` with a
  `publishAt` timestamp.
- Public uploads without review: **new API projects are typically
  quota-restricted and may require Google's audit/verification process
  before public (non-testing) uploads work reliably.** Don't assume a
  freshly-created API project can publish publicly on day one.
- Audience retention: requires the separate YouTube Analytics API and its
  own OAuth scope — not included automatically with Data API access.
- There is no distinct "upload as a Short" endpoint; YouTube classifies
  eligible videos as Shorts using its own rules based on the video itself
  (duration, aspect ratio, etc.), not an upload-time flag this app sets.

## What "Not provided by this platform" means everywhere in this product

If a metric or control isn't in the capability registry as `supported`,
the UI shows the literal text **"Not provided by this platform"** — never
a zero, an empty chart treated as zero, or a dash that could be misread as
"no engagement." This is enforced at the adapter-contract level: see
`core/src/adapter.rs`'s `MetricValue.not_provided_reason` and the
sandbox-adapter test `full_publish_flow_end_to_end` in
`core/tests/adapter_contract_tests.rs`, which asserts exactly this for a
metric the sandbox deliberately doesn't support.
