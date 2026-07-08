import type { AuthUser, ConversationSummary, OAuthProvider, OAuthProviderStatus } from "@persona/shared";
import { useMemo, useState } from "react";

const REGISTER_PASSWORD_MIN_LENGTH = 10;

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
  authUser,
  authLoading = false,
  authError,
  oauthProviders = [],
  conversations,
  activeConversationId,
  loading = false,
  onLogin,
  onRegister,
  onLogout,
  onOAuthLogin,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  onPinConversation
}: {
  authUser?: AuthUser | undefined;
  authLoading?: boolean;
  authError?: string | undefined;
  oauthProviders?: OAuthProviderStatus[];
  conversations: ConversationSummary[];
  activeConversationId?: string | undefined;
  loading?: boolean;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onRegister: (payload: { email?: string; username?: string; password: string }) => Promise<void>;
  onLogout: () => Promise<void>;
  onOAuthLogin: (provider: OAuthProvider) => void;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onPinConversation: (conversationId: string, pinned: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draftTitle, setDraftTitle] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [localAuthError, setLocalAuthError] = useState<string | undefined>();
  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return conversations;
    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(normalizedQuery));
  }, [conversations, query]);
  const enabledOAuthProviders = useMemo(
    () => oauthProviders.filter((provider) => provider.enabled),
    [oauthProviders]
  );
  const authStatusText = authMode === "login"
    ? "Pick up where your chats left off."
    : "Save your chats, media, and persona settings.";
  const primaryAuthText = authMode === "login" ? "Log in" : "Create account";
  const busyAuthText = authMode === "login" ? "Logging in..." : "Creating...";

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

  async function submitLogin(): Promise<void> {
    const nextIdentifier = identifier.trim();
    if (!nextIdentifier || !password) {
      setLocalAuthError("Enter your email or username and password.");
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onLogin(nextIdentifier, password);
      setPassword("");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitRegister(): Promise<void> {
    const payload: { email?: string; username?: string; password: string } = {
      password: registerPassword
    };
    const email = registerEmail.trim();
    const username = registerUsername.trim();
    if (email) payload.email = email;
    if (username) payload.username = username;
    if (!payload.email && !payload.username) {
      setLocalAuthError("Enter an email or username.");
      return;
    }
    if (username && username.length < 3) {
      setLocalAuthError("Username must be at least 3 characters.");
      return;
    }
    if (!payload.password || payload.password.length < REGISTER_PASSWORD_MIN_LENGTH) {
      setLocalAuthError(`Password must be at least ${REGISTER_PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onRegister(payload);
      setRegisterPassword("");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Registration failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitLogout(): Promise<void> {
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onLogout();
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Logout failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <aside className="conversation-sidebar" aria-label="Chat history">
      <div className="conversation-sidebar-top">
        <div>
          <div className="conversation-sidebar-brand">LaRae</div>
          <div className="conversation-sidebar-subtitle">Chats</div>
        </div>
      </div>

      <section className="conversation-auth-card" aria-label="Account">
        {authUser ? (
          <>
            <div className="conversation-auth-pass">
              <div className="conversation-auth-avatar" aria-hidden="true">
                {(authUser.displayName ?? authUser.username ?? authUser.email ?? "A").slice(0, 1).toUpperCase()}
              </div>
              <div className="conversation-auth-account">
                <div className="conversation-auth-label">Signed in</div>
                <div className="conversation-auth-name">
                  {authUser.displayName ?? authUser.username ?? authUser.email ?? "Account"}
                </div>
                {authUser.email || authUser.username ? (
                  <div className="conversation-auth-hint">{authUser.email ?? `@${authUser.username}`}</div>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="conversation-auth-secondary"
              onClick={() => {
                void submitLogout();
              }}
              disabled={authBusy}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <div className="conversation-auth-header">
              <div>
                <div className="conversation-auth-label">Account</div>
                <div className="conversation-auth-title">{primaryAuthText}</div>
              </div>
              <div className="conversation-auth-pill" aria-live="polite">
                {authMode === "login" ? "Returning" : "New"}
              </div>
            </div>
            <p className="conversation-auth-copy">{authStatusText}</p>
            <div className="conversation-auth-tabs" role="tablist" aria-label="Choose authentication mode">
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "login"}
                className={`conversation-auth-tab${authMode === "login" ? " conversation-auth-tab-active" : ""}`}
                onClick={() => {
                  setAuthMode("login");
                  setLocalAuthError(undefined);
                }}
                disabled={authBusy}
              >
                Log in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "register"}
                className={`conversation-auth-tab${authMode === "register" ? " conversation-auth-tab-active" : ""}`}
                onClick={() => {
                  setAuthMode("register");
                  setLocalAuthError(undefined);
                }}
                disabled={authBusy}
              >
                Create
              </button>
            </div>
            <form
              className="conversation-auth-form"
              autoComplete="off"
              onSubmit={(event) => {
                event.preventDefault();
                void (authMode === "login" ? submitLogin() : submitRegister());
              }}
            >
              {authMode === "login" ? (
                <>
                  <input
                    name="persona-login-identifier"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="Email or username"
                    aria-label="Email or username"
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    spellCheck={false}
                    disabled={authBusy || authLoading}
                  />
                  <input
                    name="persona-login-passcode"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Password"
                    aria-label="Password"
                    type="password"
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    disabled={authBusy || authLoading}
                  />
                </>
              ) : (
                <>
                  <input
                    value={registerEmail}
                    onChange={(event) => setRegisterEmail(event.target.value)}
                    placeholder="Email"
                    aria-label="Email"
                    type="email"
                    autoComplete="email"
                    disabled={authBusy || authLoading}
                  />
                  <input
                    value={registerUsername}
                    onChange={(event) => setRegisterUsername(event.target.value)}
                    placeholder="Username"
                    aria-label="Username"
                    autoComplete="username"
                    disabled={authBusy || authLoading}
                  />
                  <input
                    value={registerPassword}
                    onChange={(event) => setRegisterPassword(event.target.value)}
                    placeholder={`Password (${REGISTER_PASSWORD_MIN_LENGTH}+ chars)`}
                    aria-label="Password"
                    type="password"
                    autoComplete="new-password"
                    disabled={authBusy || authLoading}
                  />
                </>
              )}
              {(localAuthError || authError) ? (
                <div className="conversation-auth-error" role="alert">{localAuthError ?? authError}</div>
              ) : null}
              <div className="conversation-auth-actions">
                <button type="submit" className="conversation-auth-submit" disabled={authBusy || authLoading}>
                  {authBusy ? busyAuthText : primaryAuthText}
                </button>
              </div>
            </form>
            {enabledOAuthProviders.length > 0 ? (
              <div className="conversation-oauth-row">
                {enabledOAuthProviders.map((provider) => (
                  <button
                    key={provider.provider}
                    type="button"
                    className="conversation-oauth-button"
                    onClick={() => onOAuthLogin(provider.provider)}
                    disabled={authBusy}
                  >
                    <span aria-hidden="true">{provider.provider === "google" ? "G" : "f"}</span>
                    Continue with {provider.provider === "google" ? "Google" : "Facebook"}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="conversation-auth-switch"
              onClick={() => {
                setAuthMode((current) => current === "login" ? "register" : "login");
                setLocalAuthError(undefined);
              }}
              disabled={authBusy}
            >
              {authMode === "login" ? "Need an account? Create one" : "Have an account? Log in"}
            </button>
          </>
        )}
      </section>

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
                    className={`conversation-list-pin${conversation.pinned ? " conversation-list-pin-active" : ""}`}
                    onClick={() => onPinConversation(conversation.id, !conversation.pinned)}
                    title={conversation.pinned ? "Unpin chat" : "Pin chat"}
                    aria-label={`${conversation.pinned ? "Unpin" : "Pin"} ${conversation.title}`}
                  >
                    ★
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
