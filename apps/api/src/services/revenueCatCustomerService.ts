import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";

const revenueCatCustomerSchema = z.object({
  subscriber: z.object({
    management_url: z.string().url().nullable()
  }).passthrough()
}).passthrough();

type RevenueCatCustomerServiceOptions = {
  apiKey?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
};

export class RevenueCatCustomerService {
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RevenueCatCustomerServiceOptions = {}) {
    this.apiKey = options.apiKey ?? env.REVENUECAT_SECRET_API_KEY;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getManagementUrl(userId: string): Promise<string> {
    if (!env.BILLING_ENABLED) throw new HttpError("Billing is not enabled.", 409);
    if (!this.apiKey) {
      throw new HttpError("Subscription management is not configured yet.", 503);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          signal: AbortSignal.timeout(10_000)
        }
      );
    } catch (error) {
      logger.warn("RevenueCat customer portal request failed", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
      throw new HttpError("RevenueCat subscription management is temporarily unavailable.", 503);
    }

    if (!response.ok) {
      logger.warn("RevenueCat customer portal request rejected", { status: response.status });
      throw new HttpError("RevenueCat subscription management is temporarily unavailable.", 503);
    }

    let customer: z.infer<typeof revenueCatCustomerSchema>;
    try {
      customer = revenueCatCustomerSchema.parse(await response.json());
    } catch {
      logger.warn("RevenueCat customer portal response was invalid");
      throw new HttpError("RevenueCat subscription management is temporarily unavailable.", 503);
    }

    if (!customer.subscriber.management_url) {
      throw new HttpError("No active subscription management page is available for this account.", 409);
    }
    const managementUrl = new URL(customer.subscriber.management_url);
    if (managementUrl.protocol !== "https:" || managementUrl.hostname !== "billing.revenuecat.com") {
      throw new HttpError(
        "This subscription must be managed through the store where it was purchased.",
        409
      );
    }
    return managementUrl.toString();
  }
}

export const revenueCatCustomerService = new RevenueCatCustomerService();
