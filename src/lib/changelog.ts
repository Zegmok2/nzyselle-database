/**
 * App version + changelog, shown in Settings > About.
 *
 * Keep this in sync with the version in package.json and
 * src-tauri/tauri.conf.json when bumping. Add a new entry at the TOP of
 * CHANGELOG each time a build ships a meaningful set of fixes/features --
 * newest first, same convention as every other changelog.
 */
export const APP_VERSION = "0.3.0";

export type ChangeKind = "feature" | "fix" | "optimization";

export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  changes: { kind: ChangeKind; text: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
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
