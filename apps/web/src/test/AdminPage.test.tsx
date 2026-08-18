import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "../components/AdminPage.js";

const { getCurrentUser, adminLookupPlanOverrides, adminGrantPlanOverride, adminRevokePlanOverride } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  adminLookupPlanOverrides: vi.fn(),
  adminGrantPlanOverride: vi.fn(),
  adminRevokePlanOverride: vi.fn()
}));

vi.mock("../lib/api.js", () => ({
  api: { getCurrentUser, adminLookupPlanOverrides, adminGrantPlanOverride, adminRevokePlanOverride }
}));

const lookupResult = {
  user: { id: "user_1", email: "tester@example.com", username: "tester" },
  effectivePlanId: "gold",
  effectivePlanDisplayName: "Gold",
  isAdmin: false,
  assignments: [{
    id: "plan_assignment_1",
    planId: "gold",
    planVersion: 1,
    source: "tester",
    status: "active",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    reason: "QA access"
  }]
};

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ user: { id: "admin_1", email: "admin@example.com" } });
  });

  it("asks non-signed-in visitors to sign in", async () => {
    getCurrentUser.mockResolvedValue({ user: undefined });
    render(<AdminPage />);
    expect(await screen.findByText(/Sign in with an admin account/)).toBeInTheDocument();
  });

  it("looks up a user and shows their effective plan and assignments", async () => {
    adminLookupPlanOverrides.mockResolvedValue(lookupResult);
    render(<AdminPage />);

    const input = await screen.findByTestId("admin-user-lookup");
    await userEvent.type(input, "tester@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByText("tester@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("Gold").filter((element) => element.tagName === "STRONG")).toHaveLength(1);
    expect(screen.getByText(/QA access/)).toBeInTheDocument();
    expect(adminLookupPlanOverrides).toHaveBeenCalledWith("tester@example.com");
  });

  it("grants an override with the selected plan, source, and reason", async () => {
    adminLookupPlanOverrides.mockResolvedValue(lookupResult);
    adminGrantPlanOverride.mockResolvedValue(lookupResult);
    render(<AdminPage />);

    const input = await screen.findByTestId("admin-user-lookup");
    await userEvent.type(input, "tester@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    await screen.findByText("tester@example.com");

    await userEvent.selectOptions(screen.getByTestId("admin-grant-plan"), "silver");
    await userEvent.selectOptions(screen.getByTestId("admin-grant-source"), "promotion");
    await userEvent.type(screen.getByTestId("admin-grant-reason"), "Launch promo");
    await userEvent.click(screen.getByRole("button", { name: "Grant override" }));

    await waitFor(() => expect(adminGrantPlanOverride).toHaveBeenCalledWith({
      user: "tester@example.com",
      planId: "silver",
      source: "promotion",
      reason: "Launch promo"
    }));
  });

  it("revokes an active override after a reason is given", async () => {
    adminLookupPlanOverrides.mockResolvedValue(lookupResult);
    adminRevokePlanOverride.mockResolvedValue(lookupResult);
    render(<AdminPage />);

    const input = await screen.findByTestId("admin-user-lookup");
    await userEvent.type(input, "tester@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    await screen.findByText("tester@example.com");

    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await userEvent.type(screen.getByTestId("admin-revoke-reason"), "Promo ended");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(adminRevokePlanOverride).toHaveBeenCalledWith({
      user: "tester@example.com",
      assignmentId: "plan_assignment_1",
      reason: "Promo ended"
    }));
  });

  it("surfaces the server error (e.g. 403 for non-admins) inline", async () => {
    adminLookupPlanOverrides.mockRejectedValue(new Error("Admin access required."));
    render(<AdminPage />);

    const input = await screen.findByTestId("admin-user-lookup");
    await userEvent.type(input, "tester@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Admin access required.");
  });
});
