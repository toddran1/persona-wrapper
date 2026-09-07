import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "../db/client.js";
import { accessControlService } from "../services/accessControlService.js";
import { cleanupExpiredAdRewardData, createAdRewardSession } from "../services/adRewardVerificationService.js";
import { getPlanDefinition } from "../services/planCatalog.js";

vi.mock("../db/client.js", () => ({ getDatabase: vi.fn() }));

function queryResult<T>(value: T) {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => Promise.resolve(value),
    then: (resolve: (result: T) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject)
  };
  return builder;
}

function createSessionDatabase(selectResults: unknown[]) {
  const insertedSessions: Array<Record<string, unknown>> = [];
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(() => queryResult(selectResults.shift() ?? [])),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => {
        insertedSessions.push(value);
        return Promise.resolve();
      })
    }))
  };
  return {
    insertedSessions,
    database: {
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx))
    }
  };
}

describe("ad reward sessions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(accessControlService, "getEffectiveAccess").mockResolvedValue({
      plan: getPlanDefinition("bronze"),
      isAdmin: false
    });
  });

  it("creates a distinct single-use session for every ad attempt", async () => {
    const first = createSessionDatabase([[{ count: 0 }], [{ count: 0 }]]);
    vi.mocked(getDatabase).mockReturnValue(first.database as never);
    const firstSession = await createAdRewardSession("user_reward", new Date("2026-09-06T12:00:00Z"));

    const second = createSessionDatabase([[{ count: 0 }], [{ count: 1 }]]);
    vi.mocked(getDatabase).mockReturnValue(second.database as never);
    const secondSession = await createAdRewardSession("user_reward", new Date("2026-09-06T12:01:00Z"));

    expect(firstSession.sessionId).not.toBe(secondSession.sessionId);
    expect(first.insertedSessions).toHaveLength(1);
    expect(second.insertedSessions).toHaveLength(1);
  });

  it("prevents more outstanding sessions than the remaining daily reward allowance", async () => {
    const fake = createSessionDatabase([[{ count: 1 }], [{ count: 2 }]]);
    vi.mocked(getDatabase).mockReturnValue(fake.database as never);

    await expect(createAdRewardSession("user_reward", new Date("2026-09-06T12:00:00Z"))).rejects.toMatchObject({
      statusCode: 409
    });
    expect(fake.insertedSessions).toHaveLength(0);
  });

  it("expires pending sessions and removes reward data past retention", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const database = {
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
      delete: vi.fn(() => ({ where: deleteWhere }))
    };
    vi.mocked(getDatabase).mockReturnValue(database as never);

    await cleanupExpiredAdRewardData(new Date("2026-09-06T12:00:00Z"));

    expect(database.update).toHaveBeenCalledTimes(1);
    expect(database.delete).toHaveBeenCalledTimes(2);
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(2);
  });
});
