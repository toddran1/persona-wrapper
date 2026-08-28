import { describe, expect, it, vi } from "vitest";
import { RevenueCatCustomerService } from "../services/revenueCatCustomerService.js";

function customerResponse(managementUrl: string | null): Response {
  return new Response(JSON.stringify({
    subscriber: { management_url: managementUrl }
  }), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}

describe("RevenueCat customer management", () => {
  it("returns only an authenticated RevenueCat Billing portal URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(customerResponse(
      "https://billing.revenuecat.com/app_1/sub_1?token=single-use"
    ));
    const service = new RevenueCatCustomerService({
      apiKey: "secret-key",
      billingEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(service.getManagementUrl("user/with spaces")).resolves.toBe(
      "https://billing.revenuecat.com/app_1/sub_1?token=single-use"
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.revenuecat.com/v1/subscribers/user%2Fwith%20spaces",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-key" })
      })
    );
  });

  it("rejects missing portals and non-RevenueCat management destinations", async () => {
    const missingPortal = new RevenueCatCustomerService({
      apiKey: "secret-key",
      billingEnabled: true,
      fetchImpl: vi.fn().mockResolvedValue(customerResponse(null)) as unknown as typeof fetch
    });
    await expect(missingPortal.getManagementUrl("user_1")).rejects.toMatchObject({ statusCode: 409 });

    const externalStore = new RevenueCatCustomerService({
      apiKey: "secret-key",
      billingEnabled: true,
      fetchImpl: vi.fn().mockResolvedValue(customerResponse(
        "https://apps.apple.com/account/subscriptions"
      )) as unknown as typeof fetch
    });
    await expect(externalStore.getManagementUrl("user_1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("fails closed when the server credential is absent", async () => {
    const service = new RevenueCatCustomerService({ apiKey: "", billingEnabled: true });
    await expect(service.getManagementUrl("user_1")).rejects.toMatchObject({ statusCode: 503 });
  });
});
