import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from "react-native";
import { LinearGradient, type LinearGradientProps } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import * as ScreenOrientation from "expo-screen-orientation";
import Ionicons from "@expo/vector-icons/Ionicons";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import type { ExpoSpeechRecognitionErrorEvent, ExpoSpeechRecognitionResultEvent } from "expo-speech-recognition";
import { MAX_CHAT_ATTACHMENTS, MAX_OPENAI_IMAGE_EDIT_BYTES, type ActiveSession, type AuthUser, type ChatJobResponse, type ChatResponse, type Citation, type ConnectedAccount, type ConversationSummary, type CurrentPoliciesResponse, type OAuthProvider, type OAuthProviderStatus, type PersonaDefinition, type ProviderId, type UnsafeOutputReportCategory, type UploadedAsset } from "@persona/shared";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../api/client";
import { queryClient } from "../../api/queryClient";
import { conversationsPageQueryOptions, conversationTurnsQueryOptions, personaQueryOptions, personasQueryOptions } from "../../api/chatQueries";
import { clearUserQueryCache, restoreUserQueryCache, subscribeUserQueryCache } from "../../api/queryPersistence";
import { IconButton } from "../../components/IconButton";
import { NetworkStatusBanner } from "../../components/NetworkStatusBanner";
import { useLocalization } from "../../localization/LocalizationProvider";
import { useNetwork } from "../../network/NetworkProvider";
import {
  clearSelectedConversationId,
  clearSelectedPersonaId,
  getSelectedConversationId,
  getSelectedPersonaId,
  setSelectedConversationId,
  setSelectedPersonaId
} from "../../storage/secureTokens";
import { saveFileToDevice } from "../../storage/downloadDirectory";
import { getLandscapeLayoutEnabled, setLandscapeLayoutEnabled } from "../../storage/mobilePreferences";
import { defaultPersonaTheme, themeFromPersona } from "../../theme/personaTheme";
import { ChatComposer } from "./ChatComposer";
import { ChatDrawer } from "./ChatDrawer";
import { ChatTurn } from "./ChatTurn";
import { usePersonaAudio } from "./usePersonaAudio";
import { useAccountSettingsController, type SettingsPanel } from "./useAccountSettingsController";
import { PersonaVisualStage, type PersonaVisualState } from "./PersonaVisualStage";
import { MobileAuthScreen, type MobileAuthMode } from "../auth/MobileAuthScreen";
import { MobilePolicyConsentScreen } from "../auth/MobilePolicyConsentScreen";
import {
  getClientContext,
  sortConversationSummaries,
  turnFromChatResponse,
  turnsFromConversationTurns
} from "./mobileChatUtils";
import { stripGeneratedFileDownloadPrompt } from "@persona/shared";
import type { MobilePickedFile, RenderedTurn } from "./types";

const BackgroundGradient = LinearGradient as unknown as ComponentType<LinearGradientProps>;
const BACKGROUND_POLL_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_RESPONSE_FOCUS_OFFSET = 132;
const DOCKED_PERSONA_RESPONSE_FOCUS_OFFSET = 236;
const DOCKED_PERSONA_RESPONSE_FOCUS_OFFSET_LANDSCAPE = 220;
const PERSONA_RESPONSE_FOCUS_GAP = 12;
const PUBLIC_WEB_BASE_URL = (process.env.EXPO_PUBLIC_WEB_APP_URL || "http://localhost:5173").replace(/\/$/, "");
// Keep this aligned with `scheme` in app.config.ts. OAuth must not depend on
// Expo Constants because the native manifest can be unavailable during startup.
const MOBILE_APP_SCHEME = "personawrapper";
const REPORT_CATEGORIES: Array<{ value: UnsafeOutputReportCategory; label: string }> = [
  { value: "sexual_content", label: "Sexual content" },
  { value: "violence_or_self_harm", label: "Violence or self-harm" },
  { value: "hate_or_harassment", label: "Hate or harassment" },
  { value: "child_safety", label: "Child safety" },
  { value: "privacy_or_impersonation", label: "Privacy or impersonation" },
  { value: "dangerous_or_illegal", label: "Dangerous or illegal advice" },
  { value: "misinformation", label: "False or misleading information" },
  { value: "other", label: "Something else" }
];

function hasCurrentPolicyConsent(user: AuthUser | undefined, policies: CurrentPoliciesResponse | undefined): boolean {
  return Boolean(
    user
    && policies
    && user.termsVersionAccepted === policies.termsVersion
    && user.privacyVersionAccepted === policies.privacyVersion
  );
}

function mobileAppUrl(path = ""): string {
  const normalizedPath = path.replace(/^\/+/, "");
  return normalizedPath ? `${MOBILE_APP_SCHEME}://${normalizedPath}` : `${MOBILE_APP_SCHEME}://`;
}

function assistantTextForDisplay(turn: Pick<RenderedTurn, "assistantText" | "outputs">): string {
  return turn.outputs.some((output) => output.type === "file")
    ? stripGeneratedFileDownloadPrompt(turn.assistantText)
    : turn.assistantText;
}

WebBrowser.maybeCompleteAuthSession();

async function openPublicWebPage(path: string): Promise<void> {
  const pageUrl = new URL(`${PUBLIC_WEB_BASE_URL}${path}`);
  pageUrl.searchParams.set("returnTo", mobileAppUrl());
  await WebBrowser.openBrowserAsync(pageUrl.toString());
}

function assertSupportedImportSize(size: number | undefined): void {
  if (size !== undefined && size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("Import archives must be 5 GB or smaller.");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function applyLandscapeLayoutPreference(enabled: boolean): Promise<void> {
  if (enabled) {
    await ScreenOrientation.unlockAsync();
    return;
  }
  await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
}

async function loadAuthenticatedUser(): Promise<AuthUser | undefined> {
  try {
    return (await api.getCurrentUser()).user;
  } catch {
    return undefined;
  }
}

type SpeechRecognitionRuntime = typeof import("expo-speech-recognition");
type SpeechRecognitionSubscription = { remove: () => void };
type ChatTurnActionHandlers = {
  copyPrompt: (turn: RenderedTurn) => void;
  editPrompt: (turn: RenderedTurn) => void;
  showPromptActions: (turn: RenderedTurn) => void;
  outputAction: (action: Extract<RenderedTurn["outputs"][number], { type: "action" }>) => void;
  resumeBackgroundJob: (turn: RenderedTurn) => void;
  copyResponse: (turn: RenderedTurn) => void;
  showResponseActions: (turn: RenderedTurn) => void;
};
declare const require: (moduleName: string) => unknown;
const IMAGE_REQUEST_PATTERN =
  /\b(generate|create|make|draw|design|edit|change|remove|replace|recolor|retouch|give|get|show|provide|turn|convert)\b[\s\S]{0,80}\b(image|photo|picture|poster|logo|art|illustration|avatar|thumbnail|banner|flyer)\b/i;
const NON_AUDIO_SPEAKING_MS = 8000;

class BackgroundPollingTimeoutError extends Error {
  constructor(readonly job: ChatJobResponse) {
    super("This is still running in the background.");
    this.name = "BackgroundPollingTimeoutError";
  }
}

class BackgroundJobStateError extends Error {
  constructor(readonly job: ChatJobResponse) {
    super(job.error ?? "Background request failed.");
    this.name = "BackgroundJobStateError";
  }
}

class RequestCancelledError extends Error {
  constructor() {
    super("Request cancelled.");
    this.name = "AbortError";
  }
}

function isRequestCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function activeSessionLabel(session: ActiveSession): string {
  if (session.current) return "This device";
  if (session.clientType === "android") return "Android device";
  if (session.clientType === "ios") return "iPhone or iPad";
  if (session.clientType === "web") return "Web browser";
  if (session.clientType === "desktop") return "Desktop app";
  return "Unknown device";
}

function formatSessionActivity(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Activity time unavailable";
  return `Last active ${date.toLocaleString()}`;
}

const PROFILE_GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "nonbinary", label: "Nonbinary" },
  { value: "other", label: "Other" }
] as const;
const PROFILE_MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(2000, index, 1))
}));

function profileDaysInMonth(month: string): number {
  const monthNumber = Number(month);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return 31;
  return new Date(2000, monthNumber, 0).getDate();
}

export function MobileChatScreen() {
  const { t } = useLocalization();
  const { isOnline, recentlyRestored } = useNetwork();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const drawerWidth = windowWidth;
  const compactLayout = windowWidth < 360 || windowHeight < 700;
  const tabletLayout = Math.min(windowWidth, windowHeight) >= 600;
  const [persona, setPersona] = useState<PersonaDefinition | undefined>();
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [turns, setTurns] = useState<RenderedTurn[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsCursor, setConversationsCursor] = useState<string | null>(null);
  const [conversationSearchQuery, setConversationSearchQuery] = useState("");
  const [conversationSearchResults, setConversationSearchResults] = useState<ConversationSummary[]>([]);
  const [conversationSearchCursor, setConversationSearchCursor] = useState<string | null>(null);
  const [conversationSearching, setConversationSearching] = useState(false);
  const [turnsCursor, setTurnsCursor] = useState<string | null>(null);
  const [loadingEarlierTurns, setLoadingEarlierTurns] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversationsRefreshing, setConversationsRefreshing] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | undefined>();
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | undefined>();
  const [oauthProviders, setOAuthProviders] = useState<OAuthProviderStatus[]>([]);
  const [currentPolicies, setCurrentPolicies] = useState<CurrentPoliciesResponse>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [resumingJobId, setResumingJobId] = useState<string | undefined>();
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [authMode, setAuthMode] = useState<MobileAuthMode>("login");
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | undefined>();
  const [conversationActionTarget, setConversationActionTarget] = useState<ConversationSummary | undefined>();
  const [userActionTurn, setUserActionTurn] = useState<RenderedTurn | undefined>();
  const [assistantActionTurn, setAssistantActionTurn] = useState<RenderedTurn | undefined>();
  const [reportTarget, setReportTarget] = useState<RenderedTurn | undefined>();
  const [reportCategory, setReportCategory] = useState<UnsafeOutputReportCategory | undefined>();
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | undefined>();
  const [referenceSources, setReferenceSources] = useState<Citation[]>([]);
  const [renameTitle, setRenameTitle] = useState("");
  const [composerDraft, setComposerDraft] = useState<string | undefined>();
  const [voiceInputActive, setVoiceInputActive] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [responseFocusTurnId, setResponseFocusTurnId] = useState<string | undefined>();
  const [responseFocusLayoutVersion, setResponseFocusLayoutVersion] = useState(0);
  const [composerHeight, setComposerHeight] = useState(62);
  const [personaVisualState, setPersonaVisualState] = useState<PersonaVisualState>("idle");
  const [personaCardExpanded, setPersonaCardExpanded] = useState(false);
  const [personaCardHidden, setPersonaCardHidden] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [drawerInteractive, setDrawerInteractive] = useState(false);
  const drawerX = useSharedValue(-drawerWidth);
  const scrollRef = useRef<FlashListRef<RenderedTurn>>(null);
  const turnsRef = useRef<RenderedTurn[]>([]);
  const visualStateTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollButtonTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationSearchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationSearchGenerationRef = useRef(0);
  const nearConversationBottomRef = useRef(true);
  const lastFocusedResponseTurnIdRef = useRef<string | undefined>(undefined);
  const responseFocusTurnIdRef = useRef<string | undefined>(undefined);
  const assistantOffsetByTurnIdRef = useRef(new Map<string, number>());
  const personaCardLayoutRef = useRef<{ y: number; height: number } | undefined>(undefined);
  const conversationLayoutRef = useRef<{ y: number; height: number } | undefined>(undefined);
  const currentComposerDraftRef = useRef("");
  const speechBaseDraftRef = useRef("");
  const speechRuntimeRef = useRef<SpeechRecognitionRuntime | undefined>(undefined);
  const speechSubscriptionsRef = useRef<SpeechRecognitionSubscription[]>([]);
  const activeChatAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const activeChatTurnIdRef = useRef<string | undefined>(undefined);
  const activeBackgroundJobIdRef = useRef<string | undefined>(undefined);
  const activeChatPersonaIdRef = useRef<string | undefined>(undefined);
  const activePersonaIdRef = useRef<string | undefined>(undefined);
  const activeSubmissionRef = useRef<{ message: string; files: MobilePickedFile[] } | undefined>(undefined);
  const chatTurnActionHandlersRef = useRef<ChatTurnActionHandlers | undefined>(undefined);
  const dataTransferAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const settingsScrollRef = useRef<ScrollView>(null);
  const latestSettingsScrollOffsetRef = useRef(0);
  const mainSettingsScrollOffsetRef = useRef(0);
  const pendingMainSettingsOffsetRef = useRef<number | undefined>(undefined);
  const selectionGenerationRef = useRef(0);
  const conversationListGenerationRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const sessionValidationInFlightRef = useRef(false);
  const appDataReloadInFlightRef = useRef<Promise<void> | undefined>(undefined);
  const userCacheRestoreRef = useRef<Map<string, Promise<void>>>(new Map());
  const userCacheSubscriptionRef = useRef<(() => void) | undefined>(undefined);
  const {
    audioEnabled,
    setAudioEnabled,
    releaseCurrentAudioPlayback,
    replayAudioOutput,
    playGeneratedPersonaAudio
  } = usePersonaAudio();
  const {
    settingsVisible,
    setSettingsVisible,
    settingsPanel,
    setSettingsPanel,
    landscapeLayoutEnabled,
    setLandscapeLayoutEnabledState,
    landscapePreferenceBusy,
    setLandscapePreferenceBusy,
    activeSessions,
    setActiveSessions,
    sessionsLoading,
    setSessionsLoading,
    sessionsError,
    setSessionsError,
    sessionActionId,
    setSessionActionId,
    connectedAccounts,
    setConnectedAccounts,
    securityLoading,
    setSecurityLoading,
    securityError,
    setSecurityError,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    newPasswordConfirmation,
    setNewPasswordConfirmation,
    profileUsername,
    setProfileUsername,
    preferredName,
    setPreferredName,
    profileGender,
    setProfileGender,
    birthMonth,
    setBirthMonth,
    birthDay,
    setBirthDay,
    profileBusy,
    setProfileBusy,
    profileError,
    setProfileError,
    profileNotice,
    setProfileNotice,
    profileSelection,
    setProfileSelection,
    planUsage,
    setPlanUsage,
    planUsageLoading,
    setPlanUsageLoading,
    planUsageError,
    setPlanUsageError,
    memoryEnabled,
    setMemoryEnabled,
    memoryBusy,
    setMemoryBusy,
    memoryError,
    setMemoryError,
    memoryNotice,
    setMemoryNotice,
    conciseAudioResponses,
    setConciseAudioResponses,
    audioSettingsBusy,
    setAudioSettingsBusy,
    audioSettingsError,
    setAudioSettingsError,
    audioSettingsNotice,
    setAudioSettingsNotice,
    dataTransferJob,
    setDataTransferJob,
    deleteAccountVisible,
    setDeleteAccountVisible,
    deleteConfirmation,
    setDeleteConfirmation,
    deletePassword,
    setDeletePassword,
    deleteAccountBusy,
    setDeleteAccountBusy,
    deleteAccountError,
    setDeleteAccountError
  } = useAccountSettingsController(authUser);
  const currentAccountIdRef = useRef(authUser?.id);
  currentAccountIdRef.current = authUser?.id;

  useEffect(() => {
    if (authUser?.modelProvider) setProvider(authUser.modelProvider);
  }, [authUser?.id, authUser?.modelProvider]);
  const dataTransferActive = Boolean(
    dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status)
  );
  const copyTurnPrompt = useCallback((turn: RenderedTurn) => {
    chatTurnActionHandlersRef.current?.copyPrompt(turn);
  }, []);
  const editTurnPrompt = useCallback((turn: RenderedTurn) => {
    chatTurnActionHandlersRef.current?.editPrompt(turn);
  }, []);
  const showTurnPromptActions = useCallback((turn: RenderedTurn) => {
    chatTurnActionHandlersRef.current?.showPromptActions(turn);
  }, []);
  const handleTurnOutputAction = useCallback((action: Extract<RenderedTurn["outputs"][number], { type: "action" }>) => {
    chatTurnActionHandlersRef.current?.outputAction(action);
  }, []);
  const resumeTurnBackgroundJob = useCallback((turn: RenderedTurn) => {
    chatTurnActionHandlersRef.current?.resumeBackgroundJob(turn);
  }, []);
  const copyTurnResponse = useCallback((turn: RenderedTurn) => {
    chatTurnActionHandlersRef.current?.copyResponse(turn);
  }, []);
  const showTurnResponseActions = useCallback((turn: RenderedTurn) => {
    chatTurnActionHandlersRef.current?.showResponseActions(turn);
  }, []);
  const landscapeLayout = landscapeLayoutEnabled && windowWidth > windowHeight;
  // Android may place its three-button navigation rail over a side edge in
  // landscape — which side depends on the rotation direction — without
  // exposing a reliable safe-area inset. Reserve its touch area on both sides
  // so app controls and text never render beneath it.
  const landscapeLeftInset = landscapeLayout
    ? Math.max(insets.left, Platform.OS === "android" ? 72 : 0)
    : insets.left;
  const landscapeRightInset = landscapeLayout
    ? Math.max(insets.right, Platform.OS === "android" ? 72 : 0)
    : insets.right;
  const chatHorizontalGutter = compactLayout ? 8 : tabletLayout ? 20 : 12;
  const sheetHorizontalInsets = {
    paddingLeft: Math.max(insets.left + 16, 16),
    paddingRight: Math.max(insets.right + 16, 16)
  };

  const personasResource = useQuery(personasQueryOptions(authUser?.id));
  const personas = personasResource.data ?? [];
  const activePersona = persona && personas.some((candidate) => candidate.id === persona.id && candidate.available !== false)
    ? persona
    : personas.find((candidate) => candidate.available !== false);
  const theme = useMemo(() => themeFromPersona(activePersona), [activePersona]);
  const personaCardIsDocked = Boolean(
    activePersona?.visualStage
    && !personaCardHidden
    && !personaCardExpanded
    && !drawerInteractive
    && !settingsVisible
  );
  const responseFocusViewOffset = personaCardIsDocked
    ? landscapeLayout ? DOCKED_PERSONA_RESPONSE_FOCUS_OFFSET_LANDSCAPE : DOCKED_PERSONA_RESPONSE_FOCUS_OFFSET
    : DEFAULT_RESPONSE_FOCUS_OFFSET;
  const handleAssistantLayout = useCallback((turnId: string, offsetY: number) => {
    assistantOffsetByTurnIdRef.current.set(turnId, offsetY);
    if (responseFocusTurnIdRef.current === turnId) {
      setResponseFocusLayoutVersion((version) => version + 1);
    }
  }, []);
  const handlePersonaCardLayout = useCallback((layout: { y: number; height: number }) => {
    personaCardLayoutRef.current = layout;
  }, []);
  const handleConversationLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    conversationLayoutRef.current = { y, height };
  }, []);
  const handleConversationContentSizeChange = useCallback(() => {
    if (responseFocusTurnIdRef.current) {
      setResponseFocusLayoutVersion((version) => version + 1);
    }
  }, []);
  const personaById = useMemo(
    () => new Map(personas.map((candidate) => [candidate.id, candidate] as const)),
    [personas]
  );

  useEffect(() => {
    activePersonaIdRef.current = activePersona?.id;
  }, [activePersona?.id]);
  const [selectedFiles, setSelectedFiles] = useState<MobilePickedFile[]>([]);
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
    let active = true;
    void getLandscapeLayoutEnabled()
      .then(async (enabled) => {
        await applyLandscapeLayoutPreference(enabled);
        if (active) setLandscapeLayoutEnabledState(enabled);
      })
      .catch(async () => {
        if (active) setLandscapeLayoutEnabledState(false);
        try {
          await setLandscapeLayoutEnabled(false);
          await applyLandscapeLayoutPreference(false);
        } catch {
          // Keep the app usable if orientation APIs or preference storage are unavailable.
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (personasResource.error) setError(personasResource.error.message);
  }, [personasResource.error]);

  useEffect(() => {
    if (!personasResource.isSuccess) return;
    const availablePersona = personas.find((candidate) => candidate.available !== false);
    const selectedPersona = persona
      && personas.find((candidate) => candidate.id === persona.id && candidate.available !== false);

    if (!availablePersona) {
      setPersona(undefined);
      void clearSelectedPersonaId().catch(() => undefined);
      return;
    }
    if (!authUser) return;

    const nextPersonaId = selectedPersona?.id ?? availablePersona.id;
    let cancelled = false;
    void queryClient.fetchQuery({
      ...personaQueryOptions(nextPersonaId, authUser.id),
      staleTime: 0
    }).then((detail) => {
      if (cancelled) return;
      setPersona(detail);
      setProvider((current) => detail.supportedProviders.includes(current)
        ? current
        : detail.supportedProviders[0] ?? "openai");
      void setSelectedPersonaId(detail.id).catch(() => undefined);
    }).catch((reconcileError) => {
      if (cancelled) return;
      if (!selectedPersona) {
        setPersona(undefined);
        void clearSelectedPersonaId().catch(() => undefined);
      }
      setError(reconcileError instanceof Error
        ? `Could not refresh the persona profile. ${reconcileError.message}`
        : "Could not refresh the persona profile.");
      void personasResource.refetch();
    });
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, personasResource.dataUpdatedAt, personasResource.isSuccess]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  // Re-snap the hidden drawer only when the viewport width changes (rotation).
  // Running this on every drawerInteractive flip would cancel the animated
  // close started by closeDrawer and make the drawer jump away instantly.
  const previousDrawerWidthRef = useRef(drawerWidth);
  useEffect(() => {
    if (previousDrawerWidthRef.current === drawerWidth) return;
    previousDrawerWidthRef.current = drawerWidth;
    if (!drawerInteractive) drawerX.value = -drawerWidth;
  }, [drawerInteractive, drawerWidth, drawerX]);

  useEffect(() => {
    return () => {
      try {
        speechRuntimeRef.current?.ExpoSpeechRecognitionModule.abort();
      } catch {
        // Native speech recognition may be unavailable in Expo Go or unsupported builds.
      }
      activeChatAbortControllerRef.current?.abort();
      activeChatAbortControllerRef.current = undefined;
      clearScrollButtonTimer();
      clearConversationSearchTimer();
      speechSubscriptionsRef.current.forEach((subscription) => subscription.remove());
      speechSubscriptionsRef.current = [];
    };
  }, []);


  useEffect(() => {
    if (!recentlyRestored || !authChecked) return;
    void retryLoadAppData();
  }, [recentlyRestored]);

  function clearVisualStateTimer(): void {
    if (!visualStateTimerRef.current) return;
    clearTimeout(visualStateTimerRef.current);
    visualStateTimerRef.current = undefined;
  }

  async function updateLandscapeLayoutPreference(enabled: boolean): Promise<void> {
    if (landscapePreferenceBusy) return;
    setLandscapePreferenceBusy(true);
    setLandscapeLayoutEnabledState(enabled);
    try {
      await setLandscapeLayoutEnabled(enabled);
      await applyLandscapeLayoutPreference(enabled);
    } catch {
      setLandscapeLayoutEnabledState(!enabled);
      try {
        await setLandscapeLayoutEnabled(!enabled);
        await applyLandscapeLayoutPreference(!enabled);
      } catch {
        // The alert below gives the user a recoverable next step.
      }
      Alert.alert("Could not change orientation", "Please restart the app and try the landscape setting again.");
    } finally {
      setLandscapePreferenceBusy(false);
    }
  }

  function clearScrollButtonTimer(): void {
    if (!scrollButtonTimerRef.current) return;
    clearTimeout(scrollButtonTimerRef.current);
    scrollButtonTimerRef.current = undefined;
  }

  function clearConversationSearchTimer(): void {
    if (!conversationSearchTimerRef.current) return;
    clearTimeout(conversationSearchTimerRef.current);
    conversationSearchTimerRef.current = undefined;
  }

  function scheduleScrollButtonHide(): void {
    clearScrollButtonTimer();
    scrollButtonTimerRef.current = setTimeout(() => {
      setShowScrollToBottom(false);
      scrollButtonTimerRef.current = undefined;
    }, 1800);
  }

  function scrollConversationToBottom(): void {
    clearScrollButtonTimer();
    nearConversationBottomRef.current = true;
    setShowScrollToBottom(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  }

  function focusCompletedResponse(turnId: string): void {
    // Keep manual reading position intact, but follow a response that belongs
    // to the message the user just sent.
    if (!nearConversationBottomRef.current && !sending) return;
    lastFocusedResponseTurnIdRef.current = turnId;
    responseFocusTurnIdRef.current = turnId;
    setResponseFocusTurnId(turnId);
  }

  function handleConversationScroll(event: {
    nativeEvent: {
      contentOffset: { y: number };
      contentSize: { height: number };
      layoutMeasurement: { height: number };
    };
  }): void {
    if (turns.length === 0) {
      setShowScrollToBottom(false);
      return;
    }

    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const awayFromBottom = distanceFromBottom > 160;
    nearConversationBottomRef.current = !awayFromBottom;

    if (awayFromBottom) {
      setShowScrollToBottom(true);
      scheduleScrollButtonHide();
      return;
    }

    clearScrollButtonTimer();
    setShowScrollToBottom(false);
  }

  function markPersonaSpeaking(outputs: RenderedTurn["outputs"]): void {
    clearVisualStateTimer();
    if (isImageOnlyResponse(outputs)) {
      setPersonaVisualState("idle");
      return;
    }
    setPersonaVisualState("speaking");
    visualStateTimerRef.current = setTimeout(() => {
      setPersonaVisualState("idle");
      visualStateTimerRef.current = undefined;
    }, NON_AUDIO_SPEAKING_MS);
  }

  function markPersonaIdle(): void {
    clearVisualStateTimer();
    setPersonaVisualState("idle");
  }

  const openDrawer = useCallback(() => {
    setDrawerInteractive(true);
    drawerX.value = withTiming(0, { duration: 210 });
  }, [drawerX]);

  const closeDrawer = useCallback(() => {
    setDrawerInteractive(false);
    drawerX.value = withTiming(-drawerWidth, { duration: 190 });
  }, [drawerWidth, drawerX]);

  const returnToDrawer = useCallback(() => {
    setProfileSelection(undefined);
    setSettingsVisible(false);
    setSettingsPanel("main");
    mainSettingsScrollOffsetRef.current = 0;
    pendingMainSettingsOffsetRef.current = undefined;
    openDrawer();
  }, [openDrawer]);

  function openSettingsPanel(panel: SettingsPanel): void {
    // Snapshot the main settings scroll position before leaving it so
    // returnToSettingsHome can restore where the user left off.
    mainSettingsScrollOffsetRef.current = latestSettingsScrollOffsetRef.current;
    setProfileSelection(undefined);
    setProfileError(undefined);
    setProfileNotice(undefined);
    if (panel === "audio" || panel === "provider") {
      setAudioSettingsError(undefined);
      setAudioSettingsNotice(undefined);
    }
    if (panel === "profile") {
      setProfileUsername(authUser?.username ?? "");
      setPreferredName(authUser?.preferredName ?? "");
      setProfileGender(authUser?.gender ?? "");
      setBirthMonth(authUser?.birthday?.month.toString() ?? "");
      setBirthDay(authUser?.birthday?.day.toString() ?? "");
    }
    setSettingsPanel(panel);
    // Sub-panels always open scrolled to the top.
    settingsScrollRef.current?.scrollTo({ y: 0, animated: false });
    if (panel === "sessions") void refreshActiveSessions();
    if (panel === "security") void refreshConnectedAccounts();
    if (panel === "memory") void refreshMemorySettings();
    if (panel === "plan") void refreshPlanUsage();
  }

  async function refreshPlanUsage(): Promise<void> {
    const requestedAccountId = authUser?.id;
    setPlanUsageLoading(true);
    setPlanUsageError(undefined);
    try {
      const usage = await api.getPlanUsage();
      if (currentAccountIdRef.current === requestedAccountId) setPlanUsage(usage);
    } catch (usageError) {
      if (currentAccountIdRef.current === requestedAccountId) {
        setPlanUsageError(usageError instanceof Error ? usageError.message : "Could not load plan usage.");
      }
    } finally {
      if (currentAccountIdRef.current === requestedAccountId) setPlanUsageLoading(false);
    }
  }

  async function refreshMemorySettings(): Promise<void> {
    const requestedAccountId = authUser?.id;
    setMemoryBusy(true);
    setMemoryError(undefined);
    try {
      const enabled = await api.getMemorySettings();
      if (currentAccountIdRef.current === requestedAccountId) setMemoryEnabled(enabled);
    } catch (memoryLoadError) {
      if (currentAccountIdRef.current === requestedAccountId) {
        setMemoryError(memoryLoadError instanceof Error ? memoryLoadError.message : "Could not load memory settings.");
      }
    } finally {
      if (currentAccountIdRef.current === requestedAccountId) setMemoryBusy(false);
    }
  }

  async function updateMemoryEnabled(enabled: boolean): Promise<void> {
    setMemoryBusy(true);
    setMemoryError(undefined);
    setMemoryNotice(undefined);
    try {
      const saved = await api.updateMemorySettings(enabled);
      setMemoryEnabled(saved);
      setAuthUser((current) => current ? { ...current, memoryEnabled: saved } : current);
      setMemoryNotice(saved ? "Chat memory is on." : "Chat memory is off.");
    } catch (memoryUpdateError) {
      setMemoryError(memoryUpdateError instanceof Error ? memoryUpdateError.message : "Could not update memory settings.");
    } finally {
      setMemoryBusy(false);
    }
  }

  async function updateConciseAudioResponses(enabled: boolean): Promise<void> {
    setAudioSettingsBusy(true);
    setAudioSettingsError(undefined);
    setAudioSettingsNotice(undefined);
    try {
      const updatedUser = await api.updateProfile({ conciseAudioResponses: enabled });
      setAuthUser(updatedUser);
      setConciseAudioResponses(updatedUser.conciseAudioResponses ?? enabled);
      setAudioSettingsNotice(enabled
        ? "Shorter audio responses are on."
        : "Full-length audio responses are on.");
    } catch (audioSettingsUpdateError) {
      setAudioSettingsError(audioSettingsUpdateError instanceof Error
        ? audioSettingsUpdateError.message
        : "Could not update audio settings.");
    } finally {
      setAudioSettingsBusy(false);
    }
  }

  async function updateModelProvider(modelProvider: "openai" | "gemini"): Promise<void> {
    if (modelProvider === (authUser?.modelProvider ?? "openai")) return;
    setAudioSettingsBusy(true);
    setAudioSettingsError(undefined);
    try {
      const updatedUser = await api.updateProfile({ modelProvider });
      setAuthUser(updatedUser);
      setProvider(updatedUser.modelProvider ?? modelProvider);
      setAudioSettingsNotice(`${modelProvider === "gemini" ? "Gemini" : "ChatGPT"} will answer new requests.`);
    } catch (providerError) {
      setAudioSettingsError(providerError instanceof Error ? providerError.message : "Could not update the model provider.");
    } finally {
      setAudioSettingsBusy(false);
    }
  }

  function confirmClearMemory(scope: "chat" | "all"): void {
    const isChat = scope === "chat";
    Alert.alert(
      isChat ? "Forget this chat?" : "Clear all memory?",
      isChat
        ? "This removes the memory condensed from the current chat."
        : "This removes saved memory from every chat in your account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isChat ? "Forget" : "Clear all",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setMemoryBusy(true);
              setMemoryError(undefined);
              setMemoryNotice(undefined);
              try {
                if (isChat) {
                  if (!conversationId) return;
                  await api.clearConversationMemory(conversationId);
                  setMemoryNotice("This chat’s saved memory was removed.");
                } else {
                  await api.clearAllMemory();
                  setMemoryNotice("Memory was removed from all of your chats.");
                }
              } catch (memoryClearError) {
                setMemoryError(memoryClearError instanceof Error ? memoryClearError.message : "Could not clear memory.");
              } finally {
                setMemoryBusy(false);
              }
            })();
          }
        }
      ]
    );
  }

  function selectProfileOption(value: string): void {
    if (profileSelection === "gender") {
      setProfileGender(value as AuthUser["gender"] | "");
    } else if (profileSelection === "month") {
      setBirthMonth(value);
      if (birthDay && Number(birthDay) > profileDaysInMonth(value)) setBirthDay("");
    } else if (profileSelection === "day") {
      setBirthDay(value);
    }
    setProfileSelection(undefined);
    setProfileError(undefined);
  }

  async function savePersonalizationProfile(): Promise<void> {
    if (profileBusy || !profileHasChanges) return;
    if (Boolean(birthMonth) !== Boolean(birthDay)) {
      setProfileError("Enter both a birthday month and day, or leave both blank.");
      return;
    }
    const nextUsername = profileUsername.trim();
    if (authUser?.username && !nextUsername) {
      setProfileError("A username cannot be blank. Enter a new username instead.");
      return;
    }
    setProfileBusy(true);
    setProfileError(undefined);
    setProfileNotice(undefined);
    try {
      const updatedUser = await api.updateProfile({
        ...(nextUsername ? { username: nextUsername } : {}),
        preferredName: preferredName.trim() || null,
        gender: profileGender || null,
        birthday: birthMonth && birthDay
          ? { month: Number(birthMonth), day: Number(birthDay) }
          : null
      });
      setAuthUser(updatedUser);
      setProfileNotice("Changes saved");
    } catch (profileSaveError) {
      setProfileError(profileSaveError instanceof Error ? profileSaveError.message : "Could not update your profile.");
    } finally {
      setProfileBusy(false);
    }
  }

  async function removeBirthday(): Promise<void> {
    if (profileBusy) return;
    setProfileBusy(true);
    setProfileError(undefined);
    setProfileNotice(undefined);
    try {
      const updatedUser = await api.updateProfile({ birthday: null });
      setAuthUser(updatedUser);
      setBirthMonth("");
      setBirthDay("");
      setProfileNotice("Birthday removed");
    } catch (profileRemoveError) {
      setProfileError(profileRemoveError instanceof Error ? profileRemoveError.message : "Could not remove your birthday.");
    } finally {
      setProfileBusy(false);
    }
  }

  async function refreshConnectedAccounts(): Promise<void> {
    const requestedAccountId = authUser?.id;
    setSecurityLoading(true);
    setSecurityError(undefined);
    try {
      const accounts = await api.listConnectedAccounts();
      if (currentAccountIdRef.current === requestedAccountId) setConnectedAccounts(accounts);
    } catch (accountError) {
      if (currentAccountIdRef.current === requestedAccountId) {
        setSecurityError(accountError instanceof Error ? accountError.message : "Could not load connected accounts.");
      }
    } finally {
      if (currentAccountIdRef.current === requestedAccountId) setSecurityLoading(false);
    }
  }

  async function linkConnectedAccount(provider: OAuthProvider): Promise<void> {
    setSecurityLoading(true);
    setSecurityError(undefined);
    try {
      await api.linkConnectedAccount(provider);
      setConnectedAccounts(await api.listConnectedAccounts());
    } catch (accountError) {
      setSecurityError(accountError instanceof Error ? accountError.message : `Could not connect ${provider}.`);
    } finally {
      setSecurityLoading(false);
    }
  }

  function confirmUnlinkConnectedAccount(account: ConnectedAccount): void {
    const label = account.providerId === "google" ? "Google" : "Facebook";
    Alert.alert(`Disconnect ${label}?`, `You will no longer be able to sign in with ${label}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: () => void (async () => {
        setSecurityLoading(true);
        setSecurityError(undefined);
        try {
          await api.unlinkConnectedAccount(account.providerId, account.accountId);
          setConnectedAccounts(await api.listConnectedAccounts());
        } catch (accountError) {
          setSecurityError(accountError instanceof Error ? accountError.message : `Could not disconnect ${label}.`);
        } finally {
          setSecurityLoading(false);
        }
      })() }
    ]);
  }

  async function changeAccountPassword(): Promise<void> {
    if (newPassword.length < 10) {
      setSecurityError("New password must be at least 10 characters.");
      return;
    }
    if (newPassword !== newPasswordConfirmation) {
      setSecurityError("New passwords do not match.");
      return;
    }
    setSecurityLoading(true);
    setSecurityError(undefined);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirmation("");
      Alert.alert("Password updated", "Other signed-in devices have been logged out.");
    } catch (passwordError) {
      setSecurityError(passwordError instanceof Error ? passwordError.message : "Could not change your password.");
    } finally {
      setSecurityLoading(false);
    }
  }

  const returnToSettingsHome = useCallback(() => {
    setProfileSelection(undefined);
    // The effect below applies this once the main panel has re-laid out.
    // onContentSizeChange alone is not enough: when a sub-panel happens to
    // have the same content height as the main panel, that event never fires
    // and the restore would be skipped.
    pendingMainSettingsOffsetRef.current = mainSettingsScrollOffsetRef.current;
    setSettingsPanel("main");
  }, []);

  useEffect(() => {
    if (settingsPanel !== "main") return;
    const pendingOffset = pendingMainSettingsOffsetRef.current;
    if (pendingOffset === undefined) return;
    // Wait two frames so the main panel has re-rendered and laid out before
    // restoring; the ScrollView's onContentSizeChange re-applies the offset if
    // the content keeps growing in the meantime. Clearing here stops later
    // content growth (e.g. lazy-loaded data) from yanking the scroll position.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        settingsScrollRef.current?.scrollTo({ y: pendingOffset, animated: false });
        pendingMainSettingsOffsetRef.current = undefined;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [settingsPanel]);

  useEffect(() => {
    let active = true;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState !== "active") {
        // Persona speech is foreground-only. Relinquish audio focus immediately
        // so music, podcasts, and calls from other apps return to normal volume.
        void releaseCurrentAudioPlayback();
        markPersonaIdle();
        const pendingTurn = [...turnsRef.current].reverse().find(isStillRunningTurn);
        if (pendingTurn?.backgroundJobId) {
          updateTurnOutputs(pendingTurn.id, [{
            type: "status",
            status: "in_progress",
            message: "Thinking"
          }], pendingTurn.backgroundJobId);
        }
      }
      const resumed = (previousState === "background" || previousState === "inactive") && nextState === "active";
      if (!resumed || !authUser || !isOnline || sessionValidationInFlightRef.current) return;

      sessionValidationInFlightRef.current = true;
      void loadAuthenticatedUser()
        .then((user) => {
          if (!active) return;
          if (user) {
            setAuthUser(user);
            void reconcilePendingBackgroundTurn();
            return;
          }
          cancelActiveChatRequest();
          selectionGenerationRef.current += 1;
          conversationListGenerationRef.current += 1;
          dataTransferAbortControllerRef.current?.abort();
          dataTransferAbortControllerRef.current = undefined;
          setAuthUser(undefined);
          setDataTransferJob(undefined);
          setSettingsVisible(false);
          setActiveSessions([]);
          closeDrawer();
          setConversations([]);
          setConversationsRefreshing(false);
          setConversationId(undefined);
          setTurns([]);
          setTurnsCursor(null);
          setAuthMode("login");
          setAuthError("This session ended on another device. Sign in again to continue.");
          void purgeUserCache(authUser.id).catch(() => undefined);
          void clearSelectedConversationId().catch(() => undefined);
        })
        .catch((validationError) => {
          if (!active) return;
          setError(validationError instanceof Error
            ? `Could not verify your session after reconnecting. ${validationError.message}`
            : "Could not verify your session after reconnecting.");
        })
        .finally(() => {
          sessionValidationInFlightRef.current = false;
        });
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [authUser, closeDrawer, isOnline]);

  useEffect(() => {
    if (Platform.OS !== "android" || !authUser) return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (settingsVisible) {
        if (settingsPanel !== "main") {
          returnToSettingsHome();
        } else {
          returnToDrawer();
        }
        return true;
      }

      if (drawerInteractive) {
        closeDrawer();
        return true;
      }

      // The open conversation is the one screen where Android's normal back
      // behavior should leave the app. Drawer and settings behavior remains
      // handled above.
      return false;
    });

    return () => subscription.remove();
  }, [authUser, closeDrawer, drawerInteractive, returnToDrawer, returnToSettingsHome, settingsPanel, settingsVisible]);

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drawerX.value }]
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(drawerX.value, [-drawerWidth, 0], [0, 0.48], Extrapolation.CLAMP)
  }));

  const chatShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(drawerX.value, [-drawerWidth, 0], [0, 0], Extrapolation.CLAMP) }]
  }));

  // A pan recognizer around the entire drawer can take ownership of Android's
  // vertical drags before FlashList sees them, particularly in short
  // landscape viewports. Track only the completed touch instead: this keeps
  // the swipe-left close affordance without competing with native scrolling.
  const drawerTouchStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const handleDrawerTouchStart = useCallback((event: GestureResponderEvent) => {
    drawerTouchStartRef.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY
    };
  }, []);
  const handleDrawerTouchEnd = useCallback((event: GestureResponderEvent) => {
    const start = drawerTouchStartRef.current;
    drawerTouchStartRef.current = undefined;
    if (!start) return;
    const horizontalDistance = event.nativeEvent.pageX - start.x;
    const verticalDistance = event.nativeEvent.pageY - start.y;
    if (horizontalDistance < -56 && Math.abs(horizontalDistance) > Math.abs(verticalDistance) + 8) {
      closeDrawer();
    }
  }, [closeDrawer]);
  const edgeStartX = useSharedValue(-drawerWidth);
  const edgeGesture = Gesture.Pan().activeOffsetX(30).failOffsetY([-14, 14])
    .enabled(!drawerInteractive && !settingsVisible)
    .onBegin(() => {
      edgeStartX.value = drawerX.value;
    })
    .onUpdate((event) => {
      drawerX.value = Math.max(-drawerWidth, Math.min(0, edgeStartX.value + event.translationX));
    })
    .onEnd((event) => {
      if (drawerX.value > -drawerWidth + 40 || event.velocityX > 350) {
        drawerX.value = withTiming(0, { duration: 190 });
        runOnJS(setDrawerInteractive)(true);
        return;
      }
      drawerX.value = withTiming(-drawerWidth, { duration: 190 });
      runOnJS(setDrawerInteractive)(false);
    });

  async function refreshConversations(accountId = authUser?.id): Promise<ConversationSummary[]> {
    const generation = ++conversationListGenerationRef.current;
    const page = await queryClient.fetchQuery({
      ...conversationsPageQueryOptions(undefined, undefined, accountId),
      staleTime: 0
    });
    if (!page || generation !== conversationListGenerationRef.current) return [];
    const sorted = [...page.conversations].sort(sortConversationSummaries);
    setConversations(sorted);
    setConversationsCursor(page.nextCursor);
    return sorted;
  }

  function ensureUserCacheRestored(userId: string): Promise<void> {
    const existing = userCacheRestoreRef.current.get(userId);
    if (existing) return existing;
    const restore = restoreUserQueryCache(queryClient, userId).catch(() => undefined);
    userCacheRestoreRef.current.set(userId, restore);
    return restore;
  }

  async function purgeUserCache(userId: string): Promise<void> {
    userCacheSubscriptionRef.current?.();
    userCacheSubscriptionRef.current = undefined;
    await userCacheRestoreRef.current.get(userId)?.catch(() => undefined);
    userCacheRestoreRef.current.delete(userId);
    await clearUserQueryCache(queryClient, userId);
  }

  function hydrateCachedAccountData(userId: string): void {
    const conversationsOptions = conversationsPageQueryOptions(undefined, undefined, userId);
    const cachedConversations = queryClient.getQueryData(conversationsOptions.queryKey);
    if (!cachedConversations) return;
    const sorted = [...cachedConversations.conversations].sort(sortConversationSummaries);
    setConversations(sorted);
    setConversationsCursor(cachedConversations.nextCursor);
  }

  async function loadMoreConversations(): Promise<void> {
    if (!conversationsCursor || conversationsRefreshing) return;
    const generation = ++conversationListGenerationRef.current;
    setConversationsRefreshing(true);
    try {
      const page = await queryClient.fetchQuery(conversationsPageQueryOptions(conversationsCursor, undefined, authUser?.id));
      if (generation !== conversationListGenerationRef.current) return;
      setConversations((current) => [...current, ...page.conversations.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setConversationsCursor(page.nextCursor);
    } catch (loadError) {
      if (generation !== conversationListGenerationRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load more chats.");
    } finally {
      if (generation === conversationListGenerationRef.current) setConversationsRefreshing(false);
    }
  }

  function updateConversationSearch(query: string): void {
    setConversationSearchQuery(query);
    clearConversationSearchTimer();
    const generation = ++conversationSearchGenerationRef.current;
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      setConversationSearchResults([]);
      setConversationSearchCursor(null);
      setConversationSearching(false);
      return;
    }

    setConversationSearching(true);
    conversationSearchTimerRef.current = setTimeout(() => {
      conversationSearchTimerRef.current = undefined;
      void (async () => {
        try {
          const page = await queryClient.fetchQuery(conversationsPageQueryOptions(undefined, normalizedQuery, authUser?.id));
          if (generation !== conversationSearchGenerationRef.current) return;
          setConversationSearchResults(page.conversations);
          setConversationSearchCursor(page.nextCursor);
        } catch (searchError) {
          if (generation !== conversationSearchGenerationRef.current) return;
          setConversationSearchResults([]);
          setConversationSearchCursor(null);
          setError(searchError instanceof Error ? searchError.message : "Could not search chats.");
        } finally {
          if (generation === conversationSearchGenerationRef.current) setConversationSearching(false);
        }
      })();
    }, 220);
  }

  async function loadMoreConversationSearchResults(): Promise<void> {
    const normalizedQuery = conversationSearchQuery.trim();
    if (!normalizedQuery || !conversationSearchCursor || conversationSearching) return;
    const generation = conversationSearchGenerationRef.current;
    setConversationSearching(true);
    try {
      const page = await queryClient.fetchQuery(conversationsPageQueryOptions(conversationSearchCursor, normalizedQuery, authUser?.id));
      if (generation !== conversationSearchGenerationRef.current) return;
      setConversationSearchResults((current) => [...current, ...page.conversations.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setConversationSearchCursor(page.nextCursor);
    } catch (searchError) {
      if (generation === conversationSearchGenerationRef.current) {
        setError(searchError instanceof Error ? searchError.message : "Could not load more matching chats.");
      }
    } finally {
      if (generation === conversationSearchGenerationRef.current) setConversationSearching(false);
    }
  }

  async function refreshConversationSearchResults(): Promise<void> {
    const normalizedQuery = conversationSearchQuery.trim();
    if (!normalizedQuery) {
      await refreshConversationsFromDrawer();
      return;
    }
    const generation = ++conversationSearchGenerationRef.current;
    setConversationSearching(true);
    try {
      const page = await queryClient.fetchQuery({ ...conversationsPageQueryOptions(undefined, normalizedQuery, authUser?.id), staleTime: 0 });
      if (generation !== conversationSearchGenerationRef.current) return;
      setConversationSearchResults(page.conversations);
      setConversationSearchCursor(page.nextCursor);
    } catch (searchError) {
      if (generation === conversationSearchGenerationRef.current) {
        setError(searchError instanceof Error ? searchError.message : "Could not refresh matching chats.");
      }
    } finally {
      if (generation === conversationSearchGenerationRef.current) setConversationSearching(false);
    }
  }

  async function refreshConversationsFromDrawer(): Promise<void> {
    setConversationsRefreshing(true);
    try {
      await refreshConversations();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not refresh chats.");
    } finally {
      setConversationsRefreshing(false);
    }
  }

  function retryLoadAppData(): Promise<void> {
    if (appDataReloadInFlightRef.current) return appDataReloadInFlightRef.current;

    const reload = (async () => {
      setLoading(true);
      setError(undefined);
      setAuthError(undefined);
      setAuthChecked(false);
      try {
        const [user, providers, policies, savedPersonaId, savedConversationId] = await Promise.all([
          loadAuthenticatedUser(),
          api.getOAuthProviders().catch(() => []),
          api.getCurrentPolicies(),
          getSelectedPersonaId().catch(() => undefined),
          getSelectedConversationId().catch(() => undefined)
        ]);
        setAuthUser(user);
        setOAuthProviders(providers);
        setCurrentPolicies(policies);
        const personaList = await queryClient.fetchQuery(personasQueryOptions(user?.id));

        const selected = personaList.find((candidate) => candidate.id === savedPersonaId && candidate.available !== false)
          ?? (persona && persona.available !== false && personaList.some((candidate) => candidate.id === persona.id) ? persona : undefined)
          ?? personaList.find((candidate) => candidate.available !== false);
        if (user) {
          await ensureUserCacheRestored(user.id);
          hydrateCachedAccountData(user.id);
        }
        const [detail, nextConversations] = await Promise.all([
          selected && user ? queryClient.fetchQuery(personaQueryOptions(selected.id, user.id)) : undefined,
          hasCurrentPolicyConsent(user, policies) ? refreshConversations(user!.id) : []
        ]);
        if (detail) {
          setPersona(detail);
          const preferredProvider = user?.modelProvider ?? "openai";
          setProvider(detail.supportedProviders.includes(preferredProvider)
            ? preferredProvider
            : detail.supportedProviders[0] ?? "openai");
          void setSelectedPersonaId(detail.id).catch(() => undefined);
        }
        if (user) {
          if (!conversationId && savedConversationId && nextConversations.some((conversation) => conversation.id === savedConversationId)) {
            await selectConversation(savedConversationId, { keepDrawerOpen: true, accountId: user.id });
          }
        }
      } catch (retryError) {
        setError(retryError instanceof Error ? retryError.message : "Could not load mobile app data.");
      } finally {
        setAuthChecked(true);
        setLoading(false);
      }
    })();
    appDataReloadInFlightRef.current = reload;
    void reload.finally(() => {
      if (appDataReloadInFlightRef.current === reload) appDataReloadInFlightRef.current = undefined;
    });
    return reload;
  }

  function appendPickedFiles(files: MobilePickedFile[]): void {
    const oversized = files.find((file) => file.size !== undefined && file.size > MAX_OPENAI_IMAGE_EDIT_BYTES);
    if (oversized) {
      Alert.alert("File too large", `${oversized.name} must be smaller than 50 MB.`);
    }
    const accepted = files.filter((file) => file.size === undefined || file.size <= MAX_OPENAI_IMAGE_EDIT_BYTES);
    setSelectedFiles((current) => {
      const availableSlots = Math.max(0, MAX_CHAT_ATTACHMENTS - current.length);
      if (accepted.length > availableSlots) {
        Alert.alert("Attachment limit", `You can attach up to ${MAX_CHAT_ATTACHMENTS} files to one message.`);
      }
      return [...current, ...accepted.slice(0, availableSlots)];
    });
  }

  function pickedId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function fileNameFromUri(uri: string, fallback: string): string {
    const lastSegment = uri.split("/").pop();
    return lastSegment && lastSegment.includes(".") ? lastSegment : fallback;
  }

  async function pickImage(): Promise<void> {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Photos unavailable", "Allow photo access to attach images.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
        allowsMultipleSelection: true
      });
      if (result.canceled) return;
      appendPickedFiles(result.assets.map((asset, index) => ({
        id: pickedId("image"),
        uri: asset.uri,
        name: asset.fileName ?? fileNameFromUri(asset.uri, `image-${index + 1}.jpg`),
        mimeType: asset.mimeType ?? "image/jpeg",
        kind: "image",
        size: asset.fileSize
      })));
    } catch (pickerError) {
      Alert.alert("Photo picker failed", pickerError instanceof Error ? pickerError.message : "Could not open your photo library.");
    }
  }

  async function pickDocument(): Promise<void> {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true
      });
      if (result.canceled) return;
      appendPickedFiles(result.assets.map((asset) => ({
        id: pickedId("file"),
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
        kind: asset.mimeType?.startsWith("image/") ? "image" : "file",
        size: asset.size
      })));
    } catch (pickerError) {
      Alert.alert("File picker failed", pickerError instanceof Error ? pickerError.message : "Could not open the file picker.");
    }
  }

  function openAttachmentPicker(): void {
    setAttachmentMenuVisible(true);
  }

  function chooseAttachment(kind: "photo" | "file"): void {
    setAttachmentMenuVisible(false);
    if (kind === "photo") {
      void pickImage();
      return;
    }
    void pickDocument();
  }

  function mapUploadedAssetsToUserAssets(assets: UploadedAsset[]): NonNullable<RenderedTurn["userAssets"]> {
    return assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      ...(asset.url ? { url: asset.url } : {})
    }));
  }

  function isImageOnlyResponse(outputs: RenderedTurn["outputs"]): boolean {
    const hasImage = outputs.some((output) => output.type === "image");
    if (!hasImage) return false;
    return outputs.every((output) => {
      if (output.type === "image" || output.type === "status" || output.type === "tool_call" || output.type === "tool_result") return true;
      if (output.type === "text") return output.text.trim().length === 0;
      return false;
    });
  }

  function shouldEnableImageGeneration(message: string, files: Array<{ kind: "image" | "file" }>): boolean {
    return IMAGE_REQUEST_PATTERN.test(message) ||
      files.some((file) => file.kind === "image") && /\b(edit|change|remove|replace|recolor|retouch|put|add|turn|make)\b/i.test(message);
  }

  async function copyMessage(label: string, message: string): Promise<void> {
    if (!message.trim()) return;
    try {
      await Clipboard.setStringAsync(message);
      Alert.alert("Copied", label);
    } catch (copyError) {
      Alert.alert(label, copyError instanceof Error ? copyError.message : "Could not copy this message.");
    }
  }

  function editUserMessage(message: string): void {
    currentComposerDraftRef.current = message;
    setComposerDraft(message);
  }

  function showUserMessageActions(turn: RenderedTurn): void {
    setUserActionTurn(turn);
  }

  function showAssistantActions(turn: RenderedTurn): void {
    setAssistantActionTurn(turn);
  }

  function showReferences(references: Citation[]): void {
    const validReferences = references.filter((reference) => {
      try {
        const parsed = new URL(reference.url);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return false;
      }
    });
    setAssistantActionTurn(undefined);
    if (validReferences.length === 0) {
      Alert.alert("References unavailable", "This response did not include any web links that can be opened safely.");
      return;
    }
    setReferenceSources(validReferences);
  }

  function showUnsafeOutputReport(turn: RenderedTurn): void {
    setAssistantActionTurn(undefined);
    setReportTarget(turn);
    setReportCategory(undefined);
    setReportDetails("");
    setReportError(undefined);
  }

  async function submitUnsafeOutputReport(): Promise<void> {
    if (!reportTarget || !reportCategory || !conversationId || reportBusy) return;
    setReportBusy(true);
    setReportError(undefined);
    try {
      const excerpt = assistantTextForDisplay(reportTarget).trim() || JSON.stringify(reportTarget.outputs);
      await api.reportUnsafeOutput({
        conversationId,
        category: reportCategory,
        outputExcerpt: excerpt.slice(0, 4000),
        ...(reportDetails.trim() ? { details: reportDetails.trim() } : {})
      });
      setReportTarget(undefined);
      Alert.alert("Report received", "Thank you. Your report was saved for safety review.");
    } catch (reportFailure) {
      setReportError(reportFailure instanceof Error ? reportFailure.message : "Could not submit this report.");
    } finally {
      setReportBusy(false);
    }
  }

  async function openReference(reference: Citation): Promise<void> {
    try {
      const parsed = new URL(reference.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("This reference uses an unsupported URL scheme.");
      }
      const canOpen = await Linking.canOpenURL(parsed.toString());
      if (!canOpen) throw new Error("This reference cannot be opened on this device.");
      await Linking.openURL(parsed.toString());
    } catch (openError) {
      Alert.alert("Open failed", openError instanceof Error ? openError.message : "Could not open this reference.");
    }
  }

  function showPersonaAudioMenu(): void {
    Alert.alert(
      "Persona audio",
      audioEnabled ? "Turn off persona audio?" : "Turn on persona audio?",
      [
        {
          text: "Yes",
          onPress: () => setAudioEnabled((enabled) => !enabled)
        },
        { text: "No", style: "cancel" }
      ]
    );
  }

  function updateComposerDraft(nextDraft: string): void {
    currentComposerDraftRef.current = nextDraft;
    setComposerDraft(nextDraft);
  }

  function handleSpeechResult(event: ExpoSpeechRecognitionResultEvent): void {
    const transcript = event.results[0]?.transcript.trim();
    if (!transcript) return;
    const baseDraft = speechBaseDraftRef.current.trim();
    const nextDraft = baseDraft ? `${baseDraft} ${transcript}` : transcript;
    currentComposerDraftRef.current = nextDraft;
    setComposerDraft(nextDraft);
  }

  function handleSpeechError(event: ExpoSpeechRecognitionErrorEvent): void {
    setVoiceInputActive(false);
    if (event.error === "aborted") return;
    Alert.alert("Voice input", event.message || "Speech recognition stopped before it could transcribe your voice.");
  }

  function attachSpeechRecognitionListeners(runtime: SpeechRecognitionRuntime): void {
    if (speechSubscriptionsRef.current.length > 0) return;
    const module = runtime.ExpoSpeechRecognitionModule;
    speechSubscriptionsRef.current = [
      module.addListener("start", () => setVoiceInputActive(true)),
      module.addListener("end", () => setVoiceInputActive(false)),
      module.addListener("result", handleSpeechResult),
      module.addListener("error", handleSpeechError)
    ];
  }

  function alertSpeechRecognitionUnavailable(error?: unknown): void {
    const detail = error instanceof Error ? error.message : undefined;
    Alert.alert(
      "Voice input unavailable",
      detail && !/Cannot find native module|undefined is not/i.test(detail)
        ? detail
        : "Speech recognition is not available in this build or on this device. If you are using Expo Go, rebuild the iOS/Android development app after installing speech recognition."
    );
  }

  async function loadSpeechRecognitionRuntime(): Promise<SpeechRecognitionRuntime | undefined> {
    if (speechRuntimeRef.current) return speechRuntimeRef.current;
    try {
      const runtime = require("expo-speech-recognition") as SpeechRecognitionRuntime;
      speechRuntimeRef.current = runtime;
      attachSpeechRecognitionListeners(runtime);
      return runtime;
    } catch (speechError) {
      alertSpeechRecognitionUnavailable(speechError);
      return undefined;
    }
  }

  async function toggleSpeechToText(): Promise<void> {
    const runtime = await loadSpeechRecognitionRuntime();
    if (!runtime) return;
    const module = runtime.ExpoSpeechRecognitionModule;

    if (voiceInputActive) {
      try {
        module.stop();
      } catch {
        setVoiceInputActive(false);
      }
      return;
    }

    try {
      if (!module.isRecognitionAvailable()) {
        alertSpeechRecognitionUnavailable();
        return;
      }

      const permission = await module.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Voice input permission needed",
          permission.canAskAgain
            ? "Microphone and speech recognition permissions are required for voice input."
            : "Microphone or speech recognition permission is disabled. Enable it in system settings to use voice input."
        );
        return;
      }

      speechBaseDraftRef.current = currentComposerDraftRef.current.trim();
      setVoiceInputActive(true);
      module.start({
        lang: "en-US",
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        addsPunctuation: true,
        iosTaskHint: "dictation",
        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: "free_form"
        }
      });
    } catch (speechError) {
      setVoiceInputActive(false);
      alertSpeechRecognitionUnavailable(speechError);
    }
  }

  async function retryAssistantTurn(turn: RenderedTurn): Promise<void> {
    if (sending) return;
    if (turns[turns.length - 1]?.id !== turn.id) return;
    const reusableAttachments = (turn.userAssets ?? []).map((asset): UploadedAsset => ({
      id: asset.id,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: 0,
      ...(asset.url ? { url: asset.url } : {})
    }));
    if (!turn.userMessage.trim() && reusableAttachments.length === 0) {
      setError("This response cannot be retried because its original message and attachments are unavailable.");
      return;
    }
    if (!turn.assistantMessageId) {
      setError("This response cannot be retried because its saved message is unavailable.");
      return;
    }
    await submit(turn.userMessage, {
      files: [],
      attachments: reusableAttachments,
      replaceTurnId: turn.id,
      retryAssistantMessageId: turn.assistantMessageId
    });
  }

  async function handleOutputAction(action: Extract<RenderedTurn["outputs"][number], { type: "action" }>): Promise<void> {
    if (action.action !== "resume_background_job") return;
    const jobId = typeof action.arguments?.jobId === "string" ? action.arguments.jobId : undefined;
    if (!jobId) return;
    const turn = turns.find((candidate) => candidate.backgroundJobId === jobId);
    if (turn) await resumeBackgroundJob(turn);
  }

  function wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new RequestCancelledError());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", handleAbort);
        resolve();
      }, ms);
      const handleAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", handleAbort);
        reject(new RequestCancelledError());
      };
      signal?.addEventListener("abort", handleAbort, { once: true });
    });
  }

  function cancelActiveChatRequest(): void {
    const controller = activeChatAbortControllerRef.current;
    activeChatAbortControllerRef.current = undefined;
    activeChatTurnIdRef.current = undefined;
    activeBackgroundJobIdRef.current = undefined;
    activeChatPersonaIdRef.current = undefined;
    activeSubmissionRef.current = undefined;
    controller?.abort();
    // Response-focus state belongs to the current conversation. Keeping it
    // across navigation can suppress the initial scroll when a chat is opened
    // again and leave the list at the previous conversation's offset.
    lastFocusedResponseTurnIdRef.current = undefined;
    responseFocusTurnIdRef.current = undefined;
    assistantOffsetByTurnIdRef.current.clear();
    setResponseFocusTurnId(undefined);
    nearConversationBottomRef.current = true;
    setShowScrollToBottom(false);
    setAssistantActionTurn(undefined);
    setReferenceSources([]);
    setReportTarget(undefined);
    setReportCategory(undefined);
    setReportDetails("");
    setReportError(undefined);
    setSending(false);
    setUploadingAttachments(false);
    setResumingJobId(undefined);
    markPersonaIdle();
  }

  function stopActiveChatRequest(): void {
    const controller = activeChatAbortControllerRef.current;
    const turnId = activeChatTurnIdRef.current;
    const backgroundJobId = activeBackgroundJobIdRef.current;
    const activeSubmission = activeSubmissionRef.current;
    if (!controller && !turnId) return;
    const activeTurn = turnId
      ? turnsRef.current.find((turn) => turn.id === turnId)
      : undefined;

    activeChatAbortControllerRef.current = undefined;
    activeChatTurnIdRef.current = undefined;
    activeBackgroundJobIdRef.current = undefined;
    activeSubmissionRef.current = undefined;
    controller?.abort();
    setSending(false);
    setUploadingAttachments(false);
    setResumingJobId(undefined);
    setError(undefined);
    markPersonaIdle();

    if (!turnId && activeSubmission) {
      currentComposerDraftRef.current = activeSubmission.message;
      setComposerDraft(activeSubmission.message);
      setSelectedFiles(activeSubmission.files);
    }
    if (turnId) {
      updateTurnOutputs(turnId, [{
        type: "status",
        status: "cancelled",
        message: "Request stopped."
      }], backgroundJobId);
    }
    if (backgroundJobId) {
      void api.cancelChatJob(backgroundJobId)
        .then((job) => {
          if (job.status === "completed" && job.response && turnId) {
            replaceTurnWithResponse(turnId, activeTurn?.userMessage ?? "", activeTurn?.userAssets, job.response);
            void refreshConversations().catch(() => undefined);
            return;
          }
          if (job.status === "failed" && turnId) {
            updateTurnOutputs(turnId, [{
              type: "status",
              status: "failed",
              message: job.error ?? "The request failed before it could be stopped."
            }], backgroundJobId);
            return;
          }
          if (job.status !== "cancelled" && turnId) {
            setError("The server has not confirmed cancellation yet. Use Check status to reconcile this request.");
            updateTurnOutputs(turnId, [{
              type: "status",
              status: "in_progress",
              message: "Cancellation has not been confirmed. Use Check status to reconcile this request."
            }], backgroundJobId);
          }
        })
        .catch((cancelError) => {
          const message = cancelError instanceof Error ? cancelError.message : "Server cancellation could not be confirmed.";
          setError(`The request stopped on this device, but the server could not confirm cancellation. ${message}`);
          if (turnId) {
            updateTurnOutputs(turnId, [{
              type: "status",
              status: "in_progress",
              message: "Cancellation could not be confirmed. Use Check status to reconcile this request."
            }], backgroundJobId);
          }
        });
    }
  }

  function backgroundStatusMessage(job: ChatJobResponse, checked: boolean): string {
    const updatedAt = new Date(job.updatedAt);
    const checkedAt = Number.isNaN(updatedAt.getTime())
      ? "just now"
      : updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return checked
      ? `Still working in the background. Last checked at ${checkedAt}.`
      : "Still working in the background. You can keep this chat open while it finishes.";
  }

  function updateTurnOutputs(turnId: string, outputs: RenderedTurn["outputs"], backgroundJobId?: string): void {
    setTurns((current) => {
      const next = current.map((turn) => (
        turn.id === turnId
        ? {
          ...turn,
          outputs,
          ...(backgroundJobId ? { backgroundJobId } : {})
        }
        : turn
      ));
      turnsRef.current = next;
      return next;
    });
  }

  function replaceTurnWithResponse(turnId: string, userMessage: string, userAssets: RenderedTurn["userAssets"], response: ChatResponse): void {
    const completedTurn: RenderedTurn = {
      ...turnFromChatResponse(userMessage, response),
      ...(userAssets ? { userAssets } : {})
    };
    // A background request can briefly lose its original foreground connection
    // before the resumed poll receives the completed result. Completion is
    // authoritative, so clear any transient reconnect banner with it.
    setError(undefined);
    setConversationId(response.conversationId);
    if (activePersonaIdRef.current === response.persona.id) {
      markPersonaSpeaking(response.outputs);
    }
    playGeneratedPersonaAudio(response.outputs);
    setTurns((current) => current.map((turn) => (
      turn.id === turnId ? completedTurn : turn
    )));
    focusCompletedResponse(completedTurn.id);
  }

  function isStillRunningTurn(turn: RenderedTurn): boolean {
    return Boolean(turn.backgroundJobId && turn.outputs.some((output) => output.type === "status" && output.status === "in_progress"));
  }

  async function pollChatJob(
    jobId: string,
    onStatus?: (job: ChatJobResponse) => void,
    signal?: AbortSignal
  ): Promise<ChatResponse> {
    const startedAt = Date.now();
    let intervalMs = 1200;
    let latestJob: ChatJobResponse | undefined;

    while (Date.now() - startedAt < BACKGROUND_POLL_TIMEOUT_MS) {
      const job = await api.getChatJob(jobId, signal);
      latestJob = job;
      if (job.status === "completed" && job.response) {
        return job.response;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        throw new BackgroundJobStateError(job);
      }
      onStatus?.(job);
      await wait(intervalMs, signal);
      intervalMs = Math.min(5000, Math.round(intervalMs * 1.35));
    }

    throw new BackgroundPollingTimeoutError(latestJob ?? await api.getChatJob(jobId, signal));
  }

  async function resumeBackgroundJob(turn: RenderedTurn, options?: { force?: boolean }): Promise<void> {
    const force = options?.force === true;
    if (!turn.backgroundJobId || (!force && (resumingJobId || sending || activeChatAbortControllerRef.current))) return;
    if (force) {
      const previousController = activeChatAbortControllerRef.current;
      activeChatAbortControllerRef.current = undefined;
      previousController?.abort();
      setSending(false);
      setUploadingAttachments(false);
      setResumingJobId(undefined);
    }
    const controller = new AbortController();
    activeChatAbortControllerRef.current = controller;
    activeChatTurnIdRef.current = turn.id;
    activeBackgroundJobIdRef.current = turn.backgroundJobId;
    activeChatPersonaIdRef.current = turn.personaId;
    setResumingJobId(turn.backgroundJobId);
    clearVisualStateTimer();
    if (turn.personaId === activePersonaIdRef.current) {
      setPersonaVisualState("thinking");
    }
    setError(undefined);
    try {
      const firstJob = await api.getChatJob(turn.backgroundJobId, controller.signal);
      if (firstJob.status === "completed" && firstJob.response) {
        replaceTurnWithResponse(turn.id, turn.userMessage, turn.userAssets, firstJob.response);
        await setSelectedConversationId(firstJob.response.conversationId).catch(() => undefined);
        await refreshConversations();
        return;
      }
      if (firstJob.status === "failed" || firstJob.status === "cancelled") {
        throw new BackgroundJobStateError(firstJob);
      }
      updateTurnOutputs(turn.id, [{ type: "status", status: "in_progress", message: "Thinking" }], firstJob.id);
      const response = await pollChatJob(firstJob.id, undefined, controller.signal);
      replaceTurnWithResponse(turn.id, turn.userMessage, turn.userAssets, response);
      await setSelectedConversationId(response.conversationId).catch(() => undefined);
      await refreshConversations();
    } catch (resumeError) {
      if (isRequestCancellation(resumeError)) return;
      if (resumeError instanceof BackgroundPollingTimeoutError) {
        if (turn.personaId === activePersonaIdRef.current) markPersonaIdle();
        updateTurnOutputs(turn.id, [{
          type: "status",
          status: "in_progress",
          message: backgroundStatusMessage(resumeError.job, true)
        }], resumeError.job.id);
        return;
      }
      if (resumeError instanceof BackgroundJobStateError) {
        const failedStatus = resumeError.job.status === "cancelled" ? "cancelled" : "failed";
        if (turn.personaId === activePersonaIdRef.current) markPersonaIdle();
        updateTurnOutputs(turn.id, [{
          type: "status",
          status: failedStatus,
          message: resumeError.job.error ?? resumeError.message
        }], resumeError.job.id);
        setError(resumeError.message);
        return;
      }
      if (turn.personaId === activePersonaIdRef.current) markPersonaIdle();
      setError(resumeError instanceof Error ? resumeError.message : "Could not check background job.");
    } finally {
      if (activeChatAbortControllerRef.current === controller) {
        activeChatAbortControllerRef.current = undefined;
        activeChatTurnIdRef.current = undefined;
        activeBackgroundJobIdRef.current = undefined;
        activeChatPersonaIdRef.current = undefined;
        setResumingJobId(undefined);
      }
    }
  }

  async function reconcilePendingBackgroundTurn(): Promise<void> {
    if (!isOnline) return;
    const pendingTurn = [...turnsRef.current].reverse().find(isStillRunningTurn);
    if (!pendingTurn) return;
    await resumeBackgroundJob(pendingTurn, { force: true });
  }

  async function finishAuth(user: AuthUser): Promise<void> {
    setAuthUser(user);
    setAuthChecked(true);
    setAuthError(undefined);
    setPassword("");
    setIdentifier("");
    setDisplayName("");
    setRegistrationConsent(false);
    try {
      const savedConversationId = await getSelectedConversationId().catch(() => undefined);
      await ensureUserCacheRestored(user.id);
      hydrateCachedAccountData(user.id);
      const nextConversations = hasCurrentPolicyConsent(user, currentPolicies)
        ? await refreshConversations(user.id)
        : [];
      if (savedConversationId && nextConversations.some((conversation) => conversation.id === savedConversationId)) {
        await selectConversation(savedConversationId, { keepDrawerOpen: true, accountId: user.id });
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Signed in, but could not load your chat history.");
    }
  }

  useEffect(() => {
    let mounted = true;
    async function loadInitial(): Promise<void> {
      setLoading(true);
      setError(undefined);
      setAuthError(undefined);
      try {
        const [user, providers, policies, savedPersonaId, savedConversationId] = await Promise.all([
          loadAuthenticatedUser(),
          api.getOAuthProviders().catch(() => []),
          api.getCurrentPolicies(),
          getSelectedPersonaId().catch(() => undefined),
          getSelectedConversationId().catch(() => undefined)
        ]);
        if (!mounted) return;
        setAuthUser(user);
        setAuthChecked(true);
        setOAuthProviders(providers);
        setCurrentPolicies(policies);
        const personaList = await queryClient.fetchQuery(personasQueryOptions(user?.id));
        if (!mounted) return;

        const selected = personaList.find((candidate) => candidate.id === savedPersonaId && candidate.available !== false)
          ?? personaList.find((candidate) => candidate.available !== false);
        if (user) {
          await ensureUserCacheRestored(user.id);
          if (!mounted) return;
          hydrateCachedAccountData(user.id);
        }
        const [detail, nextConversations] = await Promise.all([
          selected && user ? queryClient.fetchQuery(personaQueryOptions(selected.id, user.id)) : undefined,
          hasCurrentPolicyConsent(user, policies) ? refreshConversations(user!.id) : []
        ]);
        if (!mounted) return;
        if (detail) {
          const preferredProvider = user?.modelProvider ?? "openai";
          setProvider(detail.supportedProviders.includes(preferredProvider)
            ? preferredProvider
            : detail.supportedProviders[0] ?? "openai");
          setPersona(detail);
          void setSelectedPersonaId(detail.id).catch(() => undefined);
        }
        if (user) {
          if (savedConversationId && nextConversations.some((conversation) => conversation.id === savedConversationId)) {
            await selectConversation(savedConversationId, { keepDrawerOpen: true, accountId: user.id });
          }
        }
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Could not load mobile app data.");
      } finally {
        if (mounted) {
          setAuthChecked(true);
          setLoading(false);
        }
      }
    }
    void loadInitial();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    userCacheSubscriptionRef.current?.();
    userCacheSubscriptionRef.current = undefined;
    if (!authUser?.id) return;
    let cancelled = false;
    void ensureUserCacheRestored(authUser.id).then(() => {
      if (cancelled) return;
      userCacheSubscriptionRef.current = subscribeUserQueryCache(queryClient, authUser.id);
    });
    return () => {
      cancelled = true;
      userCacheSubscriptionRef.current?.();
      userCacheSubscriptionRef.current = undefined;
    };
  }, [authUser?.id]);

  useEffect(() => {
    if (!settingsVisible || !authUser) return;
    void refreshActiveSessions();
  }, [settingsVisible, authUser?.id]);

  useEffect(() => {
    if (!responseFocusTurnId) return;
    const index = turns.findIndex((turn) => turn.id === responseFocusTurnId);
    if (index < 0) return;
    let frame: number | undefined;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        const list = scrollRef.current;
        if (!list) return;

        const itemLayout = list.getLayout(index);
        const assistantOffset = assistantOffsetByTurnIdRef.current.get(responseFocusTurnId);
        const personaCardLayout = personaCardLayoutRef.current;
        const conversationLayout = conversationLayoutRef.current;

        if (personaCardIsDocked && itemLayout && assistantOffset !== undefined && personaCardLayout && conversationLayout) {
          const responseViewportY = Math.max(
            PERSONA_RESPONSE_FOCUS_GAP,
            personaCardLayout.y + personaCardLayout.height - conversationLayout.y + PERSONA_RESPONSE_FOCUS_GAP
          );
          list.scrollToOffset({
            animated: true,
            offset: Math.max(0, list.getFirstItemOffset() + itemLayout.y + assistantOffset - responseViewportY),
            skipFirstItemOffset: true
          });
        } else {
          void list.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0,
            viewOffset: personaCardIsDocked ? -responseFocusViewOffset : responseFocusViewOffset
          });
        }

        responseFocusTurnIdRef.current = undefined;
        setResponseFocusTurnId((current) => current === responseFocusTurnId ? undefined : current);
      });
    }, 80);
    return () => {
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [personaCardIsDocked, responseFocusLayoutVersion, responseFocusTurnId, responseFocusViewOffset, turns]);

  useEffect(() => {
    if (lastFocusedResponseTurnIdRef.current === turns[turns.length - 1]?.id) return;
    requestAnimationFrame(() => {
      if (nearConversationBottomRef.current || sending) {
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    });
  }, [turns.length, sending]);

  useEffect(() => () => {
    clearVisualStateTimer();
    clearScrollButtonTimer();
  }, []);

  async function selectPersona(personaId: string): Promise<void> {
    const selectedSummary = personas.find((candidate) => candidate.id === personaId);
    if (selectedSummary?.available === false) {
      setError(`${selectedSummary.name} is not included in your current plan.`);
      closeDrawer();
      return;
    }
    if (personaId === activePersona?.id) {
      closeDrawer();
      return;
    }
    const requestInFlight = Boolean(activeChatAbortControllerRef.current);
    const selectionGeneration = ++selectionGenerationRef.current;
    setLoadingEarlierTurns(false);
    try {
      if (!requestInFlight) setLoading(true);
      if (!authUser) {
        throw new Error("Sign in before switching personas.");
      }
      const detail = await queryClient.fetchQuery(personaQueryOptions(personaId, authUser.id));
      if (selectionGeneration !== selectionGenerationRef.current) return;
      activePersonaIdRef.current = detail.id;
      setPersona(detail);
      setProvider(detail.supportedProviders.includes(provider) ? provider : detail.supportedProviders[0] ?? "openai");
      void setSelectedPersonaId(detail.id).catch(() => undefined);
      if (activeChatPersonaIdRef.current) {
        clearVisualStateTimer();
        setPersonaVisualState(activeChatPersonaIdRef.current === detail.id ? "thinking" : "idle");
      }
      closeDrawer();
    } catch (selectError) {
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setError(selectError instanceof Error ? selectError.message : "Could not switch persona.");
    } finally {
      if (!requestInFlight && selectionGeneration === selectionGenerationRef.current) setLoading(false);
    }
  }

  async function selectConversation(nextConversationId: string, options?: { keepDrawerOpen?: boolean; accountId?: string }): Promise<void> {
    cancelActiveChatRequest();
    const selectionGeneration = ++selectionGenerationRef.current;
    setLoadingEarlierTurns(false);
    try {
      setLoading(true);
      setError(undefined);
      const page = await queryClient.fetchQuery(conversationTurnsQueryOptions(nextConversationId, undefined, options?.accountId ?? authUser?.id));
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setConversationId(page.conversation.id);
      await setSelectedConversationId(page.conversation.id).catch(() => undefined);
      setTurns(turnsFromConversationTurns(page.turns));
      setTurnsCursor(page.nextCursor);
      if (!options?.keepDrawerOpen) closeDrawer();
    } catch (loadError) {
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load that chat.");
    } finally {
      if (selectionGeneration === selectionGenerationRef.current) setLoading(false);
    }
  }

  async function loadEarlierTurns(): Promise<void> {
    if (!conversationId || !turnsCursor || loadingEarlierTurns) return;
    const selectionGeneration = selectionGenerationRef.current;
    setLoadingEarlierTurns(true);
    try {
      const page = await queryClient.fetchQuery(conversationTurnsQueryOptions(conversationId, turnsCursor, authUser?.id));
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setTurns((current) => [...turnsFromConversationTurns(page.turns), ...current]);
      setTurnsCursor(page.nextCursor);
    } catch (loadError) {
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load earlier messages.");
    } finally {
      if (selectionGeneration === selectionGenerationRef.current) setLoadingEarlierTurns(false);
    }
  }

  function newChat(): void {
    cancelActiveChatRequest();
    selectionGenerationRef.current += 1;
    setLoadingEarlierTurns(false);
    setConversationId(undefined);
    setTurns([]);
    setTurnsCursor(null);
    setSelectedFiles([]);
    void clearSelectedConversationId().catch(() => undefined);
    closeDrawer();
  }

  function showConversationActions(conversation: ConversationSummary): void {
    setConversationActionTarget(conversation);
  }

  async function renameConversation(): Promise<void> {
    const title = renameTitle.trim();
    if (!renameTarget || !title) return;
    try {
      const renamed = await renameConversationMutation.mutateAsync({ id: renameTarget.id, title });
      setConversations((current) => current.map((conversation) => (
        conversation.id === renamed.id ? renamed : conversation
      )).sort(sortConversationSummaries));
      setRenameTarget(undefined);
      setRenameTitle("");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename chat.");
    }
  }

  async function pinConversation(conversation: ConversationSummary): Promise<void> {
    try {
      const updated = await pinConversationMutation.mutateAsync({ id: conversation.id, pinned: !conversation.pinned });
      setConversations((current) => current.map((item) => (
        item.id === updated.id ? updated : item
      )).sort(sortConversationSummaries));
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : "Could not update pinned chat.");
    }
  }

  function confirmDeleteConversation(conversation: ConversationSummary): void {
    Alert.alert("Delete chat?", `"${conversation.title}" will be removed from your history.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void deleteConversation(conversation.id)
      }
    ]);
  }

  async function deleteConversation(nextConversationId: string): Promise<void> {
    if (conversationId === nextConversationId) cancelActiveChatRequest();
    try {
      await deleteConversationMutation.mutateAsync(nextConversationId);
      setConversations((current) => current.filter((conversation) => conversation.id !== nextConversationId));
      if (conversationId === nextConversationId) {
        selectionGenerationRef.current += 1;
        setConversationId(undefined);
        setTurns([]);
        setTurnsCursor(null);
        await clearSelectedConversationId().catch(() => undefined);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete chat.");
    }
  }

  async function submit(message: string, options?: {
    files?: MobilePickedFile[];
    attachments?: UploadedAsset[];
    replaceTurnId?: string;
    retryAssistantMessageId?: string;
  }): Promise<void> {
    if (!activePersona || sending || activeChatAbortControllerRef.current) return;
    if (!isOnline) {
      setError(t("network.offlineBody"));
      return;
    }
    const controller = new AbortController();
    const submittedPersona = activePersona;
    const submittedProvider = provider;
    const submittedAudioEnabled = audioEnabled;
    const submittedConversationId = conversationId;
    activeChatAbortControllerRef.current = controller;
    activeChatPersonaIdRef.current = submittedPersona.id;
    activeChatTurnIdRef.current = undefined;
    activeBackgroundJobIdRef.current = undefined;
    setSending(true);
    clearVisualStateTimer();
    setPersonaVisualState("thinking");
    setError(undefined);
    currentComposerDraftRef.current = "";
    setComposerDraft(undefined);
    const submittedFiles = options?.files ?? selectedFiles;
    activeSubmissionRef.current = options?.replaceTurnId
      ? undefined
      : {
          message,
          files: submittedFiles
        };
    if (!options?.files) setSelectedFiles([]);
    let optimistic: RenderedTurn | undefined;
    let backgroundJobId: string | undefined;
    let uploadedAttachments: UploadedAsset[] = [];
    let createdVectorStoreId: string | undefined;
    let chatRequestStarted = false;
    try {
      setUploadingAttachments(submittedFiles.length > 0);
      uploadedAttachments = submittedFiles.length > 0
        ? await api.uploadFiles(submittedFiles.map((file) => ({
          uri: file.uri,
          name: file.name,
          mimeType: file.mimeType,
          ...(file.size !== undefined ? { sizeBytes: file.size } : {})
        })), { signal: controller.signal })
        : [];
      const attachments = [...(options?.attachments ?? []), ...uploadedAttachments];
      const fileAttachmentIds = attachments
        .filter((attachment) => attachment.kind === "file")
        .map((attachment) => attachment.id);
      const vectorStore = fileAttachmentIds.length > 0
        ? await api.createVectorStore(fileAttachmentIds, `mobile-${Date.now()}`, controller.signal)
        : undefined;
      createdVectorStoreId = vectorStore?.id;
      const imageGeneration = shouldEnableImageGeneration(message, [
        ...submittedFiles,
        ...(options?.attachments ?? [])
      ]);
      const resolvedToolOptions = {
        webSearch: false,
        fileSearch: fileAttachmentIds.length > 0,
        codeInterpreter: false,
        imageGeneration,
        appFunctions: true,
        background: true,
        vectorStoreIds: vectorStore ? [vectorStore.id] : []
      };
      setUploadingAttachments(false);
      optimistic = {
        id: `pending-${Date.now()}`,
        ...(options?.retryAssistantMessageId
          ? { assistantMessageId: options.retryAssistantMessageId }
          : {}),
        personaId: submittedPersona.id,
        userMessage: message,
        userAssets: mapUploadedAssetsToUserAssets(attachments),
        assistantText: "",
        outputs: [{ type: "status", status: "in_progress", message: "Thinking" }]
      };
      activeChatTurnIdRef.current = optimistic.id;
      activeSubmissionRef.current = undefined;
      setTurns((current) => {
        const next = options?.replaceTurnId
          ? current.map((turn) => turn.id === options.replaceTurnId ? optimistic as RenderedTurn : turn)
          : [...current, optimistic as RenderedTurn];
        turnsRef.current = next;
        return next;
      });
      chatRequestStarted = true;
      const response = await api.sendChat({
        personaId: submittedPersona.id,
        message,
        provider: submittedProvider,
        audio: submittedAudioEnabled,
        clientContext: getClientContext(),
        toolOptions: resolvedToolOptions,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(options?.retryAssistantMessageId ? { retryAssistantMessageId: options.retryAssistantMessageId } : {}),
        ...(submittedConversationId ? { conversationId: submittedConversationId } : {})
      }, controller.signal);
      const backgroundJob = response.diagnostics.backgroundJob;
      if (backgroundJob) {
        backgroundJobId = backgroundJob.id;
        activeBackgroundJobIdRef.current = backgroundJob.id;
        setConversationId(response.conversationId);
        await setSelectedConversationId(response.conversationId).catch(() => undefined);
        updateTurnOutputs(optimistic.id, [{
          type: "status",
          status: "in_progress",
          message: "Thinking"
        }], backgroundJob.id);
      }
      const finalResponse = backgroundJob ? await pollChatJob(backgroundJob.id, undefined, controller.signal) : response;
      setConversationId(finalResponse.conversationId);
      await setSelectedConversationId(finalResponse.conversationId).catch(() => undefined);
      const completedTurn: RenderedTurn = {
        ...turnFromChatResponse(message, finalResponse),
        userAssets: mapUploadedAssetsToUserAssets(attachments)
      };
      setError(undefined);
      if (activePersonaIdRef.current === submittedPersona.id) {
        markPersonaSpeaking(finalResponse.outputs);
      }
      playGeneratedPersonaAudio(finalResponse.outputs);
      setTurns((current) => current.map((turn) => (
        turn.id === optimistic?.id ? completedTurn : turn
      )));
      focusCompletedResponse(completedTurn.id);
      await refreshConversations();
    } catch (sendError) {
      if (!chatRequestStarted) {
        await Promise.allSettled([
          ...uploadedAttachments.map((attachment) => api.deleteUpload(attachment.id)),
          ...(createdVectorStoreId ? [api.deleteVectorStore(createdVectorStoreId)] : [])
        ]);
      }
      if (isRequestCancellation(sendError)) return;
      const messageText = sendError instanceof Error ? sendError.message : "Message failed.";
      if (optimistic) {
        if (sendError instanceof BackgroundPollingTimeoutError) {
          setError(undefined);
          markPersonaIdle();
          updateTurnOutputs(optimistic.id, [{
            type: "status",
            status: "in_progress",
            message: backgroundStatusMessage(sendError.job, true)
          }], sendError.job.id);
          await refreshConversations().catch(() => undefined);
        } else if (sendError instanceof BackgroundJobStateError) {
          const failedStatus = sendError.job.status === "cancelled" ? "cancelled" : "failed";
          setError(sendError.message);
          markPersonaIdle();
          updateTurnOutputs(optimistic.id, [{
            type: "status",
            status: failedStatus,
            message: sendError.job.error ?? sendError.message
          }], sendError.job.id);
        } else {
          if (backgroundJobId) {
            // App resume starts a new controller for the durable job. Ignore a
            // late network failure from the superseded foreground request so it
            // cannot overwrite a successfully recovered response.
            if (activeChatAbortControllerRef.current !== controller) return;
            markPersonaIdle();
            setError("The app lost contact with the background request. Tap Check status or reopen the app to reconnect.");
            updateTurnOutputs(optimistic.id, [{
              type: "status",
              status: "in_progress",
              message: "Still working in the background. Status will be checked again when the app reconnects."
            }], backgroundJobId);
          } else {
            markPersonaIdle();
            setError(messageText);
            updateTurnOutputs(optimistic.id, [{ type: "status", status: "failed", message: messageText }]);
          }
        }
      } else {
        setError(messageText);
        markPersonaIdle();
        setSelectedFiles(submittedFiles);
      }
    } finally {
      if (activeChatAbortControllerRef.current === controller) {
        activeChatAbortControllerRef.current = undefined;
        activeChatTurnIdRef.current = undefined;
        activeBackgroundJobIdRef.current = undefined;
        activeChatPersonaIdRef.current = undefined;
        activeSubmissionRef.current = undefined;
        setUploadingAttachments(false);
        setSending(false);
      }
    }
  }

  async function submitAuth(): Promise<void> {
    if (!identifier.trim() || (authMode !== "forgot" && !password)) {
      setAuthError(authMode === "forgot" ? "Enter the email address on your account." : "Enter your email or username and password.");
      return;
    }
    if (authMode === "forgot" && !identifier.includes("@")) {
      setAuthError("Enter the email address on your account.");
      return;
    }
    if (authMode === "register" && password.length < 10) {
      setAuthError("Password must be at least 10 characters.");
      return;
    }
    setAuthBusy(true);
    setAuthError(undefined);
    try {
      const trimmedIdentifier = identifier.trim();
      if (authMode === "forgot") {
        await api.requestPasswordReset(trimmedIdentifier);
        Alert.alert("Check your email", "If that email belongs to an account, a reset link is on the way. The link opens a secure page in your browser.");
        setAuthMode("login");
        return;
      }
      if (authMode === "register" && (!registrationConsent || !currentPolicies)) {
        setAuthError("Accept the Terms of Use and Privacy Policy to create an account.");
        return;
      }
      const auth = authMode === "login"
        ? await api.login({ identifier: trimmedIdentifier, password })
        : authMode === "restore"
          ? await api.restoreAccount({ identifier: trimmedIdentifier, password })
          : await api.register({
          password,
          ...(trimmedIdentifier.includes("@") ? { email: trimmedIdentifier } : { username: trimmedIdentifier }),
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          policyConsent: {
            termsVersion: currentPolicies!.termsVersion,
            privacyVersion: currentPolicies!.privacyVersion
          }
        });
      await finishAuth(auth.user);
    } catch (authError) {
      setAuthError(authError instanceof Error ? authError.message : "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function startOAuth(provider: OAuthProvider): Promise<void> {
    setAuthBusy(true);
    setAuthError(undefined);
    try {
      const auth = await api.oauthLogin(provider);
      await finishAuth(auth.user);
      closeDrawer();
    } catch (oauthError) {
      setAuthError(oauthError instanceof Error ? oauthError.message : "Could not start OAuth sign in.");
    } finally {
      setAuthBusy(false);
    }
  }

  function confirmLogout(): void {
    Alert.alert("Log out?", "You'll need to sign back in to continue chatting.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => void logout() }
    ]);
  }

  async function logout(): Promise<void> {
    const signedOutUserId = authUser?.id;
    cancelActiveChatRequest();
    selectionGenerationRef.current += 1;
    conversationListGenerationRef.current += 1;
    let logoutError: string | undefined;
    try {
      if (dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status)) {
        await api.cancelDataTransferJob(dataTransferJob.id).catch(() => undefined);
      }
      dataTransferAbortControllerRef.current?.abort();
      dataTransferAbortControllerRef.current = undefined;
      await api.logout();
    } catch (error) {
      logoutError = error instanceof Error ? error.message : "Could not reach the server to revoke this session.";
    }
    if (signedOutUserId) {
      await purgeUserCache(signedOutUserId).catch(() => undefined);
    }
    setAuthUser(undefined);
    setDataTransferJob(undefined);
    setActiveSessions([]);
    setSettingsVisible(false);
    closeDrawer();
    setConversations([]);
    setConversationsRefreshing(false);
    setConversationId(undefined);
    void clearSelectedConversationId().catch(() => undefined);
    setTurns([]);
    setTurnsCursor(null);
    setAuthMode("login");
    setAuthError(logoutError ? `You were signed out on this device. ${logoutError}` : undefined);
    if (!logoutError) {
      Alert.alert("Logged out", "You have been signed out successfully.");
    }
  }

  async function refreshActiveSessions(): Promise<void> {
    if (!isOnline) {
      setSessionsError("Connect to the internet to refresh active devices.");
      return;
    }
    const requestedAccountId = authUser?.id;
    setSessionsLoading(true);
    setSessionsError(undefined);
    try {
      const sessions = await api.listActiveSessions();
      if (currentAccountIdRef.current === requestedAccountId) setActiveSessions(sessions);
    } catch (sessionError) {
      if (currentAccountIdRef.current === requestedAccountId) {
        setSessionsError(sessionError instanceof Error ? sessionError.message : "Could not load active sessions.");
      }
    } finally {
      if (currentAccountIdRef.current === requestedAccountId) setSessionsLoading(false);
    }
  }

  function confirmRevokeSession(session: ActiveSession): void {
    if (session.current) return;
    Alert.alert(
      "Log out this device?",
      `${activeSessionLabel(session)} will need to sign in again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out device",
          style: "destructive",
          onPress: () => {
            setSessionActionId(session.id);
            setSessionsError(undefined);
            void api.revokeActiveSession(session.id)
              .then(() => setActiveSessions((current) => current.filter((item) => item.id !== session.id)))
              .catch((sessionError) => {
                setSessionsError(sessionError instanceof Error ? sessionError.message : "Could not log out that device.");
              })
              .finally(() => setSessionActionId(undefined));
          }
        }
      ]
    );
  }

  function confirmRevokeOtherSessions(): void {
    Alert.alert(
      "Log out other devices?",
      "Every other active session will need to sign in again. This device will stay signed in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out others",
          style: "destructive",
          onPress: () => {
            setSessionActionId("others");
            setSessionsError(undefined);
            void api.revokeOtherSessions()
              .then(() => setActiveSessions((current) => current.filter((session) => session.current)))
              .catch((sessionError) => {
                setSessionsError(sessionError instanceof Error ? sessionError.message : "Could not log out other devices.");
              })
              .finally(() => setSessionActionId(undefined));
          }
        }
      ]
    );
  }

  function chooseAndroidArchiveAction(fileName: string): Promise<"save" | "share" | "cancel"> {
    return new Promise((resolve) => {
      Alert.alert("Export ready", fileName, [
        { text: "Save to device", onPress: () => resolve("save") },
        { text: "Share", onPress: () => resolve("share") },
        { text: "Cancel", style: "cancel", onPress: () => resolve("cancel") }
      ]);
    });
  }

  async function shareDataArchive(scope: "account" | "conversation", selectedConversationId?: string): Promise<void> {
    const controller = new AbortController();
    try {
      if (dataTransferActive) throw new Error("Another data transfer is already running.");
      dataTransferAbortControllerRef.current = controller;
      const targetConversationId = selectedConversationId ?? conversationId;
      if (scope === "conversation" && !targetConversationId) throw new Error("Open a conversation before exporting it.");
      const started = await api.startDataExportJob(scope === "account" ? "account" : "conversations", targetConversationId ? [targetConversationId] : undefined, controller.signal);
      setDataTransferJob(started);
      const completed = await api.waitForDataTransferJob(started.id, setDataTransferJob, controller.signal);
      if (!completed.downloadUrl) throw new Error("Export archive is not ready.");
      if (!FileSystem.documentDirectory) throw new Error("This device cannot create an export file.");
      const fileName = completed.fileName ?? `for-the-baddiez-${scope}-${new Date().toISOString().slice(0, 10)}.zip`;
      const uri = `${FileSystem.documentDirectory}${fileName}`;
      try {
        const downloaded = await FileSystem.downloadAsync(api.resolveUrl(completed.downloadUrl), uri, { headers: await api.mediaHeaders() });
        if (downloaded.status < 200 || downloaded.status >= 300) throw new Error(`Export download failed with status ${downloaded.status}.`);
        if (Platform.OS === "android") {
          const action = await chooseAndroidArchiveAction(fileName);
          if (action === "save") {
            const saved = await saveFileToDevice(uri, fileName, "application/zip");
            if (saved === "saved") {
              Alert.alert("Export saved", `Saved ${fileName} to your selected device folder.`);
            }
          } else if (action === "share") {
            if (!await Sharing.isAvailableAsync()) throw new Error("No compatible app is available to share this export.");
            await Sharing.shareAsync(uri, { mimeType: "application/zip", dialogTitle: "Share For the Baddiez data" });
          }
        } else if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "application/zip", dialogTitle: "Export For the Baddiez data" });
        } else {
          Alert.alert("Export saved", `Saved ${fileName} to the app documents folder.`);
        }
      } finally {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
    } catch (exportError) {
      if (!isAbortError(exportError)) Alert.alert("Export failed", exportError instanceof Error ? exportError.message : "Could not export your data.");
    } finally {
      if (dataTransferAbortControllerRef.current === controller) dataTransferAbortControllerRef.current = undefined;
    }
  }

  async function importConversationArchive(): Promise<void> {
    const controller = new AbortController();
    try {
      if (dataTransferActive) throw new Error("Another data transfer is already running.");
      dataTransferAbortControllerRef.current = controller;
      const result = await DocumentPicker.getDocumentAsync({ type: ["application/json", "application/zip", "text/plain"], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      assertSupportedImportSize(asset.size);
      const info = await FileSystem.getInfoAsync(asset.uri);
      const sizeBytes = asset.size ?? (info.exists && "size" in info ? info.size : undefined);
      if (!sizeBytes) throw new Error("Could not determine the import archive size.");
      const started = await api.startDataImportJob({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? (asset.name.toLowerCase().endsWith(".zip") ? "application/zip" : "application/json") }, sizeBytes, controller.signal);
      setDataTransferJob(started);
      const completed = await api.waitForDataTransferJob(started.id, setDataTransferJob, controller.signal);
      const imported = completed.result;
      if (!imported) throw new Error("Import completed without a result summary.");
      await refreshConversationsFromDrawer();
      Alert.alert("Import complete", `Imported ${imported.importedConversations} conversation${imported.importedConversations === 1 ? "" : "s"} from ${imported.source}.`);
    } catch (importError) {
      if (!isAbortError(importError)) Alert.alert("Import failed", importError instanceof Error ? importError.message : "Could not import this file.");
    } finally {
      if (dataTransferAbortControllerRef.current === controller) dataTransferAbortControllerRef.current = undefined;
    }
  }

  async function cancelDataTransfer(): Promise<void> {
    if (!dataTransferJob) return;
    const cancelled = await api.cancelDataTransferJob(dataTransferJob.id);
    setDataTransferJob(cancelled);
    dataTransferAbortControllerRef.current?.abort();
    dataTransferAbortControllerRef.current = undefined;
  }

  async function deleteAccount(): Promise<void> {
    if (deleteConfirmation !== "DELETE") {
      setDeleteAccountError("Type DELETE exactly to confirm.");
      return;
    }
    setDeleteAccountBusy(true);
    setDeleteAccountError(undefined);
    cancelActiveChatRequest();
    dataTransferAbortControllerRef.current?.abort();
    dataTransferAbortControllerRef.current = undefined;
    selectionGenerationRef.current += 1;
    conversationListGenerationRef.current += 1;
    const deletedUserId = authUser?.id;
    try {
      const result = await api.deleteAccount({
        confirmation: "DELETE",
        ...(deletePassword ? { password: deletePassword } : {})
      });
      const recoveryDate = new Date(result.deletionScheduledFor).toLocaleDateString();
      setDeleteAccountVisible(false);
      setSettingsVisible(false);
      setAuthUser(undefined);
      setDataTransferJob(undefined);
      setConversations([]);
      setConversationsRefreshing(false);
      setConversationId(undefined);
      setTurns([]);
      setTurnsCursor(null);
      setDeleteConfirmation("");
      setDeletePassword("");
      setAuthMode("restore");
      setAuthError(`Account deletion is scheduled for ${recoveryDate}. Restore it before then to keep your data.`);
      if (deletedUserId) {
        await purgeUserCache(deletedUserId).catch(() => undefined);
      }
      await clearSelectedConversationId().catch(() => undefined);
    } catch (error) {
      setDeleteAccountError(error instanceof Error ? error.message : "Could not schedule account deletion.");
    } finally {
      setDeleteAccountBusy(false);
    }
  }

  const suggestedPrompts = activePersona?.suggestedPrompts ?? [];
  const hasConversationSearch = conversationSearchQuery.trim().length > 0;
  const drawerConversations = hasConversationSearch ? conversationSearchResults : conversations;
  const drawerHasMoreConversations = hasConversationSearch ? Boolean(conversationSearchCursor) : Boolean(conversationsCursor);
  const assistantActionAudio = assistantActionTurn?.outputs.find(
    (output): output is Extract<RenderedTurn["outputs"][number], { type: "audio" }> => output.type === "audio"
  );
  const assistantActionReferences = assistantActionTurn?.outputs
    .filter((output): output is Extract<RenderedTurn["outputs"][number], { type: "source_list" }> => output.type === "source_list")
    .flatMap((output) => output.sources) ?? [];
  const canRetryAssistantAction = Boolean(assistantActionTurn && turns[turns.length - 1]?.id === assistantActionTurn.id);
  const profileSelectionOptions = profileSelection === "gender"
    ? PROFILE_GENDER_OPTIONS
    : profileSelection === "month"
      ? PROFILE_MONTH_OPTIONS
      : profileSelection === "day"
        ? Array.from({ length: profileDaysInMonth(birthMonth) }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))
        : [];
  const selectedProfileOption = profileSelection === "gender"
    ? profileGender ?? ""
    : profileSelection === "month"
      ? birthMonth
      : profileSelection === "day"
        ? birthDay
        : "";
  const profileBirthdayIncomplete = Boolean(birthMonth) !== Boolean(birthDay);
  const profileHasChanges =
    profileUsername.trim() !== (authUser?.username ?? "") ||
    preferredName.trim() !== (authUser?.preferredName ?? "").trim() ||
    profileGender !== (authUser?.gender ?? "") ||
    birthMonth !== (authUser?.birthday?.month.toString() ?? "") ||
    birthDay !== (authUser?.birthday?.day.toString() ?? "");
  const profileSelectionTitle = profileSelection === "gender"
    ? "Select gender"
    : profileSelection === "month"
      ? "Select birth month"
      : profileSelection === "day"
        ? "Select birth day"
        : "";
  chatTurnActionHandlersRef.current = {
    copyPrompt: (turn) => {
      void copyMessage("Prompt copied.", turn.userMessage);
    },
    editPrompt: (turn) => editUserMessage(turn.userMessage),
    showPromptActions: showUserMessageActions,
    outputAction: (action) => {
      void handleOutputAction(action);
    },
    resumeBackgroundJob: (turn) => {
      void resumeBackgroundJob(turn);
    },
    copyResponse: (turn) => {
      void copyMessage("Response copied.", assistantTextForDisplay(turn));
    },
    showResponseActions: showAssistantActions
  };
  const renderChatTurn = useCallback(({ item: turn }: { item: RenderedTurn }) => {
    const turnPersona = turn.personaId ? personaById.get(turn.personaId) : activePersona;
    return (
      <ChatTurn
        turn={turn}
        personaLabel={turnPersona?.shortName ?? turnPersona?.name ?? (turn.personaId ? "Retired persona" : "Persona")}
        personaAccent={turnPersona?.theme.accent ?? theme.accent}
        theme={theme}
        expanded={personaCardExpanded}
        checkingBackgroundJob={resumingJobId === turn.backgroundJobId}
        checkingLabel={t("chat.checking")}
        checkStatusLabel={t("chat.checkStatus")}
        onCopyPrompt={copyTurnPrompt}
        onEditPrompt={editTurnPrompt}
        onShowPromptActions={showTurnPromptActions}
        onOutputAction={handleTurnOutputAction}
        onResumeBackgroundJob={resumeTurnBackgroundJob}
        onCopyResponse={copyTurnResponse}
        onShowResponseActions={showTurnResponseActions}
        onAssistantLayout={handleAssistantLayout}
      />
    );
  }, [
    activePersona,
    copyTurnPrompt,
    copyTurnResponse,
    editTurnPrompt,
    handleTurnOutputAction,
    handleAssistantLayout,
    personaById,
    personaCardExpanded,
    resumingJobId,
    resumeTurnBackgroundJob,
    showTurnPromptActions,
    showTurnResponseActions,
    t,
    theme
  ]);
  const handlePersonaExpandedChange = (expanded: boolean): void => {
    setPersonaCardExpanded(expanded);
    if (expanded) setPersonaCardHidden(false);
  };

  if (!authUser) {
    return (
      <MobileAuthScreen
        checkingSession={!authChecked}
        mode={authMode}
        identifier={identifier}
        displayName={displayName}
        password={password}
        busy={authBusy}
        error={authError ?? error}
        oauthProviders={oauthProviders}
        currentPolicies={currentPolicies}
        registrationConsent={registrationConsent}
        theme={theme}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError(undefined);
        }}
        onIdentifierChange={setIdentifier}
        onDisplayNameChange={setDisplayName}
        onPasswordChange={setPassword}
        onRegistrationConsentChange={setRegistrationConsent}
        onSubmit={() => void submitAuth()}
        onOAuth={(oauthProvider) => void startOAuth(oauthProvider)}
        onRetry={() => void retryLoadAppData()}
        onOpenPublicPage={(path) => void openPublicWebPage(path).catch(() => {
          setAuthError("Could not open this page. Check your internet connection and try again.");
        })}
      />
    );
  }

  if (!currentPolicies || !hasCurrentPolicyConsent(authUser, currentPolicies)) {
    return (
      <MobilePolicyConsentScreen
        policies={currentPolicies}
        loading={loading}
        loadError={!currentPolicies ? error : undefined}
        theme={theme}
        onOpenPublicPage={(path) => void openPublicWebPage(path)}
        onAccept={async () => {
          if (!currentPolicies) return;
          await finishAuth(await api.acceptPolicies({
            termsVersion: currentPolicies.termsVersion,
            privacyVersion: currentPolicies.privacyVersion
          }));
        }}
        onRetry={() => void retryLoadAppData()}
        onLogout={async () => confirmLogout()}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <BackgroundGradient
        colors={[theme.background, theme.backgroundAlt, theme.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <GestureDetector gesture={edgeGesture}>
        <Animated.View style={[styles.chatPlane, chatShiftStyle]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={0}
            style={[
              styles.keyboard,
              tabletLayout ? styles.keyboardTablet : null,
              compactLayout ? styles.keyboardCompact : null,
              landscapeLayout ? styles.keyboardLandscape : null,
              {
                paddingTop: insets.top + (compactLayout ? 4 : 8),
                paddingBottom: Math.max(insets.bottom, 8),
                paddingLeft: (landscapeLayout ? landscapeLeftInset : insets.left) + chatHorizontalGutter,
                paddingRight: (landscapeLayout ? landscapeRightInset : insets.right) + chatHorizontalGutter
              }
            ]}
          >
          <View style={[styles.topBar, landscapeLayout ? styles.topBarLandscape : null, personaCardExpanded ? styles.layerAbovePersonaBackground : null]}>
            <IconButton name="menu" label={t("chat.openChats")} theme={theme} onPress={openDrawer} testID="mobile-open-chats" />
            <View style={styles.titleBlock}>
              <Text style={[styles.personaName, { color: theme.text }]} numberOfLines={1}>
                {activePersona?.name ?? "For the Baddiez"}
              </Text>
              <Text style={[styles.themeName, { color: theme.muted }]} numberOfLines={1}>
                {theme.name}
              </Text>
            </View>
            <IconButton
              name={audioEnabled ? "volume-high" : "volume-mute-outline"}
              label={audioEnabled ? t("chat.disableAudio") : t("chat.enableAudio")}
              theme={theme}
              onPress={() => setAudioEnabled((enabled) => !enabled)}
            />
          </View>

          <View>
            <NetworkStatusBanner theme={theme} onRetry={() => void retryLoadAppData()} />
          </View>

          {activePersona?.visualStage ? (
            <PersonaVisualStage
              expanded={personaCardExpanded}
              hidden={personaCardHidden}
              landscape={landscapeLayout}
              rightInset={landscapeLayout ? landscapeRightInset : insets.right}
              personaName={activePersona.name}
              profile={activePersona.visualStage}
              state={personaVisualState}
              theme={theme}
              visible={!drawerInteractive && !settingsVisible}
              onExpandedChange={handlePersonaExpandedChange}
              onHiddenChange={setPersonaCardHidden}
              onAppForeground={markPersonaIdle}
              onDockedLayout={handlePersonaCardLayout}
            />
          ) : null}

          {personaCardExpanded ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.minimizePersona")}
              onPress={() => setPersonaCardExpanded(false)}
              style={[
                styles.personaMinimizeButton,
                { top: tabletLayout ? 120 : compactLayout ? 100 : 112 },
                { right: 11 + (landscapeLayout ? landscapeRightInset : insets.right) },
                { borderColor: theme.border, backgroundColor: "rgba(23,15,33,0.82)" }
              ]}
            >
              <Ionicons name="contract-outline" size={20} color={theme.text} />
            </Pressable>
          ) : null}

          {error ? (
            <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={[styles.error, personaCardExpanded ? styles.layerAbovePersonaBackground : null, { borderColor: theme.danger }]}>
              <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("auth.tryAgain")}
                onPress={() => void retryLoadAppData()}
                style={[styles.errorRetryButton, { borderColor: theme.border }]}
              >
                <Text style={[styles.errorRetryText, { color: theme.text }]}>{t("auth.tryAgain")}</Text>
              </Pressable>
            </View>
          ) : null}

          <FlashList
            ref={scrollRef}
            data={turns}
            keyExtractor={(turn) => turn.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.history, compactLayout ? styles.historyCompact : null, landscapeLayout ? styles.historyLandscape : null]}
            style={StyleSheet.flatten([styles.conversationScroll, personaCardExpanded ? styles.layerAbovePersonaBackground : undefined])}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={80}
            onLayout={handleConversationLayout}
            onScroll={handleConversationScroll}
            onContentSizeChange={handleConversationContentSizeChange}
            maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 0.15 }}
            ListHeaderComponent={turnsCursor ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("chat.loadEarlier")} disabled={!isOnline || loadingEarlierTurns} onPress={() => void loadEarlierTurns()} style={[styles.loadEarlierButton, { borderColor: theme.border, opacity: isOnline ? 1 : 0.45 }]}>
                {loadingEarlierTurns ? <ActivityIndicator color={theme.accent2} /> : <Text style={[styles.loadEarlierText, { color: theme.text }]}>{t("chat.loadEarlier")}</Text>}
              </Pressable>
            ) : null}
            ListEmptyComponent={loading ? (
              <View accessibilityLiveRegion="polite" accessibilityLabel={t("chat.loadingPersonas")} style={styles.loadingState}>
                <ActivityIndicator color={theme.accent2} />
                <Text style={[styles.loadingText, { color: theme.muted }]}>{t("chat.loadingPersonas")}</Text>
              </View>
            ) : (
              <View style={[styles.emptyState, compactLayout ? styles.emptyStateCompact : null]}>
                <View
                  style={[
                    styles.avatarOrb,
                    compactLayout ? styles.avatarOrbCompact : null,
                    tabletLayout ? styles.avatarOrbTablet : null,
                    { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.055)" }
                  ]}
                >
                  {activePersona?.avatarUrl ? (
                    <Image
                      accessibilityLabel={activePersona.name}
                      source={{ uri: api.resolveUrl(activePersona.avatarUrl) }}
                      style={styles.emptyAvatarImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text style={[styles.avatarInitials, { color: theme.accent2 }]}>
                      {(activePersona?.name ?? "PW").split(" ").slice(0, 2).map((part) => part[0]).join("")}
                    </Text>
                  )}
                </View>
                <Text style={[styles.emptyTitle, compactLayout ? styles.emptyTitleCompact : null, { color: theme.text }]}>{activePersona?.documentTitle ?? "For the Baddiez"}</Text>
                <Text style={[styles.emptyCopy, { color: theme.muted }]}>
                  {activePersona?.tagline ?? "Choose a persona and start a chat."}
                </Text>
                <View style={styles.suggestions}>
                  {suggestedPrompts.slice(0, 3).map((prompt) => (
                    <Pressable
                      key={prompt}
                      accessibilityRole="button"
                      accessibilityLabel={prompt}
                      disabled={!isOnline}
                      onPress={() => void submit(prompt)}
                      style={[styles.suggestion, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.045)", opacity: isOnline ? 1 : 0.45 }]}
                    >
                      <Text style={[styles.suggestionText, { color: theme.text }]}>{prompt}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            renderItem={renderChatTurn}
          />

          {showScrollToBottom && turns.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.scrollLatest")}
              onPress={scrollConversationToBottom}
              style={[
                styles.scrollToBottomButton,
                { bottom: composerHeight + Math.max(insets.bottom, 8) + 12 },
                { backgroundColor: "rgba(255,255,255,0.13)", borderColor: theme.border }
              ]}
            >
              <Ionicons name="arrow-down" size={22} color={theme.text} />
            </Pressable>
          ) : null}

          <View>
            <ChatComposer
              theme={theme}
              compact={compactLayout}
              disabled={!activePersona || !isOnline}
              requestInProgress={sending || Boolean(resumingJobId)}
              uploadingAttachments={uploadingAttachments}
              voiceInputActive={voiceInputActive}
              attachments={selectedFiles}
              draftMessage={composerDraft}
              placeholder={!isOnline ? t("chat.offlineComposer") : voiceInputActive ? t("chat.listening") : activePersona?.promptPlaceholder ?? t("chat.askAnything")}
              onAttach={openAttachmentPicker}
              onAudioMenu={showPersonaAudioMenu}
              onDraftChange={updateComposerDraft}
              onMicPress={() => void toggleSpeechToText()}
              onHeightChange={setComposerHeight}
              onRemoveAttachment={(id) => setSelectedFiles((current) => current.filter((file) => file.id !== id))}
              onSubmit={(message) => void submit(message)}
              onStop={stopActiveChatRequest}
            />
          </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </GestureDetector>

      {drawerInteractive ? (
        <Animated.View style={[styles.overlay, overlayStyle]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close chats" style={StyleSheet.absoluteFill} onPress={closeDrawer} />
        </Animated.View>
      ) : null}

      <Animated.View
        onTouchCancel={() => {
          drawerTouchStartRef.current = undefined;
        }}
        onTouchEnd={handleDrawerTouchEnd}
        onTouchStart={handleDrawerTouchStart}
        style={[styles.drawerWrap, { width: drawerWidth }, drawerStyle]}
      >
        <ChatDrawer
          authUser={authUser}
          conversations={drawerConversations}
          activeConversationId={conversationId}
          personas={personas}
          activePersona={activePersona}
          theme={theme}
          topInset={insets.top}
          leftInset={landscapeLeftInset}
          rightInset={landscapeRightInset}
          bottomInset={insets.bottom}
          landscape={landscapeLayout}
          loading={loading}
          refreshing={hasConversationSearch ? conversationSearching : conversationsRefreshing}
          searchQuery={conversationSearchQuery}
          searching={conversationSearching}
          onClose={closeDrawer}
          onNewChat={newChat}
          onSelectConversation={(id) => void selectConversation(id)}
          onShowConversationActions={showConversationActions}
          onRefreshConversations={() => void refreshConversationSearchResults()}
          onSearchQueryChange={updateConversationSearch}
          onLoadMoreConversations={() => void (hasConversationSearch ? loadMoreConversationSearchResults() : loadMoreConversations())}
          hasMoreConversations={drawerHasMoreConversations}
          onSelectPersona={(id) => void selectPersona(id)}
          onShowLogin={() => undefined}
          onShowSettings={() => {
            mainSettingsScrollOffsetRef.current = 0;
            pendingMainSettingsOffsetRef.current = undefined;
            setSettingsPanel("main");
            setSettingsVisible(true);
          }}
        />
      </Animated.View>

      {settingsVisible ? (
        <ScrollView
          ref={settingsScrollRef}
          style={[styles.settingsScreen, { backgroundColor: theme.background }]}
          contentContainerStyle={[
            styles.settingsContent,
            landscapeLayout ? styles.settingsContentLandscape : null,
            {
              paddingTop: insets.top + 12,
              paddingBottom: Math.max(insets.bottom, 18),
              paddingLeft: Math.max(
                (landscapeLayout ? landscapeLeftInset : insets.left) + 16,
                landscapeLayout ? 32 : 20
              ),
              paddingRight: Math.max(
                (landscapeLayout ? landscapeRightInset : insets.right) + 16,
                landscapeLayout ? 32 : 20
              )
            }
          ]}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          showsVerticalScrollIndicator={false}
          onScroll={(event) => {
            latestSettingsScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            // Re-apply (without consuming) a pending main-panel restore as the
            // content regrows; the restore effect above owns clearing it.
            const pendingOffset = pendingMainSettingsOffsetRef.current;
            if (pendingOffset !== undefined) {
              settingsScrollRef.current?.scrollTo({ y: pendingOffset, animated: false });
            }
          }}
        >
          <View style={styles.settingsTopBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={settingsPanel === "main" ? "Back to chats" : "Back to account settings"}
              testID="mobile-settings-back"
              onPress={settingsPanel === "main" ? returnToDrawer : returnToSettingsHome}
              style={[styles.settingsBackButton, { backgroundColor: "rgba(255,255,255,0.08)" }]}
            >
              <Ionicons name="arrow-back" size={25} color={theme.text} />
            </Pressable>
            {settingsPanel !== "main" ? (
              <Text style={[styles.settingsPanelTitle, { color: theme.text }]}>
                {settingsPanel === "profile" ? "Personalization" : settingsPanel === "provider" ? "Provider settings" : settingsPanel === "plan" ? "Plan & usage" : settingsPanel === "audio" ? "Audio" : settingsPanel === "security" ? "Security & sign-in" : settingsPanel === "sessions" ? "Active sessions" : settingsPanel === "memory" ? "Memory" : settingsPanel === "about" ? "About" : "Your data"}
              </Text>
            ) : null}
          </View>
          {settingsPanel === "main" ? (
            <>
              <View style={styles.settingsProfile}>
                <View style={[styles.settingsAvatar, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.settingsAvatarText, { color: theme.text }]}>
                    {(authUser?.preferredName?.[0] ?? authUser?.displayName?.[0] ?? authUser?.username?.[0] ?? authUser?.email?.[0] ?? "P").toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.settingsName, { color: theme.text }]} numberOfLines={1}>
                  {authUser?.preferredName ?? authUser?.displayName ?? authUser?.username ?? "Account"}
                </Text>
                {authUser?.email ? <Text style={[styles.settingsEmail, { color: theme.muted }]} numberOfLines={1}>{authUser.email}</Text> : null}
              </View>
              <View style={styles.settingsSection}>
                <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Display</Text>
                <View style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="phone-landscape-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Landscape layout</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Rotate the interface when your phone turns sideways</Text>
                  </View>
                  <Switch
                    accessibilityLabel="Allow landscape layout"
                    disabled={landscapePreferenceBusy}
                    value={landscapeLayoutEnabled}
                    onValueChange={(enabled) => void updateLandscapeLayoutPreference(enabled)}
                    trackColor={{ false: "rgba(255,255,255,0.18)", true: theme.accent }}
                    thumbColor={theme.text}
                  />
                </View>
              </View>
              <View style={styles.settingsSection}>
                <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Account</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Open personalization profile" onPress={() => openSettingsPanel("profile")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="person-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Personalization</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Preferred name, gender, and birthday</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent2} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Open plan and usage" onPress={() => openSettingsPanel("plan")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="layers-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Plan &amp; usage</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Media allowances and reset dates</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent2} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Open provider settings" onPress={() => openSettingsPanel("provider")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="git-compare-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Provider settings</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>{(authUser?.modelProvider ?? "openai") === "gemini" ? "Gemini" : "ChatGPT"}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent2} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Open audio settings" onPress={() => openSettingsPanel("audio")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="volume-high-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Audio</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Spoken response length and usage</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent2} />
                </Pressable>
              </View>
              <View style={styles.settingsSection}>
                <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Manage</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Open security and sign-in" onPress={() => openSettingsPanel("security")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="key-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Security &amp; sign-in</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Password and connected accounts</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent2} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Open active sessions" onPress={() => openSettingsPanel("sessions")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="phone-portrait-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Active sessions</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>{activeSessions.length ? `${activeSessions.length} signed-in device${activeSessions.length === 1 ? "" : "s"}` : "Review signed-in devices"}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent2} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Open memory controls" onPress={() => openSettingsPanel("memory")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="sparkles-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Memory</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Control memory inside individual chats</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent2} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Open about links" onPress={() => openSettingsPanel("about")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="information-circle-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>About</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Policies, help, and support</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent2} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Open your data tools" onPress={() => openSettingsPanel("data")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="folder-open-outline" size={22} color={theme.text} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Your data</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>{dataTransferActive && dataTransferJob ? `${dataTransferJob.progress}% · ${dataTransferJob.phase}` : "Export or import your archive"}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent2} />
                </Pressable>
              </View>
              <View style={styles.settingsSection}>
                <Pressable accessibilityRole="button" testID="mobile-logout" onPress={confirmLogout} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="log-out-outline" size={22} color={theme.text} />
                  <Text style={[styles.settingsRowText, { color: theme.text }]}>Log out</Text>
                </Pressable>
                <Pressable accessibilityRole="button" testID="mobile-delete-account" onPress={() => { setDeleteAccountError(undefined); setDeleteAccountVisible(true); }} style={[styles.settingsRow, { backgroundColor: "rgba(190,55,79,0.12)" }]}>
                  <Ionicons name="trash-outline" size={22} color={theme.danger} />
                  <Text style={[styles.settingsRowText, { color: theme.danger }]}>Delete account</Text>
                </Pressable>
              </View>
            </>
          ) : null}
          {settingsPanel === "profile" ? (
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>
                These details are optional. Personas use them only when they naturally improve how they address you or tailor an answer.
              </Text>
              <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Username</Text>
              <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Used to sign in. Letters, numbers, periods, and underscores only.</Text>
              <TextInput
                accessibilityLabel="Username"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                maxLength={64}
                value={profileUsername}
                onChangeText={setProfileUsername}
                placeholder="Choose a username"
                placeholderTextColor={theme.muted}
                style={[styles.loginInput, styles.profileTextInput, { color: theme.text }]}
              />
              <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Preferred name</Text>
              <TextInput
                accessibilityLabel="Preferred name"
                autoCapitalize="words"
                autoComplete="name"
                maxLength={80}
                value={preferredName}
                onChangeText={setPreferredName}
                placeholder="What should the personas call you?"
                placeholderTextColor={theme.muted}
                style={[styles.loginInput, styles.profileTextInput, { color: theme.text }]}
              />
              <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Gender</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Select gender"
                onPress={() => setProfileSelection("gender")}
                style={[styles.profileSelectField, { borderColor: theme.border }]}
              >
                <Text style={[styles.profileSelectText, { color: theme.text }]}>
                  {PROFILE_GENDER_OPTIONS.find((option) => option.value === profileGender)?.label ?? "Not specified"}
                </Text>
                <Ionicons name="chevron-down" size={20} color={theme.accent2} />
              </Pressable>
              <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Birthday</Text>
              <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Month and day only. We do not ask for the year.</Text>
              <View style={styles.profileBirthdayRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Select birthday month"
                  onPress={() => setProfileSelection("month")}
                  style={[styles.profileSelectField, styles.profileBirthdayInput, { borderColor: theme.border }]}
                >
                  <Text numberOfLines={1} style={[styles.profileSelectText, { color: birthMonth ? theme.text : theme.muted }]}>
                    {PROFILE_MONTH_OPTIONS.find((option) => option.value === birthMonth)?.label ?? "Month"}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color={theme.accent2} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Select birthday day"
                  onPress={() => setProfileSelection("day")}
                  style={[styles.profileSelectField, styles.profileBirthdayInput, { borderColor: theme.border }]}
                >
                  <Text style={[styles.profileSelectText, { color: birthDay ? theme.text : theme.muted }]}>{birthDay || "Day"}</Text>
                  <Ionicons name="chevron-down" size={20} color={theme.accent2} />
                </Pressable>
              </View>
              {birthMonth && birthDay ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove birthday"
                  disabled={profileBusy}
                  onPress={() => void removeBirthday()}
                  style={[styles.profileBirthdayRemove, { borderColor: "rgba(255,180,192,0.24)", backgroundColor: "rgba(127,31,58,0.12)", opacity: profileBusy ? 0.55 : 1 }]}
                >
                  <Ionicons name="close-circle-outline" size={18} color={theme.danger} />
                  <Text style={{ color: theme.danger, fontWeight: "800" }}>Remove birthday</Text>
                </Pressable>
              ) : null}
              {profileBirthdayIncomplete ? (
                <Text accessibilityRole="alert" style={[styles.sessionErrorText, { color: theme.danger }]}>
                  Choose both a birthday month and day, or clear both fields.
                </Text>
              ) : null}
              {profileError ? <Text style={[styles.sessionErrorText, { color: theme.danger }]}>{profileError}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: profileBusy || profileBirthdayIncomplete || !profileHasChanges }}
                disabled={profileBusy || profileBirthdayIncomplete || !profileHasChanges}
                onPress={() => void savePersonalizationProfile()}
                style={[styles.settingsRow, { justifyContent: "center", backgroundColor: theme.accent2, opacity: profileBusy || profileBirthdayIncomplete || !profileHasChanges ? 0.45 : 1 }]}
              >
                {profileBusy ? <ActivityIndicator size="small" color="#170f20" /> : <Text style={{ color: "#170f20", fontWeight: "900" }}>Save changes</Text>}
              </Pressable>
              {profileNotice ? (
                <View accessibilityRole="alert" style={[styles.profileSaveConfirmation, { borderColor: "rgba(214,181,94,0.24)", backgroundColor: "rgba(214,181,94,0.09)" }]}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.accent2} />
                  <Text style={{ color: theme.text, fontWeight: "800" }}>{profileNotice}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {settingsPanel === "audio" ? (
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>
                Choose how long persona replies can be when audio is enabled.
              </Text>
              {audioSettingsError ? <Text style={[styles.settingsPanelDescription, { color: theme.danger }]} accessibilityRole="alert">{audioSettingsError}</Text> : null}
              {audioSettingsNotice ? <Text style={[styles.settingsPanelDescription, { color: theme.accent2 }]} accessibilityLiveRegion="polite">{audioSettingsNotice}</Text> : null}
              <View style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)", borderColor: "rgba(214,181,94,0.32)", borderWidth: 1 }]}>
                <Ionicons name="volume-medium-outline" size={22} color={theme.accent2} />
                <View style={styles.settingsRowCopy}>
                  <Text style={[styles.settingsRowHint, { color: theme.accent2, textTransform: "uppercase", letterSpacing: 1 }]}>Recommended</Text>
                  <Text style={[styles.settingsRowText, { color: theme.text }]}>Shorter audio responses</Text>
                  <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Usually around 60 seconds while preserving the main answer</Text>
                </View>
                <Switch
                  accessibilityLabel="Use shorter audio responses"
                  disabled={audioSettingsBusy}
                  value={conciseAudioResponses}
                  onValueChange={(enabled) => void updateConciseAudioResponses(enabled)}
                  trackColor={{ false: "rgba(255,255,255,0.18)", true: theme.accent }}
                  thumbColor={theme.text}
                />
              </View>
              {!conciseAudioResponses ? (
                <View style={[styles.settingsRow, { backgroundColor: "rgba(190,55,79,0.12)", borderColor: theme.danger, borderWidth: 1 }]}>
                  <Ionicons name="warning-outline" size={22} color={theme.danger} />
                  <View style={styles.settingsRowCopy}>
                    <Text style={[styles.settingsRowText, { color: theme.danger }]}>Full-length audio is on</Text>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Long replies can use several times more audio allowance and total usage credits. A request may be unavailable when your remaining allowance is too low.</Text>
                  </View>
                </View>
              ) : null}
              {audioSettingsBusy ? <ActivityIndicator color={theme.accent2} /> : null}
            </View>
          ) : null}
          {settingsPanel === "provider" ? (
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>Choose which model answers new requests. Existing chats and persona memory stay available when you switch.</Text>
              {audioSettingsError ? <Text style={[styles.settingsPanelDescription, { color: theme.danger }]} accessibilityRole="alert">{audioSettingsError}</Text> : null}
              {audioSettingsNotice ? <Text style={[styles.settingsPanelDescription, { color: theme.accent2 }]} accessibilityLiveRegion="polite">{audioSettingsNotice}</Text> : null}
              {([[
                "openai", "ChatGPT", "OpenAI model with the complete persona experience."
              ], [
                "gemini", "Gemini", "Gemini responses, search, analysis, and supported files."
              ]] as const).map(([value, label, description]) => {
                const selected = (authUser?.modelProvider ?? "openai") === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: audioSettingsBusy }}
                    disabled={audioSettingsBusy}
                    onPress={() => void updateModelProvider(value)}
                    style={[styles.settingsRow, { backgroundColor: selected ? `${theme.accent}30` : "rgba(255,255,255,0.09)", borderColor: selected ? theme.accent2 : theme.border, borderWidth: 1 }]}
                  >
                    <Ionicons name={value === "gemini" ? "sparkles-outline" : "chatbubble-ellipses-outline"} size={22} color={selected ? theme.accent2 : theme.text} />
                    <View style={styles.settingsRowCopy}>
                      <Text style={[styles.settingsRowText, { color: theme.text }]}>{label}</Text>
                      <Text style={[styles.settingsRowHint, { color: theme.muted }]}>{description}</Text>
                    </View>
                    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? theme.accent2 : theme.muted} />
                  </Pressable>
                );
              })}
              <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>Image generation may use the app’s specialized image service even when Gemini is selected.</Text>
              {audioSettingsBusy ? <ActivityIndicator color={theme.accent2} /> : null}
            </View>
          ) : null}
          {settingsPanel === "plan" ? (
            <View style={styles.settingsSection}>
              {planUsageLoading && !planUsage ? <ActivityIndicator color={theme.accent2} /> : null}
              {planUsageError ? <Text style={[styles.settingsPanelDescription, { color: theme.danger }]} accessibilityRole="alert">{planUsageError}</Text> : null}
              {planUsage ? (
                <>
                  <View style={[styles.settingsPlanCard, { backgroundColor: "rgba(255,255,255,0.09)", borderColor: theme.border }]}>
                    <Text style={[styles.settingsPlanName, { color: theme.text }]}>{planUsage.plan.displayName}</Text>
                    <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>{planUsage.plan.description}</Text>
                  </View>
                  <View style={[styles.settingsTotalUsageCard, { borderColor: theme.border }]}>
                    <View style={styles.settingsUsageHeading}>
                      <Text style={[styles.settingsTotalUsageLabel, { color: theme.text }]}>Total usage</Text>
                      <Text style={[styles.settingsTotalUsageRemaining, { color: theme.muted }]}>
                        {planUsage.totalUsage.percentRemaining}% left
                      </Text>
                    </View>
                    <View
                      accessible
                      accessibilityRole="progressbar"
                      accessibilityLabel="Total monthly usage remaining"
                      accessibilityValue={{
                        min: 0,
                        max: 100,
                        now: planUsage.totalUsage.percentRemaining,
                        text: `${planUsage.totalUsage.percentRemaining}% left`
                      }}
                      style={styles.settingsTotalUsageTrack}
                    >
                      <View
                        style={[
                          styles.settingsTotalUsageFill,
                          {
                            backgroundColor: theme.text,
                            width: `${planUsage.totalUsage.percentRemaining}%`
                          }
                        ]}
                      />
                    </View>
                    <Text style={[styles.settingsRowHint, { color: theme.muted }]}>
                      Includes text, searches, file work, charts, images, and audio · Resets{" "}
                      {new Date(planUsage.totalUsage.periodEnd).toLocaleDateString([], {
                        month: "long",
                        day: "numeric",
                        timeZone: "UTC"
                      })}
                    </Text>
                  </View>
                  {planUsage.meters.map((meter) => {
                    const used = meter.used + meter.reserved;
                    const percent = meter.limit ? Math.min(100, Math.round((used / meter.limit) * 100)) : 0;
                    const formatAmount = (value: number) => meter.unit === "seconds"
                      ? value === 0 ? "0 min" : value < 60 ? "<1 min" : `${Math.ceil(value / 60)} min`
                      : value.toLocaleString();
                    return (
                      <View key={meter.key} style={[styles.settingsUsageCard, { backgroundColor: "rgba(255,255,255,0.07)", borderColor: theme.border }]}>
                        <View style={styles.settingsUsageHeading}>
                          <Text style={[styles.settingsRowText, { color: theme.text }]}>{meter.label}</Text>
                          <Text style={[styles.settingsRowHint, { color: theme.muted }]}>
                            {formatAmount(used)} of {meter.limit === null ? "unlimited" : formatAmount(meter.limit)}
                          </Text>
                        </View>
                        {meter.limit !== null ? (
                          <View style={styles.settingsUsageTrack}>
                            <View style={[styles.settingsUsageFill, { backgroundColor: theme.accent2, width: `${percent}%` }]} />
                          </View>
                        ) : null}
                        <Text style={[styles.settingsRowHint, { color: theme.muted }]}>
                          Resets {new Date(meter.periodEnd).toLocaleDateString([], { month: "long", day: "numeric", timeZone: "UTC" })}
                        </Text>
                      </View>
                    );
                  })}
                  <View style={[styles.settingsPlanCard, { backgroundColor: "rgba(255,255,255,0.06)", borderColor: theme.border }]}>
                    <Text style={[styles.settingsRowText, { color: theme.text }]}>Silver and Gold</Text>
                    <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>Upgrade options will appear here when subscriptions launch.</Text>
                  </View>
                </>
              ) : null}
            </View>
          ) : null}
          {settingsPanel === "sessions" ? (
            <View style={styles.settingsSection}>
              <View style={styles.settingsSectionHeadingRow}>
                <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Signed-in devices</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Refresh active sessions" disabled={sessionsLoading} onPress={() => void refreshActiveSessions()} style={styles.sessionRefreshButton}>
                  {sessionsLoading ? <ActivityIndicator size="small" color={theme.accent} /> : <Ionicons name="refresh" size={20} color={theme.accent} />}
                </Pressable>
              </View>
              {sessionsError ? <Text style={[styles.sessionErrorText, { color: theme.danger }]}>{sessionsError}</Text> : null}
              {!sessionsLoading && activeSessions.length === 0 && !sessionsError ? <Text style={[styles.sessionEmptyText, { color: theme.muted }]}>No active sessions found.</Text> : null}
              {activeSessions.map((session) => (
                <View key={session.id} style={[styles.sessionRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name={session.clientType === "web" ? "globe-outline" : session.clientType === "desktop" ? "desktop-outline" : "phone-portrait-outline"} size={22} color={session.current ? theme.accent : theme.text} />
                  <View style={styles.sessionDetails}>
                    <Text style={[styles.sessionTitle, { color: theme.text }]}>{activeSessionLabel(session)}</Text>
                    <Text style={[styles.sessionActivity, { color: theme.muted }]}>{formatSessionActivity(session.lastActiveAt)}</Text>
                  </View>
                  {!session.current ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Log out ${activeSessionLabel(session)}`} disabled={Boolean(sessionActionId)} onPress={() => confirmRevokeSession(session)} style={styles.sessionRevokeButton}>
                      {sessionActionId === session.id ? <ActivityIndicator size="small" color={theme.danger} /> : <Ionicons name="log-out-outline" size={21} color={theme.danger} />}
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {activeSessions.some((session) => !session.current) ? (
                <Pressable accessibilityRole="button" disabled={Boolean(sessionActionId)} onPress={confirmRevokeOtherSessions} style={[styles.settingsRow, { backgroundColor: "rgba(190,55,79,0.12)" }]}>
                  {sessionActionId === "others" ? <ActivityIndicator size="small" color={theme.danger} /> : <Ionicons name="log-out-outline" size={22} color={theme.danger} />}
                  <Text style={[styles.settingsRowText, { color: theme.danger }]}>Log out all other devices</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {settingsPanel === "security" ? (
            <View style={styles.settingsSection}>
              <View style={styles.settingsSectionHeadingRow}>
                <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Connected accounts</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Refresh connected accounts" disabled={securityLoading} onPress={() => void refreshConnectedAccounts()} style={styles.sessionRefreshButton}>
                  {securityLoading ? <ActivityIndicator size="small" color={theme.accent} /> : <Ionicons name="refresh" size={20} color={theme.accent} />}
                </Pressable>
              </View>
              {securityError ? <Text accessibilityRole="alert" style={[styles.sessionErrorText, { color: theme.danger }]}>{securityError}</Text> : null}
              {connectedAccounts.map((account) => (
                <View key={account.id} style={[styles.sessionRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name={account.providerId === "google" ? "logo-google" : account.providerId === "facebook" ? "logo-facebook" : "mail-outline"} size={22} color={theme.text} />
                  <View style={styles.sessionDetails}>
                    <Text style={[styles.sessionTitle, { color: theme.text }]}>{account.providerId === "credential" ? "Email & password" : account.providerId === "google" ? "Google" : account.providerId === "facebook" ? "Facebook" : account.providerId}</Text>
                    <Text style={[styles.sessionActivity, { color: theme.muted }]}>Connected</Text>
                  </View>
                  {account.providerId !== "credential" ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Disconnect ${account.providerId}`} disabled={securityLoading || connectedAccounts.length <= 1} onPress={() => confirmUnlinkConnectedAccount(account)} style={styles.sessionRevokeButton}>
                      <Ionicons name="unlink-outline" size={21} color={theme.danger} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {oauthProviders.filter((provider) => provider.enabled && !connectedAccounts.some((account) => account.providerId === provider.provider)).map((provider) => (
                <Pressable key={provider.provider} accessibilityRole="button" disabled={securityLoading} onPress={() => void linkConnectedAccount(provider.provider)} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name={provider.provider === "google" ? "logo-google" : "logo-facebook"} size={22} color={theme.text} />
                  <Text style={[styles.settingsRowText, { color: theme.text }]}>Connect {provider.provider === "google" ? "Google" : "Facebook"}</Text>
                </Pressable>
              ))}
              {connectedAccounts.some((account) => account.providerId === "credential") ? (
                <View style={styles.settingsSection}>
                  <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Change password</Text>
                  <TextInput accessibilityLabel="Current password" secureTextEntry autoCapitalize="none" autoComplete="current-password" value={currentPassword} onChangeText={setCurrentPassword} placeholder="Current password" placeholderTextColor={theme.muted} style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]} />
                  <TextInput accessibilityLabel="New password" secureTextEntry autoCapitalize="none" autoComplete="new-password" value={newPassword} onChangeText={setNewPassword} placeholder="New password (10+ characters)" placeholderTextColor={theme.muted} style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]} />
                  <TextInput accessibilityLabel="Confirm new password" secureTextEntry autoCapitalize="none" autoComplete="new-password" value={newPasswordConfirmation} onChangeText={setNewPasswordConfirmation} placeholder="Confirm new password" placeholderTextColor={theme.muted} style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]} />
                  <Pressable accessibilityRole="button" disabled={securityLoading || !currentPassword || !newPassword || !newPasswordConfirmation} onPress={() => void changeAccountPassword()} style={[styles.settingsRow, { backgroundColor: theme.accent2, opacity: securityLoading || !currentPassword || !newPassword || !newPasswordConfirmation ? 0.45 : 1 }]}>
                    <Ionicons name="key-outline" size={22} color={theme.background} />
                    <Text style={[styles.settingsRowText, { color: theme.background }]}>Update password</Text>
                  </Pressable>
                </View>
              ) : <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>To add a password, sign out and use Forgot password with your account email.</Text>}
            </View>
          ) : null}
          {settingsPanel === "about" ? (
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Help and policies</Text>
              {([
                ["Privacy Policy", "shield-checkmark-outline", "/privacy"],
                ["Terms of Use", "document-text-outline", "/terms"],
                ["Delete account policy", "person-remove-outline", "/delete-account"],
                ["Support", "help-circle-outline", "/support"]
              ] as const).map(([label, icon, path]) => (
                <Pressable key={path} accessibilityRole="link" onPress={() => void openPublicWebPage(path).catch(() => Alert.alert("Could not open page", "Check your internet connection and try again."))} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name={icon} size={22} color={theme.text} />
                  <Text style={[styles.settingsRowText, { color: theme.text }]}>{label}</Text>
                  <Ionicons name="open-outline" size={18} color={theme.muted} />
                </Pressable>
              ))}
            </View>
          ) : null}
          {settingsPanel === "data" ? (
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Import and export</Text>
              {dataTransferJob ? <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>{dataTransferJob.phase} · {dataTransferJob.progress}%</Text> : <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>Create a ZIP archive of your account or bring conversations in from another archive.</Text>}
              {dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status) ? (
                <Pressable accessibilityRole="button" onPress={() => void cancelDataTransfer().catch((cancelError) => Alert.alert("Cancel failed", cancelError instanceof Error ? cancelError.message : "Could not cancel data transfer."))} style={[styles.settingsRow, { backgroundColor: "rgba(190,55,79,0.12)" }]}>
                  <Ionicons name="close-circle-outline" size={22} color={theme.danger} />
                  <Text style={[styles.settingsRowText, { color: theme.danger }]}>Cancel data transfer</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" testID="mobile-export-account" disabled={dataTransferActive} onPress={() => void shareDataArchive("account")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)", opacity: dataTransferActive ? 0.45 : 1 }]}>
                <Ionicons name="download-outline" size={22} color={theme.text} />
                <Text style={[styles.settingsRowText, { color: theme.text }]}>Export account data</Text>
              </Pressable>
              <Pressable accessibilityRole="button" testID="mobile-export-conversation" disabled={!conversationId || dataTransferActive} onPress={() => void shareDataArchive("conversation")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)", opacity: conversationId && !dataTransferActive ? 1 : 0.45 }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.text} />
                <Text style={[styles.settingsRowText, { color: theme.text }]}>Export current chat</Text>
              </Pressable>
              <Pressable accessibilityRole="button" testID="mobile-import-conversations" disabled={dataTransferActive} onPress={() => void importConversationArchive()} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)", opacity: dataTransferActive ? 0.45 : 1 }]}>
                <Ionicons name="cloud-upload-outline" size={22} color={theme.text} />
                <Text style={[styles.settingsRowText, { color: theme.text }]}>Import conversations</Text>
              </Pressable>
            </View>
          ) : null}
          {settingsPanel === "memory" ? (
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsPanelDescription, { color: theme.muted }]}>
                Older parts of each chat can be condensed to help shape later replies. Memory stays inside each individual chat.
              </Text>
              {memoryError ? <Text style={[styles.settingsPanelDescription, { color: theme.danger }]} accessibilityRole="alert">{memoryError}</Text> : null}
              {memoryNotice ? <Text style={[styles.settingsPanelDescription, { color: theme.accent2 }]} accessibilityLiveRegion="polite">{memoryNotice}</Text> : null}
              <View style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                <Ionicons name="sparkles-outline" size={22} color={theme.text} />
                <View style={styles.settingsRowCopy}>
                  <Text style={[styles.settingsRowText, { color: theme.text }]}>Use chat memory</Text>
                  <Text style={[styles.settingsRowHint, { color: theme.muted }]}>When off, existing memory is not used and no new memory is created</Text>
                </View>
                <Switch
                  accessibilityLabel="Use chat memory"
                  disabled={memoryBusy}
                  value={memoryEnabled}
                  onValueChange={(enabled) => void updateMemoryEnabled(enabled)}
                  trackColor={{ false: "rgba(255,255,255,0.18)", true: theme.accent }}
                  thumbColor={theme.text}
                />
              </View>
              <Pressable accessibilityRole="button" disabled={memoryBusy || !conversationId} onPress={() => confirmClearMemory("chat")} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)", opacity: conversationId ? 1 : 0.45 }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.text} />
                <View style={styles.settingsRowCopy}>
                  <Text style={[styles.settingsRowText, { color: theme.text }]}>Forget this chat</Text>
                  <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Remove memory only from the current chat</Text>
                </View>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={memoryBusy} onPress={() => confirmClearMemory("all")} style={[styles.settingsRow, { backgroundColor: "rgba(190,55,79,0.12)" }]}>
                <Ionicons name="trash-outline" size={22} color={theme.danger} />
                <View style={styles.settingsRowCopy}>
                  <Text style={[styles.settingsRowText, { color: theme.danger }]}>Clear all memory</Text>
                  <Text style={[styles.settingsRowHint, { color: theme.muted }]}>Remove saved memory from every chat</Text>
                </View>
              </Pressable>
              {memoryBusy ? <ActivityIndicator color={theme.accent2} /> : null}
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      <Modal
        accessibilityViewIsModal
        visible={Boolean(profileSelection)}
        transparent
        animationType="slide"
        onRequestClose={() => setProfileSelection(undefined)}
      >
        <View style={styles.actionSheetScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close selection menu" style={StyleSheet.absoluteFill} onPress={() => setProfileSelection(undefined)} />
          <View style={[styles.profileSelectionSheet, sheetHorizontalInsets, { borderColor: theme.border, backgroundColor: theme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={[styles.attachmentSheetHandle, { backgroundColor: theme.border }]} />
            <Text style={[styles.actionSheetTitle, { color: theme.text }]}>{profileSelectionTitle}</Text>
            <ScrollView contentContainerStyle={styles.profileSelectionList} showsVerticalScrollIndicator={false}>
              {profileSelectionOptions.map((option) => {
                const selected = selectedProfileOption === option.value;
                return (
                  <Pressable
                    key={option.value || "not-specified"}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => selectProfileOption(option.value)}
                    style={[styles.profileSelectionRow, { borderColor: selected ? theme.accent2 : theme.border, backgroundColor: selected ? "rgba(214,181,94,0.12)" : "rgba(255,255,255,0.025)" }]}
                  >
                    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={21} color={selected ? theme.accent2 : theme.muted} />
                    <Text style={[styles.profileSelectionText, { color: theme.text }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable accessibilityRole="button" style={styles.actionSheetCancel} onPress={() => setProfileSelection(undefined)}>
              <Text style={[styles.actionSheetText, { color: theme.muted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal accessibilityViewIsModal visible={deleteAccountVisible} transparent animationType="fade" onRequestClose={() => setDeleteAccountVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.loginScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close delete account dialog" style={StyleSheet.absoluteFill} onPress={() => setDeleteAccountVisible(false)} />
          <View style={[styles.loginCard, styles.deleteAccountCard, sheetHorizontalInsets, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong }]}>
            <Text style={[styles.loginTitle, { color: theme.text }]}>Delete account?</Text>
            <Text style={{ color: theme.muted, lineHeight: 20 }}>
              You will be signed out immediately. Your account and all chats, uploads, images, and audio will be permanently deleted after 30 days unless you restore it.
            </Text>
            <TextInput
              accessibilityLabel="Type DELETE to confirm account deletion"
              testID="mobile-delete-confirmation"
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              autoCapitalize="characters"
              placeholder="Type DELETE"
              placeholderTextColor={theme.muted}
              style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]}
            />
            <TextInput
              accessibilityLabel="Password for account deletion"
              testID="mobile-delete-password"
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
              placeholder="Password (required for password accounts)"
              placeholderTextColor={theme.muted}
              style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]}
            />
            {deleteAccountError ? <Text style={{ color: theme.danger }}>{deleteAccountError}</Text> : null}
            <View style={styles.renameActions}>
              <Pressable accessibilityRole="button" disabled={deleteAccountBusy} onPress={() => setDeleteAccountVisible(false)} style={[styles.renameSecondaryButton, { borderColor: theme.border }]}>
                <Text style={{ color: theme.text }}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: deleteAccountBusy || deleteConfirmation !== "DELETE" }} testID="mobile-delete-confirm" disabled={deleteAccountBusy || deleteConfirmation !== "DELETE"} onPress={() => void deleteAccount()} style={[styles.renamePrimaryButton, { backgroundColor: theme.danger, opacity: deleteConfirmation === "DELETE" ? 1 : 0.45 }]}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>{deleteAccountBusy ? "Scheduling..." : "Delete account"}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        accessibilityViewIsModal
        visible={attachmentMenuVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachmentMenuVisible(false)}
      >
        <View style={styles.actionSheetScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close attachment menu" style={StyleSheet.absoluteFill} onPress={() => setAttachmentMenuVisible(false)} />
          <View style={[styles.attachmentSheet, sheetHorizontalInsets, { borderColor: theme.border, backgroundColor: theme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={[styles.attachmentSheetHandle, { backgroundColor: theme.border }]} />
            <Text style={[styles.actionSheetTitle, { color: theme.text }]}>Add to message</Text>
            <Text style={[styles.attachmentSheetCopy, { color: theme.muted }]}>Choose something to share with {activePersona?.shortName ?? activePersona?.name ?? "your persona"}.</Text>
            <Pressable accessibilityRole="button" style={styles.attachmentSheetRow} onPress={() => chooseAttachment("photo")}>
              <View style={[styles.attachmentSheetIcon, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                <Ionicons name="images-outline" size={22} color={theme.accent2} />
              </View>
              <View style={styles.attachmentSheetRowCopy}>
                <Text style={[styles.actionSheetText, { color: theme.text }]}>Photos</Text>
                <Text style={[styles.attachmentSheetHint, { color: theme.muted }]}>Choose one or more images</Text>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.attachmentSheetRow} onPress={() => chooseAttachment("file")}>
              <View style={[styles.attachmentSheetIcon, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                <Ionicons name="document-attach-outline" size={22} color={theme.accent2} />
              </View>
              <View style={styles.attachmentSheetRowCopy}>
                <Text style={[styles.actionSheetText, { color: theme.text }]}>Files</Text>
                <Text style={[styles.attachmentSheetHint, { color: theme.muted }]}>Documents, PDFs, and more</Text>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.actionSheetCancel} onPress={() => setAttachmentMenuVisible(false)}>
              <Text style={[styles.actionSheetText, { color: theme.muted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        accessibilityViewIsModal
        visible={Boolean(userActionTurn)}
        transparent
        animationType="slide"
        onRequestClose={() => setUserActionTurn(undefined)}
      >
        <View style={styles.actionSheetScrim}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close message actions"
            style={StyleSheet.absoluteFill}
            onPress={() => setUserActionTurn(undefined)}
          />
          <View style={[styles.actionSheet, sheetHorizontalInsets, { borderColor: theme.border, backgroundColor: theme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={styles.actionSheetHeader}>
              <View style={styles.actionSheetHeadingCopy}>
                <Text style={[styles.actionSheetTitle, styles.actionSheetTitleNoPadding, { color: theme.text }]}>Message actions</Text>
                {userActionTurn ? <Text numberOfLines={1} style={[styles.actionSheetSubtitle, { color: theme.muted }]}>{userActionTurn.userMessage}</Text> : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close message actions"
                hitSlop={10}
                onPress={() => setUserActionTurn(undefined)}
                style={[styles.actionSheetClose, { backgroundColor: "rgba(255,255,255,0.08)" }]}
              >
                <Ionicons name="close" size={20} color={theme.text} />
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              style={styles.actionSheetRow}
              onPress={() => {
                const turn = userActionTurn;
                setUserActionTurn(undefined);
                if (turn) void copyMessage("Prompt copied.", turn.userMessage);
              }}
            >
              <Ionicons name="copy-outline" size={20} color={theme.text} />
              <Text style={[styles.actionSheetText, { color: theme.text }]}>Copy</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.actionSheetRow}
              onPress={() => {
                const turn = userActionTurn;
                setUserActionTurn(undefined);
                if (turn) editUserMessage(turn.userMessage);
              }}
            >
              <Ionicons name="create-outline" size={20} color={theme.text} />
              <Text style={[styles.actionSheetText, { color: theme.text }]}>Edit</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        accessibilityViewIsModal
        visible={Boolean(conversationActionTarget)}
        transparent
        animationType="slide"
        onRequestClose={() => setConversationActionTarget(undefined)}
      >
        <View style={styles.actionSheetScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close chat actions" style={StyleSheet.absoluteFill} onPress={() => setConversationActionTarget(undefined)} />
          <View style={[styles.actionSheet, sheetHorizontalInsets, { borderColor: theme.border, backgroundColor: theme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={styles.actionSheetHeader}>
              <View style={styles.actionSheetHeadingCopy}>
                <Text style={[styles.actionSheetTitle, styles.actionSheetTitleNoPadding, { color: theme.text }]}>Chat options</Text>
                {conversationActionTarget ? <Text numberOfLines={1} style={[styles.actionSheetSubtitle, { color: theme.muted }]}>{conversationActionTarget.title}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close chat actions" hitSlop={10} onPress={() => setConversationActionTarget(undefined)} style={[styles.actionSheetClose, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
                <Ionicons name="close" size={20} color={theme.text} />
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" style={styles.actionSheetRow} onPress={() => {
              const target = conversationActionTarget;
              setConversationActionTarget(undefined);
              if (!target) return;
              setRenameTarget(target);
              setRenameTitle(target.title);
            }}>
              <Ionicons name="create-outline" size={20} color={theme.text} />
              <Text style={[styles.actionSheetText, { color: theme.text }]}>Rename</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.actionSheetRow} onPress={() => {
              const target = conversationActionTarget;
              setConversationActionTarget(undefined);
              if (target) void pinConversation(target);
            }}>
              <Ionicons name={conversationActionTarget?.pinned ? "bookmark-outline" : "bookmark"} size={20} color={theme.text} />
              <Text style={[styles.actionSheetText, { color: theme.text }]}>{conversationActionTarget?.pinned ? "Unpin" : "Pin"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.actionSheetRow} onPress={() => {
              const target = conversationActionTarget;
              setConversationActionTarget(undefined);
              if (target) void shareDataArchive("conversation", target.id);
            }}>
              <Ionicons name="download-outline" size={20} color={theme.text} />
              <Text style={[styles.actionSheetText, { color: theme.text }]}>Export</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={[styles.actionSheetRow, styles.actionSheetDangerRow]} onPress={() => {
              const target = conversationActionTarget;
              setConversationActionTarget(undefined);
              if (target) confirmDeleteConversation(target);
            }}>
              <Ionicons name="trash-outline" size={20} color={theme.danger} />
              <Text style={[styles.actionSheetText, { color: theme.danger }]}>Delete chat</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {renameTarget ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.loginScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close rename chat dialog" style={StyleSheet.absoluteFill} onPress={() => setRenameTarget(undefined)} />
          <View style={[styles.loginCard, styles.renameCard, sheetHorizontalInsets, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong }]}>
            <Text style={[styles.loginTitle, { color: theme.text }]}>Rename chat</Text>
            <TextInput
              accessibilityLabel="Chat title"
              value={renameTitle}
              onChangeText={setRenameTitle}
              placeholder="Chat title"
              placeholderTextColor={theme.muted}
              autoFocus
              style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]}
            />
            <View style={styles.renameActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRenameTarget(undefined)}
                style={[styles.renameSecondaryButton, { borderColor: theme.border }]}
              >
                <Text style={[styles.renameSecondaryText, { color: theme.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void renameConversation()}
                style={[styles.renamePrimaryButton, { backgroundColor: theme.text }]}
              >
                <Text style={[styles.renamePrimaryText, { color: theme.background }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : null}
      <Modal
        accessibilityViewIsModal
        visible={Boolean(assistantActionTurn)}
        transparent
        animationType="slide"
        onRequestClose={() => setAssistantActionTurn(undefined)}
      >
        <View style={styles.actionSheetScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close response actions" style={StyleSheet.absoluteFill} onPress={() => setAssistantActionTurn(undefined)} />
          <View style={[styles.actionSheet, sheetHorizontalInsets, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <Text style={[styles.actionSheetTitle, { color: theme.text }]}>Response actions</Text>
            <ScrollView
              style={styles.actionSheetScroll}
              contentContainerStyle={styles.actionSheetScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {assistantActionTurn && assistantTextForDisplay(assistantActionTurn).trim() ? (
                <Pressable accessibilityRole="button" style={styles.actionSheetRow} onPress={() => {
                  if (!assistantActionTurn) return;
                  const text = assistantTextForDisplay(assistantActionTurn);
                  setAssistantActionTurn(undefined);
                  void copyMessage("Response copied.", text);
                }}>
                  <Ionicons name="copy-outline" size={20} color={theme.text} />
                  <Text style={[styles.actionSheetText, { color: theme.text }]}>Copy</Text>
                </Pressable>
              ) : null}
              {assistantActionAudio ? (
                <Pressable accessibilityRole="button" style={styles.actionSheetRow} onPress={() => {
                  const audio = assistantActionAudio;
                  setAssistantActionTurn(undefined);
                  void replayAudioOutput(audio);
                }}>
                  <Ionicons name="volume-high-outline" size={20} color={theme.text} />
                  <Text style={[styles.actionSheetText, { color: theme.text }]}>Replay audio</Text>
                </Pressable>
              ) : null}
              {assistantActionReferences.length > 0 ? (
                <Pressable accessibilityRole="button" style={styles.actionSheetRow} onPress={() => showReferences(assistantActionReferences)}>
                  <Ionicons name="book-outline" size={20} color={theme.text} />
                  <Text style={[styles.actionSheetText, { color: theme.text }]}>References</Text>
                </Pressable>
              ) : null}
              {canRetryAssistantAction ? (
                <Pressable accessibilityRole="button" style={styles.actionSheetRow} onPress={() => {
                  const turn = assistantActionTurn;
                  setAssistantActionTurn(undefined);
                  if (turn) void retryAssistantTurn(turn);
                }}>
                  <Ionicons name="refresh" size={20} color={theme.text} />
                  <Text style={[styles.actionSheetText, { color: theme.text }]}>Retry</Text>
                </Pressable>
              ) : null}
              {assistantActionTurn ? (
                <Pressable accessibilityRole="button" style={styles.actionSheetRow} onPress={() => {
                  if (assistantActionTurn) showUnsafeOutputReport(assistantActionTurn);
                }}>
                  <Ionicons name="flag-outline" size={20} color={theme.danger} />
                  <Text style={[styles.actionSheetText, { color: theme.danger }]}>Report unsafe output</Text>
                </Pressable>
              ) : null}
              {assistantActionTurn && isStillRunningTurn(assistantActionTurn) ? (
                <Pressable accessibilityRole="button" style={styles.actionSheetRow} onPress={() => {
                  const turn = assistantActionTurn;
                  setAssistantActionTurn(undefined);
                  void resumeBackgroundJob(turn);
                }}>
                  <Ionicons name="time-outline" size={20} color={theme.text} />
                  <Text style={[styles.actionSheetText, { color: theme.text }]}>Check status</Text>
                </Pressable>
              ) : null}
            </ScrollView>
            <Pressable accessibilityRole="button" style={styles.actionSheetCancel} onPress={() => setAssistantActionTurn(undefined)}>
              <Text style={[styles.actionSheetText, { color: theme.muted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        accessibilityViewIsModal
        visible={Boolean(reportTarget)}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!reportBusy) setReportTarget(undefined); }}
      >
        <KeyboardAvoidingView style={styles.actionSheetScrim} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close report" style={StyleSheet.absoluteFill} onPress={() => { if (!reportBusy) setReportTarget(undefined); }} />
          <View style={[styles.reportSheet, sheetHorizontalInsets, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 18) }]}>
            <ScrollView
              contentContainerStyle={styles.reportSheetContent}
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
            <View style={styles.referenceHeader}>
              <View style={styles.reportHeadingCopy}>
                <Text style={[styles.reportEyebrow, { color: theme.accent2 }]}>SAFETY FEEDBACK</Text>
                <Text style={[styles.loginTitle, { color: theme.text }]}>Report this response</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close report" disabled={reportBusy} onPress={() => setReportTarget(undefined)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
            </View>
            <Text style={[styles.reportCopy, { color: theme.muted }]}>Tell us what went wrong. Reports help us investigate unsafe AI output and do not automatically remove your conversation.</Text>
            <ScrollView style={styles.reportCategoryScroll} contentContainerStyle={styles.reportCategories} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {REPORT_CATEGORIES.map((option) => {
                const selected = reportCategory === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setReportCategory(option.value)}
                    style={[styles.reportCategory, { borderColor: selected ? theme.accent2 : theme.border, backgroundColor: selected ? "rgba(226,184,75,0.10)" : "rgba(255,255,255,0.025)" }]}
                  >
                    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={18} color={selected ? theme.accent2 : theme.muted} />
                    <Text style={[styles.reportCategoryText, { color: theme.text }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TextInput
              accessibilityLabel="Additional report details"
              value={reportDetails}
              onChangeText={setReportDetails}
              placeholder="Anything else? (optional)"
              placeholderTextColor={theme.muted}
              maxLength={1000}
              multiline
              style={[styles.reportDetails, { borderColor: theme.border, color: theme.text }]}
            />
            {reportError ? <Text accessibilityRole="alert" style={[styles.reportError, { color: theme.danger }]}>{reportError}</Text> : null}
            <View style={styles.renameActions}>
              <Pressable accessibilityRole="button" disabled={reportBusy} onPress={() => setReportTarget(undefined)} style={[styles.renameSecondaryButton, { borderColor: theme.border }]}>
                <Text style={[styles.renameSecondaryText, { color: theme.text }]}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !reportCategory || reportBusy }} disabled={!reportCategory || reportBusy} onPress={() => void submitUnsafeOutputReport()} style={[styles.renamePrimaryButton, { backgroundColor: theme.accent2, opacity: reportCategory && !reportBusy ? 1 : 0.45 }]}>
                {reportBusy ? <ActivityIndicator color={theme.background} /> : <Text style={[styles.renamePrimaryText, { color: theme.background }]}>Send report</Text>}
              </Pressable>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        accessibilityViewIsModal
        visible={referenceSources.length > 0}
        transparent
        animationType="fade"
        onRequestClose={() => setReferenceSources([])}
      >
        <View style={styles.referenceScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close references" style={StyleSheet.absoluteFill} onPress={() => setReferenceSources([])} />
          <View style={[styles.referenceCard, sheetHorizontalInsets, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong }]}>
            <View style={styles.referenceHeader}>
              <Text style={[styles.loginTitle, { color: theme.text }]}>References</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close references" onPress={() => setReferenceSources([])}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.referenceList} showsVerticalScrollIndicator={false}>
              {referenceSources.map((reference, index) => (
                <Pressable
                  key={`${reference.url}-${index}`}
                  accessibilityRole="link"
                  onPress={() => void openReference(reference)}
                  style={[styles.referenceRow, { borderColor: theme.border }]}
                >
                  <Text style={[styles.referenceTitle, { color: theme.accent2 }]}>{reference.title}</Text>
                  {reference.snippet ? <Text style={[styles.referenceSnippet, { color: theme.muted }]}>{reference.snippet}</Text> : null}
                  <Text style={[styles.referenceUrl, { color: theme.muted }]} numberOfLines={1}>{reference.url}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  actionSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    gap: 2,
    maxHeight: "92%",
    paddingHorizontal: 16,
    paddingTop: 16,
    width: "100%"
  },
  actionSheetClose: {
    alignItems: "center",
    borderRadius: 999,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  actionSheetDangerRow: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    marginTop: 4,
    paddingTop: 12
  },
  actionSheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: 8
  },
  actionSheetHeadingCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12
  },
  actionSheetSubtitle: {
    fontSize: 13,
    lineHeight: 18
  },
  attachmentSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    gap: 4,
    maxHeight: "92%",
    paddingHorizontal: 18,
    paddingTop: 10,
    width: "100%"
  },
  attachmentSheetCopy: {
    fontSize: 13,
    lineHeight: 18,
    paddingBottom: 12,
    paddingHorizontal: 8
  },
  attachmentSheetHandle: {
    alignSelf: "center",
    borderRadius: 999,
    height: 4,
    marginBottom: 7,
    width: 42
  },
  attachmentSheetHint: {
    fontSize: 12,
    lineHeight: 17
  },
  attachmentSheetIcon: {
    alignItems: "center",
    borderRadius: 18,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  attachmentSheetRow: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: 13,
    minHeight: 66,
    paddingHorizontal: 8
  },
  attachmentSheetRowCopy: {
    flex: 1,
    gap: 2
  },
  actionSheetCancel: {
    alignItems: "center",
    minHeight: 50,
    justifyContent: "center",
    marginTop: 4
  },
  actionSheetRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    minHeight: 52,
    paddingHorizontal: 8
  },
  actionSheetScroll: {
    flexShrink: 1
  },
  actionSheetScrollContent: {
    flexGrow: 0
  },
  actionSheetScrim: {
    backgroundColor: "rgba(0,0,0,0.48)",
    flex: 1,
    justifyContent: "flex-end"
  },
  actionSheetText: {
    fontSize: 16,
    fontWeight: "800"
  },
  actionSheetTitle: {
    fontSize: 18,
    fontWeight: "900",
    paddingBottom: 8,
    paddingHorizontal: 8
  },
  actionSheetTitleNoPadding: {
    paddingHorizontal: 0
  },
  avatarInitials: {
    fontSize: 25,
    fontWeight: "900"
  },
  avatarOrb: {
    alignItems: "center",
    borderRadius: 30,
    borderWidth: 1,
    height: 186,
    justifyContent: "center",
    overflow: "hidden",
    width: 186
  },
  avatarOrbCompact: {
    borderRadius: 24,
    height: 132,
    width: 132
  },
  avatarOrbTablet: {
    borderRadius: 34,
    height: 220,
    width: 220
  },
  chatPlane: {
    flex: 1
  },
  conversationScroll: {
    flex: 1,
    minHeight: 0
  },
  deleteAccountCard: {
    gap: 12,
    padding: 18
  },
  drawerWrap: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    zIndex: 5
  },
  emptyAvatarImage: {
    height: "100%",
    width: "100%"
  },
  edgeSwipe: {
    left: 0,
    position: "absolute",
    width: 24,
    zIndex: 3
  },
  emptyCopy: {
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 310,
    textAlign: "center"
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    minHeight: 360,
    paddingHorizontal: 20,
    paddingVertical: 28
  },
  emptyStateCompact: {
    gap: 10,
    minHeight: 300,
    paddingHorizontal: 10,
    paddingVertical: 16
  },
  emptyTitle: {
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -0.4,
    textAlign: "center"
  },
  emptyTitleCompact: {
    fontSize: 23
  },
  error: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginHorizontal: 14,
    marginTop: 8,
    padding: 12
  },
  errorRetryButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  errorRetryText: {
    fontSize: 12,
    fontWeight: "900"
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18
  },
  history: {
    flexGrow: 1,
    gap: 26,
    paddingHorizontal: 16,
    paddingVertical: 18
  },
  historyCompact: {
    gap: 20,
    paddingHorizontal: 8,
    paddingVertical: 12
  },
  historyLandscape: {
    alignSelf: "center",
    maxWidth: 900,
    width: "100%"
  },
  keyboard: {
    alignSelf: "center",
    flex: 1,
    maxWidth: 760,
    paddingHorizontal: 12,
    position: "relative",
    width: "100%"
  },
  keyboardCompact: {
    paddingHorizontal: 8
  },
  keyboardLandscape: {
    maxWidth: "100%",
    paddingHorizontal: 8
  },
  keyboardTablet: {
    paddingHorizontal: 20,
  },
  layerAbovePersonaBackground: {
    position: "relative",
    zIndex: 2
  },
  loadingState: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    minHeight: 300,
    paddingVertical: 32
  },
  loadingText: {
    fontSize: 14
  },
  loadEarlierButton: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 170,
    paddingHorizontal: 16
  },
  loadEarlierText: {
    fontSize: 13,
    fontWeight: "800"
  },
  loginCard: {
    borderRadius: 26,
    borderWidth: 1,
    maxHeight: "88%",
    maxWidth: 440,
    width: "88%"
  },
  loginInput: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  loginScrim: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 8
  },
  loginTitle: {
    fontSize: 22,
    fontWeight: "900"
  },
  overlay: {
    backgroundColor: "#000",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 4
  },
  personaName: {
    fontSize: 17,
    fontWeight: "900"
  },
  personaMinimizeButton: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    position: "absolute",
    right: 11,
    top: 82,
    width: 42,
    zIndex: 4
  },
  root: {
    flex: 1,
    overflow: "hidden"
  },
  renameActions: {
    flexDirection: "row",
    gap: 10
  },
  renameCard: {
    gap: 12,
    padding: 18
  },
  renamePrimaryButton: {
    alignItems: "center",
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46
  },
  renamePrimaryText: {
    fontSize: 15,
    fontWeight: "900"
  },
  renameSecondaryButton: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46
  },
  renameSecondaryText: {
    fontSize: 15,
    fontWeight: "800"
  },
  reportCategories: {
    gap: 8,
    paddingBottom: 2
  },
  reportCategory: {
    alignItems: "center",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 13
  },
  reportCategoryScroll: {
    maxHeight: 226
  },
  reportCategoryText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800"
  },
  reportCopy: {
    fontSize: 13,
    lineHeight: 19
  },
  reportDetails: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 82,
    paddingHorizontal: 13,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  reportError: {
    fontSize: 13,
    lineHeight: 18
  },
  reportEyebrow: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2
  },
  reportHeadingCopy: {
    gap: 3
  },
  reportSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    maxHeight: "92%",
    paddingHorizontal: 18,
    paddingTop: 20,
    width: "100%"
  },
  reportSheetContent: {
    gap: 14
  },
  referenceCard: {
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: "78%",
    maxWidth: 520,
    padding: 18,
    width: "90%"
  },
  referenceHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 12
  },
  referenceList: {
    gap: 10,
    paddingBottom: 4
  },
  referenceRow: {
    borderBottomWidth: 1,
    gap: 4,
    paddingVertical: 12
  },
  referenceScrim: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    flex: 1,
    justifyContent: "center"
  },
  referenceSnippet: {
    fontSize: 13,
    lineHeight: 18
  },
  referenceTitle: {
    fontSize: 15,
    fontWeight: "800"
  },
  referenceUrl: {
    fontSize: 11
  },
  scrollToBottomButton: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 999,
    borderWidth: 1,
    bottom: 86,
    height: 52,
    justifyContent: "center",
    position: "absolute",
    width: 52,
    zIndex: 2
  },
  profileBirthdayInput: {
    flex: 1
  },
  profileBirthdayRow: {
    flexDirection: "row",
    gap: 10
  },
  profileBirthdayRemove: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 12
  },
  profileSaveConfirmation: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12
  },
  profileSelectField: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 58,
    paddingHorizontal: 16
  },
  profileSelectText: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800"
  },
  profileTextInput: {
    backgroundColor: "rgba(168,111,232,0.10)",
    borderColor: "rgba(214,181,94,0.34)",
    minHeight: 58,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 8
  },
  profileSelectionList: {
    gap: 7,
    paddingVertical: 4
  },
  profileSelectionRow: {
    alignItems: "center",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 50,
    paddingHorizontal: 14
  },
  profileSelectionSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    maxHeight: "72%",
    paddingHorizontal: 18,
    paddingTop: 10,
    width: "100%"
  },
  profileSelectionText: {
    fontSize: 16,
    fontWeight: "800"
  },
  settingsAvatar: {
    alignItems: "center",
    borderRadius: 999,
    height: 108,
    justifyContent: "center",
    width: 108
  },
  settingsAvatarText: {
    fontSize: 42,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  settingsBackButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 54,
    justifyContent: "center",
    width: 54
  },
  settingsEmail: {
    fontSize: 14,
    fontWeight: "700",
    maxWidth: "82%"
  },
  settingsName: {
    fontSize: 32,
    fontWeight: "900",
    maxWidth: "82%"
  },
  settingsPanelDescription: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 4
  },
  settingsPlanCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 18
  },
  settingsPlanName: {
    fontSize: 28,
    fontWeight: "900"
  },
  settingsPanelTitle: {
    alignSelf: "center",
    fontSize: 20,
    fontWeight: "900",
    left: 72,
    position: "absolute",
    right: 72,
    textAlign: "center"
  },
  settingsProfile: {
    alignItems: "center",
    gap: 10,
    paddingBottom: 42,
    paddingTop: 6
  },
  settingsRow: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: 16,
    minHeight: 64,
    paddingHorizontal: 18
  },
  settingsRowCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  settingsRowHint: {
    fontSize: 12,
    fontWeight: "700"
  },
  settingsRowText: {
    flex: 1,
    fontSize: 18,
    fontWeight: "900"
  },
  settingsSectionHeadingRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  settingsScreen: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 9
  },
  settingsContent: {
    alignSelf: "center",
    flexGrow: 1,
    gap: 28,
    maxWidth: 640,
    paddingHorizontal: 20,
    width: "100%"
  },
  settingsContentLandscape: {
    maxWidth: 900,
    paddingHorizontal: 32
  },
  settingsSection: {
    gap: 12
  },
  settingsSectionTitle: {
    fontSize: 23,
    fontWeight: "900",
    paddingHorizontal: 4
  },
  settingsTopBar: {
    minHeight: 60
  },
  settingsTotalUsageCard: {
    backgroundColor: "rgba(255,255,255,0.065)",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 16
  },
  settingsTotalUsageFill: {
    borderRadius: 999,
    height: "100%"
  },
  settingsTotalUsageLabel: {
    fontSize: 16,
    fontWeight: "900"
  },
  settingsTotalUsageRemaining: {
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "800"
  },
  settingsTotalUsageTrack: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    height: 9,
    overflow: "hidden"
  },
  settingsUsageCard: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 16
  },
  settingsUsageFill: {
    borderRadius: 999,
    height: "100%"
  },
  settingsUsageHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  settingsUsageTrack: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    height: 8,
    overflow: "hidden"
  },
  sessionActivity: {
    fontSize: 12,
    lineHeight: 17
  },
  sessionDetails: {
    flex: 1,
    gap: 2
  },
  sessionEmptyText: {
    fontSize: 14,
    paddingHorizontal: 4
  },
  sessionErrorText: {
    fontSize: 14,
    lineHeight: 19,
    paddingHorizontal: 4
  },
  sessionRefreshButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40
  },
  sessionRevokeButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44
  },
  sessionRow: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: 14,
    minHeight: 70,
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: "900"
  },
  suggestion: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: "100%"
  },
  suggestionText: {
    fontSize: 14,
    lineHeight: 19
  },
  suggestions: {
    alignSelf: "center",
    gap: 9,
    marginTop: 8,
    maxWidth: 520,
    width: "100%"
  },
  themeName: {
    fontSize: 12,
    textTransform: "capitalize"
  },
  titleBlock: {
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48
  },
  topBarLandscape: {
    paddingHorizontal: 4
  },
});
