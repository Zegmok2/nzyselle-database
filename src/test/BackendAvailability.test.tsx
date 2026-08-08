import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../App";

describe("Backend availability", () => {
  it("shows an explicit configuration error instead of silently using fake data when Tauri isn't present", async () => {
    // jsdom (the test environment) never injects window.__TAURI_INTERNALS__,
    // which is exactly the "not running as the real desktop app" case this
    // must handle honestly rather than quietly falling back to mockBackend.
    render(<App />);
    expect(
      await screen.findByText(/isn.t running as a desktop app/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/create your first account group/i)).not.toBeInTheDocument();
  });
});
