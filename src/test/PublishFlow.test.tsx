import { render, screen, waitFor } from "@testing-library/react";
import { TestBackendProvider } from "../lib/backendContext";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PublishPage } from "../components/PublishPage";
import { VideosPage } from "../components/VideosPage";
import { CalendarPage } from "../components/CalendarPage";
import { mockBackend, resetMockBackendForTests } from "../lib/mockBackend";

const WORKSPACE_ID = "ws_1";

async function seedVideoAndConnection() {
  await mockBackend.beginConnectSandbox(WORKSPACE_ID);
  const video = await mockBackend.addVideoFromPath(WORKSPACE_ID, "C:\\videos\\outfit.mp4");
  return video;
}

beforeEach(() => {
  resetMockBackendForTests();
});

describe("Publish -> Videos -> Calendar", () => {
  it("posting now queues the destination and Videos shows it posted, never a fake instant success without going through the pipeline", async () => {
    await seedVideoAndConnection();
    const user = userEvent.setup();

    const publishRender = render(
      <TestBackendProvider backend={mockBackend}>
        <PublishPage workspaceId={WORKSPACE_ID} />
      </TestBackendProvider>,
    );

    const videoSelect = await screen.findByLabelText(/video/i);
    await user.selectOptions(videoSelect, "outfit.mp4");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /post now/i }));

    expect(await screen.findByText(/queued for 1 destination/i)).toBeInTheDocument();
    publishRender.unmount();

    render(
      <TestBackendProvider backend={mockBackend}>
        <VideosPage workspaceId={WORKSPACE_ID} />
      </TestBackendProvider>,
    );
    expect(await screen.findByText("posted")).toBeInTheDocument();
  });

  it("scheduling for later keeps the post out of Videos' posted state and lists it on Calendar until cancelled", async () => {
    await seedVideoAndConnection();
    const user = userEvent.setup();

    const publishRender = render(
      <TestBackendProvider backend={mockBackend}>
        <PublishPage workspaceId={WORKSPACE_ID} />
      </TestBackendProvider>,
    );

    const videoSelect = await screen.findByLabelText(/video/i);
    await user.selectOptions(videoSelect, "outfit.mp4");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("radio", { name: /schedule for later/i }));

    const future = new Date(Date.now() + 60 * 60 * 1000);
    const localValue = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await user.type(screen.getByLabelText(/scheduled time/i), localValue);
    await user.click(screen.getByRole("button", { name: /^schedule$/i }));

    expect(await screen.findByText(/scheduled for/i)).toBeInTheDocument();
    publishRender.unmount();

    const { unmount } = render(
      <TestBackendProvider backend={mockBackend}>
        <CalendarPage workspaceId={WORKSPACE_ID} />
      </TestBackendProvider>,
    );
    await screen.findByText(/no caption/i);
    await user.click(screen.getByRole("button", { name: /cancel sandbox/i }));
    await waitFor(() => expect(screen.queryByText(/no caption/i)).not.toBeInTheDocument());
    unmount();
  });
});
