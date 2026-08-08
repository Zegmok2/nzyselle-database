import type { ReactNode } from "react";

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

/** Consistent empty-state block for lists/tables with nothing to show. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "var(--text-tertiary)",
        fontSize: 13,
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {message}
    </div>
  );
}
