import { desc, eq, or, sql } from "drizzle-orm";
import type { PlanId } from "@persona/shared";
import { accessControlService, planOverrideSources, type PlanOverrideSource } from "../services/accessControlService.js";
import { closeDatabase, getDatabase } from "../db/client.js";
import { userPlanAssignments, users } from "../db/schema.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`Missing required --${name} argument.`);
  return value;
}

function parsePlan(value: string): PlanId {
  if (value === "bronze" || value === "silver" || value === "gold") return value;
  throw new Error("--plan must be bronze, silver, or gold.");
}

function parseSource(value: string): PlanOverrideSource {
  const source = planOverrideSources.find((candidate) => candidate === value);
  if (!source) throw new Error(`--source must be one of: ${planOverrideSources.join(", ")}.`);
  return source;
}

function parseDate(name: string): Date | undefined {
  const value = argument(name);
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`--${name} must be a valid ISO date.`);
  return date;
}

async function resolveUserId(identifier: string): Promise<string> {
  const db = getDatabase();
  if (!db) throw new Error("DATABASE_URL is required.");
  const normalized = identifier.trim().toLowerCase();
  const [user] = await db.select({ id: users.id }).from(users).where(or(
    eq(users.id, identifier),
    sql`lower(${users.email}) = ${normalized}`,
    eq(users.username, normalized)
  )).limit(1);
  if (!user) throw new Error("User not found.");
  return user.id;
}

async function grant(): Promise<void> {
  const userId = await resolveUserId(requiredArgument("user"));
  const effectiveAt = parseDate("effective");
  const expiresAt = parseDate("expires");
  const assignmentId = await accessControlService.grantPlanOverride({
    userId,
    planId: parsePlan(requiredArgument("plan")),
    source: parseSource(requiredArgument("source")),
    reason: requiredArgument("reason"),
    ...(effectiveAt ? { effectiveAt } : {}),
    ...(expiresAt ? { expiresAt } : {})
  });
  console.log(`Plan override granted: ${assignmentId}`);
}

async function revoke(): Promise<void> {
  const assignmentId = requiredArgument("assignment");
  await accessControlService.revokePlanOverride({
    assignmentId,
    reason: requiredArgument("reason")
  });
  console.log(`Plan override revoked: ${assignmentId}`);
}

async function list(): Promise<void> {
  const db = getDatabase();
  if (!db) throw new Error("DATABASE_URL is required.");
  const userId = await resolveUserId(requiredArgument("user"));
  const rows = await db.select({
    id: userPlanAssignments.id,
    planId: userPlanAssignments.planId,
    source: userPlanAssignments.source,
    status: userPlanAssignments.status,
    effectiveAt: userPlanAssignments.effectiveAt,
    expiresAt: userPlanAssignments.expiresAt,
    metadata: userPlanAssignments.metadata
  }).from(userPlanAssignments)
    .where(eq(userPlanAssignments.userId, userId))
    .orderBy(desc(userPlanAssignments.effectiveAt));
  console.table(rows);
}

const command = process.argv[2];
try {
  if (command === "grant") await grant();
  else if (command === "revoke") await revoke();
  else if (command === "list") await list();
  else {
    throw new Error(
      "Use grant, revoke, or list. Example: npm run plans:override -w @persona/api -- grant --user user@example.com --plan silver --source tester --reason \"QA access\" --expires 2026-09-01"
    );
  }
} finally {
  await closeDatabase();
}
