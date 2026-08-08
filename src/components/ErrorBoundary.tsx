import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last-resort crash screen. Without this, any uncaught render error
 * anywhere in the tree unmounts the whole app and leaves a blank white
 * window with no explanation -- especially bad for a paying customer with
 * no console open. This can't fix the underlying bug, but it turns a silent
 * crash into a recoverable, legible one and never fabricates a "we've been
 * notified" message -- there's no crash-reporting service wired up, so it
 * says exactly that.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Nzyselle Database crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0a0a0c",
          color: "#f5f5f7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          fontFamily: "'Segoe UI', system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Something went wrong</div>
          <p style={{ fontSize: 13, color: "#96969e", lineHeight: 1.6, marginBottom: 8 }}>
            Nzyselle Database hit an unexpected error and couldn&rsquo;t continue. Nothing was reported
            automatically -- there&rsquo;s no crash-reporting service wired up in this build.
          </p>
          <pre
            style={{
              fontSize: 11,
              color: "#6a6a73",
              background: "#131316",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: 12,
              textAlign: "left",
              overflow: "auto",
              maxHeight: 140,
              margin: "16px 0",
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
