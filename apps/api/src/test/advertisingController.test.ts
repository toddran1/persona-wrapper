import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { getAdMobSsvCallback } from "../controllers/advertising.controller.js";

describe("advertising controller", () => {
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
