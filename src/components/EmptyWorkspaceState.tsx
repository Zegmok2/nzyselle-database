import { motion } from "framer-motion";

export function EmptyWorkspaceState({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        minHeight: "70vh",
        textAlign: "center",
        padding: "0 24px",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          background: "var(--accent-gradient)",
          opacity: 0.9,
        }}
      />
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
        Create your first account group to organize its social accounts, videos, posts, and analytics.
      </h2>
      <p style={{ margin: 0, color: "var(--text-secondary)", maxWidth: 440 }}>
        An account group is a local workspace — not a social-media login — used to group accounts that
        represent the same creator identity, like &ldquo;Nzyselle&rdquo; or &ldquo;Outfit Shop.&rdquo;
      </p>
      <button
        onClick={onCreate}
        style={{
          marginTop: 8,
          padding: "12px 24px",
          borderRadius: "var(--radius-md)",
          border: "none",
          background: "var(--accent-gradient)",
          color: "#ffffff",
          fontWeight: 600,
          fontSize: 15,
          cursor: "pointer",
        }}
      >
        Create account group
      </button>
    </motion.div>
  );
}
