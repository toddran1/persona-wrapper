import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, lte, or } from "drizzle-orm";
import { z } from "zod";
import { env } from "../config/env.js";
import { getDatabase } from "../db/client.js";
import { billingSubscriptions, billingWebhookEvents, userPlanAssignments, users } from "../db/schema.js";
import { HttpError } from "../utils/httpError.js";
import { logger } from "../utils/logger.js";
import { normalizeStoreProductId, planIdForRevenueCatPurchase } from "./billingCatalogService.js";
import { getPlanDefinition } from "./planCatalog.js";

const eventSchema = z.object({
  id: z.string().min(1), type: z.string().min(1), app_user_id: z.string().min(1).nullish(),
  original_app_user_id: z.string().nullish(), aliases: z.array(z.string()).nullish(),
  product_id: z.string().nullish(), new_product_id: z.string().nullish(),
  entitlement_ids: z.array(z.string().min(1)).nullish(),
  environment: z.enum(["SANDBOX", "PRODUCTION"]).nullish(), store: z.string().nullish(),
  app_id: z.string().nullish(), expiration_at_ms: z.number().nullable().optional(),
  grace_period_expiration_at_ms: z.number().nullable().optional(),
  event_timestamp_ms: z.number().nullish(), original_transaction_id: z.string().nullish(),
  transaction_id: z.string().nullish(), cancel_reason: z.string().nullish(),
  expiration_reason: z.string().nullish()
}).passthrough();
const webhookSchema = z.object({ api_version: z.string().nullish(), event: eventSchema }).passthrough();
export type RevenueCatWebhookEvent = z.infer<typeof eventSchema>;
type Event = RevenueCatWebhookEvent;

const EVENT_PRECEDENCE: Readonly<Record<string, number>> = {
  product_change: 10,
  billing_issue: 20,
  subscription_paused: 25,
  cancellation: 30,
  initial_purchase: 40,
  renewal: 40,
  uncancellation: 40,
  non_renewing_purchase: 40,
  subscription_extended: 40,
  refund_reversed: 40,
  refunded: 45,
  expired: 50
};

function incomingEventStatus(event: Pick<Event, "type" | "cancel_reason">): string {
  if (event.type === "EXPIRATION") return "expired";
  if (event.type === "CANCELLATION" && event.cancel_reason === "CUSTOMER_SUPPORT") return "refunded";
  return event.type.toLowerCase();
}

/**
 * RevenueCat can deliver billing-issue, cancellation, and expiration events
 * with the same timestamp in a different order. At an equal timestamp, only
 * accept a transition that is more authoritative than the stored state.
 */
export function shouldApplyRevenueCatEvent(
  existing: { lastEventAt: Date; status: string } | undefined,
  eventAt: Date,
  event: Pick<Event, "type" | "cancel_reason">
): boolean {
  if (!existing) return true;
  const timestampDifference = eventAt.getTime() - existing.lastEventAt.getTime();
  if (timestampDifference !== 0) return timestampDifference > 0;
  const incomingStatus = event.type === "EXPIRATION"
    ? "expired"
    : event.type === "CANCELLATION" && event.cancel_reason === "CUSTOMER_SUPPORT"
      ? "refunded"
      : event.type.toLowerCase();
  return (EVENT_PRECEDENCE[incomingStatus] ?? 0) > (EVENT_PRECEDENCE[existing.status] ?? 0);
}

export function revenueCatAccessOutcome(
  event: Pick<Event, "type" | "cancel_reason" | "expiration_reason" | "grace_period_expiration_at_ms">,
  eventAt: Date,
  expiresAt: Date,
  existingGracePeriodEndsAt?: Date | null
): {
  accessEnded: boolean;
  accessEndsAt: Date;
  expirationReason: string | null;
  gracePeriodEndsAt: Date | null;
  status: string;
} {
  const refunded = event.type === "CANCELLATION" && event.cancel_reason === "CUSTOMER_SUPPORT";
  const expired = event.type === "EXPIRATION";
  const gracePeriodEndsAt = event.type === "BILLING_ISSUE"
    ? safeDate(event.grace_period_expiration_at_ms)
    : event.type === "CANCELLATION" && event.cancel_reason === "BILLING_ERROR"
      ? safeDate(event.grace_period_expiration_at_ms) ?? existingGracePeriodEndsAt ?? null
      : null;
  return {
    accessEnded: expired || refunded,
    accessEndsAt: refunded ? eventAt : gracePeriodEndsAt ?? expiresAt,
    expirationReason: expired
      ? event.expiration_reason ?? null
      : refunded ? "CUSTOMER_SUPPORT" : null,
    gracePeriodEndsAt,
    status: incomingEventStatus(event)
  };
}

export function parseRevenueCatWebhookEvent(input: unknown): RevenueCatWebhookEvent {
  return eventSchema.parse(input);
}

const activeTypes = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "REFUND_REVERSED"]);
const retainedTypes = new Set(["CANCELLATION", "SUBSCRIPTION_PAUSED", "BILLING_ISSUE"]);
const WEBHOOK_PROCESSING_STALE_MS = 5 * 60 * 1000;

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function diagnosticEvent(event: Event): Record<string, unknown> {
  return {
    eventId: event.id,
    eventType: event.type,
    appId: event.app_id ?? null,
    environment: event.environment ?? "PRODUCTION",
    store: event.store ?? null,
    productId: event.product_id ?? event.new_product_id ?? null,
    entitlementIds: event.entitlement_ids ?? [],
    appUserReference: event.app_user_id ? stableId("revenuecat_user", event.app_user_id) : null
  };
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
      logger.warn("RevenueCat billing event ignored for disallowed environment", diagnosticEvent(event));
      return this.ignore(event, payload as Record<string, unknown>, `Environment ${environment} is not allowed.`);
    }
    if (env.REVENUECAT_ALLOWED_APP_IDS.length > 0 && (!event.app_id || !env.REVENUECAT_ALLOWED_APP_IDS.includes(event.app_id))) {
      logger.warn("RevenueCat billing event ignored for disallowed app id", diagnosticEvent(event));
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
      if (prior?.status !== "failed" && prior?.status !== "received" && prior?.status !== "ignored") {
        return { status: "duplicate", eventId: event.id };
      }
      // Claim failed attempts, abandoned in-progress rows, and manually
      // redelivered ignored rows atomically. The last case lets an operator
      // replay a checkout webhook after correcting a product/entitlement
      // mapping without needing to mutate the production database.
      const staleBefore = new Date(Date.now() - WEBHOOK_PROCESSING_STALE_MS);
      const [claimed] = await db.update(billingWebhookEvents)
        .set({ status: "received", error: null, updatedAt: new Date() })
        .where(and(
          eq(billingWebhookEvents.id, event.id),
          or(
            eq(billingWebhookEvents.status, "failed"),
            eq(billingWebhookEvents.status, "ignored"),
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
    if (["TEST", "TRANSFER", "TEMPORARY_ENTITLEMENT_GRANT"].includes(event.type)) {
      // Temporary grants do not identify a store product, so they cannot be
      // mapped safely to Silver or Gold without querying RevenueCat's current
      // subscriber state. Support can grant a time-bound override instead.
      return { status: "ignored", eventId: event.id };
    }
    const recognized = activeTypes.has(event.type)
      || retainedTypes.has(event.type)
      || event.type === "EXPIRATION"
      || event.type === "PRODUCT_CHANGE";
    if (!recognized) {
      logger.warn("RevenueCat billing event ignored because its plan could not be mapped", {
        ...diagnosticEvent(event),
        recognized
      });
      return { status: "ignored", eventId: event.id };
    }
    const userId = await findUserId(event);
    if (!userId) throw new HttpError("RevenueCat app user does not match an application user.", 422);

    const productId = event.product_id ?? event.new_product_id;
    const rawExternalProductId = productId?.trim() || "unknown-product";
    const externalId = event.original_transaction_id ?? event.transaction_id ?? `${userId}:${rawExternalProductId}`;
    const subscriptionId = stableId("billing_subscription", externalId);
    const eventAt = safeDate(event.event_timestamp_ms);
    if (!eventAt) {
      throw new HttpError("RevenueCat subscription events must include a valid event timestamp.", 422);
    }
    const expiresAt = safeDate(event.expiration_at_ms);
    const db = getDatabase();
    if (!db) throw new HttpError("Billing requires database-backed storage.", 503);
    const [existing] = await db.select({
      lastEventAt: billingSubscriptions.lastEventAt,
      status: billingSubscriptions.status,
      planId: billingSubscriptions.planId,
      currentPeriodEndsAt: billingSubscriptions.currentPeriodEndsAt,
      gracePeriodEndsAt: billingSubscriptions.gracePeriodEndsAt
    }).from(billingSubscriptions)
      .where(and(eq(billingSubscriptions.provider, "revenuecat"), eq(billingSubscriptions.externalSubscriptionId, externalId))).limit(1);
    if (!shouldApplyRevenueCatEvent(existing, eventAt, event)) {
      return { status: "ignored", eventId: event.id };
    }

    if (event.type === "PRODUCT_CHANGE") {
      const pendingPlanId = planIdForRevenueCatPurchase(event.new_product_id, event.entitlement_ids);
      if (!existing || !pendingPlanId || pendingPlanId === existing.planId) {
        logger.warn("RevenueCat product change ignored because its current or destination plan could not be mapped", {
          ...diagnosticEvent(event),
          currentPlanId: existing?.planId ?? null,
          pendingPlanId: pendingPlanId ?? null
        });
        return { status: "ignored", eventId: event.id };
      }
      await db.update(billingSubscriptions).set({
        status: "product_change",
        pendingPlanId,
        cancelReason: null,
        expirationReason: null,
        gracePeriodEndsAt: null,
        currentPeriodEndsAt: expiresAt ?? existing.currentPeriodEndsAt,
        lastEventId: event.id,
        lastEventAt: eventAt,
        metadata: payload,
        updatedAt: new Date()
      }).where(and(
        eq(billingSubscriptions.provider, "revenuecat"),
        eq(billingSubscriptions.externalSubscriptionId, externalId)
      ));
      logger.info("RevenueCat product change scheduled", { ...diagnosticEvent(event), pendingPlanId });
      return { status: "processed", eventId: event.id };
    }

    const planId = planIdForRevenueCatPurchase(productId, event.entitlement_ids);
    if (!planId) {
      logger.warn("RevenueCat billing event ignored because its plan could not be mapped", diagnosticEvent(event));
      return { status: "ignored", eventId: event.id };
    }
    const normalizedProductId = productId
      ? normalizeStoreProductId(productId)
      : `entitlement:${planId}`;
    const assignmentId = stableId("plan_assignment_revenuecat", externalId);
    const refunded = event.type === "CANCELLATION" && event.cancel_reason === "CUSTOMER_SUPPORT";
    if (!refunded && !expiresAt) {
      throw new HttpError("RevenueCat subscription events must include an expiration date.", 422);
    }
    const plan = getPlanDefinition(planId);
    const cancelReason = event.type === "CANCELLATION" ? event.cancel_reason ?? null : null;
    const outcome = revenueCatAccessOutcome(
      event,
      eventAt,
      expiresAt ?? eventAt,
      existing?.gracePeriodEndsAt
    );

    await db.transaction(async (tx) => {
      await tx.insert(userPlanAssignments).values({
        id: assignmentId, userId, planId, planVersion: plan.version,
        status: outcome.accessEnded ? "expired" : "active", source: "subscription",
        effectiveAt: eventAt, expiresAt: outcome.accessEndsAt,
        metadata: { provider: "revenuecat", productId: normalizedProductId, lastEventId: event.id }
      }).onConflictDoUpdate({ target: userPlanAssignments.id, set: {
        planId, planVersion: plan.version, status: outcome.accessEnded ? "expired" : "active", expiresAt: outcome.accessEndsAt,
        effectiveAt: eventAt,
        metadata: { provider: "revenuecat", productId: normalizedProductId, lastEventId: event.id }, updatedAt: new Date()
      }});
      await tx.insert(billingSubscriptions).values({
        id: subscriptionId, userId, provider: "revenuecat", externalSubscriptionId: externalId,
        planAssignmentId: assignmentId, productId: normalizedProductId, planId,
        status: outcome.status, store: event.store, environment,
        currentPeriodEndsAt: refunded ? eventAt : expiresAt, pendingPlanId: null, cancelReason,
        expirationReason: outcome.expirationReason,
        gracePeriodEndsAt: outcome.gracePeriodEndsAt, lastEventId: event.id, lastEventAt: eventAt, metadata: payload
      }).onConflictDoUpdate({ target: [billingSubscriptions.provider, billingSubscriptions.externalSubscriptionId], set: {
        userId, planAssignmentId: assignmentId, productId: normalizedProductId, planId,
        status: outcome.status, store: event.store, environment,
        currentPeriodEndsAt: refunded ? eventAt : expiresAt, pendingPlanId: null, cancelReason,
        expirationReason: outcome.expirationReason,
        gracePeriodEndsAt: outcome.gracePeriodEndsAt, lastEventId: event.id, lastEventAt: eventAt,
        metadata: payload, updatedAt: new Date()
      }});
    });
    logger.info("RevenueCat billing event applied", { ...diagnosticEvent(event), planId });
    return { status: "processed", eventId: event.id };
  }
}

export const revenueCatBillingService = new RevenueCatBillingService();
