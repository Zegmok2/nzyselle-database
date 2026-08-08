import { render, screen } from "@testing-library/react";
import { TestBackendProvider } from "../lib/backendContext";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectionsPage } from "../components/ConnectionsPage";
import { mockBackend, resetMockBackendForTests } from "../lib/mockBackend";

beforeEach(() => {
  resetMockBackendForTests();
});

describe("Real platform credential gating", () => {
  it("only offers a real connect button for a platform once its developer credentials are configured", async () => {
    render(
      <TestBackendProvider backend={mockBackend}>
        <ConnectionsPage workspaceId="ws_1" />
      </TestBackendProvider>,
    );
    await screen.findByText("TikTok");
    expect(screen.queryByRole("button", { name: /attach tiktok here/i })).not.toBeInTheDocument();

    await mockBackend.setPlatformCredentials("tiktok", "client-id-123", "client-secret-456");

    render(
      <TestBackendProvider backend={mockBackend}>
        <ConnectionsPage workspaceId="ws_1" />
      </TestBackendProvider>,
    );
    expect(await screen.findByRole("button", { name: /attach tiktok here/i })).toBeInTheDocument();
  });

  it("connecting a configured real platform produces a real connection, not a mislabeled sandbox one", async () => {
    await mockBackend.setPlatformCredentials("youtube", "yt-client", "yt-secret");
    const user = userEvent.setup();

    render(
      <TestBackendProvider backend={mockBackend}>
        <ConnectionsPage workspaceId="ws_1" />
      </TestBackendProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /attach youtube here/i }));
    await screen.findByText(/youtube creator/i);

    const connections = await mockBackend.listConnections("ws_1");
    expect(connections).toHaveLength(1);
    expect(connections[0].platformId).toBe("youtube");
  });
});
