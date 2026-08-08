import { render, screen, waitFor } from "@testing-library/react";
import { TestBackendProvider } from "../lib/backendContext";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectionsPage } from "../components/ConnectionsPage";
import { mockBackend, resetMockBackendForTests } from "../lib/mockBackend";

beforeEach(() => {
  resetMockBackendForTests();
});

function renderPage() {
  return render(
    <TestBackendProvider backend={mockBackend}>
      <ConnectionsPage workspaceId="ws_1" />
    </TestBackendProvider>,
  );
}

describe("Connections page", () => {
  it("shows all four registered platforms as not connected before anything is attached", async () => {
    renderPage();
    for (const platform of ["TikTok", "Instagram", "YouTube", "Sandbox (Dev Only)"]) {
      const card = (await screen.findByText(platform)).closest("div");
      expect(card).toBeTruthy();
    }
    expect(screen.getAllByText(/not connected/i)).toHaveLength(4);
  });

  it("never shows a fake login form, and real platforms without an adapter say so instead of offering a connect button", async () => {
    renderPage();
    await screen.findByText("TikTok");
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    // TikTok has a real adapter now (core/src/tiktok_adapter.rs), but no
    // developer app credentials configured in this test -- must NOT offer
    // a connect action that could produce a mislabeled fake connection.
    expect(screen.queryByRole("button", { name: /attach tiktok here/i })).not.toBeInTheDocument();
    expect(screen.getByText(/add a tiktok developer app client id\/secret/i)).toBeInTheDocument();

    // Only the clearly-labeled sandbox card has a working connect flow.
    expect(screen.getByRole("button", { name: /attach sandbox \(dev only\) here/i })).toBeInTheDocument();
  });

  it("connecting via the sandbox card shows a verified connected identity, and enabling/disabling never disconnects it", async () => {
    const user = userEvent.setup();
    renderPage();

    const attachBtn = await screen.findByRole("button", { name: /attach sandbox \(dev only\) here/i });
    await user.click(attachBtn);

    // Identity should appear once the (simulated) OAuth round-trip completes.
    await screen.findByText(/@sandbox_creator/);
    expect(screen.getByText(/^Connected$/)).toBeInTheDocument();

    // Disabling excludes it from new posts by default but must not remove
    // the connection or its granted-scopes history.
    const toggle = screen.getByRole("checkbox", { name: /disable sandbox \(dev only\) for new posts/i });
    await user.click(toggle);

    await waitFor(() => expect(screen.getByText(/connected \(disabled\)/i)).toBeInTheDocument());
    // Still shows the same identity and granted scopes — nothing was wiped.
    expect(screen.getByText(/@sandbox_creator/)).toBeInTheDocument();
    expect(screen.getByText(/granted: publish, analytics/i)).toBeInTheDocument();

    // Re-enabling is instant and doesn't require reconnecting.
    const toggleAgain = screen.getByRole("checkbox", { name: /enable sandbox \(dev only\) for new posts/i });
    await user.click(toggleAgain);
    await waitFor(() => expect(screen.getByText(/^Connected$/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /attach sandbox \(dev only\) here/i })).not.toBeInTheDocument();
  });

  it("disconnect actually removes the connection, unlike disabling", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /attach sandbox \(dev only\) here/i }));
    await screen.findByText(/@sandbox_creator/);

    await user.click(screen.getByRole("button", { name: /disconnect/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /attach sandbox \(dev only\) here/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/@sandbox_creator/)).not.toBeInTheDocument();
  });
});
