import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PolicyConsentGate } from "../components/PolicyConsentGate.js";

describe("PolicyConsentGate", () => {
  it("uses a checkbox-semantic button instead of a native input", async () => {
    const user = userEvent.setup();
    render(
      <PolicyConsentGate
        policies={{
          termsVersion: "2026-07-29",
          privacyVersion: "2026-07-29",
          termsPath: "/terms",
          privacyPath: "/privacy"
        }}
        loading={false}
        onAccept={vi.fn().mockResolvedValue(undefined)}
        onRetry={vi.fn()}
        onLogout={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const checkbox = screen.getByRole("checkbox", { name: "I accept the Terms of Use and Privacy Policy." });
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(document.querySelector(".policy-consent-check input")).toBeNull();

    await user.click(checkbox);

    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Accept and continue" })).toBeEnabled();
  });
});
