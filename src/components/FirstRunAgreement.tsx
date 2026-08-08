import { useState } from "react";
import { EULA_TEXT, PRIVACY_TEXT } from "../lib/legal";

const panelStyle: React.CSSProperties = {
  background: "var(--panel-soft)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: 14,
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  overflowY: "auto",
  maxHeight: 220,
};

/**
 * Shown once, before the app is usable, gated on ACCEPTANCE_STORAGE_KEY in
 * legal.ts (bump LEGAL_VERSION there to force re-acceptance after a real
 * terms change). Deliberately rendered AFTER the startup intro completes --
 * never touches SplashScreen or its timing.
 */
export function FirstRunAgreement({ onAccept }: { onAccept: () => void }) {
  const [checked, setChecked] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(640px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--panel-strong)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Before you get started</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 6 }}>
            Please review the license agreement and privacy policy below.
          </p>
        </div>

        <div>
          <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>End-User License Agreement</h2>
          <div style={panelStyle}>{EULA_TEXT}</div>
        </div>

        <div>
          <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Privacy Policy</h2>
          <div style={panelStyle}>{PRIVACY_TEXT}</div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          I have read and agree to the license agreement and privacy policy above.
        </label>

        <button
          onClick={onAccept}
          disabled={!checked}
          style={{
            alignSelf: "flex-start",
            padding: "9px 18px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            cursor: checked ? "pointer" : "not-allowed",
            opacity: checked ? 1 : 0.5,
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
