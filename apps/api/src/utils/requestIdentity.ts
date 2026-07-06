import type { Request } from "express";
import { HttpError } from "./httpError.js";

export function requestOwnerId(request: Request): string {
  const value = request.header("x-owner-id");
  if (!value || value.length > 200) throw new HttpError("A valid x-owner-id header is required.", 400);
  return value;
}

export function optionalRequestOwnerId(request: Request): string | undefined {
  const value = request.header("x-owner-id");
  if (!value) return undefined;
  if (value.length > 200) throw new HttpError("A valid x-owner-id header is required.", 400);
  return value;
}
