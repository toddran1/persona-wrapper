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
  View
} from "react-native";
import { LinearGradient, type LinearGradientProps } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import * as ScreenOrientation from "expo-screen-orientation";
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync, type AudioPlayer } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import type { ExpoSpeechRecognitionErrorEvent, ExpoSpeechRecognitionResultEvent } from "expo-speech-recognition";
import type { ActiveSession, AuthUser, ChatJobResponse, ChatResponse, Citation, ConnectedAccount, ConversationSummary, DataTransferJob, OAuthProvider, OAuthProviderStatus, PersonaDefinition, PersonaSummary, ProviderId, UnsafeOutputReportCategory, UploadedAsset } from "@persona/shared";
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
import { IconButton } from "../../components/IconButton";
import { NetworkStatusBanner } from "../../components/NetworkStatusBanner";
import { useLocalization } from "../../localization/LocalizationProvider";
import { useNetwork } from "../../network/NetworkProvider";
import {
  clearSelectedConversationId,
  getSelectedConversationId,
  setSelectedConversationId
} from "../../storage/secureTokens";
import { saveFileToDevice } from "../../storage/downloadDirectory";
import { getLandscapeLayoutEnabled, setLandscapeLayoutEnabled } from "../../storage/mobilePreferences";
import { defaultPersonaTheme, themeFromPersona, type MobileTheme } from "../../theme/personaTheme";
import { ChatComposer } from "./ChatComposer";
import { ChatDrawer } from "./ChatDrawer";
import { OutputBlocks } from "./OutputBlocks";
import { PersonaVisualStage, type PersonaVisualState } from "./PersonaVisualStage";
import { MobileAuthScreen, type MobileAuthMode } from "../auth/MobileAuthScreen";
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
type AudioPlaybackSubscription = { remove: () => void };
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

type SettingsPanel = "main" | "security" | "sessions" | "about" | "data";

export function MobileChatScreen() {
  const { t } = useLocalization();
  const { isOnline, recentlyRestored } = useNetwork();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const drawerWidth = windowWidth;
  const compactLayout = windowWidth < 360 || windowHeight < 700;
  const tabletLayout = Math.min(windowWidth, windowHeight) >= 600;
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [persona, setPersona] = useState<PersonaDefinition | undefined>();
  const [provider, setProvider] = useState<ProviderId>("openai_persona");
  const [audioEnabled, setAudioEnabled] = useState(false);
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
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [resumingJobId, setResumingJobId] = useState<string | undefined>();
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>("main");
  const [landscapeLayoutEnabled, setLandscapeLayoutEnabledState] = useState(false);
  const [landscapePreferenceBusy, setLandscapePreferenceBusy] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [dataTransferJob, setDataTransferJob] = useState<DataTransferJob | undefined>();
  const dataTransferActive = Boolean(dataTransferJob && ["awaiting_upload", "queued", "running"].includes(dataTransferJob.status));
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | undefined>();
  const [sessionActionId, setSessionActionId] = useState<string | undefined>();
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState<string | undefined>();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [authMode, setAuthMode] = useState<MobileAuthMode>("login");
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | undefined>();
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
  const [composerHeight, setComposerHeight] = useState(62);
  const [personaVisualState, setPersonaVisualState] = useState<PersonaVisualState>("idle");
  const [personaCardExpanded, setPersonaCardExpanded] = useState(false);
  const [personaCardHidden, setPersonaCardHidden] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [deleteAccountVisible, setDeleteAccountVisible] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | undefined>();
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [drawerInteractive, setDrawerInteractive] = useState(false);
  const drawerX = useSharedValue(-drawerWidth);
  const scrollRef = useRef<FlashListRef<RenderedTurn>>(null);
  const visualStateTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollButtonTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationSearchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationSearchGenerationRef = useRef(0);
  const nearConversationBottomRef = useRef(true);
  const lastFocusedResponseTurnIdRef = useRef<string | undefined>(undefined);
  const currentComposerDraftRef = useRef("");
  const speechBaseDraftRef = useRef("");
  const speechRuntimeRef = useRef<SpeechRecognitionRuntime | undefined>(undefined);
  const speechSubscriptionsRef = useRef<SpeechRecognitionSubscription[]>([]);
  const audioPlaybackRef = useRef<AudioPlayer | undefined>(undefined);
  const audioPlaybackUriRef = useRef<string | undefined>(undefined);
  const audioPlaybackSubscriptionRef = useRef<AudioPlaybackSubscription | undefined>(undefined);
  const audioPlaybackGenerationRef = useRef(0);
  const activeChatAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const dataTransferAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const selectionGenerationRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const sessionValidationInFlightRef = useRef(false);
  const appDataReloadInFlightRef = useRef<Promise<void> | undefined>(undefined);
  const landscapeLayout = landscapeLayoutEnabled && windowWidth > windowHeight;

  const activePersona = persona ?? personas[0];
  const theme = useMemo(() => themeFromPersona(activePersona), [activePersona]);
  const [selectedFiles, setSelectedFiles] = useState<MobilePickedFile[]>([]);
  const personasResource = useQuery(personasQueryOptions());
  const primaryPersonaId = personasResource.data?.[0]?.id;
  const primaryPersonaResource = useQuery({
    ...personaQueryOptions(primaryPersonaId ?? ""),
    enabled: Boolean(primaryPersonaId)
  });
  const conversationsResource = useQuery({
    ...conversationsPageQueryOptions(undefined, undefined, authUser?.id),
    enabled: Boolean(authUser),
    staleTime: 15_000
  });
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
    if (personasResource.data) setPersonas(personasResource.data);
    if (personasResource.error) setError(personasResource.error.message);
  }, [personasResource.data, personasResource.error]);

  useEffect(() => {
    if (primaryPersonaResource.data && !persona) setPersona(primaryPersonaResource.data);
  }, [primaryPersonaResource.data, persona]);

  useEffect(() => {
    if (!conversationsResource.data) return;
    setConversations([...conversationsResource.data.conversations].sort(sortConversationSummaries));
    setConversationsCursor(conversationsResource.data.nextCursor);
  }, [conversationsResource.data]);

  useEffect(() => {
    if (!drawerInteractive) drawerX.value = -drawerWidth;
  }, [drawerInteractive, drawerWidth, drawerX]);

  useEffect(() => {
    return () => {
      try {
        speechRuntimeRef.current?.ExpoSpeechRecognitionModule.abort();
      } catch {
        // Native speech recognition may be unavailable in Expo Go or unsupported builds.
      }
      void releaseCurrentAudioPlayback();
      activeChatAbortControllerRef.current?.abort();
      activeChatAbortControllerRef.current = undefined;
      clearScrollButtonTimer();
      clearConversationSearchTimer();
      speechSubscriptionsRef.current.forEach((subscription) => subscription.remove());
      speechSubscriptionsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!audioEnabled) void releaseCurrentAudioPlayback();
  }, [audioEnabled]);

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
    setSettingsVisible(false);
    setSettingsPanel("main");
    openDrawer();
  }, [openDrawer]);

  function openSettingsPanel(panel: SettingsPanel): void {
    setSettingsPanel(panel);
    if (panel === "sessions") void refreshActiveSessions();
    if (panel === "security") void refreshConnectedAccounts();
  }

  async function refreshConnectedAccounts(): Promise<void> {
    setSecurityLoading(true);
    setSecurityError(undefined);
    try {
      setConnectedAccounts(await api.listConnectedAccounts());
    } catch (accountError) {
      setSecurityError(accountError instanceof Error ? accountError.message : "Could not load connected accounts.");
    } finally {
      setSecurityLoading(false);
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
    setSettingsPanel("main");
  }, []);

  useEffect(() => {
    let active = true;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState !== "active") {
        // Persona speech is foreground-only. Relinquish audio focus immediately
        // so music, podcasts, and calls from other apps return to normal volume.
        void releaseCurrentAudioPlayback();
      }
      const resumed = (previousState === "background" || previousState === "inactive") && nextState === "active";
      if (!resumed || !authUser || !isOnline || sessionValidationInFlightRef.current) return;

      sessionValidationInFlightRef.current = true;
      void loadAuthenticatedUser()
        .then((user) => {
          if (!active) return;
          if (user) {
            setAuthUser(user);
            return;
          }
          cancelActiveChatRequest();
          selectionGenerationRef.current += 1;
          dataTransferAbortControllerRef.current?.abort();
          dataTransferAbortControllerRef.current = undefined;
          setAuthUser(undefined);
          setDataTransferJob(undefined);
          setSettingsVisible(false);
          setActiveSessions([]);
          closeDrawer();
          setConversations([]);
          setConversationId(undefined);
          setTurns([]);
          setTurnsCursor(null);
          setAuthMode("login");
          setAuthError("This session ended on another device. Sign in again to continue.");
          void clearSelectedConversationId();
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

  const drawerStartX = useSharedValue(-drawerWidth);
  const gesture = Gesture.Pan().activeOffsetX([-6, 6]).failOffsetY([-20, 20])
    .onBegin(() => {
      drawerStartX.value = drawerX.value;
    })
    .onUpdate((event) => {
      drawerX.value = Math.max(-drawerWidth, Math.min(0, drawerStartX.value + event.translationX));
    })
    .onEnd((event) => {
      const shouldOpen = event.velocityX > 300 || (event.velocityX >= -250 && drawerX.value > -drawerWidth * 0.38);
      drawerX.value = withTiming(shouldOpen ? 0 : -drawerWidth, { duration: 190 });
      runOnJS(setDrawerInteractive)(shouldOpen);
    });

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
    const page = accountId === authUser?.id
      ? (await conversationsResource.refetch()).data
      : await queryClient.fetchQuery({ ...conversationsPageQueryOptions(undefined, undefined, accountId), staleTime: 0 });
    if (!page) return [];
    const sorted = [...page.conversations].sort(sortConversationSummaries);
    setConversations(sorted);
    setConversationsCursor(page.nextCursor);
    return sorted;
  }

  async function loadMoreConversations(): Promise<void> {
    if (!conversationsCursor || conversationsRefreshing) return;
    setConversationsRefreshing(true);
    try {
      const page = await queryClient.fetchQuery(conversationsPageQueryOptions(conversationsCursor, undefined, authUser?.id));
      setConversations((current) => [...current, ...page.conversations.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setConversationsCursor(page.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load more chats.");
    } finally {
      setConversationsRefreshing(false);
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
        const [user, providers] = await Promise.all([
          loadAuthenticatedUser(),
          api.getOAuthProviders().catch(() => [])
        ]);
        setAuthUser(user);
        setOAuthProviders(providers);

        const personaList = await queryClient.fetchQuery(personasQueryOptions());
        setPersonas(personaList);
        const selected = persona ?? personaList[0];
        if (selected) {
          const detail = await queryClient.fetchQuery(personaQueryOptions(selected.id));
          setPersona(detail);
          setProvider(detail.supportedProviders.includes(provider) ? provider : detail.supportedProviders[0] ?? "openai");
        }
        if (user) {
          const nextConversations = await refreshConversations(user.id);
          const savedConversationId = await getSelectedConversationId();
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
    setSelectedFiles((current) => [...current, ...files].slice(0, 10));
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

  function shouldEnableImageGeneration(message: string, files: MobilePickedFile[]): boolean {
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

  function audioFileExtension(mimeType: string): string {
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("mp4")) return "m4a";
    return "audio";
  }

  async function releaseCurrentAudioPlayback(): Promise<void> {
    audioPlaybackGenerationRef.current += 1;
    const player = audioPlaybackRef.current;
    const uri = audioPlaybackUriRef.current;
    const subscription = audioPlaybackSubscriptionRef.current;
    audioPlaybackRef.current = undefined;
    audioPlaybackUriRef.current = undefined;
    audioPlaybackSubscriptionRef.current = undefined;
    subscription?.remove();
    try {
      player?.pause();
      player?.remove();
    } catch {
      // The native player may already have released itself after an interruption.
    }
    if (uri?.startsWith(FileSystem.cacheDirectory ?? "")) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    }
    if (player) {
      await setIsAudioActiveAsync(false).catch(() => undefined);
    }
  }

  async function prepareAudioUri(output: Extract<RenderedTurn["outputs"][number], { type: "audio" }>): Promise<string> {
    const audioUrl = api.resolveUrl(output.url);
    if (!FileSystem.cacheDirectory) return audioUrl;

    const destination = `${FileSystem.cacheDirectory}persona-audio-${Date.now()}.${audioFileExtension(output.mimeType)}`;
    const downloadOptions = api.isProtectedMediaUrl(output.url) ? { headers: await api.mediaHeaders() } : undefined;
    const result = await FileSystem.downloadAsync(audioUrl, destination, downloadOptions);
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
      throw new Error(`Audio download failed with status ${result.status}.`);
    }
    const info = await FileSystem.getInfoAsync(result.uri);
    if (!info.exists || info.size === 0) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
      throw new Error("Downloaded audio file was empty.");
    }
    return result.uri;
  }

  async function replayAudioOutput(output: Extract<RenderedTurn["outputs"][number], { type: "audio" }>): Promise<void> {
    let pendingAudioUri: string | undefined;
    try {
      await releaseCurrentAudioPlayback();
      const playbackGeneration = audioPlaybackGenerationRef.current;
      pendingAudioUri = await prepareAudioUri(output);
      if (playbackGeneration !== audioPlaybackGenerationRef.current || AppState.currentState !== "active") {
        if (pendingAudioUri.startsWith(FileSystem.cacheDirectory ?? "")) {
          await FileSystem.deleteAsync(pendingAudioUri, { idempotent: true }).catch(() => undefined);
        }
        return;
      }
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false
      });
      await setIsAudioActiveAsync(true);
      if (playbackGeneration !== audioPlaybackGenerationRef.current || AppState.currentState !== "active") {
        await setIsAudioActiveAsync(false).catch(() => undefined);
        if (pendingAudioUri.startsWith(FileSystem.cacheDirectory ?? "")) {
          await FileSystem.deleteAsync(pendingAudioUri, { idempotent: true }).catch(() => undefined);
        }
        return;
      }
      const audioUri = pendingAudioUri;
      const player = createAudioPlayer({ uri: audioUri }, {
        keepAudioSessionActive: false,
        updateInterval: 250
      });
      audioPlaybackRef.current = player;
      audioPlaybackUriRef.current = audioUri;
      audioPlaybackSubscriptionRef.current = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish && audioPlaybackRef.current === player) {
          void releaseCurrentAudioPlayback();
        }
      });
      pendingAudioUri = undefined;
      player.play();
    } catch (playbackError) {
      await releaseCurrentAudioPlayback();
      if (pendingAudioUri?.startsWith(FileSystem.cacheDirectory ?? "")) {
        await FileSystem.deleteAsync(pendingAudioUri, { idempotent: true }).catch(() => undefined);
      }
      Alert.alert("Audio playback failed", playbackError instanceof Error ? playbackError.message : "Could not play this audio response.");
    }
  }

  function playGeneratedPersonaAudio(outputs: RenderedTurn["outputs"]): void {
    if (!audioEnabled) return;
    const audio = outputs.find(
      (output): output is Extract<RenderedTurn["outputs"][number], { type: "audio" }> => output.type === "audio"
    );
    if (audio) void replayAudioOutput(audio);
  }

  function editUserMessage(message: string): void {
    currentComposerDraftRef.current = message;
    setComposerDraft(message);
  }

  function showUserMessageActions(turn: RenderedTurn): void {
    Alert.alert("Message actions", undefined, [
      { text: "Copy", onPress: () => void copyMessage("Prompt copied.", turn.userMessage) },
      { text: "Edit", onPress: () => editUserMessage(turn.userMessage) },
      { text: "Cancel", style: "cancel" }
    ]);
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
    setTurns((current) => current.filter((candidate) => candidate.id !== turn.id));
    await submit(turn.userMessage, { files: [] });
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
    controller?.abort();
    // Response-focus state belongs to the current conversation. Keeping it
    // across navigation can suppress the initial scroll when a chat is opened
    // again and leave the list at the previous conversation's offset.
    lastFocusedResponseTurnIdRef.current = undefined;
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
    setTurns((current) => current.map((turn) => (
      turn.id === turnId
        ? {
          ...turn,
          outputs,
          ...(backgroundJobId ? { backgroundJobId } : {})
        }
        : turn
    )));
  }

  function replaceTurnWithResponse(turnId: string, userMessage: string, userAssets: RenderedTurn["userAssets"], response: ChatResponse): void {
    const completedTurn: RenderedTurn = {
      ...turnFromChatResponse(userMessage, response),
      ...(userAssets ? { userAssets } : {})
    };
    setConversationId(response.conversationId);
    markPersonaSpeaking(response.outputs);
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

  async function resumeBackgroundJob(turn: RenderedTurn): Promise<void> {
    if (!turn.backgroundJobId || resumingJobId || sending || activeChatAbortControllerRef.current) return;
    const controller = new AbortController();
    activeChatAbortControllerRef.current = controller;
    setResumingJobId(turn.backgroundJobId);
    setError(undefined);
    try {
      const firstJob = await api.getChatJob(turn.backgroundJobId, controller.signal);
      if (firstJob.status === "completed" && firstJob.response) {
        replaceTurnWithResponse(turn.id, turn.userMessage, turn.userAssets, firstJob.response);
        await refreshConversations();
        return;
      }
      if (firstJob.status === "failed" || firstJob.status === "cancelled") {
        throw new BackgroundJobStateError(firstJob);
      }
      updateTurnOutputs(turn.id, [{ type: "status", status: "in_progress", message: "Thinking" }], firstJob.id);
      const response = await pollChatJob(firstJob.id, undefined, controller.signal);
      replaceTurnWithResponse(turn.id, turn.userMessage, turn.userAssets, response);
      await refreshConversations();
    } catch (resumeError) {
      if (isRequestCancellation(resumeError)) return;
      if (resumeError instanceof BackgroundPollingTimeoutError) {
        markPersonaIdle();
        updateTurnOutputs(turn.id, [{
          type: "status",
          status: "in_progress",
          message: backgroundStatusMessage(resumeError.job, true)
        }], resumeError.job.id);
        return;
      }
      if (resumeError instanceof BackgroundJobStateError) {
        const failedStatus = resumeError.job.status === "cancelled" ? "cancelled" : "failed";
        markPersonaIdle();
        updateTurnOutputs(turn.id, [{
          type: "status",
          status: failedStatus,
          message: resumeError.job.error ?? resumeError.message
        }], resumeError.job.id);
        setError(resumeError.message);
        return;
      }
      markPersonaIdle();
      setError(resumeError instanceof Error ? resumeError.message : "Could not check background job.");
    } finally {
      if (activeChatAbortControllerRef.current === controller) {
        activeChatAbortControllerRef.current = undefined;
        setResumingJobId(undefined);
      }
    }
  }

  async function finishAuth(user: AuthUser): Promise<void> {
    setAuthUser(user);
    setAuthChecked(true);
    setAuthError(undefined);
    setPassword("");
    setIdentifier("");
    setDisplayName("");
    try {
      await refreshConversations(user.id);
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
        const user = await loadAuthenticatedUser();
        if (!mounted) return;
        setAuthUser(user);
        setAuthChecked(true);

        const providers = await api.getOAuthProviders().catch(() => []);
        if (!mounted) return;
        setOAuthProviders(providers);

        const personaList = await queryClient.fetchQuery(personasQueryOptions());
        if (!mounted) return;
        setPersonas(personaList);
        const selected = personaList[0];
        if (selected) {
          setProvider(selected.supportedProviders.includes("openai_persona") ? "openai_persona" : selected.supportedProviders[0] ?? "openai");
          const detail = await queryClient.fetchQuery(personaQueryOptions(selected.id));
          if (mounted) setPersona(detail);
        }
        if (user && mounted) {
          const nextConversations = await refreshConversations(user.id);
          const savedConversationId = await getSelectedConversationId();
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
    if (!settingsVisible || !authUser) return;
    void refreshActiveSessions();
  }, [settingsVisible, authUser?.id]);

  useEffect(() => {
    if (!responseFocusTurnId) return;
    const index = turns.findIndex((turn) => turn.id === responseFocusTurnId);
    if (index < 0) return;
    const frame = requestAnimationFrame(() => {
      // Each list cell contains the prompt followed by its reply. This offset
      // places the reply at the reading position instead of the cell bottom.
      scrollRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0, viewOffset: 132 });
      setResponseFocusTurnId(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [responseFocusTurnId, turns]);

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
    cancelActiveChatRequest();
    const selectionGeneration = ++selectionGenerationRef.current;
    try {
      setLoading(true);
      const detail = await queryClient.fetchQuery(personaQueryOptions(personaId));
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setPersona(detail);
      setProvider(detail.supportedProviders.includes(provider) ? provider : detail.supportedProviders[0] ?? "openai");
      setConversationId(undefined);
      setTurns([]);
      setTurnsCursor(null);
      closeDrawer();
    } catch (selectError) {
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setError(selectError instanceof Error ? selectError.message : "Could not switch persona.");
    } finally {
      if (selectionGeneration === selectionGenerationRef.current) setLoading(false);
    }
  }

  async function selectConversation(nextConversationId: string, options?: { keepDrawerOpen?: boolean; accountId?: string }): Promise<void> {
    cancelActiveChatRequest();
    const selectionGeneration = ++selectionGenerationRef.current;
    try {
      setLoading(true);
      setError(undefined);
      const page = await queryClient.fetchQuery(conversationTurnsQueryOptions(nextConversationId, undefined, options?.accountId ?? authUser?.id));
      if (selectionGeneration !== selectionGenerationRef.current) return;
      setConversationId(page.conversation.id);
      await setSelectedConversationId(page.conversation.id);
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
      setError(loadError instanceof Error ? loadError.message : "Could not load earlier messages.");
    } finally {
      setLoadingEarlierTurns(false);
    }
  }

  function newChat(): void {
    cancelActiveChatRequest();
    selectionGenerationRef.current += 1;
    setConversationId(undefined);
    setTurns([]);
    setTurnsCursor(null);
    setSelectedFiles([]);
    void clearSelectedConversationId();
    closeDrawer();
  }

  function showConversationActions(conversation: ConversationSummary): void {
    Alert.alert(conversation.title, undefined, [
      {
        text: "Rename",
        onPress: () => {
          setRenameTarget(conversation);
          setRenameTitle(conversation.title);
        }
      },
      {
        text: conversation.pinned ? "Unpin" : "Pin",
        onPress: () => void pinConversation(conversation)
      },
      {
        text: "Export",
        onPress: () => void shareDataArchive("conversation", conversation.id)
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => confirmDeleteConversation(conversation)
      },
      { text: "Cancel", style: "cancel" }
    ]);
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
        await clearSelectedConversationId();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete chat.");
    }
  }

  async function submit(message: string, options?: { files?: MobilePickedFile[] }): Promise<void> {
    if (!activePersona || sending || activeChatAbortControllerRef.current) return;
    if (!isOnline) {
      setError(t("network.offlineBody"));
      return;
    }
    const controller = new AbortController();
    activeChatAbortControllerRef.current = controller;
    setSending(true);
    clearVisualStateTimer();
    setPersonaVisualState("thinking");
    setError(undefined);
    currentComposerDraftRef.current = "";
    setComposerDraft(undefined);
    const submittedFiles = options?.files ?? selectedFiles;
    if (!options?.files) setSelectedFiles([]);
    let optimistic: RenderedTurn | undefined;
    try {
      setUploadingAttachments(submittedFiles.length > 0);
      const attachments = submittedFiles.length > 0
        ? await api.uploadFiles(submittedFiles.map((file) => ({
          uri: file.uri,
          name: file.name,
          mimeType: file.mimeType
        })), { signal: controller.signal })
        : [];
      const fileAttachmentIds = attachments
        .filter((attachment) => attachment.kind === "file")
        .map((attachment) => attachment.id);
      const vectorStore = fileAttachmentIds.length > 0
        ? await api.createVectorStore(fileAttachmentIds, `mobile-${Date.now()}`, controller.signal)
        : undefined;
      const imageGeneration = shouldEnableImageGeneration(message, submittedFiles);
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
        userMessage: message,
        userAssets: mapUploadedAssetsToUserAssets(attachments),
        assistantText: "",
        outputs: [{ type: "status", status: "in_progress", message: "Thinking" }]
      };
      setTurns((current) => [...current, optimistic as RenderedTurn]);
      const response = await api.sendChat({
        personaId: activePersona.id,
        message,
        provider,
        audio: audioEnabled,
        clientContext: getClientContext(),
        toolOptions: resolvedToolOptions,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(conversationId ? { conversationId } : {})
      }, controller.signal);
      const backgroundJob = response.diagnostics.backgroundJob;
      const finalResponse = backgroundJob ? await pollChatJob(backgroundJob.id, undefined, controller.signal) : response;
      setConversationId(finalResponse.conversationId);
      await setSelectedConversationId(finalResponse.conversationId);
      const completedTurn: RenderedTurn = {
        ...turnFromChatResponse(message, finalResponse),
        userAssets: mapUploadedAssetsToUserAssets(attachments)
      };
      markPersonaSpeaking(finalResponse.outputs);
      playGeneratedPersonaAudio(finalResponse.outputs);
      setTurns((current) => current.map((turn) => (
        turn.id === optimistic?.id ? completedTurn : turn
      )));
      focusCompletedResponse(completedTurn.id);
      await refreshConversations();
    } catch (sendError) {
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
          setError(messageText);
          markPersonaIdle();
          updateTurnOutputs(optimistic.id, [{ type: "status", status: "failed", message: messageText }]);
        }
      } else {
        setError(messageText);
        markPersonaIdle();
        setSelectedFiles(submittedFiles);
      }
    } finally {
      if (activeChatAbortControllerRef.current === controller) {
        activeChatAbortControllerRef.current = undefined;
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
      const auth = authMode === "login"
        ? await api.login({ identifier: trimmedIdentifier, password })
        : authMode === "restore"
          ? await api.restoreAccount({ identifier: trimmedIdentifier, password })
          : await api.register({
          password,
          ...(trimmedIdentifier.includes("@") ? { email: trimmedIdentifier } : { username: trimmedIdentifier }),
          ...(displayName.trim() ? { displayName: displayName.trim() } : {})
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

  async function logout(): Promise<void> {
    cancelActiveChatRequest();
    selectionGenerationRef.current += 1;
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
    setAuthUser(undefined);
    setDataTransferJob(undefined);
    setActiveSessions([]);
    setSettingsVisible(false);
    closeDrawer();
    setConversations([]);
    setConversationId(undefined);
    void clearSelectedConversationId();
    setTurns([]);
    setTurnsCursor(null);
    setAuthMode("login");
    setAuthError(logoutError ? `You were signed out on this device. ${logoutError}` : undefined);
  }

  async function refreshActiveSessions(): Promise<void> {
    if (!isOnline) {
      setSessionsError("Connect to the internet to refresh active devices.");
      return;
    }
    setSessionsLoading(true);
    setSessionsError(undefined);
    try {
      setActiveSessions(await api.listActiveSessions());
    } catch (sessionError) {
      setSessionsError(sessionError instanceof Error ? sessionError.message : "Could not load active sessions.");
    } finally {
      setSessionsLoading(false);
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
      setConversationId(undefined);
      setTurns([]);
      setTurnsCursor(null);
      setDeleteConfirmation("");
      setDeletePassword("");
      setAuthMode("restore");
      setAuthError(`Account deletion is scheduled for ${recoveryDate}. Restore it before then to keep your data.`);
      await clearSelectedConversationId();
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
        theme={theme}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError(undefined);
        }}
        onIdentifierChange={setIdentifier}
        onDisplayNameChange={setDisplayName}
        onPasswordChange={setPassword}
        onSubmit={() => void submitAuth()}
        onOAuth={(oauthProvider) => void startOAuth(oauthProvider)}
        onRetry={() => void retryLoadAppData()}
        onOpenPublicPage={(path) => void openPublicWebPage(path).catch(() => {
          setAuthError("Could not open this page. Check your internet connection and try again.");
        })}
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
              { paddingTop: insets.top + (compactLayout ? 4 : 8), paddingBottom: Math.max(insets.bottom, 8) }
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

          {landscapeLayout && !personaCardExpanded ? (
            <View pointerEvents="none" style={[styles.landscapePersonaRail, { borderColor: theme.border }]} />
          ) : null}

          <View style={landscapeLayout ? styles.landscapeMainPane : null}>
            <NetworkStatusBanner theme={theme} onRetry={() => void retryLoadAppData()} />
          </View>

          {activePersona?.visualStage ? (
            <PersonaVisualStage
              expanded={personaCardExpanded}
              hidden={personaCardHidden}
              landscape={landscapeLayout}
              personaName={activePersona.name}
              profile={activePersona.visualStage}
              state={personaVisualState}
              theme={theme}
              visible={!drawerInteractive && !settingsVisible}
              onExpandedChange={handlePersonaExpandedChange}
              onHiddenChange={setPersonaCardHidden}
              onAppForeground={markPersonaIdle}
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
                { borderColor: theme.border, backgroundColor: "rgba(23,15,33,0.82)" }
              ]}
            >
              <Ionicons name="contract-outline" size={20} color={theme.text} />
            </Pressable>
          ) : null}

          {error ? (
            <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={[styles.error, landscapeLayout ? styles.errorLandscape : null, personaCardExpanded ? styles.layerAbovePersonaBackground : null, { borderColor: theme.danger }]}>
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
            style={StyleSheet.flatten([styles.conversationScroll, landscapeLayout ? styles.conversationScrollLandscape : undefined, personaCardExpanded ? styles.layerAbovePersonaBackground : undefined])}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={80}
            onScroll={handleConversationScroll}
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
            renderItem={({ item: turn }) => (
                <View key={turn.id} style={styles.turn}>
                  <View
                    style={[
                      styles.userBubble,
                      personaCardExpanded ? styles.expandedUserBubble : { backgroundColor: "rgba(255,255,255,0.10)" }
                    ]}
                  >
                    <Text style={[styles.userText, { color: theme.text }]}>{turn.userMessage}</Text>
                    {turn.userAssets && turn.userAssets.length > 0 ? (
                      <View style={styles.sentAssetStack}>
                        {turn.userAssets.map((asset) => (
                          <View key={asset.id} style={styles.sentAsset}>
                            <Ionicons name={asset.kind === "image" ? "image-outline" : "document-text-outline"} size={14} color={theme.accent2} />
                            <Text style={[styles.sentAssetText, { color: theme.muted }]} numberOfLines={1}>{asset.fileName}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <MessageActionRow
                    align="right"
                    theme={theme}
                    actions={[
                      { icon: "copy-outline", label: "Copy prompt", onPress: () => void copyMessage("Prompt copied.", turn.userMessage) },
                      { icon: "create-outline", label: "Edit prompt", onPress: () => editUserMessage(turn.userMessage) },
                      { icon: "ellipsis-horizontal", label: "More prompt actions", onPress: () => showUserMessageActions(turn) }
                    ]}
                  />
                  <View style={styles.assistantRow}>
                    <View style={[styles.assistantMark, { backgroundColor: theme.accent }]}>
                      <Text style={[styles.assistantMarkText, { color: theme.text }]}>
                        {(activePersona?.shortName ?? activePersona?.name ?? "P")[0]}
                      </Text>
                    </View>
                    <View style={[styles.assistantContent, personaCardExpanded ? styles.expandedAssistantBubble : null]}>
                      <OutputBlocks outputs={turn.outputs} theme={theme} onAction={(action) => void handleOutputAction(action)} />
                      {isStillRunningTurn(turn) ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={resumingJobId === turn.backgroundJobId}
                          onPress={() => void resumeBackgroundJob(turn)}
                          style={[
                            styles.checkStatusButton,
                            {
                              borderColor: theme.border,
                              backgroundColor: resumingJobId === turn.backgroundJobId ? "rgba(255,255,255,0.05)" : "rgba(214,181,94,0.12)"
                            }
                          ]}
                        >
                          <Ionicons name="refresh" size={16} color={theme.accent2} />
                          <Text style={[styles.checkStatusText, { color: theme.text }]}>
                            {resumingJobId === turn.backgroundJobId ? t("chat.checking") : t("chat.checkStatus")}
                          </Text>
                        </Pressable>
                      ) : null}
                      <MessageActionRow
                        align="left"
                        theme={theme}
                        actions={[
                          ...(assistantTextForDisplay(turn).trim()
                            ? [{ icon: "copy-outline" as const, label: "Copy response", onPress: () => void copyMessage("Response copied.", assistantTextForDisplay(turn)) }]
                            : []),
                          { icon: "ellipsis-horizontal", label: "More response actions", onPress: () => showAssistantActions(turn) }
                        ]}
                      />
                    </View>
                  </View>
                </View>
            )}
          />

          {showScrollToBottom && turns.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.scrollLatest")}
              onPress={scrollConversationToBottom}
              style={[
                styles.scrollToBottomButton,
                landscapeLayout ? styles.scrollToBottomButtonLandscape : null,
                { bottom: composerHeight + Math.max(insets.bottom, 8) + 12 },
                { backgroundColor: "rgba(255,255,255,0.13)", borderColor: theme.border }
              ]}
            >
              <Ionicons name="arrow-down" size={22} color={theme.text} />
            </Pressable>
          ) : null}

          <View style={landscapeLayout ? styles.composerLandscape : null}>
            <ChatComposer
              theme={theme}
              compact={compactLayout}
              disabled={sending || !activePersona || !isOnline}
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

      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.drawerWrap, { width: drawerWidth }, drawerStyle]}>
          <ChatDrawer
            authUser={authUser}
            conversations={drawerConversations}
            activeConversationId={conversationId}
            personas={personas}
            activePersona={activePersona}
            theme={theme}
            topInset={insets.top}
            bottomInset={insets.bottom}
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
              setSettingsPanel("main");
              setSettingsVisible(true);
            }}
          />
        </Animated.View>
      </GestureDetector>

      {settingsVisible ? (
        <ScrollView
          style={[styles.settingsScreen, { backgroundColor: theme.background }]}
          contentContainerStyle={[
            styles.settingsContent,
            landscapeLayout ? styles.settingsContentLandscape : null,
            { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 18) }
          ]}
          showsVerticalScrollIndicator={false}
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
                {settingsPanel === "security" ? "Security & sign-in" : settingsPanel === "sessions" ? "Active sessions" : settingsPanel === "about" ? "About" : "Your data"}
              </Text>
            ) : null}
          </View>
          {settingsPanel === "main" ? (
            <>
              <View style={styles.settingsProfile}>
                <View style={[styles.settingsAvatar, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.settingsAvatarText, { color: theme.text }]}>
                    {(authUser?.displayName?.[0] ?? authUser?.username?.[0] ?? authUser?.email?.[0] ?? "P").toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.settingsName, { color: theme.text }]} numberOfLines={1}>
                  {authUser?.displayName ?? authUser?.username ?? "Account"}
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
                <Pressable accessibilityRole="button" testID="mobile-logout" onPress={() => void logout()} style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
                  <Ionicons name="log-out-outline" size={22} color={theme.text} />
                  <Text style={[styles.settingsRowText, { color: theme.text }]}>Log out</Text>
                </Pressable>
                <Pressable accessibilityRole="button" testID="mobile-delete-account" onPress={() => { setDeleteAccountError(undefined); setDeleteAccountVisible(true); }} style={[styles.settingsRow, { backgroundColor: "rgba(190,55,79,0.12)" }]}>
                  <Ionicons name="trash-outline" size={22} color={theme.danger} />
                  <Text style={[styles.settingsRowText, { color: theme.danger }]}>Delete account</Text>
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
            </>
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
        </ScrollView>
      ) : null}

      <Modal accessibilityViewIsModal visible={deleteAccountVisible} transparent animationType="fade" onRequestClose={() => setDeleteAccountVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.loginScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close delete account dialog" style={StyleSheet.absoluteFill} onPress={() => setDeleteAccountVisible(false)} />
          <View style={[styles.loginCard, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong }]}>
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
          <View style={[styles.attachmentSheet, { borderColor: theme.border, backgroundColor: theme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 14) }]}>
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

      {renameTarget ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.loginScrim}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close rename chat dialog" style={StyleSheet.absoluteFill} onPress={() => setRenameTarget(undefined)} />
          <View style={[styles.loginCard, styles.renameCard, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong }]}>
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
          <View style={[styles.actionSheet, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <Text style={[styles.actionSheetTitle, { color: theme.text }]}>Response actions</Text>
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
          <View style={[styles.reportSheet, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 18) }]}>
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
            <ScrollView style={styles.reportCategoryScroll} contentContainerStyle={styles.reportCategories} keyboardShouldPersistTaps="handled">
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
          <View style={[styles.referenceCard, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong }]}>
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

type MessageAction = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

function MessageActionRow({
  actions,
  align,
  theme
}: {
  actions: MessageAction[];
  align: "left" | "right";
  theme: MobileTheme;
}) {
  if (actions.length === 0) return null;
  return (
    <View style={[styles.messageActions, align === "right" ? styles.messageActionsRight : styles.messageActionsLeft]}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={[styles.messageActionButton, { backgroundColor: "rgba(255,255,255,0.065)" }]}
        >
          <Ionicons name={action.icon} size={15} color={theme.muted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  actionSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    gap: 2,
    paddingHorizontal: 16,
    paddingTop: 16,
    width: "100%"
  },
  attachmentSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    gap: 4,
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
  assistantContent: {
    flex: 1,
    gap: 8,
    minWidth: 0
  },
  assistantMark: {
    alignItems: "center",
    borderRadius: 999,
    height: 30,
    justifyContent: "center",
    marginTop: 2,
    width: 30
  },
  assistantMarkText: {
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  assistantRow: {
    flexDirection: "row",
    gap: 10
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
  checkStatusButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  checkStatusText: {
    fontSize: 13,
    fontWeight: "800"
  },
  conversationScroll: {
    flex: 1,
    minHeight: 0
  },
  conversationScrollLandscape: {
    marginLeft: 132
  },
  composerLandscape: {
    marginLeft: 132
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
  errorLandscape: {
    marginLeft: 146
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
  expandedAssistantBubble: {
    backgroundColor: "rgba(9,7,14,0.34)",
    borderRadius: 22,
    paddingHorizontal: 13,
    paddingVertical: 11
  },
  expandedUserBubble: {
    backgroundColor: "rgba(255,255,255,0.18)"
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
  landscapeMainPane: {
    marginLeft: 132
  },
  landscapePersonaRail: {
    borderRightWidth: 1,
    bottom: 0,
    left: 0,
    opacity: 0.7,
    position: "absolute",
    top: 56,
    width: 132
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
  messageActionButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 31,
    justifyContent: "center",
    width: 31
  },
  messageActions: {
    flexDirection: "row",
    gap: 7,
    marginTop: -8
  },
  messageActionsLeft: {
    alignSelf: "flex-start",
    marginLeft: 2
  },
  messageActionsRight: {
    alignSelf: "flex-end",
    marginRight: 8
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
    gap: 14,
    maxHeight: "92%",
    paddingHorizontal: 18,
    paddingTop: 20,
    width: "100%"
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
  sentAsset: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0
  },
  sentAssetStack: {
    gap: 6,
    marginTop: 9
  },
  sentAssetText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700"
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
  scrollToBottomButtonLandscape: {
    marginLeft: 132
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
  turn: {
    gap: 14
  },
  userBubble: {
    alignSelf: "flex-end",
    borderRadius: 22,
    maxWidth: "84%",
    paddingHorizontal: 15,
    paddingVertical: 11
  },
  userText: {
    fontSize: 16,
    lineHeight: 22
  }
});
