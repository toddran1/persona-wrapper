import { eq } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { users } from "../db/schema.js";

export async function conciseAudioResponsesForUser(userId?: string): Promise<boolean> {
  const db = getDatabase();
  if (!db || !userId) return true;
  const [user] = await db.select({
    conciseAudioResponses: users.conciseAudioResponses
  }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.conciseAudioResponses ?? true;
}
