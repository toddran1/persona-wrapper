import type { ConversationSummary } from "@persona/shared";
import { useMemo, useState } from "react";

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  loading = false,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation
}: {
  conversations: ConversationSummary[];
  activeConversationId?: string | undefined;
  loading?: boolean;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draftTitle, setDraftTitle] = useState("");
  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return conversations;
    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(normalizedQuery));
  }, [conversations, query]);

  function startRename(conversation: ConversationSummary): void {
    setEditingId(conversation.id);
    setDraftTitle(conversation.title);
  }

  function cancelRename(): void {
    setEditingId(undefined);
    setDraftTitle("");
  }

  function saveRename(conversationId: string): void {
    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      cancelRename();
      return;
    }
    onRenameConversation(conversationId, nextTitle);
    cancelRename();
  }

  return (
    <aside className="conversation-sidebar" aria-label="Chat history">
      <div className="conversation-sidebar-top">
        <div>
          <div className="conversation-sidebar-brand">LaRae</div>
          <div className="conversation-sidebar-subtitle">Chats</div>
        </div>
        <button
          type="button"
          className="conversation-sidebar-icon-button"
          onClick={onNewConversation}
          title="New chat"
          aria-label="New chat"
        >
          +
        </button>
      </div>

      <button type="button" className="conversation-new-chat" onClick={onNewConversation}>
        <span aria-hidden="true">+</span>
        <span>New chat</span>
      </button>

      <label className="conversation-search">
        <span>Search chats</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats"
          type="search"
        />
      </label>

      <div className="conversation-sidebar-section-title">Chats</div>
      <div className="conversation-list" aria-busy={loading}>
        {filteredConversations.length === 0 ? (
          <p className="conversation-list-empty">{query.trim() ? "No matching chats." : "No saved chats yet."}</p>
        ) : (
          filteredConversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`conversation-list-item${conversation.id === activeConversationId ? " conversation-list-item-active" : ""}`}
            >
              {editingId === conversation.id ? (
                <form
                  className="conversation-list-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveRename(conversation.id);
                  }}
                >
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") cancelRename();
                    }}
                    autoFocus
                    maxLength={120}
                  />
                  <button type="submit">Save</button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="conversation-list-main"
                    onClick={() => onSelectConversation(conversation.id)}
                    title={conversation.title}
                  >
                    <span className="conversation-list-title">{conversation.title}</span>
                    <span className="conversation-list-meta">
                      {conversation.messageCount} messages
                      {formatConversationTime(conversation.updatedAt) ? ` · ${formatConversationTime(conversation.updatedAt)}` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="conversation-list-rename"
                    onClick={() => startRename(conversation)}
                    title="Rename chat"
                    aria-label={`Rename ${conversation.title}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="conversation-list-delete"
                    onClick={() => onDeleteConversation(conversation.id)}
                    title="Delete chat"
                    aria-label={`Delete ${conversation.title}`}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
