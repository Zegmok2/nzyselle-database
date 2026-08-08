import { useEffect, useState } from "react";
import type { AnalyticsOverview, MetricDefinitionOption, MetricRow, SocialConnection } from "../lib/types";
import { useBackend } from "../lib/backendContext";
import { PrimaryButton } from "./dashboard/Toolbar";

type RangePreset = "24h" | "7d" | "28d" | "custom";

const PRESET_LABELS: Record<Exclude<RangePreset, "custom">, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "28d": "Last 28 days",
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC-based throughout -- measuredAt timestamps are stored/compared as
 * UTC dates, so mixing in local-timezone setDate()/getDate() here would
 * drift the range boundary by a day in any timezone behind UTC. */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function formatRangeLabel(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const e = new Date(end).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${s} - ${e}`;
}

/** Computes {start, end, compareStart, compareEnd} for a preset or a custom
 * range. Comparison is always the immediately preceding period of the same
 * length, matching GA4's "Preceding period" convention. */
function computeRange(preset: RangePreset, customStart: string, customEnd: string) {
  const today = new Date();
  let start: Date;
  let end: Date = today;
  if (preset === "24h") start = daysAgo(1);
  else if (preset === "7d") start = daysAgo(7);
  else if (preset === "28d") start = daysAgo(28);
  else {
    start = customStart ? new Date(customStart) : daysAgo(28);
    end = customEnd ? new Date(customEnd) : today;
  }
  const spanMs = end.getTime() - start.getTime();
  const compareEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const compareStart = new Date(compareEnd.getTime() - spanMs);
  return {
    start: toIsoDate(start),
    end: toIsoDate(end),
    compareStart: toIsoDate(compareStart),
    compareEnd: toIsoDate(compareEnd),
  };
}

function LineChart({ overview }: { overview: AnalyticsOverview }) {
  const width = 720;
  const height = 260;
  const padding = { top: 16, right: 16, bottom: 28, left: 44 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const allValues = [...overview.current, ...overview.previous].map((p) => p.value ?? 0);
  const maxValue = Math.max(1, ...allValues);

  function pointsFor(series: AnalyticsOverview["current"]) {
    if (series.length <= 1) return "";
    return series
      .map((p, i) => {
        const x = padding.left + (i / (series.length - 1)) * plotW;
        const y = padding.top + plotH - ((p.value ?? 0) / maxValue) * plotH;
        return `${x},${y}`;
      })
      .join(" ");
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxValue * f));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Metric over time">
      {yTicks.map((t, i) => {
        const y = padding.top + plotH - (i / (yTicks.length - 1)) * plotH;
        return (
          <g key={t + "-" + i}>
            <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--border-subtle)" strokeWidth={1} />
            <text x={padding.left - 8} y={y + 4} fontSize={10} fill="var(--text-tertiary)" textAnchor="end">
              {t}
            </text>
          </g>
        );
      })}
      {overview.previous.length > 1 && (
        <polyline points={pointsFor(overview.previous)} fill="none" stroke="var(--text-tertiary)" strokeWidth={2} strokeDasharray="4 4" />
      )}
      {overview.current.length > 1 && <polyline points={pointsFor(overview.current)} fill="none" stroke="var(--accent)" strokeWidth={2.5} />}
      {overview.current.map((p, i) => {
        if (p.value === null) return null;
        const x = padding.left + (overview.current.length > 1 ? (i / (overview.current.length - 1)) * plotW : plotW / 2);
        const y = padding.top + plotH - (p.value / maxValue) * plotH;
        return <circle key={p.date} cx={x} cy={y} r={3} fill="var(--accent)" />;
      })}
      {overview.current.length > 0 &&
        [0, Math.floor(overview.current.length / 2), overview.current.length - 1].map((i) => {
          const p = overview.current[i];
          if (!p) return null;
          const x = padding.left + (overview.current.length > 1 ? (i / (overview.current.length - 1)) * plotW : plotW / 2);
          return (
            <text key={i} x={x} y={height - 8} fontSize={10} fill="var(--text-tertiary)" textAnchor="middle">
              {new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </text>
          );
        })}
    </svg>
  );
}

function DeltaBadge({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>—</span>;
  }
  const up = percent >= 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: up ? "var(--success)" : "var(--error)", display: "inline-flex", alignItems: "center", gap: 3 }}>
      {up ? "↑" : "↓"} {Math.abs(percent).toFixed(1)}%
    </span>
  );
}

export function AnalyticsPage({ workspaceId }: { workspaceId: string }) {
  const backend = useBackend();
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [metricOptions, setMetricOptions] = useState<MetricDefinitionOption[]>([]);
  const [metricKey, setMetricKey] = useState("");
  const [preset, setPreset] = useState<RangePreset>("28d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [latestMetrics, setLatestMetrics] = useState<MetricRow[]>([]);
  const [recentCount, setRecentCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deliberately NOT memoized on top of [preset, customStart, customEnd] --
  // "end" means "now", and freezing that at mount would silently stop
  // covering newly-synced data the moment a real UTC day boundary passes
  // while this page stays open. Recomputing per render is cheap.
  const range = computeRange(preset, customStart, customEnd);

  useEffect(() => {
    let cancelled = false;
    backend.listConnections(workspaceId).then((c) => {
      if (cancelled) return;
      const connected = c.filter((conn) => conn.status.startsWith("connected"));
      setConnections(connected);
      if (connected.length > 0) setConnectionId(connected[0].id);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [backend, workspaceId]);

  useEffect(() => {
    if (!connectionId) return;
    backend.listAvailableMetrics(connectionId).then((opts) => {
      setMetricOptions(opts);
      setMetricKey((prev) => (opts.some((o) => o.metricKey === prev) ? prev : (opts[0]?.metricKey ?? "")));
    });
  }, [backend, connectionId]);

  useEffect(() => {
    if (!connectionId || !metricKey) return;
    let cancelled = false;
    backend
      .getAnalyticsOverview({ connectionId, metricKey, start: range.start, end: range.end, compareStart: range.compareStart, compareEnd: range.compareEnd })
      .then((o) => {
        if (!cancelled) setOverview(o);
      });
    backend.getRecentPostCount(connectionId, 30).then((c) => {
      if (!cancelled) setRecentCount(c);
    });
    backend.listMetrics(connectionId).then((rows) => {
      if (!cancelled) setLatestMetrics(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [backend, connectionId, metricKey, range.start, range.end, range.compareStart, range.compareEnd]);

  async function handleSync() {
    // metricOptions/metricKey load asynchronously right after connectionId
    // does -- without this guard, a click landing in that gap would query
    // with an empty metric key and silently show a false "0".
    if (!connectionId || !metricKey) return;
    setSyncing(true);
    setError(null);
    try {
      await backend.syncAnalytics(connectionId);
      const o = await backend.getAnalyticsOverview({ connectionId, metricKey, start: range.start, end: range.end, compareStart: range.compareStart, compareEnd: range.compareEnd });
      setOverview(o);
      setLatestMetrics(await backend.listMetrics(connectionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  // A metric the platform simply doesn't provide must say so explicitly,
  // never render as a silent 0 in the stat tiles/chart above.
  const notProvidedReason = latestMetrics.find((m) => m.metricKey === metricKey && m.value === null)?.notProvidedReason ?? null;

  const selectStyle: React.CSSProperties = {
    background: "var(--panel-soft)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    padding: "7px 10px",
    color: "var(--text-primary)",
    fontSize: 13,
    cursor: "pointer",
  };

  if (loading) {
    return <div style={{ padding: 32, color: "var(--text-secondary)" }}>Loading…</div>;
  }

  if (connections.length === 0) {
    return (
      <div style={{ padding: 32, maxWidth: 640 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Analytics</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 12 }}>
          Connect a platform first — there's nothing to sync yet.
        </p>
      </div>
    );
  }

  const metricLabel = metricOptions.find((m) => m.metricKey === metricKey)?.label ?? metricKey;

  return (
    <div style={{ padding: 32, maxWidth: "var(--content-max-width)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Analytics</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4, maxWidth: 520 }}>
            A metric your platform doesn't provide renders as "Not provided by this platform" — never a
            fabricated zero. Sparse charts mean sparse real data, not a bug.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} style={selectStyle}>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName ?? c.platformId} ({c.platformId})
              </option>
            ))}
          </select>
          <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)} style={selectStyle}>
            {metricOptions.map((m) => (
              <option key={m.metricKey} value={m.metricKey}>
                {m.label}
              </option>
            ))}
          </select>
          <select value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} style={selectStyle} aria-label="Date range">
            {(Object.keys(PRESET_LABELS) as (keyof typeof PRESET_LABELS)[]).map((key) => (
              <option key={key} value={key}>
                {PRESET_LABELS[key]}
              </option>
            ))}
            <option value="custom">Custom range</option>
          </select>
          {preset === "custom" && (
            <>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={selectStyle} aria-label="Custom range start" />
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={selectStyle} aria-label="Custom range end" />
            </>
          )}
          <PrimaryButton onClick={handleSync} disabled={syncing || !metricKey}>
            {syncing ? "Syncing…" : "Sync now"}
          </PrimaryButton>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        {formatRangeLabel(range.start, range.end)}
        <span style={{ margin: "0 6px" }}>·</span>
        Compare: {formatRangeLabel(range.compareStart, range.compareEnd)}
      </div>

      {error && <div style={{ color: "var(--error)", fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div
          className="nz-card"
          style={{
            flex: "1 1 640px",
            minWidth: 320,
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            background: "var(--panel-strong)",
            padding: 20,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>{metricLabel}</div>
          {notProvidedReason ? (
            <div style={{ padding: "24px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 15, color: "var(--text-tertiary)", fontStyle: "italic" }}>{notProvidedReason}</div>
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 8 }}>
                Never rendered as a zero — this platform simply doesn't expose this metric.
              </p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 32, marginBottom: 20, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Total</div>
                  <div style={{ fontSize: 26, fontWeight: 700, marginTop: 2 }}>{overview ? overview.currentTotal.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}</div>
                  {overview && <DeltaBadge percent={overview.deltaPercent} />}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Previous period</div>
                  <div style={{ fontSize: 26, fontWeight: 700, marginTop: 2, color: "var(--text-secondary)" }}>
                    {overview ? overview.previousTotal.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}
                  </div>
                </div>
              </div>
              {overview && <LineChart overview={overview} />}
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 14, height: 2, background: "var(--accent)", display: "inline-block" }} /> {formatRangeLabel(range.start, range.end)}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 14, height: 0, borderTop: "2px dashed var(--text-tertiary)", display: "inline-block" }} /> Preceding period
                </span>
              </div>
            </>
          )}
        </div>

        <div
          className="nz-card"
          style={{
            flex: "1 1 260px",
            minWidth: 240,
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            background: "var(--panel-strong)",
            padding: 20,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
            Posts in last 30 minutes
          </div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>{recentCount ?? "—"}</div>
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 12, lineHeight: 1.5 }}>
            Real posts the scheduler actually completed for this connection — not a fabricated live feed.
          </p>
        </div>
      </div>

      {metricOptions.length === 0 && (
        <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No metric definitions registered for this platform yet.</p>
      )}
    </div>
  );
}
