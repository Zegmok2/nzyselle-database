export function NotYetBuilt({ tabLabel }: { tabLabel: string }) {
  return (
    <div style={{ padding: 32, maxWidth: 560 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{tabLabel}</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
        This page isn't built yet. It's on the implementation plan (see the project README) but showing
        it here as real content, rather than a placeholder screenshot, would misrepresent what currently
        works — Nzyselle Database is not supposed to show anything that isn't real.
      </p>
    </div>
  );
}
