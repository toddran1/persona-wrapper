import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { LinearGradient, type LinearGradientProps } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Audio } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import type { ExpoSpeechRecognitionErrorEvent, ExpoSpeechRecognitionResultEvent } from "expo-speech-recognition";
import type { AuthUser, ChatJobResponse, ChatResponse, Citation, ConversationSummary, OAuthProvider, OAuthProviderStatus, PersonaDefinition, PersonaSummary, ProviderId, UploadedAsset } from "@persona/shared";
import { PanGestureHandler, type PanGestureHandlerGestureEvent } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../api/client";
import { IconButton } from "../../components/IconButton";
import { clearSelectedConversationId, getSelectedConversationId, setSelectedConversationId } from "../../storage/secureTokens";
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
import type { MobilePickedFile, RenderedTurn } from "./types";

const BackgroundGradient = LinearGradient as unknown as ComponentType<LinearGradientProps>;
const BACKGROUND_POLL_TIMEOUT_MS = 12 * 60 * 1000;

WebBrowser.maybeCompleteAuthSession();

type GestureContext = {
  startX: number;
};

type SpeechRecognitionRuntime = typeof import("expo-speech-recognition");
type SpeechRecognitionSubscription = { remove: () => void };
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

export function MobileChatScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const drawerWidth = windowWidth;
  const compactLayout = windowWidth < 360 || windowHeight < 700;
  const tabletLayout = windowWidth >= 768;
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [persona, setPersona] = useState<PersonaDefinition | undefined>();
  const [provider, setProvider] = useState<ProviderId>("openai_persona");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [turns, setTurns] = useState<RenderedTurn[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
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
  const [authMode, setAuthMode] = useState<MobileAuthMode>("login");
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | undefined>();
  const [assistantActionTurn, setAssistantActionTurn] = useState<RenderedTurn | undefined>();
  const [referenceSources, setReferenceSources] = useState<Citation[]>([]);
  const [renameTitle, setRenameTitle] = useState("");
  const [composerDraft, setComposerDraft] = useState<string | undefined>();
  const [voiceInputActive, setVoiceInputActive] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
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
  const [authBusy, setAuthBusy] = useState(false);
  const [drawerInteractive, setDrawerInteractive] = useState(false);
  const drawerX = useSharedValue(-drawerWidth);
  const scrollRef = useRef<ScrollView>(null);
  const visualStateTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const scrollButtonTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const nearConversationBottomRef = useRef(true);
  const currentComposerDraftRef = useRef("");
  const speechBaseDraftRef = useRef("");
  const speechRuntimeRef = useRef<SpeechRecognitionRuntime | undefined>();
  const speechSubscriptionsRef = useRef<SpeechRecognitionSubscription[]>([]);
  const audioPlaybackRef = useRef<Audio.Sound | undefined>();
  const audioPlaybackUriRef = useRef<string | undefined>();
  const exchangedOAuthCodesRef = useRef(new Set<string>());

  const activePersona = persona ?? personas[0];
  const theme = useMemo(() => themeFromPersona(activePersona), [activePersona]);
  const [selectedFiles, setSelectedFiles] = useState<MobilePickedFile[]>([]);

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
      clearScrollButtonTimer();
      speechSubscriptionsRef.current.forEach((subscription) => subscription.remove());
      speechSubscriptionsRef.current = [];
    };
  }, []);

  function clearVisualStateTimer(): void {
    if (!visualStateTimerRef.current) return;
    clearTimeout(visualStateTimerRef.current);
    visualStateTimerRef.current = undefined;
  }

  function clearScrollButtonTimer(): void {
    if (!scrollButtonTimerRef.current) return;
    clearTimeout(scrollButtonTimerRef.current);
    scrollButtonTimerRef.current = undefined;
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
    drawerX.value = withSpring(0, { damping: 22, stiffness: 180 });
  }, [drawerX]);

  const closeDrawer = useCallback(() => {
    setDrawerInteractive(false);
    drawerX.value = withSpring(-drawerWidth, { damping: 22, stiffness: 180 });
  }, [drawerWidth, drawerX]);

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drawerX.value }]
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(drawerX.value, [-drawerWidth, 0], [0, 0.48], Extrapolation.CLAMP)
  }));

  const chatShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(drawerX.value, [-drawerWidth, 0], [0, 0], Extrapolation.CLAMP) }]
  }));

  const gesture = useAnimatedGestureHandler<PanGestureHandlerGestureEvent, GestureContext>({
    onStart: (_, context) => {
      context.startX = drawerX.value;
    },
    onActive: (event, context) => {
      drawerX.value = Math.max(-drawerWidth, Math.min(0, context.startX + event.translationX));
    },
    onEnd: (event) => {
      const shouldOpen = drawerX.value > -drawerWidth / 2 || event.velocityX > 450;
      drawerX.value = withSpring(shouldOpen ? 0 : -drawerWidth, { damping: 22, stiffness: 180 });
      runOnJS(setDrawerInteractive)(shouldOpen);
    }
  });

  const edgeGesture = useAnimatedGestureHandler<PanGestureHandlerGestureEvent, GestureContext>({
    onStart: (_, context) => {
      context.startX = drawerX.value;
    },
    onActive: (event, context) => {
      drawerX.value = Math.max(-drawerWidth, Math.min(0, context.startX + event.translationX));
    },
    onEnd: (event) => {
      if (drawerX.value > -drawerWidth + 40 || event.velocityX > 350) {
        drawerX.value = withSpring(0, { damping: 22, stiffness: 180 });
        runOnJS(setDrawerInteractive)(true);
        return;
      }
      drawerX.value = withSpring(-drawerWidth, { damping: 22, stiffness: 180 });
      runOnJS(setDrawerInteractive)(false);
    }
  });

  async function refreshConversations(): Promise<ConversationSummary[]> {
    const list = await api.listConversations();
    const sorted = [...list].sort(sortConversationSummaries);
    setConversations(sorted);
    return sorted;
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

  async function retryLoadAppData(): Promise<void> {
    setLoading(true);
    setError(undefined);
    setAuthError(undefined);
    setAuthChecked(false);
    try {
      const [user, providers] = await Promise.all([
        api.getCurrentUser().then((payload) => payload.user).catch(() => undefined),
        api.getOAuthProviders().catch(() => [])
      ]);
      setAuthUser(user);
      setOAuthProviders(providers);

      const personaList = await api.getPersonas();
      setPersonas(personaList);
      const selected = persona ?? personaList[0];
      if (selected) {
        const detail = await api.getPersona(selected.id);
        setPersona(detail);
        setProvider(detail.supportedProviders.includes(provider) ? provider : detail.supportedProviders[0] ?? "openai");
      }
      if (user) {
        const nextConversations = await refreshConversations().catch(() => []);
        const savedConversationId = await getSelectedConversationId();
        if (!conversationId && savedConversationId && nextConversations.some((conversation) => conversation.id === savedConversationId)) {
          await selectConversation(savedConversationId, { keepDrawerOpen: true });
        }
      }
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Could not load mobile app data.");
    } finally {
      setAuthChecked(true);
      setLoading(false);
    }
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
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photos unavailable", "Allow photo access to attach images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
  }

  async function pickDocument(): Promise<void> {
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
  }

  function openAttachmentPicker(): void {
    Alert.alert("Attach", "Choose what to add to this message.", [
      { text: "Photo", onPress: () => void pickImage() },
      { text: "File", onPress: () => void pickDocument() },
      { text: "Cancel", style: "cancel" }
    ]);
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

  function shouldFetchMediaWithAuth(url: string, resolvedUrl: string): boolean {
    return url.startsWith("/api/") || resolvedUrl.includes("/api/");
  }

  async function releaseCurrentAudioPlayback(): Promise<void> {
    const sound = audioPlaybackRef.current;
    const uri = audioPlaybackUriRef.current;
    audioPlaybackRef.current = undefined;
    audioPlaybackUriRef.current = undefined;
    await sound?.unloadAsync().catch(() => undefined);
    if (uri?.startsWith(FileSystem.cacheDirectory ?? "")) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    }
  }

  async function prepareAudioUri(output: Extract<RenderedTurn["outputs"][number], { type: "audio" }>): Promise<string> {
    const audioUrl = api.resolveUrl(output.url);
    if (!FileSystem.cacheDirectory) return audioUrl;

    const destination = `${FileSystem.cacheDirectory}persona-audio-${Date.now()}.${audioFileExtension(output.mimeType)}`;
    const downloadOptions = shouldFetchMediaWithAuth(output.url, audioUrl) ? { headers: await api.mediaHeaders() } : undefined;
    const result = await FileSystem.downloadAsync(audioUrl, destination, downloadOptions);
    const info = await FileSystem.getInfoAsync(result.uri);
    if (!info.exists || info.size === 0) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
      throw new Error("Downloaded audio file was empty.");
    }
    return result.uri;
  }

  async function replayAudioOutput(output: Extract<RenderedTurn["outputs"][number], { type: "audio" }>): Promise<void> {
    try {
      await releaseCurrentAudioPlayback();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
        playThroughEarpieceAndroid: false
      });
      const audioUri = await prepareAudioUri(output);
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true }
      );
      audioPlaybackRef.current = sound;
      audioPlaybackUriRef.current = audioUri;
      sound.setOnPlaybackStatusUpdate((status) => {
        if ("didJustFinish" in status && status.didJustFinish) {
          if (audioPlaybackRef.current === sound) {
            void releaseCurrentAudioPlayback();
          } else {
            void sound.unloadAsync().catch(() => undefined);
          }
        }
      });
    } catch (playbackError) {
      await releaseCurrentAudioPlayback();
      Alert.alert("Audio playback failed", playbackError instanceof Error ? playbackError.message : "Could not play this audio response.");
    }
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

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
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
    setTurns((current) => current.map((turn) => (
      turn.id === turnId ? completedTurn : turn
    )));
  }

  function isStillRunningTurn(turn: RenderedTurn): boolean {
    return Boolean(turn.backgroundJobId && turn.outputs.some((output) => output.type === "status" && output.status === "in_progress"));
  }

  async function pollChatJob(
    jobId: string,
    onStatus?: (job: ChatJobResponse) => void
  ): Promise<ChatResponse> {
    const startedAt = Date.now();
    let intervalMs = 1200;
    let latestJob: ChatJobResponse | undefined;

    while (Date.now() - startedAt < BACKGROUND_POLL_TIMEOUT_MS) {
      const job = await api.getChatJob(jobId);
      latestJob = job;
      if (job.status === "completed" && job.response) {
        return job.response;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        throw new BackgroundJobStateError(job);
      }
      onStatus?.(job);
      await wait(intervalMs);
      intervalMs = Math.min(5000, Math.round(intervalMs * 1.35));
    }

    throw new BackgroundPollingTimeoutError(latestJob ?? await api.getChatJob(jobId));
  }

  async function resumeBackgroundJob(turn: RenderedTurn): Promise<void> {
    if (!turn.backgroundJobId || resumingJobId) return;
    setResumingJobId(turn.backgroundJobId);
    setError(undefined);
    try {
      const firstJob = await api.getChatJob(turn.backgroundJobId);
      if (firstJob.status === "completed" && firstJob.response) {
        replaceTurnWithResponse(turn.id, turn.userMessage, turn.userAssets, firstJob.response);
        await refreshConversations();
        return;
      }
      if (firstJob.status === "failed" || firstJob.status === "cancelled") {
        throw new BackgroundJobStateError(firstJob);
      }
      updateTurnOutputs(turn.id, [{ type: "status", status: "in_progress", message: "Thinking" }], firstJob.id);
      const response = await pollChatJob(firstJob.id);
      replaceTurnWithResponse(turn.id, turn.userMessage, turn.userAssets, response);
      await refreshConversations();
    } catch (resumeError) {
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
      setResumingJobId(undefined);
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
      await refreshConversations();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Signed in, but could not load your chat history.");
    }
  }

  async function handleOAuthCallback(url: string | null): Promise<void> {
    if (!url) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    const isOAuthCallback =
      (parsed.hostname === "auth" && parsed.pathname === "/callback") ||
      parsed.pathname.endsWith("/auth/callback");
    if (!isOAuthCallback) return;
    const errorMessage = parsed.searchParams.get("error");
    if (errorMessage) {
      setAuthError(errorMessage);
      return;
    }
    const code = parsed.searchParams.get("code");
    if (!code) return;
    if (exchangedOAuthCodesRef.current.has(code)) return;
    exchangedOAuthCodesRef.current.add(code);
    setAuthBusy(true);
    try {
      const auth = await api.exchangeOAuthCode({ code });
      await finishAuth(auth.user);
      closeDrawer();
    } catch (exchangeError) {
      setAuthError(exchangeError instanceof Error ? exchangeError.message : "Could not finish sign in.");
    } finally {
      setAuthBusy(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    async function loadInitial(): Promise<void> {
      setLoading(true);
      setError(undefined);
      setAuthError(undefined);
      try {
        const user = await api.getCurrentUser().then((payload) => payload.user).catch(() => undefined);
        if (!mounted) return;
        setAuthUser(user);
        setAuthChecked(true);

        const providers = await api.getOAuthProviders().catch(() => []);
        if (!mounted) return;
        setOAuthProviders(providers);

        const personaList = await api.getPersonas();
        if (!mounted) return;
        setPersonas(personaList);
        const selected = personaList[0];
        if (selected) {
          setProvider(selected.supportedProviders.includes("openai_persona") ? "openai_persona" : selected.supportedProviders[0] ?? "openai");
          const detail = await api.getPersona(selected.id);
          if (mounted) setPersona(detail);
        }
        if (user && mounted) {
          const nextConversations = await refreshConversations().catch(() => []);
          const savedConversationId = await getSelectedConversationId();
          if (savedConversationId && nextConversations.some((conversation) => conversation.id === savedConversationId)) {
            await selectConversation(savedConversationId, { keepDrawerOpen: true });
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
    void Linking.getInitialURL()
      .then((url) => handleOAuthCallback(url))
      .catch(() => setAuthError("Could not complete the sign-in callback. Please try again."));
    const subscription = Linking.addEventListener("url", (event) => {
      void handleOAuthCallback(event.url);
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
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
    try {
      setLoading(true);
      const detail = await api.getPersona(personaId);
      setPersona(detail);
      setProvider(detail.supportedProviders.includes(provider) ? provider : detail.supportedProviders[0] ?? "openai");
      setConversationId(undefined);
      setTurns([]);
      closeDrawer();
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "Could not switch persona.");
    } finally {
      setLoading(false);
    }
  }

  async function selectConversation(nextConversationId: string, options?: { keepDrawerOpen?: boolean }): Promise<void> {
    try {
      setLoading(true);
      setError(undefined);
      const detail = await api.getConversation(nextConversationId);
      setConversationId(detail.id);
      await setSelectedConversationId(detail.id);
      setTurns(turnsFromConversationTurns(detail.turns));
      if (!options?.keepDrawerOpen) closeDrawer();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load that chat.");
    } finally {
      setLoading(false);
    }
  }

  function newChat(): void {
    setConversationId(undefined);
    setTurns([]);
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
      const renamed = await api.renameConversation(renameTarget.id, title);
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
      const updated = await api.pinConversation(conversation.id, !conversation.pinned);
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
    try {
      await api.deleteConversation(nextConversationId);
      setConversations((current) => current.filter((conversation) => conversation.id !== nextConversationId));
      if (conversationId === nextConversationId) {
        setConversationId(undefined);
        setTurns([]);
        await clearSelectedConversationId();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete chat.");
    }
  }

  async function submit(message: string, options?: { files?: MobilePickedFile[] }): Promise<void> {
    if (!activePersona || sending) return;
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
        })))
        : [];
      const fileAttachmentIds = attachments
        .filter((attachment) => attachment.kind === "file")
        .map((attachment) => attachment.id);
      const vectorStore = fileAttachmentIds.length > 0
        ? await api.createVectorStore(fileAttachmentIds, `mobile-${Date.now()}`)
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
      });
      const backgroundJob = response.diagnostics.backgroundJob;
      const finalResponse = backgroundJob ? await pollChatJob(backgroundJob.id) : response;
      setConversationId(finalResponse.conversationId);
      await setSelectedConversationId(finalResponse.conversationId);
      const completedTurn: RenderedTurn = {
        ...turnFromChatResponse(message, finalResponse),
        userAssets: mapUploadedAssetsToUserAssets(attachments)
      };
      markPersonaSpeaking(finalResponse.outputs);
      setTurns((current) => current.map((turn) => (
        turn.id === optimistic?.id ? completedTurn : turn
      )));
      await refreshConversations();
    } catch (sendError) {
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
      setUploadingAttachments(false);
      setSending(false);
    }
  }

  async function submitAuth(): Promise<void> {
    if (!identifier.trim() || !password) {
      setAuthError("Enter your email or username and password.");
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
      const returnUrl = ExpoLinking.createURL("auth/callback");
      const url = await api.oauthStartUrl(provider, returnUrl);
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (result.type === "success") {
        await handleOAuthCallback(result.url);
      }
    } catch (oauthError) {
      setAuthError(oauthError instanceof Error ? oauthError.message : "Could not start OAuth sign in.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout(): Promise<void> {
    let logoutError: string | undefined;
    try {
      await api.logout();
    } catch (error) {
      logoutError = error instanceof Error ? error.message : "Could not reach the server to revoke this session.";
    }
    setAuthUser(undefined);
    setSettingsVisible(false);
    closeDrawer();
    setConversations([]);
    setConversationId(undefined);
    void clearSelectedConversationId();
    setTurns([]);
    setAuthMode("login");
    setAuthError(logoutError ? `You were signed out on this device. ${logoutError}` : undefined);
  }

  async function deleteAccount(): Promise<void> {
    if (deleteConfirmation !== "DELETE") {
      setDeleteAccountError("Type DELETE exactly to confirm.");
      return;
    }
    setDeleteAccountBusy(true);
    setDeleteAccountError(undefined);
    try {
      const result = await api.deleteAccount({
        confirmation: "DELETE",
        ...(deletePassword ? { password: deletePassword } : {})
      });
      const recoveryDate = new Date(result.deletionScheduledFor).toLocaleDateString();
      setDeleteAccountVisible(false);
      setSettingsVisible(false);
      setAuthUser(undefined);
      setConversations([]);
      setConversationId(undefined);
      setTurns([]);
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
  const visualStateLabel = personaVisualState[0]?.toUpperCase() + personaVisualState.slice(1);
  const assistantActionAudio = assistantActionTurn?.outputs.find(
    (output): output is Extract<RenderedTurn["outputs"][number], { type: "audio" }> => output.type === "audio"
  );
  const assistantActionReferences = assistantActionTurn?.outputs
    .filter((output): output is Extract<RenderedTurn["outputs"][number], { type: "source_list" }> => output.type === "source_list")
    .flatMap((output) => output.sources) ?? [];
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
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <BackgroundGradient
        colors={[theme.background, theme.backgroundAlt, theme.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <PanGestureHandler onGestureEvent={edgeGesture} activeOffsetX={30} failOffsetY={[-14, 14]} enabled={!drawerInteractive && !settingsVisible}>
        <Animated.View style={[styles.chatPlane, chatShiftStyle]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={0}
            style={[
              styles.keyboard,
              tabletLayout ? styles.keyboardTablet : null,
              compactLayout ? styles.keyboardCompact : null,
              { paddingTop: insets.top + (compactLayout ? 4 : 8), paddingBottom: Math.max(insets.bottom, 8) }
            ]}
          >
          <View style={[styles.topBar, personaCardExpanded ? styles.layerAbovePersonaBackground : null]}>
            <IconButton name="menu" label="Open chats" theme={theme} onPress={openDrawer} />
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
              label={audioEnabled ? "Disable audio" : "Enable audio"}
              theme={theme}
              onPress={() => setAudioEnabled((enabled) => !enabled)}
            />
          </View>

          {activePersona?.visualStage ? (
            <PersonaVisualStage
              expanded={personaCardExpanded}
              hidden={personaCardHidden}
              personaName={activePersona.name}
              profile={activePersona.visualStage}
              state={personaVisualState}
              theme={theme}
              onExpandedChange={handlePersonaExpandedChange}
              onHiddenChange={setPersonaCardHidden}
            />
          ) : null}

          {personaCardExpanded ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Minimize persona background"
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
            <View style={[styles.error, personaCardExpanded ? styles.layerAbovePersonaBackground : null, { borderColor: theme.danger }]}>
              <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
              <Pressable
                onPress={() => void retryLoadAppData()}
                style={[styles.errorRetryButton, { borderColor: theme.border }]}
              >
                <Text style={[styles.errorRetryText, { color: theme.text }]}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.history, compactLayout ? styles.historyCompact : null]}
            style={personaCardExpanded ? styles.layerAbovePersonaBackground : undefined}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={80}
            onScroll={handleConversationScroll}
          >
            {loading && turns.length === 0 ? (
              <View style={styles.loadingState}>
                <ActivityIndicator color={theme.accent2} />
                <Text style={[styles.loadingText, { color: theme.muted }]}>Loading your personas...</Text>
              </View>
            ) : turns.length === 0 ? (
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
                      onPress={() => void submit(prompt)}
                      style={[styles.suggestion, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.045)" }]}
                    >
                      <Text style={[styles.suggestionText, { color: theme.text }]}>{prompt}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              turns.map((turn) => (
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
                            {resumingJobId === turn.backgroundJobId ? "Checking..." : "Check status"}
                          </Text>
                        </Pressable>
                      ) : null}
                      <MessageActionRow
                        align="left"
                        theme={theme}
                        actions={[
                          ...(turn.assistantText.trim()
                            ? [{ icon: "copy-outline" as const, label: "Copy response", onPress: () => void copyMessage("Response copied.", turn.assistantText) }]
                            : []),
                          { icon: "ellipsis-horizontal", label: "More response actions", onPress: () => showAssistantActions(turn) }
                        ]}
                      />
                    </View>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          {showScrollToBottom && turns.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scroll to latest message"
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

          <ChatComposer
            theme={theme}
            compact={compactLayout}
            disabled={sending || !activePersona}
            uploadingAttachments={uploadingAttachments}
            voiceInputActive={voiceInputActive}
            attachments={selectedFiles}
            draftMessage={composerDraft}
            placeholder={voiceInputActive ? "Listening..." : activePersona?.promptPlaceholder ?? "Ask anything"}
            onAttach={openAttachmentPicker}
            onAudioMenu={showPersonaAudioMenu}
            onDraftChange={updateComposerDraft}
            onMicPress={() => void toggleSpeechToText()}
            onHeightChange={setComposerHeight}
            onRemoveAttachment={(id) => setSelectedFiles((current) => current.filter((file) => file.id !== id))}
            onSubmit={(message) => void submit(message)}
          />
          </KeyboardAvoidingView>
        </Animated.View>
      </PanGestureHandler>

      {drawerInteractive ? (
        <Animated.View style={[styles.overlay, overlayStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
        </Animated.View>
      ) : null}

      <PanGestureHandler onGestureEvent={gesture} activeOffsetX={[-12, 12]}>
        <Animated.View style={[styles.drawerWrap, { width: drawerWidth }, drawerStyle]}>
          <ChatDrawer
            authUser={authUser}
            conversations={conversations}
            activeConversationId={conversationId}
            personas={personas}
            activePersona={activePersona}
            theme={theme}
            topInset={insets.top}
            bottomInset={insets.bottom}
            loading={loading}
            refreshing={conversationsRefreshing}
            onClose={closeDrawer}
            onNewChat={newChat}
            onSelectConversation={(id) => void selectConversation(id)}
            onShowConversationActions={showConversationActions}
            onRefreshConversations={() => void refreshConversationsFromDrawer()}
            onSelectPersona={(id) => void selectPersona(id)}
            onShowLogin={() => undefined}
            onShowSettings={() => setSettingsVisible(true)}
          />
        </Animated.View>
      </PanGestureHandler>

      {settingsVisible ? (
        <ScrollView
          style={[styles.settingsScreen, { backgroundColor: theme.background }]}
          contentContainerStyle={[
            styles.settingsContent,
            { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 18) }
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.settingsTopBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to chats"
              onPress={() => setSettingsVisible(false)}
              style={[styles.settingsBackButton, { backgroundColor: "rgba(255,255,255,0.08)" }]}
            >
              <Ionicons name="arrow-back" size={25} color={theme.text} />
            </Pressable>
          </View>
          <View style={styles.settingsProfile}>
            <View style={[styles.settingsAvatar, { backgroundColor: theme.accent }]}>
              <Text style={[styles.settingsAvatarText, { color: theme.text }]}>
                {(authUser?.displayName?.[0] ?? authUser?.username?.[0] ?? authUser?.email?.[0] ?? "P").toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.settingsName, { color: theme.text }]} numberOfLines={1}>
              {authUser?.displayName ?? authUser?.username ?? "Account"}
            </Text>
            {authUser?.email ? (
              <Text style={[styles.settingsEmail, { color: theme.muted }]} numberOfLines={1}>{authUser.email}</Text>
            ) : null}
          </View>
          <View style={styles.settingsSection}>
            <Text style={[styles.settingsSectionTitle, { color: theme.muted }]}>Account</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void logout()}
              style={[styles.settingsRow, { backgroundColor: "rgba(255,255,255,0.09)" }]}
            >
              <Ionicons name="log-out-outline" size={22} color={theme.text} />
              <Text style={[styles.settingsRowText, { color: theme.text }]}>Log out</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDeleteAccountError(undefined);
                setDeleteAccountVisible(true);
              }}
              style={[styles.settingsRow, { backgroundColor: "rgba(190,55,79,0.12)" }]}
            >
              <Ionicons name="trash-outline" size={22} color={theme.danger} />
              <Text style={[styles.settingsRowText, { color: theme.danger }]}>Delete account</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}

      <Modal visible={deleteAccountVisible} transparent animationType="fade" onRequestClose={() => setDeleteAccountVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.loginScrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDeleteAccountVisible(false)} />
          <View style={[styles.loginCard, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong }]}>
            <Text style={[styles.loginTitle, { color: theme.text }]}>Delete account?</Text>
            <Text style={{ color: theme.muted, lineHeight: 20 }}>
              You will be signed out immediately. Your account and all chats, uploads, images, and audio will be permanently deleted after 30 days unless you restore it.
            </Text>
            <TextInput
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              autoCapitalize="characters"
              placeholder="Type DELETE"
              placeholderTextColor={theme.muted}
              style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]}
            />
            <TextInput
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
              placeholder="Password (required for password accounts)"
              placeholderTextColor={theme.muted}
              style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]}
            />
            {deleteAccountError ? <Text style={{ color: theme.danger }}>{deleteAccountError}</Text> : null}
            <View style={styles.renameActions}>
              <Pressable disabled={deleteAccountBusy} onPress={() => setDeleteAccountVisible(false)} style={[styles.renameSecondaryButton, { borderColor: theme.border }]}>
                <Text style={{ color: theme.text }}>Cancel</Text>
              </Pressable>
              <Pressable disabled={deleteAccountBusy || deleteConfirmation !== "DELETE"} onPress={() => void deleteAccount()} style={[styles.renamePrimaryButton, { backgroundColor: theme.danger, opacity: deleteConfirmation === "DELETE" ? 1 : 0.45 }]}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>{deleteAccountBusy ? "Scheduling..." : "Delete account"}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {renameTarget ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.loginScrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRenameTarget(undefined)} />
          <View style={[styles.loginCard, styles.renameCard, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong }]}>
            <Text style={[styles.loginTitle, { color: theme.text }]}>Rename chat</Text>
            <TextInput
              value={renameTitle}
              onChangeText={setRenameTitle}
              placeholder="Chat title"
              placeholderTextColor={theme.muted}
              autoFocus
              style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]}
            />
            <View style={styles.renameActions}>
              <Pressable
                onPress={() => setRenameTarget(undefined)}
                style={[styles.renameSecondaryButton, { borderColor: theme.border }]}
              >
                <Text style={[styles.renameSecondaryText, { color: theme.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
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
        visible={Boolean(assistantActionTurn)}
        transparent
        animationType="slide"
        onRequestClose={() => setAssistantActionTurn(undefined)}
      >
        <View style={styles.actionSheetScrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAssistantActionTurn(undefined)} />
          <View style={[styles.actionSheet, { borderColor: theme.border, backgroundColor: defaultPersonaTheme.surfaceStrong, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <Text style={[styles.actionSheetTitle, { color: theme.text }]}>Response actions</Text>
            {assistantActionTurn?.assistantText.trim() ? (
              <Pressable style={styles.actionSheetRow} onPress={() => {
                const text = assistantActionTurn.assistantText;
                setAssistantActionTurn(undefined);
                void copyMessage("Response copied.", text);
              }}>
                <Ionicons name="copy-outline" size={20} color={theme.text} />
                <Text style={[styles.actionSheetText, { color: theme.text }]}>Copy</Text>
              </Pressable>
            ) : null}
            {assistantActionAudio ? (
              <Pressable style={styles.actionSheetRow} onPress={() => {
                const audio = assistantActionAudio;
                setAssistantActionTurn(undefined);
                void replayAudioOutput(audio);
              }}>
                <Ionicons name="volume-high-outline" size={20} color={theme.text} />
                <Text style={[styles.actionSheetText, { color: theme.text }]}>Replay audio</Text>
              </Pressable>
            ) : null}
            {assistantActionReferences.length > 0 ? (
              <Pressable style={styles.actionSheetRow} onPress={() => showReferences(assistantActionReferences)}>
                <Ionicons name="book-outline" size={20} color={theme.text} />
                <Text style={[styles.actionSheetText, { color: theme.text }]}>References</Text>
              </Pressable>
            ) : null}
            {assistantActionTurn ? (
              <Pressable style={styles.actionSheetRow} onPress={() => {
                const turn = assistantActionTurn;
                setAssistantActionTurn(undefined);
                void retryAssistantTurn(turn);
              }}>
                <Ionicons name="refresh" size={20} color={theme.text} />
                <Text style={[styles.actionSheetText, { color: theme.text }]}>Retry</Text>
              </Pressable>
            ) : null}
            {assistantActionTurn && isStillRunningTurn(assistantActionTurn) ? (
              <Pressable style={styles.actionSheetRow} onPress={() => {
                const turn = assistantActionTurn;
                setAssistantActionTurn(undefined);
                void resumeBackgroundJob(turn);
              }}>
                <Ionicons name="time-outline" size={20} color={theme.text} />
                <Text style={[styles.actionSheetText, { color: theme.text }]}>Check status</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.actionSheetCancel} onPress={() => setAssistantActionTurn(undefined)}>
              <Text style={[styles.actionSheetText, { color: theme.muted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={referenceSources.length > 0}
        transparent
        animationType="fade"
        onRequestClose={() => setReferenceSources([])}
      >
        <View style={styles.referenceScrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReferenceSources([])} />
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
  settingsRowText: {
    fontSize: 18,
    fontWeight: "900"
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
    maxWidth: 640,
    paddingHorizontal: 20,
    width: "100%"
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
