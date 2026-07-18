import * as SecureStore from "expo-secure-store";
const OWNER_ID_KEY = "persona-wrapper-owner-id";
const SELECTED_CONVERSATION_ID_KEY = "persona-wrapper-selected-conversation-id";

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function getOwnerId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(OWNER_ID_KEY);
  if (existing) return existing;
  const created = createLocalId("owner");
  await SecureStore.setItemAsync(OWNER_ID_KEY, created);
  return created;
}

export async function getSelectedConversationId(): Promise<string | undefined> {
  return await SecureStore.getItemAsync(SELECTED_CONVERSATION_ID_KEY) ?? undefined;
}

export async function setSelectedConversationId(conversationId: string): Promise<void> {
  await SecureStore.setItemAsync(SELECTED_CONVERSATION_ID_KEY, conversationId);
}

export async function clearSelectedConversationId(): Promise<void> {
  await SecureStore.deleteItemAsync(SELECTED_CONVERSATION_ID_KEY);
}
