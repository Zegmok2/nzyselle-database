import { useEffect, useState } from "react";
import type { CaptionTemplate, HashtagSet } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { EmptyState, SecondaryButton } from "./dashboard/Toolbar";

const inputStyle: React.CSSProperties = {
  background: "var(--panel-soft)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 10px",
  color: "var(--text-primary)",
  fontSize: 13,
};

export function TemplatesPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [templates, setTemplates] = useState<CaptionTemplate[]>([]);
  const [hashtagSets, setHashtagSets] = useState<HashtagSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateName, setTemplateName] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [setName, setSetName] = useState("");
  const [setTags, setSetTags] = useState("");

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

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-secondary)" }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>Templates</h1>
      </div>

      <section>
        <h2 style={{ fontSize: 15, marginBottom: 10 }}>Caption templates</h2>
        <form onSubmit={addTemplate} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" style={inputStyle} />
          <textarea value={templateBody} onChange={(e) => setTemplateBody(e.target.value)} placeholder="Caption structure" rows={2} style={inputStyle} />
          <div>
            <SecondaryButton>Add template</SecondaryButton>
          </div>
        </form>
        {templates.length === 0 ? (
          <EmptyState message="No templates yet." />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {templates.map((t) => (
              <li key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--panel-strong)", borderRadius: "var(--radius-sm)", fontSize: 13 }}>
                <span>{t.name}</span>
                <button onClick={() => backend.deleteCaptionTemplate(t.id).then(reload)} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 15, marginBottom: 10 }}>Hashtag sets</h2>
        <form onSubmit={addHashtagSet} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <input value={setName} onChange={(e) => setSetName(e.target.value)} placeholder="Set name" style={inputStyle} />
          <input value={setTags} onChange={(e) => setSetTags(e.target.value)} placeholder="#tag1 #tag2 #tag3" style={inputStyle} />
          <div>
            <SecondaryButton>Add hashtag set</SecondaryButton>
          </div>
        </form>
        {hashtagSets.length === 0 ? (
          <EmptyState message="No hashtag sets yet." />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {hashtagSets.map((h) => (
              <li key={h.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--panel-strong)", borderRadius: "var(--radius-sm)", fontSize: 13 }}>
                <span>
                  {h.name} — {h.hashtags.join(" ")}
                </span>
                <button onClick={() => backend.deleteHashtagSet(h.id).then(reload)} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
