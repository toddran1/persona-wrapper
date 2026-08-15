import { clampFiniteNumber, finiteNonnegativeIntegerOr, PASSWORD_MIN_LENGTH } from "@persona/shared";
import type {
  ActiveSession,
  AuthUser,
  ConnectedAccount,
  ConversationSummary,
  CurrentPoliciesResponse,
  DataTransferJob,
  OAuthProvider,
  PolicyVersions,
  PlanUsageSummary,
  OAuthProviderStatus,
  PersonaSummary,
  RevokeOtherSessionsResponse,
  UpdateUserProfileRequest,
} from "@persona/shared";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PasswordInput } from "./PasswordInput.js";

const REGISTER_PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const APPLE_LOGO_URL = "https://appleid.cdn-apple.com/appleid/button/logo?color=black&border=false&size=30&scale=3";
type SettingsSection = "account" | "influence" | "provider" | "plan" | "audio" | "security" | "memory" | "data" | "about" | "delete";

function SettingsGlyph({ section }: { section: SettingsSection }) {
  const paths: Record<SettingsSection, React.ReactNode> = {
    account: <><circle cx="12" cy="8" r="3" /><path d="M5.5 19c.8-3.2 3-5 6.5-5s5.7 1.8 6.5 5" /></>,
    influence: <><path d="M12 3 14.2 8.1 20 9l-4.2 4.1 1 5.8L12 16.2 7.2 19l1-5.8L4 9l5.8-.9L12 3Z" /></>,
    provider: <><circle cx="7" cy="12" r="3" /><circle cx="17" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><path d="m9.7 10.7 4.5-2.4M9.7 13.3l4.5 2.4" /></>,
    plan: <><path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" /><path d="m6 10.5 6 3.5 6-3.5M6 14l6 3.5 6-3.5" /></>,
    audio: <><path d="M5 10v4h3l4 4V6L8 10H5Z" /><path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" /></>,
    security: <><path d="M12 3 5.5 5.8v5.1c0 4.2 2.4 7.5 6.5 9.1 4.1-1.6 6.5-4.9 6.5-9.1V5.8L12 3Z" /><path d="m9.5 11.5 1.7 1.7 3.7-4" /></>,
    memory: <><path d="M8 5.5A3.5 3.5 0 0 1 14.3 3.4 3.8 3.8 0 0 1 19 7.1a3.7 3.7 0 0 1-.8 2.3 4 4 0 0 1-1.7 6.9A3.5 3.5 0 0 1 10 18a3.7 3.7 0 0 1-5-3.5 3.6 3.6 0 0 1 1-2.5A4 4 0 0 1 8 5.5Z" /><path d="M9 8.5c1.8.2 3 1.2 3 3v5.8M15 7.5c-1.7.4-2.8 1.4-3 3" /></>,
    data: <><path d="M12 3v12" /><path d="m8.5 7 3.5-4 3.5 4" /><path d="M5 14v5h14v-5" /></>,
    about: <><circle cx="12" cy="12" r="9" /><path d="M12 10v6" /><path d="M12 7.2h.01" /></>,
    delete: <><path d="M5 7h14" /><path d="M9 7V4h6v3" /><path d="m7.5 7 .8 13h7.4l.8-13" /><path d="M10.5 11v5M13.5 11v5" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[section]}
    </svg>
  );
}

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
  personas,
  activePersonaId,
  onSelectPersona,
  authUser,
  authLoading = false,
  authError,
  oauthReturnAction,
  oauthReturnNotice,
  oauthProviders = [],
  currentPolicies,
  conversations,
  activeConversationId,
  loading = false,
  hasMoreConversations = false,
  onLoadMoreConversations,
  onLogin,
  onRegister,
  onRestoreAccount,
  onRequestPasswordReset,
  onChangePassword,
  onUpdateProfile,
  onGetPlanUsage,
  onGetMemorySettings,
  onUpdateMemorySettings,
  onClearConversationMemory,
  onClearAllMemory,
  onListConnectedAccounts,
  onLinkConnectedAccount,
  onUnlinkConnectedAccount,
  onListActiveSessions,
  onRevokeActiveSession,
  onRevokeOtherSessions,
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
  personas: PersonaSummary[];
  activePersonaId?: string | undefined;
  onSelectPersona: (personaId: string) => void;
  authUser?: AuthUser | undefined;
  authLoading?: boolean;
  authError?: string | undefined;
  oauthReturnAction?: "link" | "sign-in" | undefined;
  oauthReturnNotice?: string | undefined;
  oauthProviders?: OAuthProviderStatus[];
  currentPolicies?: CurrentPoliciesResponse | undefined;
  conversations: ConversationSummary[];
  activeConversationId?: string | undefined;
  loading?: boolean;
  hasMoreConversations?: boolean;
  onLoadMoreConversations?: (() => void) | undefined;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onRegister: (payload: {
    email: string;
    username?: string;
    password: string;
    policyConsent: PolicyVersions;
  }) => Promise<void>;
  onRestoreAccount: (identifier: string, password: string) => Promise<void>;
  onRequestPasswordReset: (email: string) => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onUpdateProfile: (profile: UpdateUserProfileRequest) => Promise<void>;
  onGetPlanUsage: () => Promise<PlanUsageSummary>;
  onGetMemorySettings: () => Promise<boolean>;
  onUpdateMemorySettings: (enabled: boolean) => Promise<void>;
  onClearConversationMemory: (conversationId: string) => Promise<void>;
  onClearAllMemory: () => Promise<void>;
  onListConnectedAccounts: () => Promise<ConnectedAccount[]>;
  onLinkConnectedAccount: (provider: OAuthProvider) => Promise<void>;
  onUnlinkConnectedAccount: (providerId: string, accountId?: string) => Promise<void>;
  onListActiveSessions: () => Promise<ActiveSession[]>;
  onRevokeActiveSession: (sessionToken: string) => Promise<void>;
  onRevokeOtherSessions: () => Promise<RevokeOtherSessionsResponse>;
  onDeleteAccount: (payload: { confirmation: "DELETE"; password?: string }) => Promise<void>;
  onExportAccount: () => Promise<void>;
  onExportConversation: (conversationId: string) => Promise<void>;
  onImportConversations: (file: File) => Promise<void>;
  dataTransferJob?: DataTransferJob | undefined;
  onCancelDataTransfer?: (() => Promise<void>) | undefined;
  onLogout: () => Promise<void>;
  onOAuthLogin: (provider: OAuthProvider) => Promise<void>;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onPinConversation: (conversationId: string, pinned: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draftTitle, setDraftTitle] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register" | "restore" | "forgot">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirmation, setRegisterPasswordConfirmation] = useState("");
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [localAuthError, setLocalAuthError] = useState<string | undefined>();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("account");
  const [publicAboutOpen, setPublicAboutOpen] = useState(false);
  const [conversationActionMenuId, setConversationActionMenuId] = useState<string | undefined>();
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [securityNotice, setSecurityNotice] = useState<string | undefined>();
  const [username, setUsername] = useState("");
  const [usernameEditing, setUsernameEditing] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | undefined>();
  const [memoryEnabled, setMemoryEnabled] = useState(authUser?.memoryEnabled ?? true);
  const [conciseAudioResponses, setConciseAudioResponses] = useState(authUser?.conciseAudioResponses ?? true);
  const [audioNotice, setAudioNotice] = useState<string | undefined>();
  const [providerNotice, setProviderNotice] = useState<string | undefined>();
  const [influenceNotice, setInfluenceNotice] = useState<string | undefined>();
  const [memoryNotice, setMemoryNotice] = useState<string | undefined>();
  const [memoryConfirmation, setMemoryConfirmation] = useState<"chat" | "all" | undefined>();
  const [planUsage, setPlanUsage] = useState<PlanUsageSummary | undefined>();
  const [preferredName, setPreferredName] = useState("");
  const [gender, setGender] = useState<AuthUser["gender"] | "">("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const settingsDialogRef = useRef<HTMLDivElement>(null);
  const accountIdRef = useRef(authUser?.id);
  const dataTransferActive = Boolean(dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status));

  function oauthProviderLabel(provider: string): string {
    if (provider === "google") return "Google";
    if (provider === "facebook") return "Facebook";
    if (provider === "apple") return "Apple";
    return provider;
  }

  useEffect(() => {
    if (!oauthReturnAction) return;
    if (oauthReturnAction === "link" && authUser) {
      setLocalAuthError(authError);
      setSecurityNotice(oauthReturnNotice);
      setSettingsSection("security");
      setSettingsOpen(true);
      return;
    }
    if (authError) setAuthPanelOpen(true);
  }, [authError, authUser, oauthReturnAction, oauthReturnNotice]);

  async function startOAuth(provider: OAuthProvider): Promise<void> {
    if (authBusy) return;
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onOAuthLogin(provider);
      // A successful start navigates away. Keep the controls locked so a slow
      // browser cannot launch a second state/nonce transaction.
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not start social sign-in.");
      setAuthBusy(false);
    }
  }
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
        : authMode === "forgot"
          ? "We’ll email you a secure link that expires in one hour."
        : "Sign up to save your chats and settings.";
  const primaryAuthText = "Log in | Create account";
  const busyAuthText = authMode === "login" ? "Logging in..." : authMode === "restore" ? "Restoring..." : authMode === "forgot" ? "Sending..." : "Creating...";
  const accountName =
    authUser?.preferredName ?? authUser?.displayName ?? authUser?.username ?? authUser?.email ?? "Account";
  const accountDetail =
    authUser?.email ??
    (authUser?.username ? `@${authUser.username}` : "Signed in");
  const accountInitial = accountName.slice(0, 1).toUpperCase();
  const profileBirthdayIncomplete = Boolean(birthMonth) !== Boolean(birthDay);
  const profileHasChanges =
    preferredName.trim() !== (authUser?.preferredName ?? "").trim() ||
    gender !== (authUser?.gender ?? "") ||
    birthMonth !== (authUser?.birthday?.month.toString() ?? "") ||
    birthDay !== (authUser?.birthday?.day.toString() ?? "");
  const usernameHasChanges = username.trim() !== (authUser?.username ?? "");

  useEffect(() => {
    const accountChanged = accountIdRef.current !== authUser?.id;
    accountIdRef.current = authUser?.id;
    if (accountChanged) {
      // This sidebar stays mounted while authentication changes. Discard all
      // account-scoped state immediately so a slow response from the previous
      // account cannot be displayed for the next one.
      setPlanUsage(undefined);
      setConnectedAccounts([]);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordConfirmation("");
      setSecurityNotice(undefined);
      setMemoryEnabled(authUser?.memoryEnabled ?? true);
      setConciseAudioResponses(authUser?.conciseAudioResponses ?? true);
      setAudioNotice(undefined);
      setInfluenceNotice(undefined);
      setMemoryNotice(undefined);
      setMemoryConfirmation(undefined);
      setDeleteAccountOpen(false);
      setDeleteConfirmation("");
      setDeletePassword("");
      setLocalAuthError(undefined);
      setAuthBusy(false);
      setSettingsOpen(false);
      setAccountMenuOpen(false);
    }
    setConciseAudioResponses(authUser?.conciseAudioResponses ?? true);
    setUsername(authUser?.username ?? "");
    setPreferredName(authUser?.preferredName ?? "");
    setGender(authUser?.gender ?? "");
    setBirthMonth(authUser?.birthday?.month.toString() ?? "");
    setBirthDay(authUser?.birthday?.day.toString() ?? "");
  }, [authUser?.id, authUser?.username, authUser?.preferredName, authUser?.gender, authUser?.birthday?.month, authUser?.birthday?.day, authUser?.conciseAudioResponses]);

  useEffect(() => {
    if (!profileNotice) return;
    const timer = window.setTimeout(() => setProfileNotice(undefined), 2400);
    return () => window.clearTimeout(timer);
  }, [profileNotice]);

  useEffect(() => {
    if (!audioNotice) return;
    const timer = window.setTimeout(() => setAudioNotice(undefined), 2400);
    return () => window.clearTimeout(timer);
  }, [audioNotice]);

  useEffect(() => {
    if (!settingsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    settingsDialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSettings();
        return;
      }
      if (event.key !== "Tab" || !settingsDialogRef.current) return;
      const focusable = Array.from(
        settingsDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        event.preventDefault();
        settingsDialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOpen]);

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
    if (!registrationConsent || !currentPolicies) {
      setLocalAuthError("Accept the Terms of Use and Privacy Policy to create an account.");
      return;
    }
    const email = registerEmail.trim();
    const username = registerUsername.trim();
    // Sign-up requires a real email so the account can be verified; existing
    // username-only accounts can still log in.
    if (!email || !email.includes("@")) {
      setLocalAuthError("Enter an email address to create your account.");
      return;
    }
    const payload: { email: string; username?: string; password: string; policyConsent: PolicyVersions } = {
      email,
      password: registerPassword,
      policyConsent: {
        termsVersion: currentPolicies.termsVersion,
        privacyVersion: currentPolicies.privacyVersion
      }
    };
    if (username) payload.username = username;
    if (username && username.length < 3) {
      setLocalAuthError("Username must be at least 3 characters.");
      return;
    }
    if (username && !/^[a-zA-Z0-9_.]+$/.test(username)) {
      setLocalAuthError("Username can use letters, numbers, periods, and underscores only.");
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
    if (payload.password !== registerPasswordConfirmation) {
      setLocalAuthError("Passwords do not match.");
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onRegister(payload);
      setRegisterPassword("");
      setRegisterPasswordConfirmation("");
      setRegistrationConsent(false);
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

  async function submitForgotPassword(): Promise<void> {
    const email = identifier.trim();
    if (!email || !email.includes("@")) {
      setLocalAuthError("Enter the email address on your account.");
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onRequestPasswordReset(email);
      setSecurityNotice("If that email belongs to an account, a reset link is on the way.");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not request a password reset.");
    } finally {
      setAuthBusy(false);
    }
  }

  function closeSettings(): void {
    setSettingsOpen(false);
    setUsernameEditing(false);
    setLocalAuthError(undefined);
    setProfileNotice(undefined);
    setSecurityNotice(undefined);
    setProviderNotice(undefined);
    accountButtonRef.current?.focus();
  }

  async function selectSettingsSection(section: SettingsSection): Promise<void> {
    setSettingsSection(section);
    setLocalAuthError(undefined);
    setSecurityNotice(undefined);
    if (section === "plan") {
      const requestedAccountId = authUser?.id;
      setAuthBusy(true);
      try {
        const usage = await onGetPlanUsage();
        if (accountIdRef.current === requestedAccountId) setPlanUsage(usage);
      } catch (error) {
        if (accountIdRef.current === requestedAccountId) {
          setLocalAuthError(error instanceof Error ? error.message : "Could not load plan usage.");
        }
      } finally {
        if (accountIdRef.current === requestedAccountId) setAuthBusy(false);
      }
      return;
    }
    if (section === "memory") {
      const requestedAccountId = authUser?.id;
      setAuthBusy(true);
      try {
        const enabled = await onGetMemorySettings();
        if (accountIdRef.current === requestedAccountId) setMemoryEnabled(enabled);
      } catch (error) {
        if (accountIdRef.current === requestedAccountId) {
          setLocalAuthError(error instanceof Error ? error.message : "Could not load memory settings.");
        }
      } finally {
        if (accountIdRef.current === requestedAccountId) setAuthBusy(false);
      }
      return;
    }
    if (section !== "security") return;
    const requestedAccountId = authUser?.id;
    setAuthBusy(true);
    try {
      const [accounts, sessions] = await Promise.all([onListConnectedAccounts(), onListActiveSessions()]);
      if (accountIdRef.current === requestedAccountId) {
        setConnectedAccounts(accounts);
        setActiveSessions(sessions);
      }
    } catch (error) {
      if (accountIdRef.current === requestedAccountId) {
        setLocalAuthError(error instanceof Error ? error.message : "Could not load connected accounts.");
      }
    } finally {
      if (accountIdRef.current === requestedAccountId) setAuthBusy(false);
    }
  }

  async function revokeSession(session: ActiveSession): Promise<void> {
    setAuthBusy(true);
    setLocalAuthError(undefined);
    setSecurityNotice(undefined);
    try {
      await onRevokeActiveSession(session.id);
      setActiveSessions((current) => current.filter((candidate) => candidate.id !== session.id));
      setSecurityNotice("That device was signed out.");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not sign out that device.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function revokeOtherSessions(): Promise<void> {
    setAuthBusy(true);
    setLocalAuthError(undefined);
    setSecurityNotice(undefined);
    try {
      await onRevokeOtherSessions();
      setActiveSessions((current) => current.filter((session) => session.current));
      setSecurityNotice("Other devices were signed out.");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not sign out other devices.");
    } finally {
      setAuthBusy(false);
    }
  }

  function openSettings(): void {
    setAccountMenuOpen(false);
    setSettingsSection("account");
    setUsername(authUser?.username ?? "");
    setUsernameEditing(false);
    setPreferredName(authUser?.preferredName ?? "");
    setGender(authUser?.gender ?? "");
    setBirthMonth(authUser?.birthday?.month.toString() ?? "");
    setBirthDay(authUser?.birthday?.day.toString() ?? "");
    setLocalAuthError(undefined);
    setProfileNotice(undefined);
    setSecurityNotice(undefined);
    setMemoryNotice(undefined);
    setMemoryConfirmation(undefined);
    setSettingsOpen(true);
    const requestedAccountId = authUser?.id;
    void onGetPlanUsage().then((usage) => {
      if (accountIdRef.current === requestedAccountId) setPlanUsage(usage);
    }).catch(() => {
      // The dedicated Plan & usage panel exposes a retryable error if opened.
      // Account settings remain usable when usage telemetry is temporarily down.
    });
  }

  async function toggleMemory(): Promise<void> {
    const next = !memoryEnabled;
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onUpdateMemorySettings(next);
      setMemoryEnabled(next);
      setMemoryNotice(next ? "Chat memory is on." : "Chat memory is off.");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not update memory settings.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function toggleConciseAudioResponses(): Promise<void> {
    const next = !conciseAudioResponses;
    setAuthBusy(true);
    setLocalAuthError(undefined);
    setAudioNotice(undefined);
    try {
      await onUpdateProfile({ conciseAudioResponses: next });
      setConciseAudioResponses(next);
      setAudioNotice(next ? "Shorter audio responses are on." : "Full-length audio responses are on.");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not update audio settings.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function chooseModelProvider(modelProvider: "openai" | "gemini"): Promise<void> {
    if (modelProvider === (authUser?.modelProvider ?? "openai")) return;
    setAuthBusy(true);
    setLocalAuthError(undefined);
    setProviderNotice(undefined);
    try {
      await onUpdateProfile({ modelProvider });
      setProviderNotice(`${modelProvider === "gemini" ? "Gemini" : "ChatGPT"} will answer new requests.`);
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not update the model provider.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function chooseImageProvider(imageProvider: "openai" | "flux"): Promise<void> {
    if (imageProvider === (authUser?.imageProvider ?? "openai")) return;
    setAuthBusy(true);
    setLocalAuthError(undefined);
    setProviderNotice(undefined);
    try {
      await onUpdateProfile({ imageProvider });
      setProviderNotice(`${imageProvider === "flux" ? "FLUX.2 Pro" : "OpenAI Image 2"} will generate new images.`);
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not update the image provider.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function choosePersonaInfluenceLevel(personaInfluenceLevel: "uncensored" | "professional"): Promise<void> {
    if (personaInfluenceLevel === (authUser?.personaInfluenceLevel ?? "uncensored")) return;
    setAuthBusy(true);
    setLocalAuthError(undefined);
    setInfluenceNotice(undefined);
    try {
      await onUpdateProfile({ personaInfluenceLevel });
      setInfluenceNotice(personaInfluenceLevel === "professional"
        ? "Professional persona style will apply to new responses."
        : "The full uncensored persona experience will apply to new responses.");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not update the persona influence level.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function forgetMemory(scope: "chat" | "all"): Promise<void> {
    if (memoryConfirmation !== scope) {
      setMemoryConfirmation(scope);
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      if (scope === "chat") {
        if (!activeConversationId) return;
        await onClearConversationMemory(activeConversationId);
        setMemoryNotice("This chat’s saved memory was removed.");
      } else {
        await onClearAllMemory();
        setMemoryNotice("Memory was removed from all of your chats.");
      }
      setMemoryConfirmation(undefined);
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not clear memory.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitChangePassword(): Promise<void> {
    if (newPassword.length < REGISTER_PASSWORD_MIN_LENGTH) {
      setLocalAuthError(`Password must be at least ${REGISTER_PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setLocalAuthError("New passwords do not match.");
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordConfirmation("");
      setSecurityNotice("Password updated. Other devices were logged out.");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not change your password.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitProfile(): Promise<void> {
    if (authBusy || !profileHasChanges) return;
    if (profileBirthdayIncomplete) {
      setLocalAuthError("Choose both a birthday month and day, or leave both blank.");
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    setProfileNotice(undefined);
    try {
      await onUpdateProfile({
        preferredName: preferredName.trim() || null,
        gender: gender || null,
        birthday: birthMonth && birthDay
          ? { month: Number(birthMonth), day: Number(birthDay) }
          : null
      });
      setProfileNotice("Changes saved");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not update your profile.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function saveUsername(): Promise<void> {
    if (authBusy || !usernameHasChanges) return;
    const nextUsername = username.trim();
    if (!nextUsername) {
      setLocalAuthError("A username cannot be blank.");
      return;
    }
    setAuthBusy(true);
    setLocalAuthError(undefined);
    setProfileNotice(undefined);
    try {
      await onUpdateProfile({ username: nextUsername });
      setUsernameEditing(false);
      setProfileNotice("Username saved");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not update your username.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function removeBirthday(): Promise<void> {
    if (authBusy) return;
    setAuthBusy(true);
    setLocalAuthError(undefined);
    setProfileNotice(undefined);
    try {
      await onUpdateProfile({ birthday: null });
      setBirthMonth("");
      setBirthDay("");
      setProfileNotice("Birthday removed");
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not remove your birthday.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function unlinkAccount(account: ConnectedAccount): Promise<void> {
    const providerLabel = oauthProviderLabel(account.providerId);
    if (!window.confirm(`Disconnect ${providerLabel}? You will no longer be able to sign in with it.`)) return;
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onUnlinkConnectedAccount(account.providerId, account.accountId);
      setConnectedAccounts(await onListConnectedAccounts());
      setSecurityNotice(`${providerLabel} disconnected.`);
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not disconnect this account.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function linkAccount(provider: OAuthProvider): Promise<void> {
    setAuthBusy(true);
    setLocalAuthError(undefined);
    try {
      await onLinkConnectedAccount(provider);
      setConnectedAccounts(await onListConnectedAccounts());
    } catch (error) {
      setLocalAuthError(error instanceof Error ? error.message : "Could not connect this account.");
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
      setSettingsOpen(false);
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
      setSettingsOpen(false);
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
                    : authMode === "restore" ? submitRestore() : authMode === "forgot" ? submitForgotPassword() : submitRegister());
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
                    {authMode !== "forgot" ? (
                      <input
                        name="persona-login-passcode"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Password"
                        aria-label="Password"
                        data-testid="auth-password"
                        type="password"
                        autoComplete="current-password"
                        data-1p-ignore="true"
                        data-lpignore="true"
                        disabled={authBusy || authLoading}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <input
                      value={registerEmail}
                      onChange={(event) => setRegisterEmail(event.target.value)}
                      placeholder="Email (required)"
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
                      placeholder="Username (optional)"
                      aria-label="Username"
                      data-testid="auth-register-username"
                      autoComplete="username"
                      disabled={authBusy || authLoading}
                    />
                    <PasswordInput
                      value={registerPassword}
                      onChange={setRegisterPassword}
                      placeholder={`Password (${REGISTER_PASSWORD_MIN_LENGTH}+ chars)`}
                      ariaLabel="Password"
                      testId="auth-register-password"
                      autoComplete="new-password"
                      disabled={authBusy || authLoading}
                      showStrength
                    />
                    <PasswordInput
                      value={registerPasswordConfirmation}
                      onChange={setRegisterPasswordConfirmation}
                      placeholder="Confirm password"
                      ariaLabel="Confirm password"
                      testId="auth-register-password-confirmation"
                      autoComplete="new-password"
                      disabled={authBusy || authLoading}
                    />
                    <label className="conversation-registration-consent">
                      <input
                        type="checkbox"
                        checked={registrationConsent}
                        onChange={(event) => setRegistrationConsent(event.target.checked)}
                        disabled={authBusy || authLoading || !currentPolicies}
                        data-testid="auth-register-consent"
                      />
                      <span>
                        I accept the <a href="/terms" target="_blank" rel="noreferrer">Terms of Use</a> and{" "}
                        <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
                      </span>
                    </label>
                  </>
                )}
                {securityNotice && authMode === "forgot" ? <div className="conversation-auth-copy" role="status">{securityNotice}</div> : null}
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
                    disabled={authBusy || authLoading || (authMode === "register" && (!registrationConsent || !currentPolicies))}
                  >
                    {authBusy ? busyAuthText : authMode === "login" ? "Log in" : authMode === "restore" ? "Restore account" : authMode === "forgot" ? "Send reset link" : "Create account"}
                  </button>
                </div>
              </form>
              {enabledOAuthProviders.length > 0 && authMode !== "forgot" ? (
                <div className="conversation-oauth-row">
                  {enabledOAuthProviders.map((provider) => (
                    <button
                      key={provider.provider}
                      type="button"
                      className={`conversation-oauth-button${provider.provider === "apple" ? " conversation-oauth-button-apple" : ""}`}
                      data-testid={`oauth-${provider.provider}`}
                      onClick={() => void startOAuth(provider.provider)}
                      disabled={authBusy}
                    >
                      {provider.provider === "apple" ? (
                        <img alt="" aria-hidden="true" className="apple-oauth-logo" src={APPLE_LOGO_URL} />
                      ) : (
                        <span aria-hidden="true">{provider.provider === "google" ? "G" : "f"}</span>
                      )}
                      Continue with{" "}
                      {oauthProviderLabel(provider.provider)}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                className="conversation-auth-switch"
                onClick={() => {
                  setAuthMode(authMode === "forgot" ? "login" : "forgot");
                  setLocalAuthError(undefined);
                  setSecurityNotice(undefined);
                }}
                disabled={authBusy}
              >
                {authMode === "forgot" ? "Back to log in" : "Forgot password?"}
              </button>
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

      <section className="conversation-persona-picker" aria-labelledby="conversation-persona-picker-label">
        <div id="conversation-persona-picker-label" className="conversation-sidebar-section-title">Persona</div>
        <div className="conversation-persona-options" role="list">
          {personas.map((persona) => {
            const selected = persona.id === activePersonaId;
            const available = persona.available !== false;
            return (
              <div key={persona.id} role="listitem">
                <button
                  type="button"
                  className={`conversation-persona-option${selected ? " conversation-persona-option-active" : ""}${available ? "" : " conversation-persona-option-locked"}`}
                  style={{ "--persona-option-accent": persona.theme.accent, "--persona-option-accent-2": persona.theme.accent2 } as CSSProperties}
                  aria-current={selected ? "true" : undefined}
                  aria-label={available
                    ? `Use ${persona.shortName ?? persona.name}, ${persona.theme.themeName}`
                    : `${persona.shortName ?? persona.name}, requires ${persona.minimumPlan} plan`}
                  disabled={!available}
                  onClick={() => onSelectPersona(persona.id)}
                >
                  <span className="conversation-persona-avatar" aria-hidden="true">
                    {persona.avatarUrl ? <img src={persona.avatarUrl} alt="" /> : (persona.shortName ?? persona.name).slice(0, 1)}
                  </span>
                  <span className="conversation-persona-copy">
                    <span>{persona.shortName ?? persona.name}</span>
                    <small>{available ? persona.theme.themeName : `${persona.minimumPlan} plan`}</small>
                  </span>
                  <span className="conversation-persona-indicator" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

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
              <div className="conversation-account-menu-detail">
                {accountDetail}
              </div>
              <div className="conversation-account-menu-divider" />
              <button
                type="button"
                className="conversation-account-menu-button conversation-account-menu-button-planned"
                role="menuitem"
                disabled
                title="Plan upgrades are coming later"
              >
                <span>Upgrade plan</span>
                <small>Soon</small>
              </button>
              <button type="button" className="conversation-account-menu-button" role="menuitem" onClick={openSettings}>
                <span>Settings</span>
                <span aria-hidden="true">⌘,</span>
              </button>
              <div className="conversation-account-menu-divider" />
              <button
                type="button"
                className="conversation-account-menu-button conversation-account-menu-button-logout"
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
            ref={accountButtonRef}
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
      {settingsOpen && authUser
        ? createPortal(
            <div
              className="settings-modal-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeSettings();
              }}
            >
              <div
                className="settings-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-modal-title"
                ref={settingsDialogRef}
                tabIndex={-1}
              >
                <header className="settings-modal-header">
                  <div>
                    <span className="settings-modal-kicker">Your space</span>
                    <h2 id="settings-modal-title">Settings</h2>
                  </div>
                  <button
                    type="button"
                    className="settings-modal-close"
                    onClick={closeSettings}
                    aria-label="Close settings"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </header>

                <div className="settings-modal-layout">
                  <nav className="settings-modal-nav" aria-label="Settings sections">
                    {([
                      ["account", "Account"],
                      ["influence", "Persona influence"],
                      ["provider", "Provider settings"],
                      ["plan", "Plan & usage"],
                      ["audio", "Audio"],
                      ["security", "Security & sign-in"],
                      ["memory", "Memory"],
                      ["data", "Your data"],
                      ["about", "About"],
                      ["delete", "Delete account"],
                    ] as const).map(([section, label]) => (
                      <button
                        type="button"
                        key={section}
                        className={`settings-modal-nav-item${settingsSection === section ? " settings-modal-nav-item-active" : ""}${section === "delete" ? " settings-modal-nav-item-danger" : ""}`}
                        onClick={() => void selectSettingsSection(section)}
                        aria-current={settingsSection === section ? "page" : undefined}
                      >
                        <span className="settings-modal-nav-icon"><SettingsGlyph section={section} /></span>
                        <span>{label}</span>
                        <span className="settings-modal-nav-arrow" aria-hidden="true">›</span>
                      </button>
                    ))}
                  </nav>

                  <section className="settings-modal-content" aria-live="polite">
                    {localAuthError ? <div className="settings-notice settings-notice-error" role="alert">{localAuthError}</div> : null}
                    {securityNotice ? <div className="settings-notice" role="status">{securityNotice}</div> : null}

                    {settingsSection === "account" ? (
                      <div className="settings-section">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">Identity</span>
                          <h3>Account</h3>
                          <p>The details connected to your For the Baddiez profile.</p>
                        </div>
                        <div className="settings-list">
                          <div className="settings-list-row">
                            <span>Email</span>
                            <strong>{authUser.email ?? "Not added"}</strong>
                          </div>
                          <div className="settings-list-row">
                            <span>Username</span>
                            <div className="settings-identity-editor">
                              {usernameEditing ? (
                                <span className="settings-username-input-wrap">
                                  <input
                                    aria-label="Username"
                                    type="text"
                                    minLength={3}
                                    maxLength={64}
                                    autoCapitalize="none"
                                    autoComplete="username"
                                    spellCheck={false}
                                    value={username}
                                    onChange={(event) => setUsername(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") void saveUsername();
                                      if (event.key === "Escape") {
                                        setUsername(authUser.username ?? "");
                                        setUsernameEditing(false);
                                      }
                                    }}
                                    autoFocus
                                    disabled={authBusy}
                                  />
                                </span>
                              ) : (
                                <strong>{authUser.username ? authUser.username : "Not added"}</strong>
                              )}
                              <button
                                type="button"
                                className="settings-identity-edit"
                                aria-label={usernameEditing ? "Save username" : "Edit username"}
                                title={usernameEditing ? "Save username" : "Edit username"}
                                disabled={authBusy || (usernameEditing && !usernameHasChanges)}
                                onClick={() => {
                                  if (usernameEditing) {
                                    void saveUsername();
                                  } else {
                                    setLocalAuthError(undefined);
                                    setUsername(authUser.username ?? "");
                                    setUsernameEditing(true);
                                  }
                                }}
                              >
                                {usernameEditing ? (
                                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
                                ) : (
                                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" /><path d="m14.7 6.5 2.8 2.8" /></svg>
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="settings-list-row">
                            <span>Display name</span>
                            <strong>{authUser.displayName ?? accountName}</strong>
                          </div>
                          <div className="settings-list-row">
                            <span>Plan</span>
                            <strong>{planUsage?.plan.displayName ?? "Bronze"}</strong>
                          </div>
                        </div>
                        {profileNotice ? <span className="settings-save-confirmation" role="status">✓ {profileNotice}</span> : null}
                        <div className="settings-subsection">
                          <h4>Personalization</h4>
                          <p className="settings-empty-copy">Optional details the personas can use when addressing you and tailoring answers.</p>
                          <div className="settings-form-grid">
                            <label>
                              Preferred name
                              <input
                                type="text"
                                maxLength={80}
                                autoComplete="nickname"
                                value={preferredName}
                                onChange={(event) => setPreferredName(event.target.value)}
                                placeholder="What should the personas call you?"
                                disabled={authBusy}
                              />
                            </label>
                            <label>
                              Gender
                              <select value={gender ?? ""} onChange={(event) => setGender(event.target.value as AuthUser["gender"] | "")} disabled={authBusy}>
                                <option value="">Not specified</option>
                                <option value="female">Female</option>
                                <option value="male">Male</option>
                                <option value="nonbinary">Nonbinary</option>
                                <option value="other">Other</option>
                              </select>
                            </label>
                            <div className="settings-birthday-fields">
                              <label>
                                Birthday month
                                <select
                                  value={birthMonth}
                                  onChange={(event) => {
                                    const nextMonth = event.target.value;
                                    setBirthMonth(nextMonth);
                                    const maxDay = nextMonth ? new Date(Date.UTC(2000, Number(nextMonth), 0)).getUTCDate() : 31;
                                    if (birthDay && Number(birthDay) > maxDay) setBirthDay("");
                                  }}
                                  disabled={authBusy}
                                >
                                  <option value="">Month</option>
                                  {Array.from({ length: 12 }, (_, index) => (
                                    <option key={index + 1} value={index + 1}>
                                      {new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(2000, index, 1))}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Birthday day
                                <select value={birthDay} onChange={(event) => setBirthDay(event.target.value)} disabled={authBusy}>
                                  <option value="">Day</option>
                                  {Array.from(
                                    { length: birthMonth ? new Date(Date.UTC(2000, Number(birthMonth), 0)).getUTCDate() : 31 },
                                    (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>,
                                  )}
                                </select>
                              </label>
                            </div>
                            {profileBirthdayIncomplete ? (
                              <p className="settings-field-error" role="alert">Choose both a birthday month and day, or clear both fields.</p>
                            ) : null}
                            {birthMonth && birthDay ? (
                              <button type="button" className="settings-inline-action settings-birthday-remove" onClick={() => void removeBirthday()} disabled={authBusy} aria-label="Remove birthday">
                                <span aria-hidden="true">×</span> Remove birthday
                              </button>
                            ) : null}
                            <div className="settings-profile-save-row">
                              <button
                                type="button"
                                className="settings-action settings-action-primary"
                                onClick={() => void submitProfile()}
                                disabled={authBusy || profileBirthdayIncomplete || !profileHasChanges}
                                title={profileBirthdayIncomplete ? "Choose both a birthday month and day to save." : !profileHasChanges ? "Make a change to save." : undefined}
                              >
                                {authBusy ? "Saving..." : "Save changes"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {settingsSection === "influence" ? (
                      <div className="settings-section">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">Persona style</span>
                          <h3>Persona influence level</h3>
                          <p>Choose how strongly persona language shapes new responses. This does not change safety protections.</p>
                        </div>
                        {influenceNotice ? <div className="settings-notice" role="status">{influenceNotice}</div> : null}
                        <div className="settings-provider-options" role="radiogroup" aria-label="Persona influence level">
                          {([[
                            "uncensored", "Uncensored", "The full persona experience with unfiltered language and the strongest character voice."
                          ], [
                            "professional", "Professional", "Keeps the persona's style and slang while avoiding profanity and vulgar language."
                          ]] as const).map(([value, label, description]) => {
                            const selected = (authUser.personaInfluenceLevel ?? "uncensored") === value;
                            return (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                className={`settings-provider-option${selected ? " settings-provider-option-selected" : ""}`}
                                disabled={authBusy}
                                onClick={() => void choosePersonaInfluenceLevel(value)}
                                key={value}
                              >
                                <span><strong>{label}</strong><small>{description}</small></span>
                                <span className="settings-provider-radio" aria-hidden="true" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {settingsSection === "plan" ? (
                      <div className="settings-section">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">Membership</span>
                          <h3>{planUsage?.plan.displayName ?? "Plan & usage"}</h3>
                          <p>{planUsage?.plan.description ?? "Loading your current allowances..."}</p>
                        </div>
                        {planUsage ? (
                          <>
                            <div className="settings-total-usage">
                              <div className="settings-total-usage-heading">
                                <strong>Total usage</strong>
                                <span>{Math.round(clampFiniteNumber(planUsage.totalUsage.percentRemaining, 0, 100))}% left</span>
                              </div>
                              <div
                                className="settings-total-usage-track"
                                role="progressbar"
                                aria-label="Total monthly usage remaining"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(clampFiniteNumber(planUsage.totalUsage.percentRemaining, 0, 100))}
                                aria-valuetext={`${Math.round(clampFiniteNumber(planUsage.totalUsage.percentRemaining, 0, 100))}% left`}
                              >
                                <span style={{ width: `${Math.round(clampFiniteNumber(planUsage.totalUsage.percentRemaining, 0, 100))}%` }} />
                              </div>
                              <small>
                                Includes text, searches, file work, charts, images, and audio · Resets{" "}
                                {new Date(planUsage.totalUsage.periodEnd).toLocaleDateString([], {
                                  month: "long",
                                  day: "numeric",
                                  timeZone: "UTC"
                                })}
                              </small>
                            </div>
                            <div className="settings-list">
                              {planUsage.meters.map((meter) => {
                                const used = finiteNonnegativeIntegerOr(meter.used) + finiteNonnegativeIntegerOr(meter.reserved);
                                const limit = meter.limit === null ? null : finiteNonnegativeIntegerOr(meter.limit);
                                const percent = limit && limit > 0
                                  ? Math.round(clampFiniteNumber((used / limit) * 100, 0, 100))
                                  : 0;
                                const formatAmount = (value: number) => {
                                  const safeValue = finiteNonnegativeIntegerOr(value);
                                  return meter.unit === "seconds"
                                    ? safeValue === 0 ? "0 min" : safeValue < 60 ? "<1 min" : `${Math.ceil(safeValue / 60)} min`
                                    : safeValue.toLocaleString();
                                };
                                return (
                                  <div className="settings-usage-meter" key={meter.key}>
                                    <div className="settings-usage-meter-heading">
                                      <strong>{meter.label}</strong>
                                      <span>{formatAmount(used)} of {limit === null ? "unlimited" : formatAmount(limit)}</span>
                                    </div>
                                    {limit !== null ? <div className="settings-usage-track"><span style={{ width: `${percent}%` }} /></div> : null}
                                    <small>Resets {new Date(meter.periodEnd).toLocaleDateString([], { month: "long", day: "numeric", timeZone: "UTC" })}</small>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="settings-coming-soon">
                              <span>Upgrade plan</span>
                              <p>Silver and Gold subscriptions will appear here when billing launches.</p>
                              <span className="settings-coming-soon-badge">Coming soon</span>
                            </div>
                          </>
                        ) : authBusy ? <p className="settings-empty-copy">Loading usage...</p> : null}
                      </div>
                    ) : null}

                    {settingsSection === "security" ? (
                      <div className="settings-section">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">Access</span>
                          <h3>Security &amp; sign-in</h3>
                          <p>Update your password and control the accounts you use to sign in.</p>
                        </div>
                        <div className="settings-subsection">
                          <h4>Change password</h4>
                          {connectedAccounts.some((account) => account.providerId === "credential") ? (
                            <div className="settings-form-grid">
                              <label>Current password<PasswordInput ariaLabel="Current password" autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} disabled={authBusy} /></label>
                              <label>New password<PasswordInput ariaLabel="New password" autoComplete="new-password" value={newPassword} onChange={setNewPassword} disabled={authBusy} showStrength /></label>
                              <label>Confirm new password<PasswordInput ariaLabel="Confirm new password" autoComplete="new-password" value={passwordConfirmation} onChange={setPasswordConfirmation} disabled={authBusy} /></label>
                              <button type="button" className="settings-action settings-action-primary" onClick={() => void submitChangePassword()} disabled={authBusy || !currentPassword || !newPassword || !passwordConfirmation}>
                                {authBusy ? "Updating..." : "Update password"}
                              </button>
                            </div>
                          ) : authBusy ? (
                            <p className="settings-empty-copy">Loading sign-in methods...</p>
                          ) : (
                            <p className="settings-empty-copy">No password is set. Log out and use “Forgot password?” if you want to add one.</p>
                          )}
                        </div>
                        <div className="settings-subsection">
                          <h4>Connected accounts</h4>
                          <div className="settings-list">
                            {connectedAccounts.map((account) => (
                              <div className="settings-list-row settings-list-row-action" key={account.id}>
                                <span>{account.providerId === "credential" ? "Email & password" : account.providerId === "google" ? "Google" : account.providerId === "facebook" ? "Facebook" : account.providerId === "apple" ? "Apple" : account.providerId}</span>
                                {account.providerId !== "credential" ? (
                                  <button type="button" className="settings-inline-action" onClick={() => void unlinkAccount(account)} disabled={authBusy || connectedAccounts.length <= 1}>Disconnect</button>
                                ) : <strong>Connected</strong>}
                              </div>
                            ))}
                          </div>
                          <div className="settings-action-row">
                            {enabledOAuthProviders.filter((provider) => !connectedAccounts.some((account) => account.providerId === provider.provider)).map((provider) => (
                              <button key={provider.provider} type="button" className={`settings-action${provider.provider === "apple" ? " settings-action-apple" : ""}`} disabled={authBusy} onClick={() => void linkAccount(provider.provider)}>
                                {provider.provider === "apple" ? <img alt="" aria-hidden="true" className="apple-oauth-logo" src={APPLE_LOGO_URL} /> : null}
                                {provider.provider === "apple" ? "Continue with Apple" : `Connect ${oauthProviderLabel(provider.provider)}`}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="settings-subsection">
                          <h4>Signed-in devices</h4>
                          {activeSessions.length > 0 ? (
                            <>
                              <div className="settings-list">
                                {activeSessions.map((session) => (
                                  <div className="settings-list-row settings-list-row-action" key={session.id}>
                                    <span>
                                      {session.current ? "This device" : session.userAgent ?? "Unknown device"}
                                      {" · "}
                                      <small>active {new Date(session.lastActiveAt).toLocaleDateString([], { month: "short", day: "numeric" })}</small>
                                    </span>
                                    {session.current ? <strong>Current</strong> : (
                                      <button type="button" className="settings-inline-action" onClick={() => void revokeSession(session)} disabled={authBusy}>Sign out</button>
                                    )}
                                  </div>
                                ))}
                              </div>
                              {activeSessions.some((session) => !session.current) ? (
                                <div className="settings-action-row">
                                  <button type="button" className="settings-action" disabled={authBusy} onClick={() => void revokeOtherSessions()}>
                                    Sign out other devices
                                  </button>
                                </div>
                              ) : null}
                            </>
                          ) : authBusy ? <p className="settings-empty-copy">Loading devices...</p> : null}
                        </div>
                      </div>
                    ) : null}

                    {settingsSection === "audio" ? (
                      <div className="settings-section">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">Listening mode</span>
                          <h3>Audio</h3>
                          <p>Choose how long spoken persona replies can be when audio is enabled.</p>
                        </div>
                        {audioNotice ? <div className="settings-notice" role="status">{audioNotice}</div> : null}
                        <div className="settings-audio-card">
                          <div className="settings-audio-card-copy">
                            <span className="settings-recommended-badge">Recommended</span>
                            <strong>Shorter audio responses</strong>
                            <small>Keep spoken replies concise—usually around 60 seconds—while preserving the main answer.</small>
                          </div>
                          <button
                            type="button"
                            className={`settings-memory-switch${conciseAudioResponses ? " settings-memory-switch-on" : ""}`}
                            role="switch"
                            aria-label="Use shorter audio responses"
                            aria-checked={conciseAudioResponses}
                            disabled={authBusy}
                            onClick={() => void toggleConciseAudioResponses()}
                          >
                            <span />
                          </button>
                        </div>
                        {!conciseAudioResponses ? (
                          <div className="settings-audio-warning" role="note">
                            <strong>Full-length audio is on</strong>
                            <p>Longer spoken replies can use several times more audio allowance and total usage credits. A request may be unavailable when your remaining allowance is too low.</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {settingsSection === "provider" ? (
                      <div className="settings-section">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">AI model</span>
                          <h3>Provider settings</h3>
                          <p>Choose which model answers new requests. Existing chats and persona memory stay available when you switch.</p>
                        </div>
                        {providerNotice ? <div className="settings-notice" role="status">{providerNotice}</div> : null}
                        <div className="settings-provider-options" role="radiogroup" aria-label="Model provider">
                          {([[
                            "openai", "ChatGPT", "Uses the OpenAI model and the complete persona experience."
                          ], [
                            "gemini", "Gemini", "Uses Gemini for responses, search, analysis, and supported files."
                          ]] as const)
                            // Free (bronze) accounts are ChatGPT-only; the server rejects the switch too.
                            .filter(([value]) => value === "openai" || planUsage?.plan.id !== "bronze")
                            .map(([value, label, description]) => {
                            const selected = (authUser.modelProvider ?? "openai") === value;
                            return (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                className={`settings-provider-option${selected ? " settings-provider-option-selected" : ""}`}
                                disabled={authBusy}
                                onClick={() => void chooseModelProvider(value)}
                                key={value}
                              >
                                <span><strong>{label}</strong><small>{description}</small></span>
                                <span className="settings-provider-radio" aria-hidden="true" />
                              </button>
                            );
                          })}
                        </div>
                        <p className="settings-provider-note">Image generation may use the app’s specialized image service even when Gemini is selected.</p>
                        <div className="settings-subsection">
                          <h4>Image provider</h4>
                          <div className="settings-provider-options" role="radiogroup" aria-label="Image provider">
                            {([[
                              "openai", "OpenAI Image 2", "The default persona image experience. More precise and consistent. Best for detailed instructions, edits, and predictable results."
                            ], [
                              "flux", "FLUX.2 Pro", "More flexible with fewer content refusals. Great for creative freedom, but results may be less precise or more unpredictable."
                            ]] as const)
                              // FLUX.2 Pro is a Gold-plan feature; the server rejects the switch too.
                              .filter(([value]) => value === "openai" || planUsage?.plan.id === "gold")
                              .map(([value, label, description]) => {
                              const selected = (authUser.imageProvider ?? "openai") === value;
                              return (
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={selected}
                                  className={`settings-provider-option${selected ? " settings-provider-option-selected" : ""}`}
                                  disabled={authBusy}
                                  onClick={() => void chooseImageProvider(value)}
                                  key={value}
                                >
                                  <span><strong>{label}</strong><small>{description}</small></span>
                                  <span className="settings-provider-radio" aria-hidden="true" />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {settingsSection === "data" ? (
                      <div className="settings-section">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">Portability</span>
                          <h3>Your data</h3>
                          <p>Bring conversations in or download an archive of your account.</p>
                        </div>
                        {dataTransferJob ? (
                          <div className="settings-transfer-status" role="status">
                            <div>
                              <strong>{dataTransferJob.phase}</strong>
                              <span>{dataTransferJob.progress}%</span>
                            </div>
                            <div className="settings-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, dataTransferJob.progress))}%` }} /></div>
                            {dataTransferJob.totalItems > 0 ? <p>{dataTransferJob.processedItems} of {dataTransferJob.totalItems} items processed</p> : null}
                          </div>
                        ) : null}
                        <div className="settings-data-actions">
                          <button type="button" className="settings-data-card" onClick={() => void onExportAccount()} disabled={authBusy || dataTransferActive}>
                            <span className="settings-data-card-icon" aria-hidden="true">↓</span>
                            <span><strong>Export account data</strong><small>Download your chats, settings, and media archive.</small></span>
                          </button>
                          <button type="button" className="settings-data-card" onClick={() => importInputRef.current?.click()} disabled={authBusy || dataTransferActive}>
                            <span className="settings-data-card-icon" aria-hidden="true">↑</span>
                            <span><strong>Import conversations</strong><small>Bring in a supported JSON, JSONL, or ZIP archive.</small></span>
                          </button>
                          <input ref={importInputRef} data-testid="conversation-import-input" type="file" accept="application/json,application/zip,.json,.jsonl,.zip" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
                        </div>
                        {dataTransferActive && onCancelDataTransfer ? (
                          <button type="button" className="settings-action" onClick={() => void onCancelDataTransfer()}>Cancel data transfer</button>
                        ) : null}
                      </div>
                    ) : null}

                    {settingsSection === "memory" ? (
                      <div className="settings-section">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">Conversation context</span>
                          <h3>Memory</h3>
                          <p>When a chat gets long, older messages are condensed into a short summary so the persona still remembers what you talked about. This usually starts to matter after roughly 24 messages (about a dozen exchanges) in one chat — sooner if your messages are long. Memory stays inside each individual chat and is never shared between chats.</p>
                        </div>
                        {memoryNotice ? <div className="settings-notice" role="status">{memoryNotice}</div> : null}
                        <div className="settings-list">
                          <div className="settings-list-row">
                            <span><strong>Use chat memory</strong><small>When off, long chats only use recent messages. This slightly lowers usage on long chats, since no summary is added to each request.</small></span>
                            <button type="button" className={`settings-memory-switch${memoryEnabled ? " settings-memory-switch-on" : ""}`} role="switch" aria-label="Use chat memory" aria-checked={memoryEnabled} disabled={authBusy} onClick={() => void toggleMemory()}>
                              <span />
                            </button>
                          </div>
                        </div>
                        <div className="settings-data-actions">
                          <button type="button" className="settings-data-card" disabled={authBusy || !activeConversationId} onClick={() => void forgetMemory("chat")}>
                            <span><strong>{memoryConfirmation === "chat" ? "Confirm forget this chat" : "Forget this chat"}</strong><small>Remove only the memory condensed from the currently open chat.</small></span>
                          </button>
                          <button type="button" className="settings-data-card settings-memory-danger" disabled={authBusy} onClick={() => void forgetMemory("all")}>
                            <span><strong>{memoryConfirmation === "all" ? "Confirm clear all memory" : "Clear all memory"}</strong><small>Remove saved memory from every chat in your account.</small></span>
                          </button>
                        </div>
                        {memoryConfirmation ? <button type="button" className="settings-action" onClick={() => setMemoryConfirmation(undefined)}>Cancel</button> : null}
                      </div>
                    ) : null}

                    {settingsSection === "about" ? (
                      <div className="settings-section">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">The fine print</span>
                          <h3>About</h3>
                          <p>Policies, account controls, and ways to reach us.</p>
                        </div>
                        <div className="settings-link-list">
                          <a href="/privacy"><span>Privacy Policy</span><span aria-hidden="true">↗</span></a>
                          <a href="/terms"><span>Terms of Use</span><span aria-hidden="true">↗</span></a>
                          <a href="/delete-account"><span>Delete account policy</span><span aria-hidden="true">↗</span></a>
                          <a href="/support"><span>Support</span><span aria-hidden="true">↗</span></a>
                        </div>
                      </div>
                    ) : null}

                    {settingsSection === "delete" ? (
                      <div className="settings-section settings-section-danger">
                        <div className="settings-section-heading">
                          <span className="settings-section-eyebrow">Danger zone</span>
                          <h3>Delete account</h3>
                          <p>You’ll be signed out immediately. Your account and data are permanently deleted after 30 days unless you restore the account.</p>
                        </div>
                        {!deleteAccountOpen ? (
                          <button type="button" className="settings-action settings-action-danger" onClick={() => setDeleteAccountOpen(true)} disabled={authBusy}>Continue to deletion</button>
                        ) : (
                          <div className="settings-delete-confirmation">
                            <label>Confirmation<input data-testid="delete-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="Type DELETE" disabled={authBusy} /></label>
                            <label>Password <span>(if applicable)</span><input data-testid="delete-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} type="password" disabled={authBusy} /></label>
                            <div className="settings-action-row">
                              <button type="button" className="settings-action" onClick={() => setDeleteAccountOpen(false)} disabled={authBusy}>Cancel</button>
                              <button data-testid="confirm-delete-account" type="button" className="settings-action settings-action-danger" disabled={authBusy || deleteConfirmation !== "DELETE"} onClick={() => void submitDeleteAccount()}>
                                {authBusy ? "Scheduling..." : "Confirm account deletion"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </section>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
