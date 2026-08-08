import { useState } from "react";
import { motion } from "framer-motion";

interface CreateWorkspaceModalProps {
  onCancel: () => void;
  onCreate: (input: { name: string; description?: string; accentColor?: string; defaultWatchFolder?: string }) => Promise<void>;
}

const ACCENTS = ["#A98BFF", "#FF8FD0", "#FFE176", "#72E6B1"];

export function CreateWorkspaceModal({ onCancel, onCreate }: CreateWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accentColor, setAccentColor] = useState<string>(ACCENTS[0]);
  const [watchFolder, setWatchFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        accentColor,
        defaultWatchFolder: watchFolder.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the account group.");
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-workspace-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,5,10,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: 440,
          maxWidth: "92vw",
          background: "var(--panel-strong)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h2 id="create-workspace-title" style={{ margin: 0, fontSize: 18 }}>
          Create account group
        </h2>

        <label style={fieldLabel}>
          Account-group name
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nzyselle"
            style={inputStyle}
          />
        </label>

        <label style={fieldLabel}>
          Description <span style={optionalTag}>optional</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>

        <div>
          <div style={{ ...fieldLabel, marginBottom: 8 }}>
            Accent color <span style={optionalTag}>optional</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {ACCENTS.map((c) => (
              <button
                type="button"
                key={c}
                aria-label={`Use accent color ${c}`}
                aria-pressed={accentColor === c}
                onClick={() => setAccentColor(c)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: c,
                  border: accentColor === c ? "2px solid white" : "2px solid transparent",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>

        <label style={fieldLabel}>
          Default export/watch folder <span style={optionalTag}>optional</span>
          <input
            value={watchFolder}
            onChange={(e) => setWatchFolder(e.target.value)}
            placeholder="C:\\Users\\you\\Desktop\\OutfitVideos"
            style={inputStyle}
          />
        </label>

        {error && <div style={{ color: "var(--error)", fontSize: 13 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
          <button type="button" onClick={onCancel} style={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit} style={primaryButton(canSubmit)}>
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </motion.form>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "var(--text-secondary)",
};

const optionalTag: React.CSSProperties = {
  color: "var(--text-tertiary)",
  fontWeight: 400,
};

const inputStyle: React.CSSProperties = {
  background: "var(--panel-soft)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "10px 12px",
  color: "var(--text-primary)",
  fontSize: 14,
  fontFamily: "inherit",
};

const secondaryButton: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-subtle)",
  background: "transparent",
  color: "var(--text-primary)",
  cursor: "pointer",
};

function primaryButton(enabled: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: enabled ? "var(--accent-gradient)" : "var(--panel-soft)",
    color: enabled ? "#ffffff" : "var(--text-tertiary)",
    fontWeight: 600,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}
