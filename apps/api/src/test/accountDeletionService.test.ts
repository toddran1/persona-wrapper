import { describe, expect, it } from "vitest";
import { AccountDeletionService } from "../services/accountDeletionService.js";

describe("AccountDeletionService", () => {
  it("treats scheduled cleanup as a no-op when the database is not configured", async () => {
    const service = new AccountDeletionService();
    await expect(service.purgeDueAccounts()).resolves.toBe(0);
  });
});
