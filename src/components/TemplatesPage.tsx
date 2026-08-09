import { useEffect, useState } from "react";
import type { CaptionTemplate, HashtagSet } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { ConfirmDialog, EmptyState, PageToolbar, PrimaryButton, Skeleton } from "./dashboard/Toolbar";
import { Hash, FileText } from "lucide-react";

const inputStyle: React.CSSProperties = {
  background: "var(--panel-soft)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 10px",
  color: "var(--text-primary)",
  fontSize: "var(--text-base)",
  fontFamily: "inherit",
};

type PendingDelete = { kind: "template"; id: string; label: string } | { kind: "hashtagSet"; id: string; label: string };

export function TemplatesPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [templates, setTemplates] = useState<CaptionTemplate[]>([]);
  const [hashtagSets, setHashtagSets] = useState<HashtagSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateName, setTemplateName] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [setName, setSetName] = useState("");
  const [setTags, setSetTags] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  async function reload() {
    const [t, h] = await Promise.all([backend.listCaptionTemplates(workspaceId), backend.listHashtagSets(workspaceId)]);
    setTemplates(t);
    setHashtagSets(h);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, workspaceId]);

  async function addTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!templateName.trim()) return;
    await backend.createCaptionTemplate(workspaceId, templateName.trim(), templateBody || undefined);
    setTemplateName("");
    setTemplateBody("");
    reload();
  }

  async function addHashtagSet(e: React.FormEvent) {
    e.preventDefault();
    if (!setName.trim()) return;
    const tags = setTags.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
    await backend.createHashtagSet(workspaceId, setName.trim(), tags);
    setSetName("");
    setSetTags("");
    reload();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "template") await backend.deleteCaptionTemplate(pendingDelete.id);
    else await backend.deleteHashtagSet(pendingDelete.id);
    setPendingDelete(null);
    reload();
  }

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton height={32} width={160} />
        <Skeleton height={100} />
        <Skeleton height={100} />
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
      <PageToolbar title="Templates" />

      <section>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: 10 }}>Caption templates</h2>
        <form onSubmit={addTemplate} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" style={inputStyle} />
          <textarea value={templateBody} onChange={(e) => setTemplateBody(e.target.value)} placeholder="Caption structure" rows={2} style={inputStyle} />
          <div>
            <PrimaryButton type="submit">Add template</PrimaryButton>
          </div>
        </form>
        {templates.length === 0 ? (
          <EmptyState icon={<FileText size={22} />} message="No templates yet." />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {templates.map((t) => (
              <li key={t.id} className="nz-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--panel-strong)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-base)" }}>
                <span>{t.name}</span>
                <button
                  onClick={() => setPendingDelete({ kind: "template", id: t.id, label: t.name })}
                  style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "var(--text-sm)" }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: 10 }}>Hashtag sets</h2>
        <form onSubmit={addHashtagSet} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <input value={setName} onChange={(e) => setSetName(e.target.value)} placeholder="Set name" style={inputStyle} />
          <input value={setTags} onChange={(e) => setSetTags(e.target.value)} placeholder="#tag1 #tag2 #tag3" style={inputStyle} />
          <div>
            <PrimaryButton type="submit">Add hashtag set</PrimaryButton>
          </div>
        </form>
        {hashtagSets.length === 0 ? (
          <EmptyState icon={<Hash size={22} />} message="No hashtag sets yet." />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {hashtagSets.map((h) => (
              <li key={h.id} className="nz-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--panel-strong)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-base)" }}>
                <span>
                  {h.name} — {h.hashtags.join(" ")}
                </span>
                <button
                  onClick={() => setPendingDelete({ kind: "hashtagSet", id: h.id, label: h.name })}
                  style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "var(--text-sm)" }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === "template" ? "Delete this template?" : "Delete this hashtag set?"}
        message={pendingDelete ? `"${pendingDelete.label}" will be permanently deleted. This doesn't affect posts already made with it.` : ""}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
