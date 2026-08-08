import { createContext, useContext, type ReactNode } from "react";
import type { Backend } from "./backend";
import { isRunningInTauri, tauriBackend } from "./tauriBackend";

const BackendContext = createContext<Backend | null>(null);

/** Production entry point: wraps the app with the real Tauri backend. If
 * the native shell isn't present (e.g. someone opened the built frontend
 * in a plain browser), this deliberately does NOT fall back to mock data
 * — per spec, that must surface as a configuration error, not fake
 * success. See <ConfigurationError /> in App.tsx for what the user sees. */
export function BackendProvider({ children }: { children: ReactNode }) {
  const backend = isRunningInTauri() ? tauriBackend : null;
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}

/** Test-only entry point. Components never import mockBackend directly —
 * tests use this instead, so there is no code path from a production
 * render to fake data. */
export function TestBackendProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}

export function useBackend(): Backend {
  const backend = useContext(BackendContext);
  if (!backend) {
    throw new Error(
      "No backend available. Nzyselle Database must run inside its native Tauri shell " +
        "(npm run tauri dev / the built .exe) — it does not fall back to sample data.",
    );
  }
  return backend;
}

export function useHasBackend(): boolean {
  return useContext(BackendContext) !== null;
}
