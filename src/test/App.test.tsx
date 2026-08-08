import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AppShell } from "../App";
import { mockBackend, resetMockBackendForTests } from "../lib/mockBackend";
import { TestBackendProvider } from "../lib/backendContext";

beforeEach(() => {
  resetMockBackendForTests();
});

function renderApp() {
  return render(
    <TestBackendProvider backend={mockBackend}>
      <AppShell />
    </TestBackendProvider>,
  );
}

// Splash uses real timers; keep it short and deterministic for tests by
// letting reduced-motion / mode logic take its course but bounding waits.
async function skipSplash() {
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument(), {
    timeout: 3000,
  });
}

describe("first launch", () => {
  it("opens with zero workspaces and shows the empty-state, not fake data", async () => {
    renderApp();
    await skipSplash();
    expect(
      await screen.findByText(/Create your first account group/i),
    ).toBeInTheDocument();
    // Explicitly must NOT show any account group card, mock stats, or a
    // preselected group on a truly fresh launch.
    expect(screen.queryByText(/accounts connected/i)).not.toBeInTheDocument();
  });

  it("lets the user create an account group named 'Nzyselle' and reach its workspace", async () => {
    const user = userEvent.setup();
    renderApp();
    await skipSplash();

    await user.click(await screen.findByRole("button", { name: /create account group/i }));
    const nameInput = await screen.findByLabelText(/account-group name/i);
    await user.type(nameInput, "Nzyselle");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    // Creating should drop us back on the account-groups page with the new
    // group visible as a card.
    expect(await screen.findByRole("heading", { name: "Account groups" })).toBeInTheDocument();
    const openButton = await screen.findByRole("button", { name: /Nzyselle/i });
    expect(openButton).toBeInTheDocument();

    // Opening it shows its own workspace navigation.
    await user.click(openButton);
    expect(await screen.findByRole("button", { name: /connections/i })).toBeInTheDocument();
    expect(screen.getByText(/All account groups/i)).toBeInTheDocument();
  });

  it("supports creating additional groups with no artificial limit", async () => {
    const user = userEvent.setup();
    renderApp();
    await skipSplash();

    for (const name of ["Nzyselle", "Outfit Shop", "Gaming", "Personal"]) {
      const createBtn = await screen.findByRole("button", { name: /create account group/i });
      await user.click(createBtn);
      const nameInput = await screen.findByLabelText(/account-group name/i);
      await user.type(nameInput, name);
      await user.click(screen.getByRole("button", { name: /^create$/i }));
      // Wait for this submission to fully resolve (modal closes) before the
      // next iteration reuses the same "Create account group" trigger —
      // otherwise a fast loop can type into a still-submitting modal.
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }

    for (const name of ["Nzyselle", "Outfit Shop", "Gaming", "Personal"]) {
      expect(await screen.findByRole("button", { name: new RegExp(name, "i") })).toBeInTheDocument();
    }
  });

  it("never traps the user inside a workspace — Back returns to account groups", async () => {
    const user = userEvent.setup();
    renderApp();
    await skipSplash();

    await user.click(await screen.findByRole("button", { name: /create account group/i }));
    await user.type(await screen.findByLabelText(/account-group name/i), "Nzyselle");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await user.click(await screen.findByRole("button", { name: /Nzyselle/i }));

    await user.click(screen.getByRole("button", { name: /All account groups/i }));
    expect(await screen.findByRole("heading", { name: "Account groups" })).toBeInTheDocument();
  });
});
