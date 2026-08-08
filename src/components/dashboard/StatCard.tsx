/** Compact metric card -- used across Overview/Analytics for consistent
 * summary-tile styling (dark panel, thin border, muted label, optional
 * trailing delta chip). */
export function StatCard({
  label,
  value,
  hint,
  delta,
}: {
  label: string;
  value: string | number;
  hint?: string;
  delta?: { text: string; tone: "up" | "down" | "neutral" };
}) {
  const deltaColor = delta?.tone === "up" ? "var(--success)" : delta?.tone === "down" ? "var(--error)" : "var(--text-secondary)";
  return (
    <div
      className="nz-card"
      style={{
        padding: "16px 18px",
        borderRadius: "var(--radius-md)",
        background: "var(--panel-strong)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>
        {delta && (
          <span style={{ fontSize: 11, color: deltaColor, display: "inline-flex", alignItems: "center", gap: 2 }}>{delta.text}</span>
        )}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 6, letterSpacing: "-0.01em" }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
