import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";

const REVENUECAT_API_ORIGIN = "https://api.revenuecat.com";
const MAX_SUBSCRIPTION_PAGES = 10;

const revenueCatSubscriptionSchema = z.object({
  id: z.string().min(1),
  gives_access: z.boolean(),
  current_period_ends_at: z.number().nullish(),
  management_url: z.string().url().nullish(),
  store: z.string().min(1)
}).passthrough();

const revenueCatSubscriptionListSchema = z.object({
  items: z.array(revenueCatSubscriptionSchema),
  next_page: z.string().nullable().optional()
}).passthrough();

const revenueCatManagementUrlSchema = z.object({
  management_url: z.string().url()
}).passthrough();

type RevenueCatSubscription = z.infer<typeof revenueCatSubscriptionSchema>;

type RevenueCatCustomerServiceOptions = {
  apiKey?: string | undefined;
  billingEnabled?: boolean | undefined;
  fetchImpl?: typeof fetch | undefined;
  projectId?: string | undefined;
};

function isRevenueCatBillingUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "billing.revenuecat.com";
  } catch {
    return false;
  }
}

export class RevenueCatCustomerService {
  private readonly apiKey: string | undefined;
  private readonly billingEnabled: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly projectId: string | undefined;

  constructor(options: RevenueCatCustomerServiceOptions = {}) {
    this.apiKey = options.apiKey ?? env.REVENUECAT_SECRET_API_KEY;
    this.billingEnabled = options.billingEnabled ?? env.BILLING_ENABLED;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.projectId = options.projectId ?? env.REVENUECAT_PROJECT_ID;
  }

  async getManagementUrl(userId: string): Promise<string> {
    if (!this.billingEnabled) throw new HttpError("Billing is not enabled.", 409);
    if (!this.apiKey || !this.projectId) {
      throw new HttpError("Subscription management is not configured yet.", 503);
    }

    const subscription = await this.getActiveWebBillingSubscription(userId);
    const projectId = encodeURIComponent(this.projectId);
    const subscriptionId = encodeURIComponent(subscription.id);
    const response = await this.request(
      `${REVENUECAT_API_ORIGIN}/v2/projects/${projectId}/subscriptions/${subscriptionId}/authenticated_management_url`,
      "management-url"
    );
    const result = await this.parseResponse(response, revenueCatManagementUrlSchema, "management-url");
    if (!isRevenueCatBillingUrl(result.management_url)) {
      throw new HttpError("RevenueCat returned an invalid subscription management page.", 503);
    }
    return new URL(result.management_url).toString();
  }

  private async getActiveWebBillingSubscription(userId: string): Promise<RevenueCatSubscription> {
    const projectId = encodeURIComponent(this.projectId as string);
    const customerId = encodeURIComponent(userId);
    const expectedPathPrefix = `/v2/projects/${projectId}/customers/${customerId}/subscriptions`;
    let requestUrl = `${REVENUECAT_API_ORIGIN}${expectedPathPrefix}?limit=100`;
    const subscriptions: RevenueCatSubscription[] = [];

    for (let pageNumber = 0; pageNumber < MAX_SUBSCRIPTION_PAGES; pageNumber += 1) {
      const response = await this.request(requestUrl, "subscriptions");
      const page = await this.parseResponse(response, revenueCatSubscriptionListSchema, "subscriptions");
      subscriptions.push(...page.items);
      if (!page.next_page) break;
      if (pageNumber === MAX_SUBSCRIPTION_PAGES - 1) {
        throw new HttpError("RevenueCat returned too many subscription records for this account.", 503);
      }
      const nextUrl = new URL(page.next_page, REVENUECAT_API_ORIGIN);
      if (
        !page.next_page.startsWith("/") ||
        nextUrl.origin !== REVENUECAT_API_ORIGIN ||
        nextUrl.pathname !== expectedPathPrefix
      ) {
        throw new HttpError("RevenueCat returned an invalid subscription page.", 503);
      }
      requestUrl = nextUrl.toString();
    }

    // The list response's management_url may be RevenueCat's email-link flow
    // on api.revenuecat.com. The store field is the authoritative Web Billing
    // discriminator; only the final authenticated URL must use billing.revenuecat.com.
    const activeWebSubscriptions = subscriptions
      .filter((subscription) => subscription.gives_access && subscription.store.trim().toLowerCase() === "rc_billing")
      .sort((left, right) =>
        (right.current_period_ends_at ?? 0) - (left.current_period_ends_at ?? 0) || left.id.localeCompare(right.id)
      );
    const subscription = activeWebSubscriptions[0];
    if (!subscription) {
      throw new HttpError("No active RevenueCat Web Billing subscription is available for this account.", 409);
    }
    return subscription;
  }

  private async request(url: string, operation: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        signal: AbortSignal.timeout(10_000)
      });
    } catch (error) {
      logger.warn("RevenueCat customer portal request failed", {
        operation,
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
      throw new HttpError("RevenueCat subscription management is temporarily unavailable.", 503);
    }

    if (!response.ok) {
      logger.warn("RevenueCat customer portal request rejected", {
        operation,
        status: response.status,
        revenueCatRequestId: response.headers.get("x-request-id") ?? undefined
      });
      if (response.status === 401 || response.status === 403) {
        throw new HttpError("RevenueCat subscription management is not configured correctly.", 503);
      }
      if (response.status === 429) {
        throw new HttpError("RevenueCat subscription management is busy. Please try again shortly.", 503);
      }
      if (response.status === 423) {
        throw new HttpError("RevenueCat is updating this subscription. Please try again shortly.", 409);
      }
      if (response.status === 404 && operation === "subscriptions") {
        throw new HttpError("No RevenueCat billing customer is available for this account.", 409);
      }
      if (response.status === 404 && operation === "management-url") {
        throw new HttpError("Your subscription changed while the portal was opening. Please try again.", 409);
      }
      throw new HttpError("RevenueCat subscription management is temporarily unavailable.", 503);
    }
    return response;
  }

  private async parseResponse<T>(response: Response, schema: z.ZodType<T>, operation: string): Promise<T> {
    try {
      return schema.parse(await response.json());
    } catch {
      logger.warn("RevenueCat customer portal response was invalid", { operation });
      throw new HttpError("RevenueCat subscription management is temporarily unavailable.", 503);
    }
  }
}

export const revenueCatCustomerService = new RevenueCatCustomerService();
