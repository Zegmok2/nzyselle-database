import { useId, type ReactNode } from "react";
import type { PlatformDefinition } from "../../lib/types";

/** Page-level header: title/description on the left, an optional search
 * field and a primary action on the right -- the same toolbar shape reused
 * across Library/Publish/Videos/Templates/etc. so every page's "add" /
 * "search" controls sit in a consistent, predictable spot. */
export function PageToolbar({
  title,
  description,
  search,
  actions,
}: {
  title: string;
  description?: string;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string };
  actions?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</h1>
        {description && <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4, maxWidth: 560 }}>{description}</p>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {search && (
          <div style={{ position: "relative" }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", opacity: 0.55 }}
            >
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              className="nz-input"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? "Search…"}
              aria-label={search.ariaLabel ?? search.placeholder ?? "Search"}
              style={{
                background: "var(--panel-soft)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: "8px 12px 8px 30px",
                color: "var(--text-primary)",
                fontSize: 13,
                width: 240,
              }}
            />
          </div>
        )}
        {actions}
      </div>
    </div>
  );
}

/** Primary call-to-action button -- solid accent, white text, consistent
 * across every page's toolbar. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className="nz-btn-primary"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        borderRadius: "var(--radius-sm)",
        border: "none",
        background: "var(--accent)",
        color: "#ffffff",
        fontWeight: 500,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/** Secondary/ghost button -- bordered, transparent, for less prominent
 * actions (Remove, Cancel, Retry, etc). */
export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="nz-btn-secondary"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "7px 14px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-subtle)",
        background: "transparent",
        color: "var(--text-secondary)",
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/** Consistent empty-state block for lists/tables with nothing to show.
 * `icon` is optional so existing text-only call sites keep working
 * unchanged; pass a lucide-react icon element to give the state visual
 * context (a video icon for an empty library, a plug icon for no
 * connections, etc). */
export function EmptyState({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "var(--text-tertiary)",
        fontSize: 13,
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      {icon && (
        <span style={{ color: "var(--text-tertiary)", opacity: 0.7, display: "flex" }} aria-hidden>
          {icon}
        </span>
      )}
      {message}
    </div>
  );
}

/** Restyled native <select> -- keeps real <select> semantics (keyboard,
 * screen readers) and only repaints via the .nz-select class. */
export function Select({
  value,
  onChange,
  children,
  ariaLabel,
  disabled,
  required,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  required?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <select
      className="nz-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      disabled={disabled}
      required={required}
      style={{ width: "100%", ...style }}
    >
      {children}
    </select>
  );
}

/** Toggle switch backed by a real, focusable checkbox -- see .nz-switch in
 * tokens.css for the visual implementation. */
export function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <label className="nz-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} aria-label={ariaLabel} />
      <span className="nz-switch-track">
        <span className="nz-switch-thumb" />
      </span>
    </label>
  );
}

export type BadgeTone = "success" | "error" | "warning" | "info" | "neutral";

/** Status pill -- color driven by `tone`, matching .nz-badge's data-tone
 * variants in tokens.css. Use "neutral" for anything that isn't a clear
 * success/error/warning/info state. */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className="nz-badge" data-tone={tone === "neutral" ? undefined : tone}>
      {children}
    </span>
  );
}

/** Shimmering loading placeholder -- replaces the old "Loading…" text
 * states. Pass width/height to match the shape of what's loading. */
export function Skeleton({ width = "100%", height = 16, style }: { width?: number | string; height?: number | string; style?: React.CSSProperties }) {
  return <div className="nz-skeleton" style={{ width, height, ...style }} />;
}

// Original Nzyselle identity colors per platform -- deliberately NOT each
// platform's real brand color/logo, just a consistent way to tell cards
// apart at a glance. Sandbox uses the app's own accent.
const PLATFORM_BADGE_COLOR: Record<PlatformDefinition["id"], string> = {
  tiktok: "#e857a3",
  instagram: "#e0864f",
  youtube: "#e05f5f",
  sandbox: "var(--accent)",
};

/** Consistent platform identity: a colored initial badge (never a real
 * logo/trademark) + display name. Used anywhere a platform/connection
 * needs to be visually identified (Connections, Publish composer). */
export function PlatformBadge({ platformId, label, size = 32 }: { platformId: PlatformDefinition["id"]; label: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: "var(--panel-soft)",
        border: `1px solid ${PLATFORM_BADGE_COLOR[platformId]}`,
        color: PLATFORM_BADGE_COLOR[platformId],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {label[0]?.toUpperCase()}
    </span>
  );
}

/** Confirmation modal for destructive actions (delete, restore, disconnect
 * with pending scheduled posts). Same fixed-overlay + centered-panel
 * pattern as FirstRunAgreement.tsx. Renders nothing when `open` is false
 * so callers can mount it unconditionally and just flip `open`. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  if (!open) return null;
  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          background: "var(--panel-strong)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          {title}
        </h2>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <SecondaryButton onClick={onCancel}>{cancelLabel}</SecondaryButton>
          <button
            className="nz-btn-primary"
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: danger ? "var(--error)" : "var(--accent)",
              color: "#ffffff",
              fontWeight: 500,
              fontSize: 13,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
