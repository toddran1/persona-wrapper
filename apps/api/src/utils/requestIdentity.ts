import type { Request } from "express";
import { env } from "../config/env.js";
import { HttpError } from "./httpError.js";

export function requestOwnerId(request: Request): string {
  const value = optionalRequestOwnerId(request);
  if (!value) throw new HttpError("A valid x-owner-id header or bearer token is required.", 400);
  return value;
}

export function optionalRequestOwnerId(request: Request): string | undefined {
  if (request.auth?.userId) return request.auth.userId;
  const value = request.header("x-owner-id");
  if (!value) {
    if (env.AUTH_REQUIRED) throw new HttpError("Authentication required.", 401);
    return undefined;
  }
  if (value.length > 200) throw new HttpError("A valid x-owner-id header is required.", 400);
  return value;
}
