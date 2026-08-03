import { eq } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { users } from "../db/schema.js";
import type { ModelProviderPreference } from "@persona/shared";

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
