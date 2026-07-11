import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../components/AppErrorBoundary.js";

describe("AppErrorBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a recovery screen and can remount the application", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let shouldThrow = true;
    function UnstableContent() {
      if (shouldThrow) throw new Error("render failed");
      return <p>Application restored</p>;
    }

    render(
      <AppErrorBoundary>
        <UnstableContent />
      </AppErrorBoundary>
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Application restored")).toBeInTheDocument();
  });
});
