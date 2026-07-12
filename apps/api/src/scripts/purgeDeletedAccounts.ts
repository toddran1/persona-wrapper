import { closeDatabase } from "../db/client.js";
import { accountDeletionService } from "../services/accountDeletionService.js";

try {
  const purged = await accountDeletionService.purgeDueAccounts();
  console.info(`Purged ${purged} account(s).`);
} finally {
  await closeDatabase();
}
