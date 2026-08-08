import { useEffect, useState } from "react";
import { SplashScreen } from "./components/SplashScreen";
import { FirstRunAgreement } from "./components/FirstRunAgreement";
import { ACCEPTANCE_STORAGE_KEY } from "./lib/legal";
import { EmptyWorkspaceState } from "./components/EmptyWorkspaceState";
import { CreateWorkspaceModal } from "./components/CreateWorkspaceModal";
import { WorkspaceGrid } from "./components/WorkspaceGrid";
import { WorkspaceShell, type WorkspaceTab } from "./components/WorkspaceShell";
import { ConnectionsPage } from "./components/ConnectionsPage";
import { LibraryPage } from "./components/LibraryPage";
import { PublishPage } from "./components/PublishPage";
import { VideosPage } from "./components/VideosPage";
import { CalendarPage } from "./components/CalendarPage";
import { AnalyticsPage } from "./components/AnalyticsPage";
import { DiagnosticsPage } from "./components/DiagnosticsPage";
import { TemplatesPage } from "./components/TemplatesPage";
import { SettingsPage } from "./components/SettingsPage";
import { OverviewPage } from "./components/OverviewPage";
import { BackendProvider, useBackend, useHasBackend } from "./lib/backendContext";
import type { Workspace } from "./lib/types";

type Route = { name: "splash" } | { name: "groups" } | { name: "workspace"; id: string; tab: WorkspaceTab };

/** Shown when the frontend is running without its native Tauri shell (e.g.
 * a browser preview of the built assets). Per spec, this must be an
 * explicit configuration error, never a silent fallback to sample data. */
function ConfigurationError() {
  return (
    <div style={{ padding: 48, maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Nzyselle Database isn&rsquo;t running as a desktop app</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
        This screen only has a browser preview of the interface, with no connection to your local
        database. Run <code>npm run tauri dev</code> (or open the installed application) instead of
        loading this page directly in a browser — Nzyselle Database never falls back to sample data.
      </p>
    </div>
  );
}

function hasAcceptedLegal(): boolean {
  if (import.meta.env.MODE === "test") return true;
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(ACCEPTANCE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell() {
  const backend = useBackend();
  const initialRoute: Route = import.meta.env.MODE === "test" ? { name: "groups" } : { name: "splash" };
  const [route, setRoute] = useState<Route>(initialRoute);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(hasAcceptedLegal);

  useEffect(() => {
    backend.listWorkspaces().then((ws) => {
      setWorkspaces(ws);
      setLoaded(true);
    });
  }, [backend]);

  async function handleCreateWorkspace(input: {
    name: string;
    description?: string;
    accentColor?: string;
    defaultWatchFolder?: string;
  }) {
    const ws = await backend.createWorkspace(input);
    setWorkspaces((prev) => [...prev, ws]);
    setShowCreateModal(false);
    setRoute({ name: "groups" });
  }

  if (route.name === "splash") {
    return <SplashScreen mode="full" onComplete={() => setRoute({ name: "groups" })} />;
  }

  if (!legalAccepted) {
    return (
      <FirstRunAgreement
        onAccept={() => {
          try {
            window.localStorage.setItem(ACCEPTANCE_STORAGE_KEY, "1");
          } catch {
            // ignore -- worst case this is shown again next launch
          }
          setLegalAccepted(true);
        }}
      />
    );
  }

  if (!loaded) {
    return <div style={{ padding: 32, color: "var(--text-secondary)" }}>Loading…</div>;
  }

  if (route.name === "groups") {
    if (workspaces.length === 0) {
      return (
        <>
          <EmptyWorkspaceState onCreate={() => setShowCreateModal(true)} />
          {showCreateModal && (
            <CreateWorkspaceModal onCancel={() => setShowCreateModal(false)} onCreate={handleCreateWorkspace} />
          )}
        </>
      );
    }
    return (
      <>
        <WorkspaceGrid
          workspaces={workspaces}
          onOpen={(id) => setRoute({ name: "workspace", id, tab: "connections" })}
          onCreate={() => setShowCreateModal(true)}
        />
        {showCreateModal && (
          <CreateWorkspaceModal onCancel={() => setShowCreateModal(false)} onCreate={handleCreateWorkspace} />
        )}
      </>
    );
  }

  // route.name === "workspace"
  const workspace = workspaces.find((w) => w.id === route.id);
  if (!workspace) {
    // Never trap the user — if the workspace disappeared (e.g. deleted in
    // another window), fall back to the groups page instead of a dead end.
    setRoute({ name: "groups" });
    return null;
  }

  return (
    <WorkspaceShell
      workspace={workspace}
      activeTab={route.tab}
      onChangeTab={(tab) => setRoute({ name: "workspace", id: workspace.id, tab })}
      onBackToGroups={() => setRoute({ name: "groups" })}
    >
      {route.tab === "connections" ? (
        <ConnectionsPage workspaceId={workspace.id} />
      ) : route.tab === "library" ? (
        <LibraryPage workspaceId={workspace.id} />
      ) : route.tab === "publish" ? (
        <PublishPage workspaceId={workspace.id} />
      ) : route.tab === "videos" ? (
        <VideosPage workspaceId={workspace.id} />
      ) : route.tab === "calendar" ? (
        <CalendarPage workspaceId={workspace.id} />
      ) : route.tab === "analytics" ? (
        <AnalyticsPage workspaceId={workspace.id} />
      ) : route.tab === "templates" ? (
        <TemplatesPage workspaceId={workspace.id} />
      ) : route.tab === "diagnostics" ? (
        <DiagnosticsPage workspaceId={workspace.id} />
      ) : route.tab === "settings" ? (
        <SettingsPage
          workspace={workspace}
          onUpdated={(updated) => setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)))}
        />
      ) : (
        <OverviewPage workspace={workspace} />
      )}
    </WorkspaceShell>
  );
}

function AppInner() {
  const hasBackend = useHasBackend();
  return hasBackend ? <AppShell /> : <ConfigurationError />;
}

export default function App() {
  return (
    <BackendProvider>
      <AppInner />
    </BackendProvider>
  );
}
