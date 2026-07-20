import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordPage } from "../components/ResetPasswordPage.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: { resetPassword: vi.fn() }
}));

describe("ResetPasswordPage", () => {
  beforeEach(() => vi.mocked(api.resetPassword).mockReset());

  it("rejects missing or expired reset tokens", () => {
    render(<MemoryRouter initialEntries={["/reset-password?error=INVALID_TOKEN"]}><ResetPasswordPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("invalid or has expired");
    expect(screen.getByRole("link", { name: "Return to sign in" })).toBeInTheDocument();
  });

  it("submits a matching replacement password", async () => {
    vi.mocked(api.resetPassword).mockResolvedValue();
    render(<MemoryRouter initialEntries={["/reset-password?token=reset-token"]}><ResetPasswordPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-new-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a-new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(api.resetPassword).toHaveBeenCalledWith("reset-token", "a-new-password"));
    expect(await screen.findByText("Password updated")).toBeInTheDocument();
  });
});
