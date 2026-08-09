/**
 * App version + changelog, shown in Settings > About.
 *
 * Keep this in sync with the version in package.json and
 * src-tauri/tauri.conf.json when bumping. Add a new entry at the TOP of
 * CHANGELOG each time a build ships a meaningful set of fixes/features --
 * newest first, same convention as every other changelog.
 */
export const APP_VERSION = "0.4.9";

export type ChangeKind = "feature" | "fix" | "optimization";

export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  changes: { kind: ChangeKind; text: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.4.9",
    date: "2026-08-08",
    changes: [
      { kind: "fix", text: "Fixed Instagram's OAuth redirect URI being rejected outright (\"Error saving redirect URIs\") even as a bare http://localhost callback: unlike every other flow in this app, Meta's Business Login for Instagram has no loopback/localhost exception at all -- confirmed against Meta's own docs, which only ever show real HTTPS domains as examples. Instagram now redirects to a small static bridge page (docs/instagram-redirect.html, hosted on GitHub Pages) that immediately forwards the browser to this app's real local callback listener with the same query string -- the OAuth code/state never leaves the user's machine, the bridge page only reads the URL it's already been sent to." },
    ],
  },
  {
    version: "0.4.8",
    date: "2026-08-08",
    changes: [
      { kind: "fix", text: "Rewrote the Instagram adapter to use \"Instagram API with Instagram Login\" (instagram.com/oauth/authorize, instagram_business_* scopes, a short-lived-to-long-lived token exchange) instead of the older Facebook Login flow (facebook.com/dialog/oauth, instagram_basic scopes, Facebook Page indirection) it was originally written against. Discovered live: a real Meta app defaults to the newer flow, which uses entirely different endpoints, scope names, and credentials (a separate Instagram App ID/Secret, not the Facebook one). No linked Facebook Page is required under this flow." },
    ],
  },
  {
    version: "0.4.7",
    date: "2026-08-08",
    changes: [
      { kind: "fix", text: "Fixed Instagram's OAuth scope list being rejected outright by Meta (\"Invalid Scopes\"): business_management isn't actually a dependency of anything this adapter does and was rejected, while pages_read_engagement and pages_read_user_content -- real documented dependencies of instagram_basic/instagram_content_publish -- were missing. Corrected against Meta's live Permissions Reference after a real rejected connect attempt." },
    ],
  },
  {
    version: "0.4.6",
    date: "2026-08-08",
    changes: [
      { kind: "fix", text: "Fixed Instagram's OAuth connect being rejected by Meta (\"Facebook has detected [app] isn't using a secure connection\"): Meta's local-development exception to the HTTPS requirement only recognizes the literal hostname \"localhost\", not \"127.0.0.1\", even though both resolve to the same loopback interface. Instagram now uses localhost specifically for its redirect URI; TikTok and YouTube are unaffected. Registering the app now requires http://localhost:47984/callback instead of the 127.0.0.1 form -- updated in docs/LIMITATIONS.md. Found live, on a real Instagram connect attempt." },
    ],
  },
  {
    version: "0.4.5",
    date: "2026-08-08",
    changes: [
      { kind: "fix", text: "Fixed the OAuth callback listener leaking its port on timeout: the 5-minute timeout only applied to the caller's wait, not the background task actually holding the socket, so an abandoned connect attempt left the port permanently bound. For TikTok/Instagram (fixed ports, unlike YouTube's dynamic one) this meant a single stuck attempt could block every later connect with an OS \"address already in use\" error -- found live, on a real Instagram connect attempt. Added a regression test that rebinds the port after a timeout to confirm it's actually released." },
    ],
  },
  {
    version: "0.4.4",
    date: "2026-08-08",
    changes: [
      { kind: "fix", text: "Instagram's credential fields in Settings > Platform Developer Apps now say \"App ID\"/\"App Secret\" instead of \"Client ID\"/\"Client Secret\" -- matching Meta's own developer console terminology, so there's no guessing which field to paste which value into." },
    ],
  },
  {
    version: "0.4.3",
    date: "2026-08-08",
    changes: [
      { kind: "feature", text: "Milestone: the first successful real platform connection in this project's history. YouTube's OAuth flow, WindowsCredentialStore, and the loopback callback server were all confirmed working end-to-end against a live Google account. Updated the Verification status notice (Settings > About) and README to reflect this accurately -- YouTube publishing itself, and TikTok/Instagram entirely, remain unverified until each clears the same bar." },
    ],
  },
  {
    version: "0.4.2",
    date: "2026-08-08",
    changes: [
      { kind: "fix", text: "Fixed the YouTube adapter crashing on connect with \"missing field `items`\": YouTube's API omits the `items` key entirely (instead of returning an empty array) when a query matches zero channels or videos, which broke deserialization before the existing \"no channel found\" check ever ran. Found live, on the first real YouTube connection attempt. Applies to both the channel lookup during connect and the metrics lookup during analytics sync." },
    ],
  },
  {
    version: "0.4.1",
    date: "2026-08-08",
    changes: [
      { kind: "fix", text: "Fixed a bug that hid every real backend error behind a generic message (\"Couldn't connect.\", \"Sync failed.\", etc.): a failed Tauri command rejects with a plain string, not a JS Error object, but every error handler checked `instanceof Error` first -- so the actual reason (e.g. why a real OAuth connect failed) was silently discarded in favor of a useless fallback. Found during the first live YouTube connection attempt. Fixed once at the tauriBackend.ts boundary so every command benefits, not just the ones already handling errors." },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-08-08",
    changes: [
      { kind: "feature", text: "Rebuilt Publish into a real composer: per-platform caption overrides, shared hashtags (previously silently dropped), real validation against each platform's actual documented caption-length/duration limits (fetched live from the connection's own adapter, never hardcoded frontend guesses), and a video/destination picker with real thumbnails." },
      { kind: "feature", text: "New shared design system: a typography scale, restyled form controls (Select, Switch, checkboxes/radios), status Badges, Skeleton loading states, a reusable ConfirmDialog, and a consistent PlatformBadge identity -- applied across every screen (Overview, Library, Connections, Publish, Videos, Calendar, Analytics, Diagnostics, Templates, Settings)." },
      { kind: "feature", text: "Destructive actions (removing a video, deleting a template/hashtag set, restoring a backup) now ask for confirmation before acting instead of firing immediately." },
      { kind: "feature", text: "Analytics chart gained a real hover tooltip and clearer axis lines; its stat tiles now reuse the same StatCard component as Overview instead of duplicating markup." },
      { kind: "optimization", text: "Every loading state now shows a real skeleton placeholder instead of plain \"Loading…\" text; every empty state shows a context-appropriate icon." },
    ],
  },
  {
    version: "0.3.1",
    date: "2026-08-08",
    changes: [
      { kind: "optimization", text: "Replaced the splash intro's \"N... D...\" voice -- previously a live browser SpeechSynthesisUtterance call (which just sounded like plain OS text-to-speech) -- with a baked audio clip: SAPI speech run through an offline pitch-shift + flanger + tremolo + chorus + bitcrush chain for a genuinely synthetic/robotic character." },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-08-08",
    changes: [
      { kind: "feature", text: "Added in-app auto-updates: a \"Check for updates\" button in Settings > About that downloads and installs new versions from GitHub Releases and restarts the app -- customers never manually redownload again (see docs/RELEASING.md for the release runbook)." },
      { kind: "fix", text: "Fixed a bug where TikTok's, Instagram's, and YouTube's real OAuth connect flow sent generic placeholder scope names (\"publish\", \"analytics\") instead of each platform's real, documented OAuth scopes -- none of those platforms recognize those strings, so every real connect attempt would have failed or granted no access. Each adapter now always requests its own correct scope set." },
      { kind: "fix", text: "Discovered while reviewing the same code: TikTok's and Instagram's OAuth apps require an exact pre-registered redirect URI (unlike Google's Desktop-app OAuth client, which allows any loopback port) -- connecting either platform now uses a fixed local port (documented in docs/LIMITATIONS.md) instead of a random one that could never match." },
      { kind: "optimization", text: "Extended the app's Tauri capabilities grant to cover the new updater and process (restart) plugin permissions, alongside the dialog/opener permissions already granted." },
    ],
  },
  {
    version: "0.2.1",
    date: "2026-08-08",
    changes: [
      { kind: "feature", text: "Added a first-run End-User License Agreement and Privacy Policy acceptance screen (drafts -- see Settings for the note on getting them reviewed before a public launch)." },
      { kind: "feature", text: "Added a verification-status notice in Settings > About making clear which platforms have actually been tested end-to-end." },
      { kind: "fix", text: "Added a top-level error boundary so an unexpected crash now shows a recoverable message instead of a blank window." },
      { kind: "optimization", text: "Ran cargo clippy and cargo audit across both Rust crates and npm audit on the frontend; fixed everything actionable, documented what isn't (transitive dev-tooling and Tauri/GTK advisories that don't reach the shipped app)." },
      { kind: "optimization", text: "Added a publisher name to the installer metadata." },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-08-08",
    changes: [
      { kind: "feature", text: "Real upload scheduler and adapter registry driving the full Publish -> Videos -> Calendar pipeline." },
      { kind: "feature", text: "Analytics, Diagnostics, Templates, Overview, and workspace Settings tabs, all backed by real data." },
      { kind: "feature", text: "Backup & restore, a native OS video file picker, and real generated video thumbnails in the Library." },
      { kind: "feature", text: "GA4-style Analytics with date-range presets and a comparison-period chart." },
      { kind: "feature", text: "Real (unverified -- written against public docs, not yet run against a live account) TikTok, Instagram, and YouTube adapters, gated behind per-platform developer credentials in Settings." },
      { kind: "feature", text: "Removed the X (Twitter) platform entirely." },
      { kind: "feature", text: "Full visual redesign: dark technical dashboard theme, top navigation bar, and a reusable component library (cards, tables, toolbars, buttons) applied consistently across every screen." },
      { kind: "feature", text: "New terminal-style startup intro: falling code rain, a synthesized voice cue, and a \"Change The World.\" reveal synced to audio." },
      { kind: "fix", text: "App window now always opens centered on screen." },
      { kind: "fix", text: "Fixed a duplicate-window bug caused by a missing Windows GUI-subsystem flag (a console window was spawning alongside the real one)." },
      { kind: "fix", text: "Fixed an Analytics \"Sync now\" race condition that could briefly show a false zero before the metric key finished loading." },
      { kind: "fix", text: "Fixed three Rust code-quality issues flagged by clippy: a missing Default impl, an inefficient iterator call, and a dead-code wrapper in the sandbox adapter." },
      { kind: "optimization", text: "Debounced the startup intro's canvas resize handler so dragging the window edge no longer stutters the animation." },
      { kind: "optimization", text: "Cut the frontend JS bundle from ~1 MB to ~330 KB by removing offline-generated animation data that an earlier intro iteration no longer needs." },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-08-07",
    changes: [
      { kind: "feature", text: "Initial release: workspace/account-group management, Sandbox platform connection, and the video Library." },
    ],
  },
];
