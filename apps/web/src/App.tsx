import { NEUTRAL_PERSONA_ID } from "@persona/shared";
import type { AuthUser, ChatJobResponse, ChatResponse, ClientContext, ContentBlock, ConversationSummary, ConversationTurn, CurrentPoliciesResponse, DataTransferJob, ForTheBaddiezArchive, OAuthProvider, OAuthProviderStatus, PersonaDefinition, PersonaSummary, PolicyVersions, ProviderId, ToolOptions, UploadedAsset } from "@persona/shared";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./lib/api.js";
import { queryClient } from "./lib/queryClient.js";
import { conversationsPageQueryOptions, conversationTurnsQueryOptions, personaQueryOptions, personasQueryOptions } from "./lib/chatQueries.js";
import { ChatComposer } from "./components/ChatComposer.js";
import { ConversationSidebar } from "./components/ConversationSidebar.js";
import { PolicyConsentGate } from "./components/PolicyConsentGate.js";
import { VerifyEmailGate } from "./components/VerifyEmailGate.js";
import { ConversationHistory, type RenderedTurn, type UserPromptAsset } from "./components/ConversationHistory.js";
import { DebugPanel } from "./components/DebugPanel.js";
import { EvalCapturePanel } from "./components/EvalCapturePanel.js";
import { GoldenPairReviewPage } from "./components/GoldenPairReviewPage.js";
import { NeutralResponsePanel } from "./components/NeutralResponsePanel.js";
import { PersonaHeader } from "./components/PersonaHeader.js";
import { PersonaVisualStage, type PersonaVisualState } from "./components/PersonaVisualStage.js";

const NON_AUDIO_SPEAKING_MS = 8000;

function oauthProviderLabel(provider: string | null): string {
  if (provider === "google") return "Google";
  if (provider === "facebook") return "Facebook";
  if (provider === "apple") return "Apple";
  return "Social";
}

function oauthReturnFromLocation(): { action: "link" | "sign-in"; message: string; status: "error" | "success" } | undefined {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const provider = params.get("oauthProvider");
  const succeeded = params.get("oauthSuccess") === "1";
  if ((!error && !succeeded) || !provider) return undefined;
  const label = oauthProviderLabel(provider);
  const action = params.get("oauthAction") === "link" ? "link" : "sign-in";
  if (succeeded) {
    return { action, status: "success", message: `${label} connected.` };
  }
  const cancelled = error === "access_denied" || error === "user_cancelled_authorize";
  return {
    action,
    status: "error",
    message: cancelled
      ? `${label} ${action === "link" ? "connection" : "sign-in"} was cancelled.`
      : `${label} ${action === "link" ? "could not be connected" : "sign-in could not be completed"}. Please try again.`
  };
}

function hasCurrentPolicyConsent(user: AuthUser | undefined, policies: CurrentPoliciesResponse | undefined): boolean {
  return Boolean(
    user
    && policies
    && user.termsVersionAccepted === policies.termsVersion
    && user.privacyVersionAccepted === policies.privacyVersion
  );
}

function isImageOnlyResponse(outputs: ContentBlock[]): boolean {
  const hasImage = outputs.some((output) => output.type === "image");
  if (!hasImage) return false;

  return outputs.every((output) => {
    if (output.type === "image") return true;
    if (output.type === "status") return true;
    if (output.type === "tool_call" || output.type === "tool_result") return true;
    if (output.type === "text") return output.text.trim().length === 0;
    return false;
  });
}

function sortConversationSummaries(left: ConversationSummary, right: ConversationSummary): number {
  const pinnedDelta = Number(right.pinned) - Number(left.pinned);
  if (pinnedDelta !== 0) return pinnedDelta;
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function renderTurnsFromConversationTurns(turns: ConversationTurn[]): RenderedTurn[] {
  return turns.map((turn) => ({
    ...(turn.userMessageId ? { userMessageId: turn.userMessageId } : {}),
    ...(turn.assistantMessageId ? { assistantMessageId: turn.assistantMessageId } : {}),
    ...(turn.personaId ? { personaId: turn.personaId } : {}),
    userMessage: turn.userMessage,
    userAssets: turn.userAssets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      ...(asset.url ? { url: asset.url } : {})
    })),
    assistantText: turn.assistantText,
    outputs: turn.outputs,
    ...(turn.usage ? { usage: turn.usage } : {}),
    ...(turn.backgroundJobId ? { backgroundJobId: turn.backgroundJobId } : {})
  }));
}

function turnSyncKey(turn: RenderedTurn): string | undefined {
  return turn.assistantMessageId ?? turn.userMessageId ?? turn.backgroundJobId;
}

// Merges a freshly fetched latest page of turns over local state: fresh turns
// replace their local copies, while older paginated turns and unsynced local
// turns are kept. Used for cross-session sync on window focus. A locally
// pending background turn is also replaced once the server's completed copy
// of the same job arrives (its sync key changes from job id to message ids).
function mergeCrossSessionTurns(current: RenderedTurn[], fresh: RenderedTurn[]): RenderedTurn[] {
  const freshKeys = new Set(fresh.map(turnSyncKey).filter((key) => key !== undefined));
  const freshJobIds = new Set(fresh.map((turn) => turn.backgroundJobId).filter((id) => id !== undefined));
  return [...current.filter((turn) => {
    if (turn.backgroundJobId && freshJobIds.has(turn.backgroundJobId)) return false;
    const key = turnSyncKey(turn);
    return key === undefined || !freshKeys.has(key);
  }), ...fresh];
}

function getClientContext(): ClientContext {
  const now = new Date();

  return {
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    currentDateTime: now.toISOString(),
    utcOffsetMinutes: -now.getTimezoneOffset()
  };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Request cancelled."));
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      window.clearTimeout(timeout);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Request cancelled."));
    };
    const timeout = window.setTimeout(finish, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function downloadExport(content: BlobPart, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function archiveToMarkdown(archive: ForTheBaddiezArchive): string {
  return archive.conversations.map((conversation) => [
    `# ${conversation.title}`,
    "",
    ...conversation.messages.map((message) => `## ${message.role === "assistant" ? "Assistant" : message.role === "user" ? "You" : message.role}\n\n${message.content}`)
  ].join("\n\n")).join("\n\n---\n\n");
}

function isTransientApiBootError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("could not reach api") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed")
  );
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options?: {
    attempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  }
): Promise<T> {
  const attempts = options?.attempts ?? 12;
  const shouldRetry = options?.shouldRetry ?? (() => false);
  let delayMs = options?.initialDelayMs ?? 250;
  const maxDelayMs = options?.maxDelayMs ?? 1500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) {
        throw error;
      }
      await wait(delayMs);
      delayMs = Math.min(maxDelayMs, Math.round(delayMs * 1.6));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Retry operation failed.");
}

function formatCheckTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function stillRunningStatusMessage(job: Pick<ChatJobResponse, "updatedAt">, checked: boolean): string {
  if (!checked) {
    return "Still working on this request. You can check again without sending the prompt twice.";
  }

  return `Still working on this request. Last checked at ${formatCheckTimestamp(job.updatedAt)}.`;
}

class BackgroundPollingTimeoutError extends Error {
  constructor(readonly job: ChatJobResponse) {
    super("The request is still running in the background.");
    this.name = "BackgroundPollingTimeoutError";
  }
}

class BackgroundJobStateError extends Error {
  constructor(readonly job: ChatJobResponse) {
    super(job.error ?? "Background request failed.");
    this.name = "BackgroundJobStateError";
  }
}

const WEB_SELECTED_CONVERSATION_KEY = "for-the-baddiez:selected-conversation";
const WEB_SELECTED_PERSONA_KEY = "for-the-baddiez:selected-persona";
const WEB_PENDING_BACKGROUND_JOB_KEY = "for-the-baddiez:pending-background-job";

type StoredBackgroundJob = {
  jobId: string;
  conversationId: string;
  personaId?: string;
  userMessage: string;
  userAssets: UserPromptAsset[];
};

function storedConversationId(): string | undefined {
  try {
    const value = window.sessionStorage.getItem(WEB_SELECTED_CONVERSATION_KEY)?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function storedPersonaId(): string | undefined {
  try {
    return window.localStorage.getItem(WEB_SELECTED_PERSONA_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function storedBackgroundJob(): StoredBackgroundJob | undefined {
  try {
    const raw = window.sessionStorage.getItem(WEB_PENDING_BACKGROUND_JOB_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredBackgroundJob>;
    if (
      typeof parsed.jobId !== "string" ||
      typeof parsed.conversationId !== "string" ||
      typeof parsed.userMessage !== "string" ||
      !Array.isArray(parsed.userAssets)
    ) return undefined;
    return {
      jobId: parsed.jobId,
      conversationId: parsed.conversationId,
      ...(typeof parsed.personaId === "string" ? { personaId: parsed.personaId } : {}),
      userMessage: parsed.userMessage,
      userAssets: parsed.userAssets
    };
  } catch {
    return undefined;
  }
}

function saveBackgroundJob(job: StoredBackgroundJob): void {
  try {
    window.sessionStorage.setItem(WEB_PENDING_BACKGROUND_JOB_KEY, JSON.stringify(job));
  } catch {
    // The in-memory turn remains recoverable when session storage is unavailable.
  }
}

function clearStoredBackgroundJob(jobId?: string): void {
  try {
    const current = storedBackgroundJob();
    if (jobId && current?.jobId !== jobId) return;
    window.sessionStorage.removeItem(WEB_PENDING_BACKGROUND_JOB_KEY);
  } catch {
    // Session storage can be unavailable in hardened browser modes.
  }
}

export function App({ reviewPage = false }: { reviewPage?: boolean }) {
  const testModeEnabled = import.meta.env.VITE_TEST_MODE === "true";
  const reviewPageEnabled = testModeEnabled && reviewPage;
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | undefined>(() => storedPersonaId());
  const [personaDetail, setPersonaDetail] = useState<PersonaDefinition | undefined>();
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [personaCardVisible, setPersonaCardVisible] = useState(true);
  const [response, setResponse] = useState<ChatResponse | undefined>();
  const [latestRequest, setLatestRequest] = useState<Record<string, unknown> | undefined>();
  const [renderedTurns, setRenderedTurns] = useState<RenderedTurn[]>([]);
  const renderedTurnsRef = useRef<RenderedTurn[]>([]);
  const [autoPlayAudioTurnIndex, setAutoPlayAudioTurnIndex] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [personaAudioPlaying, setPersonaAudioPlaying] = useState(false);
  const [nonAudioVisualState, setNonAudioVisualState] = useState<PersonaVisualState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>(() => storedConversationId());
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [conversationListCursor, setConversationListCursor] = useState<string | null>(null);
  const [turnsCursor, setTurnsCursor] = useState<string | null>(null);
  const [loadingEarlierTurns, setLoadingEarlierTurns] = useState(false);
  const [conversationListLoading, setConversationListLoading] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | undefined>();
  const [authLoading, setAuthLoading] = useState(true);
  const [oauthReturn] = useState(oauthReturnFromLocation);
  const [authError, setAuthError] = useState<string | undefined>(oauthReturn?.status === "error" ? oauthReturn.message : undefined);
  const [dataTransferJob, setDataTransferJob] = useState<DataTransferJob | undefined>();
  const [oauthProviders, setOAuthProviders] = useState<OAuthProviderStatus[]>([]);
  // Landing state after the better-auth verify-email link redirects home.
  const [emailVerificationNotice, setEmailVerificationNotice] = useState<"verified" | "invalid" | undefined>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("emailVerified") === "1") return "verified";
    if (params.get("error") === "INVALID_TOKEN") return "invalid";
    return undefined;
  });

  useEffect(() => {
    if (!emailVerificationNotice) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("emailVerified");
    url.searchParams.delete("error");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [emailVerificationNotice]);

  useEffect(() => {
    if (!oauthReturn) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    url.searchParams.delete("oauthProvider");
    url.searchParams.delete("oauthAction");
    url.searchParams.delete("oauthSuccess");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [oauthReturn]);

  useEffect(() => {
    if (authUser?.modelProvider) setProvider(authUser.modelProvider);
  }, [authUser?.id, authUser?.modelProvider]);
  const [currentPolicies, setCurrentPolicies] = useState<CurrentPoliciesResponse>();
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState<string>();
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalSavedMessage, setEvalSavedMessage] = useState<string | undefined>();
  const [evalError, setEvalError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>();
  const [pendingPersonaId, setPendingPersonaId] = useState<string | undefined>();
  const [pendingPromptAssets, setPendingPromptAssets] = useState<UserPromptAsset[]>([]);
  const [pendingPromptFiles, setPendingPromptFiles] = useState<File[]>([]);
  const [composerDraft, setComposerDraft] = useState<string | undefined>();
  const [composerDraftAttachments, setComposerDraftAttachments] = useState<File[] | undefined>();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activeRequestRef = useRef<AbortController | undefined>(undefined);
  const activeBackgroundJobIdRef = useRef<string | undefined>(undefined);
  const activeRequestPersonaIdRef = useRef<string | undefined>(undefined);
  const selectedPersonaIdRef = useRef<string | undefined>(selectedPersonaId);
  const personaSelectionGenerationRef = useRef(0);
  const dataTransferAbortRef = useRef<AbortController | undefined>(undefined);
  const selectionGenerationRef = useRef(0);
  const conversationListRefreshGenerationRef = useRef(0);
  const conversationListErrorRef = useRef<string | undefined>(undefined);
  const completedTurnCountRef = useRef(0);
  const lastCompletedTurnWasImageOnlyRef = useRef(false);
  const suppressAudioVisualForCurrentTurnRef = useRef(false);
  const suppressPersonaVisualTransitionsRef = useRef(false);
  const nonAudioVisualTimeoutRef = useRef<number | undefined>(undefined);
  const loadCurrentPolicies = useCallback(async (): Promise<void> => {
    setPolicyLoading(true);
    setPolicyError(undefined);
    try {
      setCurrentPolicies(await api.getCurrentPolicies());
    } catch (loadError) {
      setPolicyError(loadError instanceof Error ? loadError.message : "Could not load the current policies.");
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCurrentPolicies();
  }, [loadCurrentPolicies]);

  const personasResource = useQuery({
    ...personasQueryOptions(authUser?.id),
    retry: (failureCount, queryError) => failureCount < 12 && isTransientApiBootError(queryError)
  });
  const primaryPersonaId = personasResource.data?.some((persona) => persona.id === selectedPersonaId && persona.available !== false)
    ? selectedPersonaId
    : personasResource.data?.find((persona) => persona.available !== false)?.id;
  const personaResource = useQuery({
    ...personaQueryOptions(primaryPersonaId ?? "", authUser?.id),
    // Anonymous visitors can render the public persona summary. The detailed
    // profile remains behind the entitlement-aware authenticated endpoint.
    enabled: Boolean(primaryPersonaId && authUser),
    retry: (failureCount, queryError) => failureCount < 12 && isTransientApiBootError(queryError)
  });
  const conversationsResource = useQuery({
    ...conversationsPageQueryOptions(undefined, undefined, authUser?.id),
    enabled: hasCurrentPolicyConsent(authUser, currentPolicies),
    staleTime: 15_000
  });

  useEffect(() => {
    selectedPersonaIdRef.current = selectedPersonaId;
  }, [selectedPersonaId]);
  const deleteConversationMutation = useMutation({
    mutationFn: api.deleteConversation,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["conversations", authUser?.id] })
  });
  const renameConversationMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.renameConversation(id, title),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["conversations", authUser?.id] })
  });
  const pinConversationMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.pinConversation(id, pinned),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["conversations", authUser?.id] })
  });

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1180px)");
    const closeMobileSidebar = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setMobileSidebarOpen(false);
    };
    desktopQuery.addEventListener("change", closeMobileSidebar);
    return () => desktopQuery.removeEventListener("change", closeMobileSidebar);
  }, []);

  useEffect(() => {
    try {
      if (conversationId) {
        window.sessionStorage.setItem(WEB_SELECTED_CONVERSATION_KEY, conversationId);
      } else {
        window.sessionStorage.removeItem(WEB_SELECTED_CONVERSATION_KEY);
      }
    } catch {
      // Session storage can be unavailable in hardened browser modes.
    }
  }, [conversationId]);

  useEffect(() => {
    if (!authUser || authLoading || !conversationId) return;

    let cancelled = false;
    const reconcile = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      const pendingJob = storedBackgroundJob();
      if (!pendingJob || pendingJob.conversationId !== conversationId || cancelled) return;

      setRenderedTurns((current) => current.some((turn) => turn.backgroundJobId === pendingJob.jobId)
        ? current
        : [
            ...current,
            {
              ...(pendingJob.personaId ? { personaId: pendingJob.personaId } : {}),
              userMessage: pendingJob.userMessage,
              userAssets: pendingJob.userAssets,
              assistantText: "",
              backgroundJobId: pendingJob.jobId,
              outputs: buildThinkingOutputs()
            }
          ]
      );
      activeBackgroundJobIdRef.current = pendingJob.jobId;

      try {
        const job = await api.getChatJob(pendingJob.jobId);
        if (cancelled) return;
        if (job.status === "completed" && job.response) {
          activeRequestRef.current?.abort();
          activeRequestPersonaIdRef.current = undefined;
          replaceBackgroundTurnWithResult(job.id, job.response);
          clearStoredBackgroundJob(job.id);
          activeBackgroundJobIdRef.current = undefined;
          setLoading(false);
          void refreshConversationList(job.response.conversationId);
          return;
        }
        if (job.status === "failed" || job.status === "cancelled") {
          activeRequestRef.current?.abort();
          activeRequestPersonaIdRef.current = undefined;
          const reason = job.failureReason ?? (job.status === "cancelled" ? "manual_cancel" : "provider_failure");
          markCurrentTurnSilent();
          replaceBackgroundTurnWithError(job, reason);
          clearStoredBackgroundJob(job.id);
          activeBackgroundJobIdRef.current = undefined;
          setLoading(false);
          return;
        }
        setBackgroundTurnThinking(job.id);
        if (!activeRequestRef.current) void resumeBackgroundJob(job.id);
      } catch (reconcileError) {
        if (!cancelled) {
          setError(reconcileError instanceof Error ? reconcileError.message : "Could not check the background request.");
        }
      }
    };

    const onVisibilityChange = () => {
      void reconcile();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void reconcile();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authLoading, authUser?.id, conversationId, renderedTurns.length]);

  useEffect(() => {
    renderedTurnsRef.current = renderedTurns;
  }, [renderedTurns]);

  // Cross-session sync: when this tab regains focus, refresh the open
  // conversation so messages sent from another session appear. The sidebar
  // list is already covered by react-query's refetchOnWindowFocus.
  useEffect(() => {
    if (!authUser || !conversationId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshOpenConversationTurns();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [authUser, conversationId]);

  function clearNonAudioVisualTimer(): void {
    if (nonAudioVisualTimeoutRef.current === undefined) return;
    window.clearTimeout(nonAudioVisualTimeoutRef.current);
    nonAudioVisualTimeoutRef.current = undefined;
  }

  function markCurrentTurnSilent(): void {
    suppressAudioVisualForCurrentTurnRef.current = true;
    lastCompletedTurnWasImageOnlyRef.current = true;
    clearNonAudioVisualTimer();
    setPersonaAudioPlaying(false);
    setNonAudioVisualState("idle");
  }

  function holdPersonaVisualIdleForCurrentMutation(): void {
    suppressPersonaVisualTransitionsRef.current = true;
    markCurrentTurnSilent();
  }

  function releasePersonaVisualSuppressionSoon(): void {
    window.setTimeout(() => {
      suppressPersonaVisualTransitionsRef.current = false;
      suppressAudioVisualForCurrentTurnRef.current = false;
      lastCompletedTurnWasImageOnlyRef.current = false;
    }, 0);
  }

  function mapUploadedAssetsToUserPromptAssets(attachments: UploadedAsset[]): UserPromptAsset[] {
    return attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      ...(attachment.url ? { url: attachment.url } : {})
    }));
  }

  function reusableUploadedAssets(assets: UserPromptAsset[]): UploadedAsset[] {
    return assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: 0,
      ...(asset.url ? { url: asset.url } : {})
    }));
  }

  function mapFilesToPendingPromptAssets(files: File[]): UserPromptAsset[] {
    return files.map((file, index) => {
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      return {
        id: `pending-${index}-${file.name}-${file.size}`,
        kind: file.type.startsWith("image/") ? "image" : "file",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        ...(previewUrl ? { url: previewUrl } : {})
      };
    });
  }

  function releasePendingPromptAssets(assets: UserPromptAsset[]): void {
    for (const asset of assets) {
      if (asset.url?.startsWith("blob:")) {
        URL.revokeObjectURL(asset.url);
      }
    }
  }

  useEffect(() => {
    if (personasResource.data) {
      setPersonas(personasResource.data);
      setSelectedPersonaId((current) => {
        if (current && personasResource.data.some((persona) => persona.id === current && persona.available !== false)) return current;
        return personasResource.data.find((persona) => persona.available !== false)?.id;
      });
    }
  }, [personasResource.data]);

  useEffect(() => {
    if (personaResource.data?.id === primaryPersonaId) setPersonaDetail(personaResource.data);
    if (personaResource.error) setError(personaResource.error.message);
  }, [personaResource.data, personaResource.error, primaryPersonaId]);

  useEffect(() => {
    try {
      if (selectedPersonaId) {
        window.localStorage.setItem(WEB_SELECTED_PERSONA_KEY, selectedPersonaId);
      } else if (personasResource.isSuccess) {
        window.localStorage.removeItem(WEB_SELECTED_PERSONA_KEY);
      }
    } catch {
      // Local storage can be unavailable in hardened browser modes.
    }
  }, [personasResource.isSuccess, selectedPersonaId]);

  useEffect(() => {
    if (!conversationsResource.data) return;
    const page = conversationsResource.data;
    if (conversationList.length === 0) {
      setConversationList(page.conversations);
      setConversationListCursor(page.nextCursor);
      return;
    }
    // Merge the refetched first page into the loaded list: refresh existing
    // entries and insert new ones, but keep later pages and the cursor so
    // "Load more chats" progress survives a window-focus refetch.
    setConversationList((current) => {
      if (current.length === 0) return page.conversations;
      const merged = current.map((conversation) => page.conversations.find((item) => item.id === conversation.id) ?? conversation);
      const newConversations = page.conversations.filter((item) => !current.some((existing) => existing.id === item.id));
      return [...merged, ...newConversations].sort(sortConversationSummaries);
    });
  }, [conversationsResource.data, conversationList.length]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setAuthLoading(true);
      let authenticated = false;
      let authenticatedUserId: string | undefined;

      try {
        const providers = await retryWithBackoff(
          () => api.getOAuthProviders(),
          { shouldRetry: isTransientApiBootError }
        );
        if (!cancelled) setOAuthProviders(providers);
      } catch (providerError) {
        console.warn("Failed to load OAuth providers", providerError);
      }

      try {
        const [me, policies] = await Promise.all([
          api.getCurrentUser(),
          api.getCurrentPolicies()
        ]);
        authenticated = true;
        authenticatedUserId = me.user.id;
        if (!cancelled) {
          setAuthUser(me.user);
          setCurrentPolicies(policies);
          setAuthError(oauthReturn?.status === "error" ? oauthReturn.message : undefined);
        }
        if (!hasCurrentPolicyConsent(me.user, policies)) authenticated = false;
      } catch {
        if (!cancelled) {
          setAuthUser(undefined);
          clearAccountConversationState();
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
          const selectedConversationId = authenticated ? storedConversationId() : undefined;
          if (!selectedConversationId) setConversationId(undefined);
          if (authenticated) {
            void (async () => {
              await refreshConversationList(selectedConversationId, true, authenticatedUserId);
              if (selectedConversationId) await loadConversation(selectedConversationId, authenticatedUserId);
            })();
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const selectedDetail = personaDetail?.id === selectedPersonaId ? personaDetail : undefined;
    const nextTitle = selectedDetail
      ? selectedDetail.documentTitle
      : personas.find((persona) => persona.id === selectedPersonaId)?.documentTitle;
    document.title = nextTitle ? `${nextTitle} | For the Baddiez` : "For the Baddiez";
  }, [personaDetail, personas, selectedPersonaId]);

  async function selectPersona(personaId: string): Promise<void> {
    const selectedSummary = personas.find((candidate) => candidate.id === personaId);
    if (selectedSummary?.available === false) {
      setError(`${selectedSummary.name} is not included in your current plan.`);
      setMobileSidebarOpen(false);
      return;
    }
    if (personaId === selectedPersonaId) {
      setMobileSidebarOpen(false);
      return;
    }
    const requestInFlight = Boolean(activeRequestRef.current);
    const selectionGeneration = ++personaSelectionGenerationRef.current;
    if (!requestInFlight) setLoading(true);
    setError(undefined);
    try {
      if (!authUser) throw new Error("Sign in before switching personas.");
      const detail = await queryClient.fetchQuery(personaQueryOptions(personaId, authUser.id));
      if (selectionGeneration !== personaSelectionGenerationRef.current) return;
      selectedPersonaIdRef.current = detail.id;
      setSelectedPersonaId(detail.id);
      setPersonaDetail(detail);
      setProvider((current) => detail.supportedProviders.includes(current)
        ? current
        : detail.supportedProviders[0] ?? "openai");
      setMobileSidebarOpen(false);
    } catch (selectError) {
      if (selectionGeneration !== personaSelectionGenerationRef.current) return;
      setError(selectError instanceof Error ? selectError.message : "Could not switch persona.");
    } finally {
      if (!requestInFlight && selectionGeneration === personaSelectionGenerationRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!audioEnabled) {
      setPersonaAudioPlaying(false);
    }
  }, [audioEnabled]);

  useEffect(() => () => clearNonAudioVisualTimer(), []);

  useEffect(() => {
    clearNonAudioVisualTimer();

    if (suppressPersonaVisualTransitionsRef.current) {
      completedTurnCountRef.current = renderedTurns.length;
      setNonAudioVisualState("idle");
      return;
    }

    if (audioEnabled) {
      completedTurnCountRef.current = renderedTurns.length;
      setNonAudioVisualState("idle");
      return;
    }

    if (loading) {
      if (
        activeRequestPersonaIdRef.current
        && activeRequestPersonaIdRef.current !== selectedPersonaId
      ) {
        completedTurnCountRef.current = renderedTurns.length;
        setNonAudioVisualState("idle");
        return;
      }
      if (suppressAudioVisualForCurrentTurnRef.current) {
        setNonAudioVisualState("idle");
        return;
      }
      lastCompletedTurnWasImageOnlyRef.current = false;
      setNonAudioVisualState("thinking");
      return;
    }

    if (renderedTurns.length > completedTurnCountRef.current) {
      completedTurnCountRef.current = renderedTurns.length;
      const completedPersonaId = renderedTurns.at(-1)?.personaId;
      if (completedPersonaId && completedPersonaId !== selectedPersonaId) {
        setNonAudioVisualState("idle");
        return;
      }
      if (lastCompletedTurnWasImageOnlyRef.current || suppressAudioVisualForCurrentTurnRef.current) {
        lastCompletedTurnWasImageOnlyRef.current = false;
        suppressAudioVisualForCurrentTurnRef.current = false;
        setNonAudioVisualState("idle");
        return;
      }
      setNonAudioVisualState("speaking");
      nonAudioVisualTimeoutRef.current = window.setTimeout(() => {
        setNonAudioVisualState("idle");
        nonAudioVisualTimeoutRef.current = undefined;
      }, NON_AUDIO_SPEAKING_MS);
      return;
    }

    completedTurnCountRef.current = renderedTurns.length;
    if (pendingPrompt === undefined) {
      setNonAudioVisualState("idle");
    }
  }, [audioEnabled, loading, pendingPrompt, renderedTurns.length]);

  async function handleSubmit(
    message: string,
    files: File[],
    toolOptions: ToolOptions,
    reusableAttachments: UploadedAsset[] = [],
    retryAssistantMessageId?: string,
    personaIdOverride?: string
  ): Promise<void> {
    if (!personaDetail || !authUser || activeRequestRef.current) {
      return;
    }

    const submittedPersonaId = personaIdOverride ?? personaDetail.id;
    setLoading(true);
    setPersonaAudioPlaying(false);
    suppressAudioVisualForCurrentTurnRef.current = false;
    setError(undefined);
    setPendingPrompt(message);
    setPendingPersonaId(submittedPersonaId);
    setComposerDraft(undefined);
    setComposerDraftAttachments(undefined);
    const localPendingAssets = mapFilesToPendingPromptAssets(files);
    const pendingAssets = [
      ...mapUploadedAssetsToUserPromptAssets(reusableAttachments),
      ...localPendingAssets
    ];
    setPendingPromptAssets(pendingAssets);
    setPendingPromptFiles(files);
    const requestController = new AbortController();
    const submittedProvider = provider;
    const submittedAudioEnabled = audioEnabled;
    const submittedConversationId = conversationId;
    activeRequestRef.current = requestController;
    activeRequestPersonaIdRef.current = submittedPersonaId;
    let keepBackgroundJob = false;
    let backgroundJobId: string | undefined;
    let uploadedAttachments: UploadedAsset[] = [];
    let createdVectorStoreId: string | undefined;
    let chatRequestStarted = false;

    try {
      uploadedAttachments = files.length > 0 ? await api.uploadFiles(files, requestController.signal) : [];
      const attachments = [...reusableAttachments, ...uploadedAttachments];
      let resolvedToolOptions = toolOptions;
      if (toolOptions.fileSearch && attachments.some((attachment) => attachment.kind === "file")) {
        const vectorStore = await api.createVectorStore(
          attachments.filter((attachment) => attachment.kind === "file").map((attachment) => attachment.id),
          undefined,
          requestController.signal
        );
        createdVectorStoreId = vectorStore.id;
        resolvedToolOptions = { ...toolOptions, vectorStoreIds: [vectorStore.id] };
      }
      const payload = {
        personaId: submittedPersonaId,
        message,
        provider: submittedProvider,
        audio: submittedAudioEnabled,
        testMode: testModeEnabled,
        clientContext: getClientContext(),
        attachments,
        toolOptions: resolvedToolOptions,
        ...(retryAssistantMessageId ? { retryAssistantMessageId } : {}),
        ...(submittedConversationId ? { conversationId: submittedConversationId } : {})
      };
      setLatestRequest(payload);
      chatRequestStarted = true;
      const result = await api.sendChat(payload, requestController.signal);
      const backgroundJob = result.diagnostics.backgroundJob;
      activeBackgroundJobIdRef.current = backgroundJob?.id;
      if (backgroundJob) {
        backgroundJobId = backgroundJob.id;
        keepBackgroundJob = true;
        const userAssets = mapUploadedAssetsToUserPromptAssets(attachments);
        appendChatStillRunning(message, {
          id: backgroundJob.id,
          status: backgroundJob.status,
          updatedAt: new Date().toISOString()
        }, userAssets, files, false);
        saveBackgroundJob({
          jobId: backgroundJob.id,
          conversationId: result.conversationId,
          personaId: submittedPersonaId,
          userMessage: message,
          userAssets
        });
        setConversationId(result.conversationId);
        setPendingPrompt(undefined);
        setPendingPersonaId(undefined);
        setPendingPromptAssets([]);
        setPendingPromptFiles([]);
        releasePendingPromptAssets(localPendingAssets);
      }
      const finalResult = backgroundJob
        ? await pollChatJob(backgroundJob.id, requestController.signal)
        : result;

      if (backgroundJob) {
        replaceBackgroundTurnWithResult(backgroundJob.id, finalResult);
        clearStoredBackgroundJob(backgroundJob.id);
      } else {
        appendChatResult(message, finalResult, attachments, files, retryAssistantMessageId);
      }
      void refreshConversationList(finalResult.conversationId);
      activeBackgroundJobIdRef.current = undefined;
      setPendingPrompt(undefined);
      setPendingPersonaId(undefined);
      setPendingPromptAssets([]);
      setPendingPromptFiles([]);
      releasePendingPromptAssets(localPendingAssets);
      setEvalSavedMessage(undefined);
      setEvalError(undefined);
    } catch (submitError) {
      if (!chatRequestStarted) {
        await Promise.allSettled([
          ...uploadedAttachments.map((attachment) => api.deleteUpload(attachment.id)),
          ...(createdVectorStoreId ? [api.deleteVectorStore(createdVectorStoreId)] : [])
        ]);
      }
      const messageText = submitError instanceof Error ? submitError.message : "Failed to generate response";
      setPendingPrompt(undefined);
      setPendingPersonaId(undefined);
      setPendingPromptAssets([]);
      setPendingPromptFiles([]);
      if (submitError instanceof BackgroundPollingTimeoutError) {
        keepBackgroundJob = true;
        setError(undefined);
        if (!backgroundJobId) {
          appendChatStillRunning(message, submitError.job, pendingAssets, files);
          saveBackgroundJob({
            jobId: submitError.job.id,
            conversationId: conversationId ?? "",
            personaId: submittedPersonaId,
            userMessage: message,
            userAssets: pendingAssets
          });
        } else {
          refreshBackgroundTurnStatus(submitError.job);
        }
        setEvalSavedMessage(undefined);
        setEvalError(undefined);
        return;
      }
      if (submitError instanceof BackgroundJobStateError) {
        const jobReason = submitError.job.failureReason ?? (submitError.job.status === "cancelled" ? "manual_cancel" : "provider_failure");
        setError(messageText);
        if (backgroundJobId) {
          replaceBackgroundTurnWithError(submitError.job, jobReason);
          clearStoredBackgroundJob(submitError.job.id);
          activeBackgroundJobIdRef.current = undefined;
        } else {
          appendChatJobError(message, submitError.job, jobReason, pendingAssets, files);
        }
        return;
      }
      if (!requestController.signal.aborted) {
        if (backgroundJobId) {
          keepBackgroundJob = true;
          setError("The browser lost contact with the background request. Return to this tab or use Check status to reconnect.");
        } else {
          setError(messageText);
          appendChatError(message, messageText, pendingAssets, files);
        }
      }
    } finally {
      const isCurrentRequest = activeRequestRef.current === requestController;
      if (isCurrentRequest) activeRequestRef.current = undefined;
      if (isCurrentRequest) activeRequestPersonaIdRef.current = undefined;
      if (!keepBackgroundJob && !requestController.signal.aborted) activeBackgroundJobIdRef.current = undefined;
      if (requestController.signal.aborted) releasePendingPromptAssets(localPendingAssets);
      if (isCurrentRequest) setLoading(false);
    }
  }

  function retryAssistantTurn(turn: RenderedTurn): void {
    retryAssistantTurnWithPersona(turn);
  }

  function retryAssistantTurnWithoutPersona(turn: RenderedTurn): void {
    retryAssistantTurnWithPersona(turn, NEUTRAL_PERSONA_ID);
  }

  function retryAssistantTurnWithPersona(turn: RenderedTurn, personaIdOverride?: string): void {
    const files = turn.userFiles ?? [];
    const reusableAttachments = files.length === 0
      ? reusableUploadedAssets(turn.userAssets ?? [])
      : [];
    if (!turn.userMessage.trim() && files.length === 0 && reusableAttachments.length === 0) {
      setError("This response cannot be retried because its original message and attachments are unavailable.");
      return;
    }
    if (!turn.assistantMessageId) {
      setError("This response cannot be retried because its saved message is unavailable.");
      return;
    }
    void handleSubmit(turn.userMessage, files, {
      webSearch: false,
      fileSearch: false,
      codeInterpreter: false,
      imageGeneration: false,
      videoAnalysis: false,
      appFunctions: true,
      background: false,
      vectorStoreIds: []
    }, reusableAttachments, turn.assistantMessageId, personaIdOverride);
  }

  function appendChatResult(
    message: string,
    result: ChatResponse,
    attachments: UploadedAsset[] = [],
    userFiles: File[] = [],
    retryAssistantMessageId?: string
  ): void {
    const assistantTextBlock = result.outputs.find((output) => output.type === "text");
    const assistantText = assistantTextBlock?.type === "text" ? assistantTextBlock.text : "";
    const userAssets = mapUploadedAssetsToUserPromptAssets(attachments);
    const imageOnlyResponse = isImageOnlyResponse(result.outputs);
    lastCompletedTurnWasImageOnlyRef.current = imageOnlyResponse;
    suppressAudioVisualForCurrentTurnRef.current = imageOnlyResponse;

    setConversationId(result.conversationId);
    setResponse(result);
    const autoPlayIndex = retryAssistantMessageId
      ? renderedTurnsRef.current.findIndex((turn) => turn.assistantMessageId === retryAssistantMessageId)
      : renderedTurnsRef.current.length;
    setAutoPlayAudioTurnIndex(autoPlayIndex >= 0 ? autoPlayIndex : undefined);
    setRenderedTurns((current) => {
      const completedTurn: RenderedTurn = {
          ...(result.userMessageId ? { userMessageId: result.userMessageId } : {}),
          ...(result.assistantMessageId ? { assistantMessageId: result.assistantMessageId } : {}),
          personaId: result.persona.id,
          userMessage: message,
          userAssets,
          userFiles,
          assistantText,
          outputs: result.outputs,
          usage: result.usage
        };
      return retryAssistantMessageId
        ? current.map((turn) => turn.assistantMessageId === retryAssistantMessageId ? completedTurn : turn)
        : [...current, completedTurn];
    });
  }

  function replaceBackgroundTurnWithResult(jobId: string, result: ChatResponse): void {
    const assistantTextBlock = result.outputs.find((output) => output.type === "text");
    const assistantText = assistantTextBlock?.type === "text" ? assistantTextBlock.text : "";
    const imageOnlyResponse = isImageOnlyResponse(result.outputs);
    // The durable job result is authoritative over a transient foreground
    // reconnect error that may have been recorded before polling recovered.
    setError(undefined);
    lastCompletedTurnWasImageOnlyRef.current = imageOnlyResponse;
    suppressAudioVisualForCurrentTurnRef.current = imageOnlyResponse;
    setConversationId(result.conversationId);
    setResponse(result);
    const backgroundTurnIndex = renderedTurnsRef.current.findIndex((turn) => turn.backgroundJobId === jobId);
    setAutoPlayAudioTurnIndex(backgroundTurnIndex >= 0 ? backgroundTurnIndex : undefined);
    setRenderedTurns((current) => current.map((turn) => (
      turn.backgroundJobId === jobId ? (() => {
        const { backgroundJobId: _backgroundJobId, ...completedTurn } = turn;
        return {
            ...completedTurn,
            ...(result.userMessageId ? { userMessageId: result.userMessageId } : {}),
            ...(result.assistantMessageId ? { assistantMessageId: result.assistantMessageId } : {}),
            personaId: result.persona.id,
            assistantText,
            outputs: result.outputs,
            ...(result.usage ? { usage: result.usage } : {})
          };
        })() : turn
    )));
  }

  function replaceBackgroundTurnWithError(job: ChatJobResponse, reason: string): void {
    const assistantText = reason === "manual_cancel" ? "Request cancelled." : "Background request failed.";
    setRenderedTurns((current) => current.map((turn) => (
      turn.backgroundJobId === job.id ? (() => {
          const { backgroundJobId: _backgroundJobId, ...failedTurn } = turn;
          return {
            ...failedTurn,
            assistantText,
            outputs: buildJobErrorOutputs(job, reason)
          };
        })() : turn
    )));
    setAutoPlayAudioTurnIndex(undefined);
  }

  function refreshBackgroundTurnStatus(job: ChatJobResponse): void {
    setRenderedTurns((current) => current.map((turn) => (
      turn.backgroundJobId === job.id
        ? { ...turn, outputs: buildStillRunningOutputs(job) }
        : turn
    )));
  }

  function setBackgroundTurnThinking(jobId: string): void {
    setRenderedTurns((current) => current.map((turn) => (
      turn.backgroundJobId === jobId
        ? { ...turn, assistantText: "", outputs: buildThinkingOutputs() }
        : turn
    )));
  }

  async function refreshConversationList(preferConversationId?: string, retryOnStartup = false, accountId = authUser?.id): Promise<void> {
    const refreshGeneration = ++conversationListRefreshGenerationRef.current;
    setConversationListLoading(true);
    try {
      const page = accountId === authUser?.id
        ? (await conversationsResource.refetch()).data
        : await queryClient.fetchQuery({ ...conversationsPageQueryOptions(undefined, undefined, accountId), staleTime: 0 });
      if (!page || refreshGeneration !== conversationListRefreshGenerationRef.current) return;
      setConversationList(page.conversations);
      setConversationListCursor(page.nextCursor);
      const previousListError = conversationListErrorRef.current;
      conversationListErrorRef.current = undefined;
      if (previousListError) {
        setError((current) => current === previousListError ? undefined : current);
      }
      if (preferConversationId) {
        setConversationId(preferConversationId);
      }
    } catch (listError) {
      if (refreshGeneration !== conversationListRefreshGenerationRef.current) return;
      console.warn("Failed to load conversation list", listError);
      const message = retryOnStartup
        ? "Signed in, but your chat history could not be loaded. Try refreshing the page."
        : "Your latest chat was saved, but the conversation list could not be refreshed.";
      conversationListErrorRef.current = message;
      setError(message);
    } finally {
      if (refreshGeneration === conversationListRefreshGenerationRef.current) {
        setConversationListLoading(false);
      }
    }
  }

  function clearAccountConversationState(): void {
    conversationListRefreshGenerationRef.current += 1;
    conversationListErrorRef.current = undefined;
    dataTransferAbortRef.current?.abort();
    dataTransferAbortRef.current = undefined;
    queryClient.removeQueries({ queryKey: ["conversations"] });
    queryClient.removeQueries({ queryKey: ["conversation-turns"] });
    setConversationList([]);
    setConversationListCursor(null);
    setConversationListLoading(false);
    setDataTransferJob(undefined);
  }

  async function loadConversation(nextConversationId: string, accountId = authUser?.id): Promise<void> {
    abandonActiveRequest();
    const selectionGeneration = ++selectionGenerationRef.current;
    holdPersonaVisualIdleForCurrentMutation();
    setLoadingEarlierTurns(false);
    setLoading(true);
    setError(undefined);
    setPendingPrompt(undefined);
    setPendingPersonaId(undefined);
    setPendingPromptAssets([]);
    setPendingPromptFiles([]);
    setPersonaAudioPlaying(false);
    setAutoPlayAudioTurnIndex(undefined);
    try {
      const page = await queryClient.fetchQuery(conversationTurnsQueryOptions(nextConversationId, undefined, accountId));
      if (selectionGeneration !== selectionGenerationRef.current) return;
      const nextTurns = renderTurnsFromConversationTurns(page.turns);
      setConversationId(page.conversation.id);
      setTurnsCursor(page.nextCursor);
      completedTurnCountRef.current = nextTurns.length;
      setRenderedTurns(nextTurns);
      setResponse(undefined);
      setLatestRequest(undefined);
      setEvalSavedMessage(undefined);
      setEvalError(undefined);
    } catch (loadError) {
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load conversation");
    } finally {
      if (selectionGeneration === selectionGenerationRef.current) {
        setLoading(false);
        releasePersonaVisualSuppressionSoon();
      }
    }
  }

  async function loadEarlierTurns(): Promise<void> {
    if (!conversationId || !turnsCursor || loadingEarlierTurns) return;
    const selectionGeneration = selectionGenerationRef.current;
    setLoadingEarlierTurns(true);
    try {
      const page = await queryClient.fetchQuery(conversationTurnsQueryOptions(conversationId, turnsCursor, authUser?.id));
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setRenderedTurns((current) => [...renderTurnsFromConversationTurns(page.turns), ...current]);
      setTurnsCursor(page.nextCursor);
      completedTurnCountRef.current += page.turns.length;
    } catch (loadError) {
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load earlier messages");
    } finally {
      if (selectionGeneration === selectionGenerationRef.current) {
        setLoadingEarlierTurns(false);
      }
    }
  }

  // Cross-session sync: refetch the open conversation's latest page and merge
  // it over local state so messages sent from another session appear on
  // window focus. Skips while a request is in flight so streaming state is
  // never clobbered, and stays silent on failure.
  async function refreshOpenConversationTurns(): Promise<void> {
    if (!conversationId || !authUser || activeRequestRef.current) return;
    const selectionGeneration = selectionGenerationRef.current;
    try {
      const page = await queryClient.fetchQuery(conversationTurnsQueryOptions(conversationId, undefined, authUser.id));
      if (selectionGeneration !== selectionGenerationRef.current || activeRequestRef.current) return;
      const merged = mergeCrossSessionTurns(renderedTurnsRef.current, renderTurnsFromConversationTurns(page.turns));
      completedTurnCountRef.current = merged.length;
      setRenderedTurns(merged);
      setTurnsCursor(page.nextCursor);
    } catch {
      // Background sync is silent by design.
    }
  }

  async function loadMoreConversations(): Promise<void> {
    if (!conversationListCursor || conversationListLoading) return;
    const refreshGeneration = ++conversationListRefreshGenerationRef.current;
    setConversationListLoading(true);
    try {
      const page = await queryClient.fetchQuery(conversationsPageQueryOptions(conversationListCursor, undefined, authUser?.id));
      if (refreshGeneration !== conversationListRefreshGenerationRef.current) return;
      setConversationList((current) => [...current, ...page.conversations.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setConversationListCursor(page.nextCursor);
    } catch (loadError) {
      if (refreshGeneration !== conversationListRefreshGenerationRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load more conversations");
    } finally {
      if (refreshGeneration === conversationListRefreshGenerationRef.current) {
        setConversationListLoading(false);
      }
    }
  }

  async function deleteConversationFromHistory(nextConversationId: string): Promise<void> {
    try {
      await deleteConversationMutation.mutateAsync(nextConversationId);
      setConversationList((current) => current.filter((conversation) => conversation.id !== nextConversationId));
      if (conversationId === nextConversationId) {
        resetConversation();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete conversation");
    }
  }

  async function renameConversationFromHistory(nextConversationId: string, title: string): Promise<void> {
    try {
      const renamed = await renameConversationMutation.mutateAsync({ id: nextConversationId, title });
      setConversationList((current) => current.map((conversation) => (
        conversation.id === renamed.id ? renamed : conversation
      )).sort(sortConversationSummaries));
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename conversation");
    }
  }

  async function pinConversationFromHistory(nextConversationId: string, pinned: boolean): Promise<void> {
    try {
      const updated = await pinConversationMutation.mutateAsync({ id: nextConversationId, pinned });
      setConversationList((current) => current.map((conversation) => (
        conversation.id === updated.id ? updated : conversation
      )).sort(sortConversationSummaries));
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : "Failed to update pinned chat");
    }
  }

  function appendChatError(message: string, errorMessage: string, userAssets: UserPromptAsset[] = [], userFiles: File[] = []): void {
    markCurrentTurnSilent();
    setAutoPlayAudioTurnIndex(undefined);
    setRenderedTurns((current) => [
      ...current,
      {
        ...(personaDetail?.id ? { personaId: personaDetail.id } : {}),
        userMessage: message,
        userAssets,
        userFiles,
        assistantText: `Request failed: ${errorMessage}`,
        outputs: [
          {
            type: "text",
            text: `Request failed: ${errorMessage}`
          },
          {
            type: "status",
            status: "failed",
            message: errorMessage
          }
        ]
      }
    ]);
  }

  function appendChatStillRunning(
    message: string,
    job: ChatJobResponse,
    userAssets: UserPromptAsset[] = [],
    userFiles: File[] = [],
    showRecoveryStatus = true
  ): void {
    markCurrentTurnSilent();
    setAutoPlayAudioTurnIndex(undefined);
    setRenderedTurns((current) => [
      ...current,
      {
        ...(personaDetail?.id ? { personaId: personaDetail.id } : {}),
        userMessage: message,
        userAssets,
        userFiles,
        assistantText: showRecoveryStatus ? "This is still running in the background." : "",
        backgroundJobId: job.id,
        outputs: showRecoveryStatus
          ? buildStillRunningOutputs(job)
          : buildThinkingOutputs()
      }
    ]);
  }

  function appendChatJobError(message: string, job: ChatJobResponse, reason: string, userAssets: UserPromptAsset[] = [], userFiles: File[] = []): void {
    markCurrentTurnSilent();
    setAutoPlayAudioTurnIndex(undefined);
    const label = reason === "manual_cancel"
      ? "Request cancelled."
      : reason === "openai_background_timeout"
        ? "OpenAI background processing timed out."
        : "Provider request failed.";
    setRenderedTurns((current) => [
      ...current,
      {
        ...(personaDetail?.id ? { personaId: personaDetail.id } : {}),
        userMessage: message,
        userAssets,
        userFiles,
        assistantText: label,
        backgroundJobId: job.id,
        outputs: [
          {
            type: "status",
            status: reason === "manual_cancel" ? "cancelled" : "failed",
            message: job.error ?? label
          },
          ...(testModeEnabled ? [{
            type: "json" as const,
            data: {
              reason,
              jobId: job.id,
              providerResponseId: job.providerResponseId,
              providerStatus: job.providerStatus,
              updatedAt: job.updatedAt
            }
          }] : [])
        ]
      }
    ]);
  }

  async function pollChatJob(jobId: string, signal: AbortSignal): Promise<ChatResponse> {
    const startedAt = Date.now();
    const maxPollMs = Number(import.meta.env.VITE_BACKGROUND_POLL_TIMEOUT_MS ?? 12 * 60 * 1000);
    let intervalMs = 1200;
    let latestJob: ChatJobResponse | undefined;

    while (Date.now() - startedAt < maxPollMs) {
      signal.throwIfAborted();
      const job = await api.getChatJob(jobId, signal);
      latestJob = job;
      if (job.status === "completed" && job.response) {
        return job.response;
      }
      if (job.status === "failed") {
        throw new BackgroundJobStateError(job);
      }
      if (job.status === "cancelled") {
        throw new BackgroundJobStateError(job);
      }
      await wait(intervalMs, signal);
      intervalMs = Math.min(5000, Math.round(intervalMs * 1.35));
    }

    throw new BackgroundPollingTimeoutError(latestJob ?? await api.getChatJob(jobId, signal));
  }

  async function resumeBackgroundJob(jobId: string): Promise<void> {
    const requestController = new AbortController();
    const requestPersonaId = renderedTurns.find((turn) => turn.backgroundJobId === jobId)?.personaId;
    activeRequestRef.current = requestController;
    activeBackgroundJobIdRef.current = jobId;
    activeRequestPersonaIdRef.current = requestPersonaId;
    setLoading(true);
    setPersonaAudioPlaying(false);
    setError(undefined);
    try {
      const finalResult = await pollChatJob(jobId, requestController.signal);
      replaceBackgroundTurnWithResult(jobId, finalResult);
      clearStoredBackgroundJob(jobId);
      void refreshConversationList(finalResult.conversationId);
      activeBackgroundJobIdRef.current = undefined;
    } catch (resumeError) {
      if (resumeError instanceof BackgroundPollingTimeoutError) {
        markCurrentTurnSilent();
        setRenderedTurns((current) => current.map((turn) => (
          turn.backgroundJobId === jobId
            ? {
                ...turn,
                outputs: buildStillRunningOutputs(resumeError.job)
              }
            : turn
        )));
        setAutoPlayAudioTurnIndex(undefined);
        return;
      }
      if (resumeError instanceof BackgroundJobStateError) {
        markCurrentTurnSilent();
        const reason = resumeError.job.failureReason ?? (resumeError.job.status === "cancelled" ? "manual_cancel" : "provider_failure");
        replaceBackgroundTurnWithError(resumeError.job, reason);
        clearStoredBackgroundJob(jobId);
        return;
      }
      const messageText = resumeError instanceof Error ? resumeError.message : "Failed to resume background request";
      markCurrentTurnSilent();
      setError(messageText);
    } finally {
      if (activeRequestRef.current === requestController) {
        activeRequestRef.current = undefined;
        activeRequestPersonaIdRef.current = undefined;
      }
      if (!requestController.signal.aborted) activeBackgroundJobIdRef.current = undefined;
      setLoading(false);
    }
  }

  function buildStillRunningOutputs(job: ChatJobResponse): ContentBlock[] {
    return [
      {
        type: "status",
        status: "in_progress",
        message: stillRunningStatusMessage(job, true)
      },
      ...(testModeEnabled ? [{
        type: "json" as const,
        data: {
          reason: "frontend_poll_timeout",
          jobId: job.id,
          providerResponseId: job.providerResponseId,
          providerStatus: job.providerStatus,
          updatedAt: job.updatedAt
        }
      }] : []),
      {
        type: "action",
        id: `resume-${job.id}`,
        label: "Check status",
        action: "resume_background_job",
        arguments: { jobId: job.id },
        style: "primary"
      }
    ];
  }

  function buildThinkingOutputs(): ContentBlock[] {
    return [{ type: "status", status: "in_progress", message: "Thinking" }];
  }

  function buildJobErrorOutputs(job: ChatJobResponse, reason: string): ContentBlock[] {
    const message = reason === "manual_cancel"
      ? "Request cancelled."
      : reason === "openai_background_timeout"
        ? "OpenAI background processing timed out."
        : "Provider request failed.";
    return [
      {
        type: "status",
        status: reason === "manual_cancel" ? "cancelled" : "failed",
        message: job.error ?? message
      },
      ...(testModeEnabled ? [{
        type: "json" as const,
        data: {
          reason,
          jobId: job.id,
          providerResponseId: job.providerResponseId,
          providerStatus: job.providerStatus,
          updatedAt: job.updatedAt
        }
      }] : [])
    ];
  }

  function cancelRequest(): void {
    markCurrentTurnSilent();
    setAutoPlayAudioTurnIndex(undefined);
    const backgroundJobId = activeBackgroundJobIdRef.current;
    const cancelledPrompt = pendingPrompt;
    const cancelledAssets = pendingPromptAssets;
    const cancelledFiles = pendingPromptFiles;
    if (backgroundJobId) {
      setRenderedTurns((current) => current.map((turn) => (
        turn.backgroundJobId === backgroundJobId
          ? {
              ...turn,
              assistantText: "Confirming cancellation.",
              outputs: [{
                type: "status",
                status: "in_progress",
                message: "Confirming cancellation with the server."
              }]
            }
          : turn
      )));
      void api.cancelChatJob(backgroundJobId)
        .then((job) => {
          if (job.status === "completed" && job.response) {
            replaceBackgroundTurnWithResult(backgroundJobId, job.response);
          } else if (job.status === "failed" || job.status === "cancelled") {
            replaceBackgroundTurnWithError(job, job.status === "cancelled" ? "manual_cancel" : (job.failureReason ?? "provider_failure"));
          } else {
            refreshBackgroundTurnStatus(job);
            setError("The server has not confirmed cancellation yet. Use Check status to reconcile this request.");
            return;
          }
          clearStoredBackgroundJob(backgroundJobId);
          void refreshConversationList(job.response?.conversationId);
        })
        .catch((cancelError) => {
          const message = cancelError instanceof Error ? cancelError.message : "Server cancellation could not be confirmed.";
          setError(`The request stopped in this browser, but server cancellation could not be confirmed. ${message}`);
          setRenderedTurns((current) => current.map((turn) => (
            turn.backgroundJobId === backgroundJobId
              ? {
                  ...turn,
                  assistantText: "Cancellation could not be confirmed.",
                  outputs: [{
                    type: "status",
                    status: "in_progress",
                    message: "Cancellation could not be confirmed. Use Check status to reconcile this request."
                  }]
                }
              : turn
          )));
        });
    }
    activeRequestRef.current?.abort();
    activeRequestRef.current = undefined;
    activeBackgroundJobIdRef.current = undefined;
    setLoading(false);
    setPersonaAudioPlaying(false);
    setPendingPrompt(undefined);
    setPendingPersonaId(undefined);
    setPendingPromptAssets([]);
    setPendingPromptFiles([]);
    const appendCancelledTurn = cancelledPrompt !== undefined
      && (cancelledPrompt.trim().length > 0 || cancelledAssets.length > 0);
    const cancelledTurnAssets = cancelledAssets.map((asset) => (
      asset.url?.startsWith("blob:")
        ? {
            id: asset.id,
            kind: asset.kind,
            fileName: asset.fileName,
            mimeType: asset.mimeType
          }
        : asset
    ));
    releasePendingPromptAssets(cancelledAssets);
    if (appendCancelledTurn) {
      setRenderedTurns((current) => [
        ...current,
        {
          ...(personaDetail?.id ? { personaId: personaDetail.id } : {}),
          userMessage: cancelledPrompt,
          userAssets: cancelledTurnAssets,
          userFiles: cancelledFiles,
          assistantText: "Request cancelled.",
          outputs: [
            {
              type: "status",
              status: "cancelled",
              message: "Request cancelled by user."
            }
          ]
        }
      ]);
    }
  }

  function abandonActiveRequest(): void {
    activeRequestRef.current?.abort();
    activeRequestRef.current = undefined;
    activeBackgroundJobIdRef.current = undefined;
    activeRequestPersonaIdRef.current = undefined;
    setLoading(false);
    setPendingPrompt(undefined);
    setPendingPersonaId(undefined);
    setPendingPromptAssets([]);
    setPendingPromptFiles([]);
  }

  function resetConversation(): void {
    abandonActiveRequest();
    selectionGenerationRef.current += 1;
    setLoadingEarlierTurns(false);
    personaSelectionGenerationRef.current += 1;
    setConversationId(undefined);
    setResponse(undefined);
    setLatestRequest(undefined);
    setRenderedTurns([]);
    setTurnsCursor(null);
    setError(undefined);
    setEvalSavedMessage(undefined);
    setEvalError(undefined);
    setPendingPrompt(undefined);
    setPendingPersonaId(undefined);
    setPendingPromptAssets([]);
    setPendingPromptFiles([]);
    setComposerDraft(undefined);
    setComposerDraftAttachments(undefined);
    setPersonaAudioPlaying(false);
    setAutoPlayAudioTurnIndex(undefined);
  }

  async function handleLogin(identifier: string, password: string): Promise<void> {
    setAuthLoading(true);
    setAuthError(undefined);
    try {
      const auth = await api.login({ identifier, password, clientType: "web" });
      setAuthUser(auth.user);
      resetConversation();
      if (hasCurrentPolicyConsent(auth.user, currentPolicies)) {
        await refreshConversationList(undefined, true, auth.user.id);
      }
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Login failed.";
      setAuthError(message);
      throw loginError;
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleRegister(payload: { email: string; username?: string; password: string; policyConsent: PolicyVersions }): Promise<void> {
    setAuthLoading(true);
    setAuthError(undefined);
    try {
      const auth = await api.register({ ...payload, clientType: "web" });
      setAuthUser(auth.user);
      resetConversation();
      await refreshConversationList(undefined, true, auth.user.id);
    } catch (registerError) {
      const message = registerError instanceof Error ? registerError.message : "Registration failed.";
      setAuthError(message);
      throw registerError;
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleRestoreAccount(identifier: string, password: string): Promise<void> {
    setAuthLoading(true);
    setAuthError(undefined);
    try {
      const auth = await api.restoreAccount({ identifier, password, clientType: "web" });
      setAuthUser(auth.user);
      resetConversation();
      if (hasCurrentPolicyConsent(auth.user, currentPolicies)) {
        await refreshConversationList(undefined, true, auth.user.id);
      }
    } catch (restoreError) {
      setAuthError(restoreError instanceof Error ? restoreError.message : "Account restoration failed.");
      throw restoreError;
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleDeleteAccount(payload: { confirmation: "DELETE"; password?: string }): Promise<void> {
    setAuthLoading(true);
    setAuthError(undefined);
    try {
      const result = await api.deleteAccount(payload);
      setAuthUser(undefined);
      resetConversation();
      clearAccountConversationState();
      setAuthError(`Account deletion is scheduled for ${new Date(result.deletionScheduledFor).toLocaleDateString()}. Restore it before then to keep your data.`);
    } catch (deleteError) {
      setAuthError(deleteError instanceof Error ? deleteError.message : "Could not schedule account deletion.");
      throw deleteError;
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleExportAccount(): Promise<void> {
    setError(undefined);
    const controller = new AbortController();
    try {
      if (dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status)) throw new Error("Another data transfer is already running.");
      dataTransferAbortRef.current = controller;
      const started = await api.startDataExportJob("account", undefined, controller.signal);
      setDataTransferJob(started);
      const completed = await api.waitForDataTransferJob(started.id, setDataTransferJob, controller.signal);
      const blob = await api.downloadDataTransferArchive(completed);
      downloadExport(blob, completed.fileName ?? `for-the-baddiez-account-${new Date().toISOString().slice(0, 10)}.zip`, "application/zip");
    } catch (exportError) {
      if (!(exportError instanceof Error && exportError.name === "AbortError")) {
        setError(exportError instanceof Error ? exportError.message : "Could not export your account data.");
      }
    } finally {
      if (dataTransferAbortRef.current === controller) dataTransferAbortRef.current = undefined;
    }
  }

  async function handleExportConversation(conversationId: string): Promise<void> {
    setError(undefined);
    try {
      const archive = await api.exportConversations([conversationId]);
      const date = new Date().toISOString().slice(0, 10);
      downloadExport(JSON.stringify(archive, null, 2), `for-the-baddiez-conversation-${date}.json`, "application/json");
      downloadExport(archiveToMarkdown(archive), `for-the-baddiez-conversation-${date}.md`, "text/markdown");
      downloadExport(archiveToMarkdown(archive), `for-the-baddiez-conversation-${date}.txt`, "text/plain");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export this conversation.");
    }
  }

  async function handleImportConversations(file: File): Promise<void> {
    if (dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status)) throw new Error("Another data transfer is already running.");
    const controller = new AbortController();
    dataTransferAbortRef.current = controller;
    try {
      const started = await api.startDataImportJob(file, controller.signal);
      setDataTransferJob(started);
      const completed = await api.waitForDataTransferJob(started.id, setDataTransferJob, controller.signal);
      await refreshConversationList(undefined, true);
      const result = completed.result;
      setAuthError(result ? `Imported ${result.importedConversations} conversation${result.importedConversations === 1 ? "" : "s"} from ${result.source}; skipped ${result.skippedConversations} duplicate or unsupported conversation${result.skippedConversations === 1 ? "" : "s"}.` : "Import complete.");
    } catch (importError) {
      if (!(importError instanceof Error && importError.name === "AbortError")) throw importError;
    } finally {
      if (dataTransferAbortRef.current === controller) dataTransferAbortRef.current = undefined;
    }
  }

  async function handleCancelDataTransfer(): Promise<void> {
    if (!dataTransferJob) return;
    setDataTransferJob(await api.cancelDataTransferJob(dataTransferJob.id));
    dataTransferAbortRef.current?.abort();
    dataTransferAbortRef.current = undefined;
  }

  async function handleLogout(): Promise<void> {
    setAuthLoading(true);
    setAuthError(undefined);
    try {
      if (dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status)) {
        await api.cancelDataTransferJob(dataTransferJob.id).catch(() => undefined);
      }
      await api.logout();
    } finally {
      setAuthUser(undefined);
      resetConversation();
      clearAccountConversationState();
      setAuthLoading(false);
    }
  }

  async function handleOAuthLogin(providerName: OAuthProvider): Promise<void> {
    setAuthError(undefined);
    await api.oauthLogin(providerName);
  }

  async function saveEvalCapture(idealStyledText: string, notes: string, tags: string[]): Promise<void> {
    if (!response?.conversationId) {
      return;
    }

    setEvalSaving(true);
    setEvalSavedMessage(undefined);
    setEvalError(undefined);

    try {
      const result = await api.saveStyleTransferEval({
        conversationId: response.conversationId,
        idealStyledText,
        notes,
        tags: ["ui-review", ...tags]
      });
      setEvalSavedMessage(`Saved ${result.id}`);
    } catch (saveError) {
      setEvalError(saveError instanceof Error ? saveError.message : "Failed to save eval example");
    } finally {
      setEvalSaving(false);
    }
  }

  const activePersona = personaDetail?.id === selectedPersonaId
    && personas.some((candidate) => candidate.id === personaDetail?.id && candidate.available !== false)
    ? personaDetail
    : personas.find((persona) => persona.id === selectedPersonaId && persona.available !== false)
      ?? personas.find((persona) => persona.available !== false);
  const activeTheme = activePersona?.theme;
  const personaNamesById = useMemo(
    () => Object.fromEntries(personas.map((candidate) => [
      candidate.id,
      candidate.shortName ?? candidate.name
    ])),
    [personas]
  );
  const hasConversationContent = renderedTurns.length > 0 || pendingPrompt !== undefined || loading;
  const personaVisualState = audioEnabled
    ? personaAudioPlaying
      ? "speaking"
      : loading && !suppressAudioVisualForCurrentTurnRef.current
        ? "thinking"
        : "idle"
    : loading && !suppressAudioVisualForCurrentTurnRef.current
      ? "thinking"
      : nonAudioVisualState;
  const themeStyle = activeTheme
    ? ({
        "--theme-background": activeTheme.background,
        "--theme-background-alt": activeTheme.backgroundAlt,
        "--theme-background-accent": activeTheme.backgroundAccent,
        "--theme-background-accent-secondary": activeTheme.backgroundAccentSecondary,
        "--theme-surface": activeTheme.surface,
        "--theme-surface-strong": activeTheme.surfaceStrong,
        "--theme-rail": activeTheme.rail,
        "--theme-border": activeTheme.border,
        "--theme-accent": activeTheme.accent,
        "--theme-accent-2": activeTheme.accent2,
        "--theme-danger": activeTheme.danger,
        "--theme-text": activeTheme.text,
        "--theme-muted": activeTheme.muted,
        ...Object.fromEntries(activeTheme.chartColors.map((color, index) => [`--theme-chart-${index + 1}`, color]))
      } as CSSProperties)
    : undefined;

  const policyConsentRequired = Boolean(authUser && currentPolicies && (
    authUser.termsVersionAccepted !== currentPolicies.termsVersion
    || authUser.privacyVersionAccepted !== currentPolicies.privacyVersion
  ));
  const policyConsentUnknown = Boolean(authUser && !currentPolicies);

  if (authUser && (policyConsentRequired || policyConsentUnknown)) {
    return (
      <PolicyConsentGate
        policies={currentPolicies}
        loading={policyLoading}
        error={policyError}
        onRetry={() => void loadCurrentPolicies()}
        onAccept={async () => {
          if (!currentPolicies) return;
          setAuthUser(await api.acceptPolicies({
            termsVersion: currentPolicies.termsVersion,
            privacyVersion: currentPolicies.privacyVersion
          }));
        }}
        onLogout={handleLogout}
      />
    );
  }

  // Accounts with a real email must verify before entering the app.
  // Username-only accounts (no email) skip this entirely.
  if (authUser?.email && authUser.emailVerified === false) {
    const accountEmail = authUser.email;
    return (
      <VerifyEmailGate
        email={accountEmail}
        onResend={() => api.resendVerificationEmail(accountEmail)}
        onCheckStatus={async () => {
          const me = await api.getCurrentUser();
          setAuthUser(me.user);
          return me.user.emailVerified === true;
        }}
        onLogout={handleLogout}
      />
    );
  }

  return (
    reviewPageEnabled ? (
      <GoldenPairReviewPage />
    ) : (
    <main className="page-shell" style={themeStyle}>
      {emailVerificationNotice ? (
        <div
          className={`email-verification-notice${emailVerificationNotice === "invalid" ? " email-verification-notice-error" : ""}`}
          role={emailVerificationNotice === "invalid" ? "alert" : "status"}
        >
          <span>
            {emailVerificationNotice === "verified"
              ? "Your email is verified — you're all set."
              : "That verification link is invalid or has expired."}
          </span>
          <button
            type="button"
            aria-label="Dismiss email verification notice"
            onClick={() => setEmailVerificationNotice(undefined)}
          >
            ×
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={`mobile-sidebar-toggle${mobileSidebarOpen ? " mobile-sidebar-toggle-open" : ""}`}
        aria-label={mobileSidebarOpen ? "Close chats" : "Open chats"}
        aria-expanded={mobileSidebarOpen}
        onClick={() => setMobileSidebarOpen((open) => !open)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      {mobileSidebarOpen ? (
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          aria-label="Close chats"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}
      <div className={`app-grid ${testModeEnabled ? "app-grid-test" : "app-grid-normal"}`}>
        <ConversationSidebar
          mobileOpen={mobileSidebarOpen}
          personaName={activePersona?.name ?? "Persona"}
          personas={personas}
          activePersonaId={activePersona?.id}
          onSelectPersona={(personaId) => void selectPersona(personaId)}
          authUser={authUser}
          authLoading={authLoading}
          authError={authError}
          oauthReturnAction={oauthReturn?.action}
          oauthReturnNotice={oauthReturn?.status === "success" ? oauthReturn.message : undefined}
          oauthProviders={oauthProviders}
          currentPolicies={currentPolicies}
          conversations={conversationList}
          activeConversationId={conversationId}
          loading={conversationListLoading}
          hasMoreConversations={Boolean(conversationListCursor)}
          onLoadMoreConversations={() => void loadMoreConversations()}
          onLogin={handleLogin}
          onRegister={handleRegister}
          onRestoreAccount={handleRestoreAccount}
          onRequestPasswordReset={api.requestPasswordReset}
          onChangePassword={api.changePassword}
          onUpdateProfile={async (profile) => {
            setAuthUser(await api.updateProfile(profile));
          }}
          onGetPlanUsage={api.getPlanUsage}
          onGetMemorySettings={api.getMemorySettings}
          onUpdateMemorySettings={async (enabled) => {
            const memoryEnabled = await api.updateMemorySettings(enabled);
            setAuthUser((current) => current ? { ...current, memoryEnabled } : current);
          }}
          onClearConversationMemory={api.clearConversationMemory}
          onClearAllMemory={api.clearAllMemory}
          onListConnectedAccounts={api.listConnectedAccounts}
          onLinkConnectedAccount={api.linkConnectedAccount}
          onUnlinkConnectedAccount={api.unlinkConnectedAccount}
          onListActiveSessions={api.listActiveSessions}
          onRevokeActiveSession={api.revokeActiveSession}
          onRevokeOtherSessions={api.revokeOtherSessions}
          onDeleteAccount={handleDeleteAccount}
          onExportAccount={handleExportAccount}
          onExportConversation={handleExportConversation}
          onImportConversations={handleImportConversations}
          dataTransferJob={dataTransferJob}
          onCancelDataTransfer={handleCancelDataTransfer}
          onLogout={handleLogout}
          onOAuthLogin={handleOAuthLogin}
          onNewConversation={() => {
            setMobileSidebarOpen(false);
            resetConversation();
          }}
          onSelectConversation={(nextConversationId) => {
            setMobileSidebarOpen(false);
            void loadConversation(nextConversationId);
          }}
          onDeleteConversation={(nextConversationId) => {
            void deleteConversationFromHistory(nextConversationId);
          }}
          onRenameConversation={(nextConversationId, title) => {
            void renameConversationFromHistory(nextConversationId, title);
          }}
          onPinConversation={(nextConversationId, pinned) => {
            void pinConversationFromHistory(nextConversationId, pinned);
          }}
        />
        <PersonaHeader
          personaSummary={personas.find((persona) => persona.id === activePersona?.id)}
          personaDetail={personaDetail?.id === activePersona?.id ? personaDetail : undefined}
          loading={authLoading || personasResource.isPending}
          signedIn={Boolean(authUser)}
          error={personasResource.error?.message}
          onRetry={() => {
            void personasResource.refetch();
          }}
        />
        <section className={`chat-column${hasConversationContent ? "" : " chat-column-empty"}`}>
                <div
                  className={`conversation-stage-grid${
                    personaCardVisible ? "" : " conversation-stage-grid-persona-hidden"
                  }`}
                >
            <ConversationHistory
              conversationId={conversationId}
              personaId={activePersona?.id ?? "persona"}
              personaShortName={activePersona?.shortName ?? activePersona?.name ?? "Persona"}
              pendingPersonaShortName={pendingPersonaId
                ? personaNamesById[pendingPersonaId] ?? "Retired persona"
                : undefined}
              personaNamesById={personaNamesById}
              turns={renderedTurns}
              hasEarlierTurns={Boolean(turnsCursor)}
              loadingEarlierTurns={loadingEarlierTurns}
              onLoadEarlierTurns={() => void loadEarlierTurns()}
              pendingPrompt={pendingPrompt}
              pendingAssets={pendingPromptAssets}
              pendingFiles={pendingPromptFiles}
              thinking={loading && pendingPrompt !== undefined}
              testMode={testModeEnabled}
              autoPlayAudioTurnIndex={autoPlayAudioTurnIndex}
              onAudioPlaybackChange={audioEnabled ? (playing, turnPersonaId) => {
                if (suppressAudioVisualForCurrentTurnRef.current) return;
                if (turnPersonaId !== selectedPersonaIdRef.current) return;
                setPersonaAudioPlaying(playing);
              } : undefined}
              onEditUserPrompt={(message, files) => {
                setComposerDraft(message);
                setComposerDraftAttachments(files);
              }}
              onRetryAssistantTurn={retryAssistantTurn}
              onRetryAssistantTurnWithoutPersona={retryAssistantTurnWithoutPersona}
              onReportAssistantTurn={async (turn, category, details) => {
                if (!conversationId) throw new Error("Open a saved conversation before reporting this response.");
                const excerpt = turn.assistantText.trim() || JSON.stringify(turn.outputs);
                await api.reportUnsafeOutput({
                  conversationId,
                  category,
                  outputExcerpt: excerpt.slice(0, 4000),
                  ...(details ? { details } : {})
                });
              }}
              onOutputAction={async (action) => {
                if (action.action !== "resume_background_job") return;
                const jobId = typeof action.arguments?.jobId === "string" ? action.arguments.jobId : undefined;
                if (jobId) {
                  await resumeBackgroundJob(jobId);
                }
              }}
            />
            <div className={`persona-stage-slot${personaCardVisible ? "" : " persona-stage-slot-hidden"}`}>
              {activePersona?.visualStage ? (
                <PersonaVisualStage
                  state={personaVisualState}
                  personaName={activePersona.name}
                  profile={activePersona.visualStage}
                  hidden={!personaCardVisible}
                  onHide={() => setPersonaCardVisible(false)}
                />
              ) : null}
            </div>
          </div>
          <div className="composer-dock">
            <ChatComposer
              provider={provider}
              audioEnabled={audioEnabled}
              personaCardHidden={!personaCardVisible}
              loading={loading}
              disabled={!authUser || authLoading}
              promptPlaceholder={!authUser
                ? "Please sign in or create an account to start chatting."
                : activePersona?.promptPlaceholder ?? "Ask anything"}
              suggestedPrompts={activePersona?.suggestedPrompts ?? []}
              {...(composerDraft !== undefined ? { draftMessage: composerDraft } : {})}
              {...(composerDraftAttachments !== undefined ? { draftAttachments: composerDraftAttachments } : {})}
              onResetConversation={resetConversation}
              onShowPersonaCard={() => setPersonaCardVisible(true)}
              onProviderChange={setProvider}
              onAudioChange={setAudioEnabled}
              onCancel={cancelRequest}
              onSubmit={handleSubmit}
            />
          </div>
        </section>
        {testModeEnabled ? (
          <aside className="sidebar-column">
            <DebugPanel request={latestRequest} response={response} />
            <NeutralResponsePanel response={response} />
            <EvalCapturePanel
              response={response}
              saving={evalSaving}
              savedMessage={evalSavedMessage}
              error={evalError}
              onSave={saveEvalCapture}
            />
          </aside>
        ) : null}
        {error ? <div className="error-banner">{error}</div> : null}
      </div>
    </main>
    )
  );
}
