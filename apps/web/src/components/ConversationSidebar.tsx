import type {
  AuthUser,
  ConversationSummary,
  DataTransferJob,
  OAuthProvider,
  OAuthProviderStatus,
} from "@persona/shared";
import { useMemo, useRef, useState } from "react";

const REGISTER_PASSWORD_MIN_LENGTH = 10;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024 * 1024;

function assertSupportedImportSize(size: number | undefined): void {
  if (size !== undefined && size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("Import archives must be 5 GB or smaller.");
  }
}

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
  mobileOpen = false,
  personaName,
  authUser,
  authLoading = false,
  authError,
  oauthProviders = [],
  conversations,
  activeConversationId,
  loading = false,
  hasMoreConversations = false,
  onLoadMoreConversations,
  onLogin,
  onRegister,
  onRestoreAccount,
  onDeleteAccount,
  onExportAccount,
  onExportConversation,
  onImportConversations,
  dataTransferJob,
  onCancelDataTransfer,
  onLogout,
  onOAuthLogin,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  onPinConversation,
}: {
  mobileOpen?: boolean;
  personaName: string;
  authUser?: AuthUser | undefined;
  authLoading?: boolean;
  authError?: string | undefined;
  oauthProviders?: OAuthProviderStatus[];
  conversations: ConversationSummary[];
  activeConversationId?: string | undefined;
  loading?: boolean;
  hasMoreConversations?: boolean;
  onLoadMoreConversations?: (() => void) | undefined;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onRegister: (payload: {
    email?: string;
    username?: string;
    password: string;
  }) => Promise<void>;
  onRestoreAccount: (identifier: string, password: string) => Promise<void>;
  onDeleteAccount: (payload: { confirmation: "DELETE"; password?: string }) => Promise<void>;
  onExportAccount: () => Promise<void>;
  onExportConversation: (conversationId: string) => Promise<void>;
  onImportConversations: (file: File) => Promise<void>;
  dataTransferJob?: DataTransferJob | undefined;
  onCancelDataTransfer?: (() => Promise<void>) | undefined;
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
  const [authMode, setAuthMode] = useState<"login" | "register" | "restore">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [localAuthError, setLocalAuthError] = useState<string | undefined>();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [publicAboutOpen, setPublicAboutOpen] = useState(false);
  const [conversationActionMenuId, setConversationActionMenuId] = useState<string | undefined>();
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const dataTransferActive = Boolean(dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status));
  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return conversations;
    return conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(normalizedQuery),
    );
  }, [conversations, query]);
  const enabledOAuthProviders = useMemo(
    () => oauthProviders.filter((provider) => provider.enabled),
    [oauthProviders],
  );
  const authStatusText =
    authMode === "login"
      ? "Pick up where your chats left off."
      : authMode === "restore"
        ? "Cancel a scheduled deletion before the recovery deadline."
        : "Sign up to save your chats and settings.";
  const primaryAuthText = "Log in | Create account";
  const busyAuthText = authMode === "login" ? "Logging in..." : authMode === "restore" ? "Restoring..." : "Creating...";
  const accountName =
    authUser?.displayName ?? authUser?.username ?? authUser?.email ?? "Account";
  const accountDetail =
    authUser?.email ??
    (authUser?.username ? `@${authUser.username}` : "Signed in");
  const accountInitial = accountName.slice(0, 1).toUpperCase();

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

  function closeConversationActionMenu(): void {
    setConversationActionMenuId(undefined);
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
      setAuthPanelOpen(false);
    } catch (error) {
      setLocalAuthError(
        error instanceof Error ? error.message : "Login failed.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitRegister(): Promise<void> {
    const payload: { email?: string; username?: string; password: string } = {
      password: registerPassword,
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
    if (
      !payload.password ||
      payload.password.length < REGISTER_PASSWORD_MIN_LENGTH
    ) {
      setLocalAuthError(
        `Password must be at least ${REGISTER_PASSWORD_MIN_LENGTH} characters.`,
      );
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onRegister(payload);
      setRegisterPassword("");
      setAuthPanelOpen(false);
    } catch (error) {
      setLocalAuthError(
        error instanceof Error ? error.message : "Registration failed.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitRestore(): Promise<void> {
    const nextIdentifier = identifier.trim();
    if (!nextIdentifier || !password) {
      setLocalAuthError("Enter your email or username and password.");
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onRestoreAccount(nextIdentifier, password);
      setPassword("");
      setAuthPanelOpen(false);
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Account restoration failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitDeleteAccount(): Promise<void> {
    if (deleteConfirmation !== "DELETE") {
      setLocalAuthError("Type DELETE exactly to confirm.");
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onDeleteAccount({ confirmation: "DELETE", ...(deletePassword ? { password: deletePassword } : {}) });
      setDeleteAccountOpen(false);
      setAccountMenuOpen(false);
      setDeleteConfirmation("");
      setDeletePassword("");
      setAuthMode("restore");
      setAuthPanelOpen(true);
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not schedule account deletion.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      assertSupportedImportSize(file.size);
      await onImportConversations(file);
      setAccountMenuOpen(false);
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not import this file.");
    } finally {
      setAuthBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function submitLogout(): Promise<void> {
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onLogout();
      setAccountMenuOpen(false);
    } catch (error) {
      setLocalAuthError(
        error instanceof Error ? error.message : "Logout failed.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <aside className={`conversation-sidebar${mobileOpen ? " conversation-sidebar-mobile-open" : ""}`} aria-label="Chat history">
      <div className="conversation-sidebar-top">
        <div className="conversation-sidebar-brand-lockup">
          <img
            className="conversation-sidebar-brand-logo"
            src="/FTB_logo/For_the_Baddiez_logo_transparent.png"
            alt=""
            aria-hidden="true"
          />
          <div className="conversation-sidebar-brand-copy">
            <div className="conversation-sidebar-brand">For the Baddiez</div>
            <div className="conversation-sidebar-subtitle">{personaName}</div>
          </div>
        </div>
      </div>

      {!authUser ? (
        <section
          className={`conversation-auth-card${authPanelOpen ? " conversation-auth-card-open" : ""}`}
          aria-label="Account"
        >
          <button
            type="button"
            className="conversation-auth-toggle"
            data-testid="auth-panel-toggle"
            onClick={() => setAuthPanelOpen((open) => !open)}
            aria-expanded={authPanelOpen}
            aria-controls="conversation-auth-panel"
          >
            <span className="conversation-auth-toggle-copy">
              <span className="conversation-auth-label">Account</span>
              <span className="conversation-auth-title">{primaryAuthText}</span>
            </span>
            <span className="conversation-auth-toggle-meta">
              <span className="conversation-auth-chevron" aria-hidden="true">
                {authPanelOpen ? "-" : "+"}
              </span>
            </span>
          </button>
          {authPanelOpen ? (
            <div
              id="conversation-auth-panel"
              className="conversation-auth-panel"
            >
              <div
                className="conversation-auth-tabs"
                role="tablist"
                aria-label="Choose authentication mode"
              >
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
                  data-testid="auth-login-tab"
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
                  data-testid="auth-register-tab"
                >
                  Sign up
                </button>
              </div>
              <p className="conversation-auth-copy">{authStatusText}</p>
              <form
                className="conversation-auth-form"
                autoComplete="off"
                onSubmit={(event) => {
                  event.preventDefault();
                  void (authMode === "login"
                    ? submitLogin()
                    : authMode === "restore" ? submitRestore() : submitRegister());
                }}
              >
                {authMode !== "register" ? (
                  <>
                    <input
                      name="persona-login-identifier"
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      placeholder="Email or username"
                      aria-label="Email or username"
                      data-testid="auth-identifier"
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
                      data-testid="auth-password"
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
                      data-testid="auth-register-email"
                      type="email"
                      autoComplete="email"
                      disabled={authBusy || authLoading}
                    />
                    <input
                      value={registerUsername}
                      onChange={(event) =>
                        setRegisterUsername(event.target.value)
                      }
                      placeholder="Username"
                      aria-label="Username"
                      data-testid="auth-register-username"
                      autoComplete="username"
                      disabled={authBusy || authLoading}
                    />
                    <input
                      value={registerPassword}
                      onChange={(event) =>
                        setRegisterPassword(event.target.value)
                      }
                      placeholder={`Password (${REGISTER_PASSWORD_MIN_LENGTH}+ chars)`}
                      aria-label="Password"
                      data-testid="auth-register-password"
                      type="password"
                      autoComplete="new-password"
                      disabled={authBusy || authLoading}
                    />
                  </>
                )}
                {localAuthError || authError ? (
                  <div className="conversation-auth-error" role="alert">
                    {localAuthError ?? authError}
                  </div>
                ) : null}
                <div className="conversation-auth-actions">
                  <button
                    type="submit"
                    className="conversation-auth-submit"
                    data-testid="auth-submit"
                    disabled={authBusy || authLoading}
                  >
                    {authBusy ? busyAuthText : authMode === "login" ? "Log in" : authMode === "restore" ? "Restore account" : "Create account"}
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
                      data-testid={`oauth-${provider.provider}`}
                      onClick={() => onOAuthLogin(provider.provider)}
                      disabled={authBusy}
                    >
                      <span aria-hidden="true">
                        {provider.provider === "google" ? "G" : "f"}
                      </span>
                      Continue with{" "}
                      {provider.provider === "google" ? "Google" : "Facebook"}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                className="conversation-auth-switch"
                onClick={() => {
                  setAuthMode((current) =>
                    current === "login" ? "register" : "login",
                  );
                  setLocalAuthError(undefined);
                }}
                disabled={authBusy}
              >
                {authMode === "login"
                  ? "Need an account? Create one"
                  : "Have an account? Log in"}
              </button>
              <button
                type="button"
                className="conversation-auth-switch"
                onClick={() => {
                  setAuthMode(authMode === "restore" ? "login" : "restore");
                  setLocalAuthError(undefined);
                }}
                disabled={authBusy}
              >
                {authMode === "restore" ? "Back to log in" : "Account scheduled for deletion? Restore it"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {!authUser ? (
        <section className="conversation-public-about" aria-label="About For the Baddiez">
          <button
            type="button"
            className="conversation-auth-toggle"
            onClick={() => setPublicAboutOpen((open) => !open)}
            aria-expanded={publicAboutOpen}
            aria-controls="conversation-public-about-panel"
          >
            <span className="conversation-auth-toggle-copy">
              <span className="conversation-auth-label">About</span>
              <span className="conversation-auth-title">Help and policies</span>
            </span>
            <span className="conversation-auth-toggle-meta">
              <span className="conversation-auth-chevron" aria-hidden="true">{publicAboutOpen ? "-" : "+"}</span>
            </span>
          </button>
          {publicAboutOpen ? (
            <nav id="conversation-public-about-panel" className="conversation-public-about-links" aria-label="Public information">
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Use</a>
              <a href="/delete-account">Delete account policy</a>
              <a href="/support">Support</a>
            </nav>
          ) : null}
        </section>
      ) : null}

      <button
        type="button"
        className="conversation-new-chat"
        data-testid="new-chat"
        onClick={() => {
          setAccountMenuOpen(false);
          onNewConversation();
        }}
      >
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
          data-testid="conversation-search"
        />
      </label>

      <div className="conversation-sidebar-section-title">Chats</div>
      <div className="conversation-list" aria-busy={loading}>
        {filteredConversations.length === 0 ? (
          <p className="conversation-list-empty">
            {query.trim() ? "No matching chats." : "No saved chats yet."}
          </p>
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
                    onClick={() => {
                      setAccountMenuOpen(false);
                      closeConversationActionMenu();
                      onSelectConversation(conversation.id);
                    }}
                    title={conversation.title}
                  >
                    <span className="conversation-list-title">
                      {conversation.title}
                    </span>
                    <span className="conversation-list-meta">
                      {/* {conversation.messageCount / 2} messages */}
                      {formatConversationTime(conversation.updatedAt)
                        ? ` · ${formatConversationTime(conversation.updatedAt)}`
                        : ""}
                    </span>
                  </button>
                  <div className="conversation-list-actions">
                    <button
                      type="button"
                      className={`conversation-list-more${conversationActionMenuId === conversation.id ? " conversation-list-more-open" : ""}`}
                      data-testid={`conversation-actions-${conversation.id}`}
                      onClick={() => setConversationActionMenuId((current) => current === conversation.id ? undefined : conversation.id)}
                      aria-label={`Chat actions for ${conversation.title}`}
                      aria-haspopup="menu"
                      aria-expanded={conversationActionMenuId === conversation.id}
                    >
                      <span aria-hidden="true">•••</span>
                    </button>
                    {conversationActionMenuId === conversation.id ? (
                      <div className="conversation-list-action-menu" role="menu" aria-label={`Actions for ${conversation.title}`}>
                        <button type="button" role="menuitem" onClick={() => { startRename(conversation); closeConversationActionMenu(); }}>
                          Rename
                        </button>
                        <button type="button" role="menuitem" onClick={() => { void onExportConversation(conversation.id); closeConversationActionMenu(); }}>
                          Export
                        </button>
                        <button type="button" role="menuitem" onClick={() => { onPinConversation(conversation.id, !conversation.pinned); closeConversationActionMenu(); }}>
                          {conversation.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button type="button" role="menuitem" className="conversation-list-action-menu-delete" onClick={() => { onDeleteConversation(conversation.id); closeConversationActionMenu(); }}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ))
        )}
        {hasMoreConversations && !query.trim() ? (
          <button type="button" className="conversation-list-load-more" onClick={onLoadMoreConversations} disabled={loading}>
            {loading ? "Loading..." : "Load more chats"}
          </button>
        ) : null}
      </div>

      {authUser ? (
        <div className="conversation-account-footer">
          {accountMenuOpen ? (
            <div
              className="conversation-account-menu"
              role="menu"
              aria-label="Account menu"
            >
              <div className="conversation-account-menu-label">
                Signed in as
              </div>
              <div className="conversation-account-menu-name">
                {accountName}
              </div>
              <div className="conversation-account-menu-detail">
                {accountDetail}
              </div>
              {localAuthError ? <div className="conversation-auth-error" role="alert">{localAuthError}</div> : null}
              <div className="conversation-account-menu-divider" />
              <div className="conversation-account-menu-label">Your data</div>
              {dataTransferJob ? (
                <div className="conversation-auth-copy" role="status">
                  {dataTransferJob.phase} · {dataTransferJob.progress}%
                  {dataTransferJob.totalItems > 0 ? ` (${dataTransferJob.processedItems}/${dataTransferJob.totalItems})` : ""}
                </div>
              ) : null}
              {dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status) && onCancelDataTransfer ? (
                <button type="button" className="conversation-account-menu-button" onClick={() => void onCancelDataTransfer()}>Cancel data transfer</button>
              ) : null}
              <button type="button" className="conversation-account-menu-button" role="menuitem" onClick={() => void onExportAccount()} disabled={authBusy || dataTransferActive}>Export account data</button>
              <button type="button" className="conversation-account-menu-button" role="menuitem" onClick={() => importInputRef.current?.click()} disabled={authBusy || dataTransferActive}>Import conversations</button>
              <input ref={importInputRef} data-testid="conversation-import-input" type="file" accept="application/json,application/zip,.json,.jsonl,.zip" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
              <div className="conversation-account-menu-divider" />
              <div className="conversation-account-menu-label">About</div>
              <a className="conversation-account-menu-button" role="menuitem" href="/privacy">Privacy Policy</a>
              <a className="conversation-account-menu-button" role="menuitem" href="/terms">Terms of Use</a>
              <a className="conversation-account-menu-button" role="menuitem" href="/delete-account">Delete account policy</a>
              <a className="conversation-account-menu-button" role="menuitem" href="/support">Support</a>
              <div className="conversation-account-menu-divider" />
              {deleteAccountOpen ? (
                <div className="conversation-auth-form">
                  <p className="conversation-auth-copy">You will be signed out now. All account data is permanently deleted after 30 days unless restored.</p>
                  <input data-testid="delete-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="Type DELETE" aria-label="Type DELETE to confirm" disabled={authBusy} />
                  <input data-testid="delete-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="Password (if applicable)" aria-label="Password" type="password" disabled={authBusy} />
                  {localAuthError ? <div className="conversation-auth-error" role="alert">{localAuthError}</div> : null}
                  <button data-testid="confirm-delete-account" type="button" className="conversation-account-menu-button" disabled={authBusy || deleteConfirmation !== "DELETE"} onClick={() => void submitDeleteAccount()}>
                    {authBusy ? "Scheduling..." : "Confirm account deletion"}
                  </button>
                </div>
              ) : (
                <button type="button" className="conversation-account-menu-button" role="menuitem" onClick={() => setDeleteAccountOpen(true)} disabled={authBusy}>
                  Delete account
                </button>
              )}
              <button
                type="button"
                className="conversation-account-menu-button"
                role="menuitem"
                onClick={() => {
                  void submitLogout();
                }}
                disabled={authBusy}
              >
                {authBusy ? "Logging out..." : "Log out"}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="conversation-account-button"
            data-testid="account-menu-toggle"
            onClick={() => setAccountMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
          >
            <span className="conversation-account-avatar" aria-hidden="true">
              {accountInitial}
            </span>
            <span className="conversation-account-copy">
              <span className="conversation-account-name">{accountName}</span>
              <span className="conversation-account-detail">
                {accountDetail}
              </span>
            </span>
            <span className="conversation-account-dots" aria-hidden="true">
              •••
            </span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
