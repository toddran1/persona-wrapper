import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicLegalPage, PUBLIC_PAGE_PATHS } from "../components/PublicLegalPage.js";

describe("PublicLegalPage", () => {
  it.each([
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms of Use"],
    ["/delete-account", "Delete Account Policy"],
    ["/support", "Support"]
  ])("renders %s as a public page", (path, heading) => {
    render(<PublicLegalPage path={path} />);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal and support" })).toBeInTheDocument();
  });

  it("provides an external account-deletion request flow", () => {
    render(<PublicLegalPage path="/delete-account" />);
    expect(screen.getByRole("heading", { name: "Request account deletion" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email or username")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify account" })).toBeDisabled();
  });

  it("registers every required public route", () => {
    expect([...PUBLIC_PAGE_PATHS]).toEqual(["/privacy", "/terms", "/delete-account", "/support"]);
  });

  it("states that users must be at least 16 years old", () => {
    render(<PublicLegalPage path="/terms" />);
    expect(screen.getByText("You must be 16 years of age or older to create an account or use the Service.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("If you are 16 or 17, you may use the Service only with permission from a parent or legal guardian.", { exact: false })).toBeInTheDocument();
  });
});
