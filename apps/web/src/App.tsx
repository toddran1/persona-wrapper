import type { ChatJobResponse, ChatMessage, ChatResponse, ClientContext, ContentBlock, ConversationSummary, ConversationTurn, PersonaDefinition, PersonaSummary, ProviderId, ToolOptions, UploadedAsset } from "@persona/shared";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useRef } from "react";
import { api } from "./lib/api.js";
import { ChatComposer } from "./components/ChatComposer.js";
import { ConversationSidebar } from "./components/ConversationSidebar.js";
import { ConversationHistory, type RenderedTurn, type UserPromptAsset } from "./components/ConversationHistory.js";
import { DebugPanel } from "./components/DebugPanel.js";
import { EvalCapturePanel } from "./components/EvalCapturePanel.js";
import { GoldenPairReviewPage } from "./components/GoldenPairReviewPage.js";
import { NeutralResponsePanel } from "./components/NeutralResponsePanel.js";
import { PersonaHeader } from "./components/PersonaHeader.js";
import { PersonaVisualStage, type PersonaVisualState } from "./components/PersonaVisualStage.js";

const NON_AUDIO_SPEAKING_MS = 8000;

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

function renderTurnsFromHistory(history: ChatMessage[]): RenderedTurn[] {
  const turns: RenderedTurn[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    if (!message || message.role !== "user") continue;
    let assistant: ChatMessage | undefined;
    for (let nextIndex = index + 1; nextIndex < history.length; nextIndex += 1) {
      const candidate = history[nextIndex];
      if (!candidate || candidate.role === "user") break;
      if (candidate.role === "assistant") {
        assistant = candidate;
        break;
      }
    }
    turns.push({
      userMessage: message.content,
      assistantText: assistant?.content ?? "",
      outputs: assistant?.content
        ? [{
            type: "text",
            text: assistant.content
          }]
        : []
    });
  }
  return turns;
}

function renderTurnsFromConversationTurns(turns: ConversationTurn[]): RenderedTurn[] {
  return turns.map((turn) => ({
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
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Request cancelled."));
    }, { once: true });
  });
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

export function App() {
  const testModeEnabled = import.meta.env.VITE_TEST_MODE === "true";
  const reviewPageEnabled = testModeEnabled && window.location.pathname.replace(/\/$/, "") === "/review";
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [personaDetail, setPersonaDetail] = useState<PersonaDefinition | undefined>();
  const [provider, setProvider] = useState<ProviderId>("openai_persona");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [personaCardVisible, setPersonaCardVisible] = useState(true);
  const [response, setResponse] = useState<ChatResponse | undefined>();
  const [latestRequest, setLatestRequest] = useState<Record<string, unknown> | undefined>();
  const [renderedTurns, setRenderedTurns] = useState<RenderedTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [personaAudioPlaying, setPersonaAudioPlaying] = useState(false);
  const [nonAudioVisualState, setNonAudioVisualState] = useState<PersonaVisualState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [conversationListLoading, setConversationListLoading] = useState(false);
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalSavedMessage, setEvalSavedMessage] = useState<string | undefined>();
  const [evalError, setEvalError] = useState<string | undefined>();
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>();
  const [pendingPromptAssets, setPendingPromptAssets] = useState<UserPromptAsset[]>([]);
  const [pendingPromptFiles, setPendingPromptFiles] = useState<File[]>([]);
  const [composerDraft, setComposerDraft] = useState<string | undefined>();
  const [composerDraftAttachments, setComposerDraftAttachments] = useState<File[] | undefined>();
  const activeRequestRef = useRef<AbortController | undefined>();
  const activeBackgroundJobIdRef = useRef<string | undefined>();
  const completedTurnCountRef = useRef(0);
  const lastCompletedTurnWasImageOnlyRef = useRef(false);
  const suppressAudioVisualForCurrentTurnRef = useRef(false);
  const nonAudioVisualTimeoutRef = useRef<number | undefined>();

  function clearNonAudioVisualTimer(): void {
    if (nonAudioVisualTimeoutRef.current === undefined) return;
    window.clearTimeout(nonAudioVisualTimeoutRef.current);
    nonAudioVisualTimeoutRef.current = undefined;
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
    void (async () => {
      try {
        const loadedPersonas = await api.getPersonas();
        setPersonas(loadedPersonas);

        if (loadedPersonas[0]) {
          const detail = await api.getPersona(loadedPersonas[0].id);
          setPersonaDetail(detail);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load personas");
      }
    })();
  }, []);

  useEffect(() => {
    void refreshConversationList();
  }, []);

  useEffect(() => {
    const nextTitle = personaDetail?.documentTitle ?? personas[0]?.documentTitle;
    document.title = nextTitle ?? "Persona Wrapper";
  }, [personaDetail?.documentTitle, personas]);

  useEffect(() => {
    if (!audioEnabled) {
      setPersonaAudioPlaying(false);
    }
  }, [audioEnabled]);

  useEffect(() => () => clearNonAudioVisualTimer(), []);

  useEffect(() => {
    clearNonAudioVisualTimer();

    if (audioEnabled) {
      completedTurnCountRef.current = renderedTurns.length;
      setNonAudioVisualState("idle");
      return;
    }

    if (loading) {
      lastCompletedTurnWasImageOnlyRef.current = false;
      setNonAudioVisualState("thinking");
      return;
    }

    if (renderedTurns.length > completedTurnCountRef.current) {
      completedTurnCountRef.current = renderedTurns.length;
      if (lastCompletedTurnWasImageOnlyRef.current) {
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
    if (!pendingPrompt) {
      setNonAudioVisualState("idle");
    }
  }, [audioEnabled, loading, pendingPrompt, renderedTurns.length]);

  async function handleSubmit(message: string, files: File[], toolOptions: ToolOptions): Promise<void> {
    if (!personaDetail) {
      return;
    }

    setLoading(true);
    setPersonaAudioPlaying(false);
    suppressAudioVisualForCurrentTurnRef.current = false;
    setError(undefined);
    setPendingPrompt(message);
    setComposerDraft(undefined);
    setComposerDraftAttachments(undefined);
    const localPendingAssets = mapFilesToPendingPromptAssets(files);
    setPendingPromptAssets(localPendingAssets);
    setPendingPromptFiles(files);
    const requestController = new AbortController();
    activeRequestRef.current = requestController;
    let keepBackgroundJob = false;

    try {
      const attachments = files.length > 0 ? await api.uploadFiles(files) : [];
      let resolvedToolOptions = toolOptions;
      if (toolOptions.fileSearch && attachments.some((attachment) => attachment.kind === "file")) {
        const vectorStore = await api.createVectorStore(
          attachments.filter((attachment) => attachment.kind === "file").map((attachment) => attachment.id)
        );
        resolvedToolOptions = { ...toolOptions, vectorStoreIds: [vectorStore.id] };
      }
      const payload = {
        personaId: personaDetail.id,
        message,
        provider,
        audio: audioEnabled,
        testMode: testModeEnabled,
        clientContext: getClientContext(),
        attachments,
        toolOptions: resolvedToolOptions,
        ...(conversationId ? { conversationId } : {})
      };
      setLatestRequest(payload);
      const result = await api.sendChat(payload, requestController.signal);
      const backgroundJob = result.diagnostics.backgroundJob;
      activeBackgroundJobIdRef.current = backgroundJob?.id;
      const finalResult = backgroundJob
        ? await pollChatJob(backgroundJob.id, requestController.signal)
        : result;

      appendChatResult(message, finalResult, attachments, files);
      void refreshConversationList(finalResult.conversationId);
      activeBackgroundJobIdRef.current = undefined;
      setPendingPrompt(undefined);
      setPendingPromptAssets([]);
      setPendingPromptFiles([]);
      releasePendingPromptAssets(localPendingAssets);
      setEvalSavedMessage(undefined);
      setEvalError(undefined);
    } catch (submitError) {
      const messageText = submitError instanceof Error ? submitError.message : "Failed to generate response";
      setPendingPrompt(undefined);
      setPendingPromptAssets([]);
      setPendingPromptFiles([]);
      if (submitError instanceof BackgroundPollingTimeoutError) {
        keepBackgroundJob = true;
        setError(undefined);
        appendChatStillRunning(message, submitError.job, localPendingAssets, files);
        setEvalSavedMessage(undefined);
        setEvalError(undefined);
        return;
      }
      if (submitError instanceof BackgroundJobStateError) {
        const jobReason = submitError.job.failureReason ?? (submitError.job.status === "cancelled" ? "manual_cancel" : "provider_failure");
        setError(messageText);
        appendChatJobError(message, submitError.job, jobReason, localPendingAssets, files);
        return;
      }
      if (!requestController.signal.aborted) {
        setError(messageText);
        appendChatError(message, messageText, localPendingAssets, files);
      }
    } finally {
      if (activeRequestRef.current === requestController) activeRequestRef.current = undefined;
      if (!keepBackgroundJob && !requestController.signal.aborted) activeBackgroundJobIdRef.current = undefined;
      setLoading(false);
    }
  }

  function appendChatResult(message: string, result: ChatResponse, attachments: UploadedAsset[] = [], userFiles: File[] = []): void {
    const assistantTextBlock = result.outputs.find((output) => output.type === "text");
    const assistantText = assistantTextBlock?.type === "text" ? assistantTextBlock.text : "";
    const userAssets = mapUploadedAssetsToUserPromptAssets(attachments);
    const imageOnlyResponse = isImageOnlyResponse(result.outputs);
    lastCompletedTurnWasImageOnlyRef.current = imageOnlyResponse;
    suppressAudioVisualForCurrentTurnRef.current = imageOnlyResponse;

    setConversationId(result.conversationId);
    setResponse(result);
    setRenderedTurns((current) => [
      ...current,
      {
        userMessage: message,
        userAssets,
        userFiles,
        assistantText,
        outputs: result.outputs,
        usage: result.usage
      }
    ]);
  }

  async function refreshConversationList(preferConversationId?: string): Promise<void> {
    setConversationListLoading(true);
    try {
      const conversations = await api.listConversations();
      setConversationList(conversations);
      if (preferConversationId) {
        setConversationId(preferConversationId);
      }
    } catch (listError) {
      console.warn("Failed to load conversation list", listError);
    } finally {
      setConversationListLoading(false);
    }
  }

  async function loadConversation(nextConversationId: string): Promise<void> {
    setLoading(true);
    setError(undefined);
    setPendingPrompt(undefined);
    setPendingPromptAssets([]);
    setPendingPromptFiles([]);
    setPersonaAudioPlaying(false);
    try {
      const conversation = await api.getConversation(nextConversationId);
      setConversationId(conversation.id);
      setRenderedTurns(
        conversation.turns.length > 0
          ? renderTurnsFromConversationTurns(conversation.turns)
          : renderTurnsFromHistory(conversation.history)
      );
      setResponse(undefined);
      setLatestRequest(undefined);
      setEvalSavedMessage(undefined);
      setEvalError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load conversation");
    } finally {
      setLoading(false);
    }
  }

  async function deleteConversationFromHistory(nextConversationId: string): Promise<void> {
    try {
      await api.deleteConversation(nextConversationId);
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
      const renamed = await api.renameConversation(nextConversationId, title);
      setConversationList((current) => current.map((conversation) => (
        conversation.id === renamed.id ? renamed : conversation
      )).sort(sortConversationSummaries));
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename conversation");
    }
  }

  async function pinConversationFromHistory(nextConversationId: string, pinned: boolean): Promise<void> {
    try {
      const updated = await api.pinConversation(nextConversationId, pinned);
      setConversationList((current) => current.map((conversation) => (
        conversation.id === updated.id ? updated : conversation
      )).sort(sortConversationSummaries));
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : "Failed to update pinned chat");
    }
  }

  function appendChatError(message: string, errorMessage: string, userAssets: UserPromptAsset[] = [], userFiles: File[] = []): void {
    setRenderedTurns((current) => [
      ...current,
      {
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

  function appendChatStillRunning(message: string, job: ChatJobResponse, userAssets: UserPromptAsset[] = [], userFiles: File[] = []): void {
    setRenderedTurns((current) => [
      ...current,
      {
        userMessage: message,
        userAssets,
        userFiles,
        assistantText: "This is still running in the background.",
        backgroundJobId: job.id,
        outputs: [
          {
            type: "status",
            status: "in_progress",
            message: stillRunningStatusMessage(job, false)
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
        ]
      }
    ]);
  }

  function appendChatJobError(message: string, job: ChatJobResponse, reason: string, userAssets: UserPromptAsset[] = [], userFiles: File[] = []): void {
    const label = reason === "manual_cancel"
      ? "Request cancelled."
      : reason === "openai_background_timeout"
        ? "OpenAI background processing timed out."
        : "Provider request failed.";
    setRenderedTurns((current) => [
      ...current,
      {
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
    activeRequestRef.current = requestController;
    activeBackgroundJobIdRef.current = jobId;
    setLoading(true);
    setPersonaAudioPlaying(false);
    setError(undefined);
    try {
      const finalResult = await pollChatJob(jobId, requestController.signal);
      const assistantTextBlock = finalResult.outputs.find((output) => output.type === "text");
      const assistantText = assistantTextBlock?.type === "text" ? assistantTextBlock.text : "";
      const imageOnlyResponse = isImageOnlyResponse(finalResult.outputs);
      lastCompletedTurnWasImageOnlyRef.current = imageOnlyResponse;
      suppressAudioVisualForCurrentTurnRef.current = imageOnlyResponse;
      setConversationId(finalResult.conversationId);
      setResponse(finalResult);
      setRenderedTurns((current) => current.map((turn) => (
        turn.backgroundJobId === jobId
          ? {
              ...turn,
              assistantText,
              outputs: finalResult.outputs,
              usage: finalResult.usage
            }
          : turn
      )));
      activeBackgroundJobIdRef.current = undefined;
    } catch (resumeError) {
      if (resumeError instanceof BackgroundPollingTimeoutError) {
        setRenderedTurns((current) => current.map((turn) => (
          turn.backgroundJobId === jobId
            ? {
                ...turn,
                outputs: buildStillRunningOutputs(resumeError.job)
              }
            : turn
        )));
        return;
      }
      if (resumeError instanceof BackgroundJobStateError) {
        const reason = resumeError.job.failureReason ?? (resumeError.job.status === "cancelled" ? "manual_cancel" : "provider_failure");
        setRenderedTurns((current) => current.map((turn) => (
          turn.backgroundJobId === jobId
            ? {
                ...turn,
                assistantText: reason === "manual_cancel" ? "Request cancelled." : "Background request failed.",
                outputs: buildJobErrorOutputs(resumeError.job, reason)
              }
            : turn
        )));
        return;
      }
      const messageText = resumeError instanceof Error ? resumeError.message : "Failed to resume background request";
      setError(messageText);
    } finally {
      if (activeRequestRef.current === requestController) activeRequestRef.current = undefined;
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
    const backgroundJobId = activeBackgroundJobIdRef.current;
    const cancelledPrompt = pendingPrompt;
    if (backgroundJobId) {
      void api.cancelChatJob(backgroundJobId).catch((cancelError) => {
        console.warn("Failed to cancel background chat job", cancelError);
      });
    }
    activeRequestRef.current?.abort();
    activeRequestRef.current = undefined;
    activeBackgroundJobIdRef.current = undefined;
    setLoading(false);
    setPersonaAudioPlaying(false);
    setPendingPrompt(undefined);
    setPendingPromptFiles([]);
    if (cancelledPrompt) {
      setRenderedTurns((current) => [
        ...current,
        {
          userMessage: cancelledPrompt,
          userAssets: pendingPromptAssets,
          userFiles: pendingPromptFiles,
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

  function resetConversation(): void {
    setConversationId(undefined);
    setResponse(undefined);
    setLatestRequest(undefined);
    setRenderedTurns([]);
    setError(undefined);
    setEvalSavedMessage(undefined);
    setEvalError(undefined);
    setPendingPrompt(undefined);
    setPendingPromptAssets([]);
    setPendingPromptFiles([]);
    setComposerDraft(undefined);
    setComposerDraftAttachments(undefined);
    setPersonaAudioPlaying(false);
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

  const activeTheme = personaDetail?.theme ?? personas[0]?.theme;
  const hasConversationContent = renderedTurns.length > 0 || Boolean(pendingPrompt) || loading;
  const personaVisualState = audioEnabled
    ? personaAudioPlaying
      ? "speaking"
      : loading
        ? "thinking"
        : "idle"
    : loading
      ? "thinking"
      : nonAudioVisualState;
  const themeStyle = activeTheme
    ? ({
        "--theme-background": activeTheme.background,
        "--theme-background-accent": activeTheme.backgroundAccent,
        "--theme-background-accent-secondary": activeTheme.backgroundAccentSecondary,
        "--theme-surface": activeTheme.surface,
        "--theme-surface-strong": activeTheme.surfaceStrong,
        "--theme-border": activeTheme.border,
        "--theme-accent": activeTheme.accent,
        "--theme-accent-2": activeTheme.accent2,
        "--theme-text": activeTheme.text,
        "--theme-muted": activeTheme.muted
      } as CSSProperties)
    : undefined;

  return (
    reviewPageEnabled ? (
      <GoldenPairReviewPage />
    ) : (
    <main className="page-shell" style={themeStyle}>
      <div className={`app-grid ${testModeEnabled ? "app-grid-test" : "app-grid-normal"}`}>
        <ConversationSidebar
          conversations={conversationList}
          activeConversationId={conversationId}
          loading={conversationListLoading}
          onNewConversation={resetConversation}
          onSelectConversation={(nextConversationId) => {
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
        <PersonaHeader personaSummary={personas[0]} personaDetail={personaDetail} />
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
        <section className={`chat-column${hasConversationContent ? "" : " chat-column-empty"}`}>
                <div
                  className={`conversation-stage-grid${
                    personaCardVisible ? "" : " conversation-stage-grid-persona-hidden"
                  }`}
                >
            <ConversationHistory
              turns={renderedTurns}
              pendingPrompt={pendingPrompt}
              pendingAssets={pendingPromptAssets}
              pendingFiles={pendingPromptFiles}
              thinking={loading && Boolean(pendingPrompt)}
              testMode={testModeEnabled}
              onAudioPlaybackChange={audioEnabled ? (playing) => {
                if (suppressAudioVisualForCurrentTurnRef.current) return;
                setPersonaAudioPlaying(playing);
              } : undefined}
              onEditUserPrompt={(message, files) => {
                setComposerDraft(message);
                setComposerDraftAttachments(files);
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
              <PersonaVisualStage
                state={personaVisualState}
                personaName={personaDetail?.name ?? personas[0]?.name ?? "LaRae"}
                hidden={!personaCardVisible}
                onHide={() => setPersonaCardVisible(false)}
              />
            </div>
          </div>
          <div className="composer-dock">
            <ChatComposer
              provider={provider}
              audioEnabled={audioEnabled}
              personaCardHidden={!personaCardVisible}
              loading={loading}
              promptPlaceholder={personaDetail?.promptPlaceholder ?? personas[0]?.promptPlaceholder ?? "Ask anything"}
              suggestedPrompts={personaDetail?.suggestedPrompts ?? personas[0]?.suggestedPrompts ?? []}
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
        {error ? <div className="error-banner">{error}</div> : null}
      </div>
    </main>
    )
  );
}
