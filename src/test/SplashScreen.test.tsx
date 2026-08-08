import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SplashScreen } from "../components/SplashScreen";

beforeEach(() => {
  window.localStorage.removeItem("nzyselle:skipIntro");
});

afterEach(() => {
  window.localStorage.removeItem("nzyselle:skipIntro");
});

describe("SplashScreen (terminal intro)", () => {
  it('mode="off" completes immediately and renders nothing', async () => {
    const onComplete = vi.fn();
    const { container } = render(<SplashScreen mode="off" onComplete={onComplete} />);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("the dev-only skip flag (nzyselle:skipIntro) bypasses the intro without touching mode", async () => {
    window.localStorage.setItem("nzyselle:skipIntro", "1");
    const onComplete = vi.fn();
    const { container } = render(<SplashScreen mode="full" onComplete={onComplete} />);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders as an accessible status region while playing, and never lets the real interface show through", async () => {
    const onComplete = vi.fn();
    render(<SplashScreen mode="short" onComplete={onComplete} />);
    expect(await screen.findByRole("status", { name: /loading nzyselle database/i })).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("eventually reveals the phrase and calls onComplete exactly once for a real (non-skipped) run", async () => {
    const onComplete = vi.fn();
    render(<SplashScreen mode="short" onComplete={onComplete} />);
    // "CHANGE THE WORLD." is built from block glyphs, not plain text nodes,
    // so we can't query for the literal string -- the reliable signal that
    // the full sequence ran is onComplete firing exactly once.
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(onComplete).toHaveBeenCalledTimes(1);
  }, 24000);

  it("respects prefers-reduced-motion with a shorter, simplified run that still completes once", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      const onComplete = vi.fn();
      render(<SplashScreen mode="short" onComplete={onComplete} />);
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { timeout: 20000 });
    } finally {
      window.matchMedia = original;
    }
  }, 24000);
});
