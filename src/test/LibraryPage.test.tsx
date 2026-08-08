import { render, screen, waitFor } from "@testing-library/react";
import { TestBackendProvider } from "../lib/backendContext";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryPage } from "../components/LibraryPage";
import { mockBackend, resetMockBackendForTests } from "../lib/mockBackend";

beforeEach(() => {
  resetMockBackendForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The real picker opens a native OS dialog -- in tests we stub the result
 * it resolves to, the same shape tauriBackend.pickVideoFile() would return. */
function stubPickedFile(path: string | null) {
  vi.spyOn(mockBackend, "pickVideoFile").mockResolvedValue(path);
}

describe("Library page", () => {
  it("starts empty with an honest empty state, not fake sample videos", async () => {
    render(
      <TestBackendProvider backend={mockBackend}>
        <LibraryPage workspaceId="ws_1" />
      </TestBackendProvider>,
    );
    expect(await screen.findByText(/no videos yet/i)).toBeInTheDocument();
  });

  it("lets the user pick a video via the native file dialog and shows its real details", async () => {
    stubPickedFile("C:\\Users\\zegmo\\Desktop\\OutfitVideos\\golden-angel-girl.mp4");
    const user = userEvent.setup();
    render(
      <TestBackendProvider backend={mockBackend}>
        <LibraryPage workspaceId="ws_1" />
      </TestBackendProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /add video/i }));

    expect(await screen.findByText("golden-angel-girl.mp4")).toBeInTheDocument();
    expect(screen.getByText(/1080×1920 \(vertical\)/)).toBeInTheDocument();
  });

  it("cancelling the picker adds nothing", async () => {
    stubPickedFile(null);
    const user = userEvent.setup();
    render(
      <TestBackendProvider backend={mockBackend}>
        <LibraryPage workspaceId="ws_1" />
      </TestBackendProvider>,
    );
    await user.click(await screen.findByRole("button", { name: /add video/i }));
    expect(await screen.findByText(/no videos yet/i)).toBeInTheDocument();
  });

  it("warns instead of silently double-adding the same file", async () => {
    stubPickedFile("C:\\videos\\same-file.mp4");
    const user = userEvent.setup();
    render(
      <TestBackendProvider backend={mockBackend}>
        <LibraryPage workspaceId="ws_1" />
      </TestBackendProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /add video/i }));
    await screen.findByText("same-file.mp4");

    await user.click(screen.getByRole("button", { name: /add video/i }));

    expect(await screen.findByText(/already in the library/i)).toBeInTheDocument();
    // still only one entry, not two
    expect(screen.getAllByText("same-file.mp4")).toHaveLength(1);
  });

  it("search filters the list without deleting anything", async () => {
    const user = userEvent.setup();
    render(
      <TestBackendProvider backend={mockBackend}>
        <LibraryPage workspaceId="ws_1" />
      </TestBackendProvider>,
    );

    for (const name of ["angel.mp4", "goth.mp4"]) {
      stubPickedFile(`C:\\videos\\${name}`);
      await user.click(await screen.findByRole("button", { name: /add video/i }));
      await screen.findByText(name);
    }

    await user.type(screen.getByLabelText(/search library/i), "angel");
    await waitFor(() => expect(screen.queryByText("goth.mp4")).not.toBeInTheDocument());
    expect(screen.getByText("angel.mp4")).toBeInTheDocument();
  });

  it("removing a video actually removes it, not just hides it", async () => {
    stubPickedFile("C:\\videos\\temp.mp4");
    const user = userEvent.setup();
    render(
      <TestBackendProvider backend={mockBackend}>
        <LibraryPage workspaceId="ws_1" />
      </TestBackendProvider>,
    );
    await user.click(await screen.findByRole("button", { name: /add video/i }));
    await screen.findByText("temp.mp4");

    await user.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(screen.queryByText("temp.mp4")).not.toBeInTheDocument());

    const videos = await mockBackend.listVideos("ws_1");
    expect(videos).toHaveLength(0);
  });
});
