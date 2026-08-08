import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VerifyEmailGate } from "../components/VerifyEmailGate.js";

function renderGate(overrides: {
  onResend?: () => Promise<void>;
  onCheckStatus?: () => Promise<boolean>;
  onLogout?: () => Promise<void>;
} = {}) {
  const props = {
    onResend: vi.fn().mockResolvedValue(undefined),
    onCheckStatus: vi.fn().mockResolvedValue(true),
    onLogout: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
  render(<VerifyEmailGate email="baddie@example.com" {...props} />);
  return props;
}

describe("VerifyEmailGate", () => {
  it("shows the account email and resends the verification email", async () => {
    const user = userEvent.setup();
    const props = renderGate();

    expect(screen.getByText(/baddie@example.com/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resend verification email" }));

    await waitFor(() => expect(props.onResend).toHaveBeenCalledOnce());
    expect(await screen.findByRole("status")).toHaveTextContent("Verification email sent");
  });

  it("continues once the account is verified", async () => {
    const user = userEvent.setup();
    const props = renderGate();

    await user.click(screen.getByRole("button", { name: "I've verified — continue" }));

    await waitFor(() => expect(props.onCheckStatus).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tells the user when the account is still unverified", async () => {
    const user = userEvent.setup();
    renderGate({ onCheckStatus: vi.fn().mockResolvedValue(false) });

    await user.click(screen.getByRole("button", { name: "I've verified — continue" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Not verified yet");
  });

  it("offers a way back to sign-in", async () => {
    const user = userEvent.setup();
    const props = renderGate();

    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(props.onLogout).toHaveBeenCalledOnce());
  });
});
