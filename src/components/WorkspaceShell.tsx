import type { ReactNode } from "react";
import type { Workspace } from "../lib/types";

export type WorkspaceTab =
  | "overview"
  | "publish"
  | "videos"
  | "calendar"
  | "library"
  | "connections"
  | "analytics"
  | "templates"
  | "diagnostics"
  | "settings";

const NAV_ITEMS: { key: WorkspaceTab; label: string; implemented: boolean }[] = [
  { key: "overview", label: "Overview", implemented: true },
  { key: "publish", label: "Publish", implemented: true },
  { key: "videos", label: "Videos", implemented: true },
  { key: "calendar", label: "Calendar", implemented: true },
  { key: "library", label: "Library", implemented: true },
  { key: "connections", label: "Connections", implemented: true },
  { key: "analytics", label: "Analytics", implemented: true },
  { key: "templates", label: "Templates", implemented: true },
  { key: "diagnostics", label: "Diagnostics", implemented: true },
  { key: "settings", label: "Settings", implemented: true },
];

/**
 * Full-width top navigation shell (logo/back-link, workspace identity,
 * horizontal tab strip, quick settings) -- replaces the previous left
 * sidebar layout. Tab strip scrolls horizontally rather than wrapping so it
 * degrades gracefully at narrow window widths instead of overlapping.
 */
export function WorkspaceShell({
  workspace,
  activeTab,
  onChangeTab,
  onBackToGroups,
  children,
}: {
  workspace: Workspace;
  activeTab: WorkspaceTab;
  onChangeTab: (tab: WorkspaceTab) => void;
  onBackToGroups: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          flexShrink: 0,
          background: "var(--panel-strong)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            height: "var(--nav-height)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 16px",
            overflowX: "auto",
          }}
        >
          <button
            onClick={onBackToGroups}
            title="All account groups"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: "pointer",
              padding: "6px 8px",
              borderRadius: "var(--radius-sm)",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
            className="nz-nav-item"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            All account groups
          </button>

          <span aria-hidden style={{ color: "var(--border-strong)", fontSize: 13, flexShrink: 0 }}>
            /
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", flexShrink: 0 }}>
            <div
              aria-hidden
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                background: workspace.accentColor ?? "#3b82f6",
              }}
            />
            <strong style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{workspace.name}</strong>
          </div>

          <nav aria-label="Workspace sections" style={{ display: "flex", alignItems: "center", gap: 18, marginLeft: 20, height: "100%" }}>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                className="nz-tab"
                onClick={() => onChangeTab(item.key)}
                aria-current={activeTab === item.key ? "page" : undefined}
                style={{
                  background: "transparent",
                  border: "none",
                  color: activeTab === item.key ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: 13,
                  fontWeight: activeTab === item.key ? 600 : 400,
                  cursor: "pointer",
                  padding: "4px 2px",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                {item.label}
                {!item.implemented && <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>soon</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ flex: 1, overflow: "auto" }}>{children}</main>
    </div>
  );
}
