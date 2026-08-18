import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { grantPlanOverride, listPlanOverrides, revokePlanOverride } from "../controllers/admin.controller.js";

const response = {} as Response;

function requestWith(auth: Request["auth"], body?: unknown, query?: unknown): Request {
  return { auth, body, query } as unknown as Request;
}

describe("admin plan override endpoints", () => {
  it("rejects unauthenticated requests", async () => {
    await expect(listPlanOverrides(requestWith(undefined, undefined, { user: "a@b.c" }), response))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(grantPlanOverride(requestWith(undefined, {}), response))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(revokePlanOverride(requestWith(undefined, {}), response))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects authenticated non-admin users before touching storage", async () => {
    const auth = { userId: "user_1", sessionId: "session_1", clientType: "web" as const, policyConsentRequired: false, emailVerificationRequired: false, isAdmin: false };
    await expect(listPlanOverrides(requestWith(auth, undefined, { user: "a@b.c" }), response))
      .rejects.toMatchObject({ statusCode: 403, message: "Admin access required." });
    await expect(grantPlanOverride(requestWith(auth, {
      user: "a@b.c", planId: "gold", source: "tester", reason: "QA"
    }), response)).rejects.toMatchObject({ statusCode: 403 });
    await expect(revokePlanOverride(requestWith(auth, {
      user: "a@b.c", assignmentId: "plan_assignment_1", reason: "Done"
    }), response)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects malformed grant bodies for admins before storage access", async () => {
    const auth = { userId: "admin_1", sessionId: "session_1", clientType: "web" as const, policyConsentRequired: false, emailVerificationRequired: false, isAdmin: true };
    await expect(grantPlanOverride(requestWith(auth, {
      user: "a@b.c", planId: "platinum", source: "tester", reason: "QA"
    }), response)).rejects.toThrow();
    await expect(grantPlanOverride(requestWith(auth, {
      user: "a@b.c", planId: "gold", source: "nepotism", reason: "QA"
    }), response)).rejects.toThrow();
    await expect(grantPlanOverride(requestWith(auth, {
      user: "a@b.c", planId: "gold", source: "tester", reason: ""
    }), response)).rejects.toThrow();
    await expect(grantPlanOverride(requestWith(auth, {
      user: "a@b.c", planId: "gold", source: "tester", reason: "QA", expiresAt: "not-a-date"
    }), response)).rejects.toMatchObject({ statusCode: 400, message: "Invalid expiration date." });
  });
});
