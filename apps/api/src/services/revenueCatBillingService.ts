import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, lte, or } from "drizzle-orm";
import { z } from "zod";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { billingSubscriptions, billingWebhookEvents, userPlanAssignments, users } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { normalizeStoreProductId, planIdForStoreProduct } from "./billingCatalogService.js";
import { getPlanDefinition } from "./planCatalog.js";

const eventSchema = z.object({
  id: z.string().min(1), type: z.string().min(1), app_user_id: z.string().min(1),
  original_app_user_id: z.string().optional(), aliases: z.array(z.string()).optional(),
  product_id: z.string().optional(), new_product_id: z.string().optional(),
  environment: z.enum(["SANDBOX", "PRODUCTION"]).optional(), store: z.string().optional(),
  app_id: z.string().optional(), expiration_at_ms: z.number().nullable().optional(),
  event_timestamp_ms: z.number().optional(), original_transaction_id: z.string().optional(),
  transaction_id: z.string().optional()
}).passthrough();
const webhookSchema = z.object({ api_version: z.string().optional(), event: eventSchema }).passthrough();
type Event = z.infer<typeof eventSchema>;

const activeTypes = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "REFUND_REVERSED"]);
const retainedTypes = new Set(["CANCELLATION", "SUBSCRIPTION_PAUSED", "BILLING_ISSUE"]);
const WEBHOOK_PROCESSING_STALE_MS = 5 * 60 * 1000;

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function safeDate(value: number | null | undefined): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function authorized(value: string | undefined): boolean {
  if (!value || !env.REVENUECAT_WEBHOOK_AUTHORIZATION) return false;
  const left = Buffer.from(value);
  const right = Buffer.from(env.REVENUECAT_WEBHOOK_AUTHORIZATION);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function findUserId(event: Event): Promise<string | undefined> {
  const db = getDatabase();
  if (!db) throw new HttpError("Billing requires database-backed storage.", 503);
  const candidates = [...new Set([event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]
    .filter((value): value is string => Boolean(value && !value.startsWith("$RCAnonymousID:"))))];
  for (const candidate of candidates) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, candidate)).limit(1);
    if (user) return user.id;
  }
  return undefined;
}

export type RevenueCatWebhookResult = { status: "processed" | "duplicate" | "ignored"; eventId: string };

export class RevenueCatBillingService {
  authorize(header: string | undefined): void {
    if (!env.BILLING_ENABLED) throw new HttpError("Billing is not enabled.", 404);
    if (!authorized(header)) throw new HttpError("Invalid billing webhook authorization.", 401);
  }

  async process(input: unknown): Promise<RevenueCatWebhookResult> {
    const payload = webhookSchema.parse(input);
    const event = payload.event;
    const db = getDatabase();
    if (!db) throw new HttpError("Billing requires database-backed storage.", 503);
    const environment = event.environment ?? "PRODUCTION";

    if (!env.REVENUECAT_ALLOWED_ENVIRONMENTS.includes(environment)) {
      return this.ignore(event, payload as Record<string, unknown>, `Environment ${environment} is not allowed.`);
    }
    if (env.REVENUECAT_ALLOWED_APP_IDS.length > 0 && (!event.app_id || !env.REVENUECAT_ALLOWED_APP_IDS.includes(event.app_id))) {
      return this.ignore(event, payload as Record<string, unknown>, "RevenueCat app id is not allowed.");
    }

    const [created] = await db.insert(billingWebhookEvents).values({
      id: event.id, provider: "revenuecat", eventType: event.type,
      appUserId: event.app_user_id, environment, payload: payload as Record<string, unknown>
    }).onConflictDoNothing().returning({ id: billingWebhookEvents.id });
    if (!created) {
      const [prior] = await db.select({
        status: billingWebhookEvents.status,
        updatedAt: billingWebhookEvents.updatedAt
      }).from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.id, event.id)).limit(1);
      const processingIsFresh = prior?.status === "received"
        && Date.now() - prior.updatedAt.getTime() < WEBHOOK_PROCESSING_STALE_MS;
      if (processingIsFresh) {
        // A matching delivery is still being handled. Returning a retryable
        // response prevents a concurrent duplicate from being acknowledged
        // before the first attempt has durably completed.
        throw new HttpError("Billing webhook event is already being processed.", 503);
      }
      if (prior?.status !== "failed" && prior?.status !== "received") {
        return { status: "duplicate", eventId: event.id };
      }
      // Claim failed attempts and abandoned in-progress rows atomically. Two
      // RevenueCat retries can arrive together, and both must not advance the
      // same event concurrently even though downstream writes are upserts.
      const staleBefore = new Date(Date.now() - WEBHOOK_PROCESSING_STALE_MS);
      const [claimed] = await db.update(billingWebhookEvents)
        .set({ status: "received", error: null, updatedAt: new Date() })
        .where(and(
          eq(billingWebhookEvents.id, event.id),
          or(
            eq(billingWebhookEvents.status, "failed"),
            and(
              eq(billingWebhookEvents.status, "received"),
              lte(billingWebhookEvents.updatedAt, staleBefore)
            )
          )
        ))
        .returning({ id: billingWebhookEvents.id });
      if (!claimed) {
        throw new HttpError("Billing webhook event is already being processed.", 503);
      }
    }

    try {
      const result = await this.apply(event, payload as Record<string, unknown>, environment);
      await db.update(billingWebhookEvents).set({ status: result.status, processedAt: new Date(), updatedAt: new Date() })
        .where(eq(billingWebhookEvents.id, event.id));
      return result;
    } catch (error) {
      await db.update(billingWebhookEvents).set({
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 1000) : "Unknown billing error",
        updatedAt: new Date()
      }).where(eq(billingWebhookEvents.id, event.id));
      throw error;
    }
  }

  private async ignore(event: Event, payload: Record<string, unknown>, reason: string): Promise<RevenueCatWebhookResult> {
    const db = getDatabase();
    if (!db) throw new HttpError("Billing requires database-backed storage.", 503);
    await db.insert(billingWebhookEvents).values({
      id: event.id, provider: "revenuecat", eventType: event.type,
      appUserId: event.app_user_id, environment: event.environment,
      status: "ignored", error: reason, payload, processedAt: new Date()
    }).onConflictDoNothing();
    return { status: "ignored", eventId: event.id };
  }

  private async apply(event: Event, payload: Record<string, unknown>, environment: "SANDBOX" | "PRODUCTION"): Promise<RevenueCatWebhookResult> {
    if (["TEST", "PRODUCT_CHANGE", "TRANSFER", "TEMPORARY_ENTITLEMENT_GRANT"].includes(event.type)) {
      // Temporary grants do not identify a store product, so they cannot be
      // mapped safely to Silver or Gold without querying RevenueCat's current
      // subscriber state. Support can grant a time-bound override instead.
      return { status: "ignored", eventId: event.id };
    }
    const productId = event.product_id ?? event.new_product_id;
    const planId = planIdForStoreProduct(productId);
    const recognized = activeTypes.has(event.type) || retainedTypes.has(event.type) || event.type === "EXPIRATION";
    if (!recognized || !productId || !planId) return { status: "ignored", eventId: event.id };
    const userId = await findUserId(event);
    if (!userId) throw new HttpError("RevenueCat app user does not match an application user.", 422);

    const normalizedProductId = normalizeStoreProductId(productId);
    const externalId = event.original_transaction_id ?? event.transaction_id ?? `${userId}:${normalizedProductId}`;
    const assignmentId = stableId("plan_assignment_revenuecat", externalId);
    const subscriptionId = stableId("billing_subscription", externalId);
    const eventAt = safeDate(event.event_timestamp_ms) ?? new Date();
    const expiresAt = safeDate(event.expiration_at_ms);
    const expired = event.type === "EXPIRATION";
    if (!expired && !expiresAt) {
      throw new HttpError("RevenueCat subscription events must include an expiration date.", 422);
    }
    const plan = getPlanDefinition(planId);
    const db = getDatabase();
    if (!db) throw new HttpError("Billing requires database-backed storage.", 503);
    const [existing] = await db.select({ lastEventAt: billingSubscriptions.lastEventAt }).from(billingSubscriptions)
      .where(and(eq(billingSubscriptions.provider, "revenuecat"), eq(billingSubscriptions.externalSubscriptionId, externalId))).limit(1);
    if (existing && existing.lastEventAt > eventAt) return { status: "ignored", eventId: event.id };

    await db.transaction(async (tx) => {
      await tx.insert(userPlanAssignments).values({
        id: assignmentId, userId, planId, planVersion: plan.version,
        status: expired ? "expired" : "active", source: "subscription",
        effectiveAt: eventAt, expiresAt,
        metadata: { provider: "revenuecat", productId: normalizedProductId, lastEventId: event.id }
      }).onConflictDoUpdate({ target: userPlanAssignments.id, set: {
        planId, planVersion: plan.version, status: expired ? "expired" : "active", expiresAt,
        metadata: { provider: "revenuecat", productId: normalizedProductId, lastEventId: event.id }, updatedAt: new Date()
      }});
      await tx.insert(billingSubscriptions).values({
        id: subscriptionId, userId, provider: "revenuecat", externalSubscriptionId: externalId,
        planAssignmentId: assignmentId, productId: normalizedProductId, planId,
        status: expired ? "expired" : event.type.toLowerCase(), store: event.store, environment,
        currentPeriodEndsAt: expiresAt, lastEventId: event.id, lastEventAt: eventAt, metadata: payload
      }).onConflictDoUpdate({ target: [billingSubscriptions.provider, billingSubscriptions.externalSubscriptionId], set: {
        userId, planAssignmentId: assignmentId, productId: normalizedProductId, planId,
        status: expired ? "expired" : event.type.toLowerCase(), store: event.store, environment,
        currentPeriodEndsAt: expiresAt, lastEventId: event.id, lastEventAt: eventAt,
        metadata: payload, updatedAt: new Date()
      }});
    });
    return { status: "processed", eventId: event.id };
  }
}

export const revenueCatBillingService = new RevenueCatBillingService();
