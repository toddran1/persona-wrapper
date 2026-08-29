import { describe, expect, it, vi } from "vitest";
import { RevenueCatCustomerService } from "../services/revenueCatCustomerService.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}

function subscription(
  id: string,
  managementUrl: string | null,
  options: { endsAt?: number; givesAccess?: boolean; store?: string } = {}
): Record<string, unknown> {
  return {
    id,
    gives_access: options.givesAccess ?? true,
    current_period_ends_at: options.endsAt ?? 2_000,
    management_url: managementUrl,
    store: options.store ?? "rc_billing"
  };
}

describe("RevenueCat customer management", () => {
  it("uses the v2 read-only flow to return a single-use RevenueCat Billing portal URL", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [subscription("sub_1", "https://api.revenuecat.com/rcbilling/v1/customerportal/tx_1/portal")],
        next_page: null
      }))
      .mockResolvedValueOnce(jsonResponse({
        management_url: "https://billing.revenuecat.com/app_1/sub_1?token=single-use"
      }));
    const service = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      projectId: "proj_1"
    });

    await expect(service.getManagementUrl("user/with spaces")).resolves.toBe(
      "https://billing.revenuecat.com/app_1/sub_1?token=single-use"
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.revenuecat.com/v2/projects/proj_1/customers/user%2Fwith%20spaces/subscriptions?limit=100",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_v2_read_only" })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.revenuecat.com/v2/projects/proj_1/subscriptions/sub_1/authenticated_management_url",
      expect.any(Object)
    );
  });

  it("selects the longest-running active Web Billing subscription across bounded pages", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [
          subscription("expired", "https://billing.revenuecat.com/app_1/expired", { givesAccess: false }),
          subscription("mobile", "https://apps.apple.com/account/subscriptions", { endsAt: 9_000, store: "app_store" }),
          subscription("sub_older", "https://billing.revenuecat.com/app_1/sub_older", { endsAt: 3_000 })
        ],
        next_page: "/v2/projects/proj_1/customers/user_1/subscriptions?starting_after=sub_older&limit=100"
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [subscription("sub_newer", "https://billing.revenuecat.com/app_1/sub_newer", { endsAt: 4_000 })],
        next_page: null
      }))
      .mockResolvedValueOnce(jsonResponse({
        management_url: "https://billing.revenuecat.com/app_1/sub_newer?token=single-use"
      }));
    const service = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      projectId: "proj_1"
    });

    await expect(service.getManagementUrl("user_1")).resolves.toContain("/sub_newer?");
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://api.revenuecat.com/v2/projects/proj_1/subscriptions/sub_newer/authenticated_management_url",
      expect.any(Object)
    );
  });

  it("accepts RevenueCat's Web Billing store discriminator case-insensitively", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [subscription("sub_1", null, { store: "RC_BILLING" })],
        next_page: null
      }))
      .mockResolvedValueOnce(jsonResponse({
        management_url: "https://billing.revenuecat.com/app_1/sub_1?token=single-use"
      }));
    const service = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      projectId: "proj_1"
    });

    await expect(service.getManagementUrl("user_1")).resolves.toContain("/sub_1?");
  });

  it("rejects missing Web Billing subscriptions and invalid management destinations", async () => {
    const missingPortal = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
        items: [subscription("mobile", "https://apps.apple.com/account/subscriptions", { store: "app_store" })],
        next_page: null
      })) as unknown as typeof fetch,
      projectId: "proj_1"
    });
    await expect(missingPortal.getManagementUrl("user_1")).rejects.toMatchObject({ statusCode: 409 });

    const invalidDestinationFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [subscription("sub_1", "https://billing.revenuecat.com/app_1/sub_1")],
        next_page: null
      }))
      .mockResolvedValueOnce(jsonResponse({
        management_url: "https://attacker.example/steal-session"
      }));
    const invalidDestination = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      fetchImpl: invalidDestinationFetch as unknown as typeof fetch,
      projectId: "proj_1"
    });
    await expect(invalidDestination.getManagementUrl("user_1")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("rejects provider-controlled pagination that leaves the expected customer path", async () => {
    const service = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
        items: [],
        next_page: "https://attacker.example/subscriptions?page=2"
      })) as unknown as typeof fetch,
      projectId: "proj_1"
    });
    await expect(service.getManagementUrl("user_1")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("reports a subscription race as retryable account state instead of an outage", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [subscription("sub_1", "https://billing.revenuecat.com/app_1/sub_1")],
        next_page: null
      }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const service = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      projectId: "proj_1"
    });

    await expect(service.getManagementUrl("user_1")).rejects.toMatchObject({
      message: "Your subscription changed while the portal was opening. Please try again.",
      statusCode: 409
    });
  });

  it("fails closed when either v2 server credential is absent", async () => {
    const missingKey = new RevenueCatCustomerService({
      apiKey: "",
      billingEnabled: true,
      projectId: "proj_1"
    });
    await expect(missingKey.getManagementUrl("user_1")).rejects.toMatchObject({ statusCode: 503 });

    const missingProject = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      projectId: ""
    });
    await expect(missingProject.getManagementUrl("user_1")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("distinguishes invalid credentials and rate limits without exposing provider details", async () => {
    const invalidCredential = new RevenueCatCustomerService({
      apiKey: "invalid-key",
      billingEnabled: true,
      fetchImpl: vi.fn().mockResolvedValue(new Response("sensitive provider response", {
        status: 401
      })) as unknown as typeof fetch,
      projectId: "proj_1"
    });
    await expect(invalidCredential.getManagementUrl("user_1")).rejects.toMatchObject({
      message: "RevenueCat subscription management is not configured correctly.",
      statusCode: 503
    });

    const rateLimited = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 429 })) as unknown as typeof fetch,
      projectId: "proj_1"
    });
    await expect(rateLimited.getManagementUrl("user_1")).rejects.toMatchObject({
      message: "RevenueCat subscription management is busy. Please try again shortly.",
      statusCode: 503
    });

    const locked = new RevenueCatCustomerService({
      apiKey: "sk_v2_read_only",
      billingEnabled: true,
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 423 })) as unknown as typeof fetch,
      projectId: "proj_1"
    });
    await expect(locked.getManagementUrl("user_1")).rejects.toMatchObject({
      message: "RevenueCat is updating this subscription. Please try again shortly.",
      statusCode: 409
    });
  });
});
