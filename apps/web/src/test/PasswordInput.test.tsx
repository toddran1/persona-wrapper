import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { passwordStrengthScore } from "@persona/shared";
import { PasswordInput } from "../components/PasswordInput.js";

describe("passwordStrengthScore", () => {
  it("scores by length and character variety", () => {
    expect(passwordStrengthScore("")).toBe(0);
    expect(passwordStrengthScore("short")).toBe(1);
    expect(passwordStrengthScore("longenough1")).toBe(2);
    expect(passwordStrengthScore("Mix3d-length")).toBe(3);
    expect(passwordStrengthScore("V3ry!long passphrase")).toBe(4);
  });
});

describe("PasswordInput", () => {
  it("toggles visibility and shows a strength hint", async () => {
    const user = userEvent.setup();
    render(
      <PasswordInput
        ariaLabel="New password"
        value="V3ry!long passphrase"
        onChange={vi.fn()}
        showStrength
      />
    );

    const input = screen.getByLabelText("New password");
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByRole("status", { name: "Password strength: Strong" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show new password" }));
    expect(input).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide new password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("hides the meter until a password is entered", () => {
    render(<PasswordInput ariaLabel="Password" value="" onChange={vi.fn()} showStrength />);

    expect(screen.queryByRole("status", { name: /Password strength/ })).not.toBeInTheDocument();
  });
});
