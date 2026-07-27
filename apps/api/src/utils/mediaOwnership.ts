import { env } from "../config/env.js";
import { HttpError } from "./httpError.js";

export function assertOwnedMediaAccess(
  resourceOwnerId: string | null | undefined,
  requestingOwnerId: string | undefined,
  notFoundMessage: string
): void {
  if (env.AUTH_REQUIRE_OWNED_MEDIA_ACCESS) {
    if (!resourceOwnerId || !requestingOwnerId || resourceOwnerId !== requestingOwnerId) {
      throw new HttpError(notFoundMessage, 404);
    }
    return;
  }

  // Development can retain support for old unowned fixtures, while still
  // preventing one explicit owner from reading another owner's output.
  if (resourceOwnerId && requestingOwnerId && resourceOwnerId !== requestingOwnerId) {
    throw new HttpError(notFoundMessage, 404);
  }
}
