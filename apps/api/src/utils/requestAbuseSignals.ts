import { createHmac } from "node:crypto";
import type { Request } from "express";
import { env } from "../config/env.js";

export type RequestAbuseSignals = {
  deviceKey?: string;
  ipKey?: string;
};

function pseudonymousSignal(scope: "device" | "ip", value: string): string {
  const key = env.BETTER_AUTH_SECRET ?? "persona-wrapper-local-abuse-signal-key";
  return `${scope}:${createHmac("sha256", key).update(`${scope}:${value}`).digest("hex")}`;
}

function normalizedDeviceId(request: Request): string | undefined {
  const value = request.header("x-device-id")?.trim() || request.header("x-owner-id")?.trim();
  if (!value || value.length < 8 || value.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(value)) return undefined;
  return value;
}

function normalizedIpAddress(request: Request): string | undefined {
  const value = request.ip?.trim() || request.socket?.remoteAddress?.trim();
  if (!value || value.length > 100) return undefined;
  return value;
}

export function requestAbuseSignals(request: Request): RequestAbuseSignals {
  const deviceId = normalizedDeviceId(request);
  const ipAddress = normalizedIpAddress(request);
  return {
    ...(deviceId ? { deviceKey: pseudonymousSignal("device", deviceId) } : {}),
    ...(ipAddress ? { ipKey: pseudonymousSignal("ip", ipAddress) } : {})
  };
}
