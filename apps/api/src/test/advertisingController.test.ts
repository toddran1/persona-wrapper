import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { getAdMobSsvCallback, postAdImpressionRevenue } from "../controllers/advertising.controller.js";

describe("advertising controller", () => {
  it("requires an identified owner before accepting impression revenue", async () => {
    await expect(postAdImpressionRevenue(
      { auth: undefined, params: { sessionId: "session_test" }, body: { value: 0.01, currency: "USD", precision: "precise" }, header: () => undefined } as unknown as Request,
      {} as Response
    )).rejects.toMatchObject({ statusCode: 400 });
  });

  it("acknowledges AdMob's queryless URL-readiness probe without granting a reward", async () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await getAdMobSsvCallback(
      { originalUrl: "/api/advertising/admob/ssv" } as Request,
      { status, json } as unknown as Response
    );

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: "ready" });
  });

  it("acknowledges a malformed console probe without processing a reward", async () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await getAdMobSsvCallback(
      { originalUrl: "/api/advertising/admob/ssv?testing=true" } as Request,
      { status, json } as unknown as Response
    );

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: "ignored" });
  });
});
