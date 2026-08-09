import { render, screen, waitFor, within } from "@testing-library/react";
import { TestBackendProvider } from "../lib/backendContext";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AnalyticsPage } from "../components/AnalyticsPage";
import { TemplatesPage } from "../components/TemplatesPage";
import { mockBackend, resetMockBackendForTests } from "../lib/mockBackend";

const WORKSPACE_ID = "ws_1";

beforeEach(() => {
  resetMockBackendForTests();
});

/** The chart's Y-axis tick labels can coincidentally show the same number
 * as the stat tile (e.g. both showing "128"), so a plain findByText("128")
 * can match more than one element. Scope to the "Total" StatCard
 * specifically -- its DOM is [row(label+delta), valueDiv, hintDiv?]
 * (see dashboard/StatCard.tsx), so the value is the card's 2nd child. */
function totalValueText(): string {
  const label = screen.getByText("Total");
  const card = label.closest(".nz-card")!;
  return card.querySelector(":scope > div:nth-child(2)")!.textContent ?? "";
}

describe("Analytics page", () => {
  it("shows a real total for a supported metric and syncing updates it", async () => {
    const conn = await mockBackend.beginConnectSandbox(WORKSPACE_ID);
    const video = await mockBackend.addVideoFromPath(WORKSPACE_ID, "C:\\videos\\outfit.mp4");
    await mockBackend.submitCampaign({ workspaceId: WORKSPACE_ID, videoAssetId: video.id, connectionIds: [conn.id] });

    const user = userEvent.setup();
    render(
      <TestBackendProvider backend={mockBackend}>
        <AnalyticsPage workspaceId={WORKSPACE_ID} />
      </TestBackendProvider>,
    );

    // Default metric is "views" -- sync populates real per-day totals, not
    // fabricated. The button stays disabled until the metric list finishes
    // loading (avoids a race where syncing fires with no metric selected).
    await waitFor(async () => expect(await screen.findByRole("button", { name: /sync now/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /sync now/i }));
    await waitFor(() => expect(totalValueText()).toBe("128"));
  });

  it("renders an unsupported metric as the literal not-provided text, never a fabricated zero", async () => {
    // Syncs directly through the backend rather than re-driving the "Sync
    // now" button (already covered above) -- this test's job is the
    // not-provided contract once a metric switch happens, not the click.
    const conn = await mockBackend.beginConnectSandbox(WORKSPACE_ID);
    const video = await mockBackend.addVideoFromPath(WORKSPACE_ID, "C:\\videos\\outfit.mp4");
    await mockBackend.submitCampaign({ workspaceId: WORKSPACE_ID, videoAssetId: video.id, connectionIds: [conn.id] });
    await mockBackend.syncAnalytics(conn.id);

    const user = userEvent.setup();
    render(
      <TestBackendProvider backend={mockBackend}>
        <AnalyticsPage workspaceId={WORKSPACE_ID} />
      </TestBackendProvider>,
    );

    await waitFor(() => expect(totalValueText()).toBe("128")); // the pre-synced data loads on mount

    const metricSelect = screen.getByDisplayValue("Views");
    await user.selectOptions(metricSelect, "Audience retention");

    expect(await screen.findByText("Not provided by this platform")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("Templates page", () => {
  it("lets the user create and delete a caption template and a hashtag set", async () => {
    const user = userEvent.setup();
    render(
      <TestBackendProvider backend={mockBackend}>
        <TemplatesPage workspaceId={WORKSPACE_ID} />
      </TestBackendProvider>,
    );

    await user.type(await screen.findByPlaceholderText(/template name/i), "Reels caption");
    await user.click(screen.getByRole("button", { name: /add template/i }));
    expect(await screen.findByText("Reels caption")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/set name/i), "Angelcore");
    await user.type(screen.getByPlaceholderText(/#tag1/i), "#angel #cottagecore");
    await user.click(screen.getByRole("button", { name: /add hashtag set/i }));
    expect(await screen.findByText(/Angelcore — #angel #cottagecore/)).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    await user.click(deleteButtons[0]);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("Reels caption")).not.toBeInTheDocument());
  });
});
