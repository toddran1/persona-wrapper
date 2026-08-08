import { eq } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { users } from "../db/schema.js";
import type { ModelProviderPreference, PersonaInfluenceLevel } from "@persona/shared";
import { logger } from "../utils/logger.js";

export async function conciseAudioResponsesForUser(userId?: string): Promise<boolean> {
  const db = getDatabase();
  if (!db || !userId) return true;
  const [user] = await db.select({
    conciseAudioResponses: users.conciseAudioResponses
  }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.conciseAudioResponses ?? true;
}

export async function modelProviderForUser(userId?: string): Promise<ModelProviderPreference | undefined> {
  const db = getDatabase();
  if (!db || !userId) return undefined;
  const [user] = await db.select({ modelProvider: users.modelProvider })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return undefined;
  return user.modelProvider === "gemini" ? "gemini" : "openai";
}

export async function personaInfluenceLevelForUser(userId?: string): Promise<PersonaInfluenceLevel> {
  const db = getDatabase();
  if (!db || !userId) return "uncensored";
  const [user] = await db.select({ personaInfluenceLevel: users.personaInfluenceLevel })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return "uncensored";
  if (user.personaInfluenceLevel === "professional" || user.personaInfluenceLevel === "uncensored") {
    return user.personaInfluenceLevel;
  }
  logger.error("Invalid stored persona influence level; using professional mode", {
    userId,
    storedValue: user.personaInfluenceLevel
  });
  return "professional";
}
