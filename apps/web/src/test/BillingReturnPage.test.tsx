import type { BillingCatalogResponse, MeResponse, PlanId, PlanUsageSummary } from "@persona/shared";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingReturnPage } from "../components/BillingReturnPage.js";
import { api } from "../lib/api.js";
import { savePendingBillingCheckout } from "../lib/pendingBillingCheckout.js";

vi.mock("../lib/api.js", () => ({
  api: {
    getCurrentUser: vi.fn(),
    getPlanUsage: vi.fn(),
    getBillingCatalog: vi.fn()
  }
}));

const now = "2026-08-27T12:00:00.000Z";

function meResponse(userId = "user-1"): MeResponse {
  return {
    user: {
      id: userId,
      status: "active",
      createdAt: now,
      updatedAt: now
    }
  };
}

function usageResponse(planId: PlanId): PlanUsageSummary {
  return {
    plan: {
      id: planId,
      version: 1,
      displayName: planId,
      description: `${planId} plan`,
      monthlyPriceCents: planId === "bronze" ? null : 799,
      adsEnabled: planId === "bronze",
      priorityQueue: planId === "gold",
      maxConcurrentMediaJobs: 1,
      personaIds: ["larae"]
    },
    totalUsage: {
      limitMicroUsd: 1_000_000,
      baseLimitMicroUsd: 1_000_000,
      rolloverMicroUsd: 0,
      usedMicroUsd: 0,
      reservedMicroUsd: 0,
      remainingMicroUsd: 1_000_000,
      percentRemaining: 100,
      periodStart: now,
      periodEnd: "2026-09-27T12:00:00.000Z"
    },
    meters: [],
    enforcementEnabled: true
  };
}

function catalogResponse(planId: PlanId): BillingCatalogResponse {
  return {
    enabled: true,
    provider: "revenuecat",
    offeringId: "default",
    products: [],
    currentPlanId: planId,
    subscription: null
  };
}

describe("BillingReturnPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.mocked(api.getCurrentUser).mockReset();
    vi.mocked(api.getPlanUsage).mockReset();
    vi.mocked(api.getBillingCatalog).mockReset();
  });

  it("confirms the purchased plan only after the API reports the entitlement", async () => {
    savePendingBillingCheckout({
      accountId: "user-1",
      currentPlanId: "bronze",
      planId: "silver",
      startedAt: Date.now()
    });
    vi.mocked(api.getCurrentUser).mockResolvedValue(meResponse());
    vi.mocked(api.getPlanUsage).mockResolvedValue(usageResponse("silver"));
    vi.mocked(api.getBillingCatalog).mockResolvedValue(catalogResponse("silver"));

    render(<MemoryRouter><BillingReturnPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Welcome to Silver" })).toBeInTheDocument();
    expect(screen.getByText("Silver is active. Your new limits and persona access are ready.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to For the Baddiez" })).toHaveAttribute("href", "/");
  });

  it("keeps the purchase in a processing state while the old plan remains active", async () => {
    savePendingBillingCheckout({
      accountId: "user-1",
      currentPlanId: "bronze",
      planId: "gold",
      startedAt: Date.now()
    });
    vi.mocked(api.getCurrentUser).mockResolvedValue(meResponse());
    vi.mocked(api.getPlanUsage).mockResolvedValue(usageResponse("bronze"));
    vi.mocked(api.getBillingCatalog).mockResolvedValue(catalogResponse("bronze"));

    render(<MemoryRouter><BillingReturnPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Almost there" })).toBeInTheDocument();
    expect(screen.getByText(/still confirming your Gold membership/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("stops presenting an old checkout as an actively processing confirmation", async () => {
    savePendingBillingCheckout({
      accountId: "user-1",
      currentPlanId: "bronze",
      planId: "silver",
      startedAt: Date.now() - 120_000
    });
    vi.mocked(api.getCurrentUser).mockResolvedValue(meResponse());
    vi.mocked(api.getPlanUsage).mockResolvedValue(usageResponse("bronze"));
    vi.mocked(api.getBillingCatalog).mockResolvedValue(catalogResponse("bronze"));

    render(<MemoryRouter><BillingReturnPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Checkout received" })).toBeInTheDocument();
    expect(screen.getByText(/have not received the store entitlement yet/i)).toBeInTheDocument();
    expect(screen.getByText("Store confirmation delayed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("asks the customer to sign in when the return tab has no authenticated session", async () => {
    vi.mocked(api.getCurrentUser).mockRejectedValue(new Error("Authentication required."));

    render(<MemoryRouter><BillingReturnPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Finish with the right account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/");
    await waitFor(() => expect(api.getPlanUsage).not.toHaveBeenCalled());
  });
});
