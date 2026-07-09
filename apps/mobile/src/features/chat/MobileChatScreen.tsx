import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import type { AuthUser, ConversationSummary, PersonaDefinition, PersonaSummary, ProviderId } from "@persona/shared";
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
import { silkNoirTheme, themeFromPersona } from "../../theme/personaTheme";
import { ChatComposer } from "./ChatComposer";
import { ChatDrawer } from "./ChatDrawer";
import { OutputBlocks } from "./OutputBlocks";
import {
  getClientContext,
  sortConversationSummaries,
  turnFromChatResponse,
  turnsFromConversationTurns
} from "./mobileChatUtils";
import type { RenderedTurn } from "./types";

const screenWidth = Dimensions.get("window").width;
const drawerWidth = Math.min(screenWidth * 0.82, 340);

type GestureContext = {
  startX: number;
};

export function MobileChatScreen() {
  const insets = useSafeAreaInsets();
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [persona, setPersona] = useState<PersonaDefinition | undefined>();
  const [provider, setProvider] = useState<ProviderId>("openai_persona");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [turns, setTurns] = useState<RenderedTurn[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [authUser, setAuthUser] = useState<AuthUser | undefined>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [loginVisible, setLoginVisible] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [drawerInteractive, setDrawerInteractive] = useState(false);
  const drawerX = useSharedValue(-drawerWidth);
  const scrollRef = useRef<ScrollView>(null);

  const activePersona = persona ?? personas[0];
  const theme = useMemo(() => themeFromPersona(activePersona), [activePersona]);

  const openDrawer = useCallback(() => {
    setDrawerInteractive(true);
    drawerX.value = withSpring(0, { damping: 22, stiffness: 180 });
  }, [drawerX]);

  const closeDrawer = useCallback(() => {
    setDrawerInteractive(false);
    drawerX.value = withSpring(-drawerWidth, { damping: 22, stiffness: 180 });
  }, [drawerX]);

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drawerX.value }]
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(drawerX.value, [-drawerWidth, 0], [0, 0.48], Extrapolation.CLAMP)
  }));

  const chatShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(drawerX.value, [-drawerWidth, 0], [0, 28], Extrapolation.CLAMP) }]
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

  async function refreshConversations(): Promise<void> {
    const list = await api.listConversations();
    setConversations([...list].sort(sortConversationSummaries));
  }

  useEffect(() => {
    let mounted = true;
    async function loadInitial(): Promise<void> {
      setLoading(true);
      setError(undefined);
      try {
        const [personaList, user] = await Promise.all([
          api.getPersonas(),
          api.getCurrentUser().then((payload) => payload.user).catch(() => undefined)
        ]);
        if (!mounted) return;
        setPersonas(personaList);
        const selected = personaList[0];
        if (selected) {
          setProvider(selected.supportedProviders.includes("openai_persona") ? "openai_persona" : selected.supportedProviders[0] ?? "openai");
          const detail = await api.getPersona(selected.id);
          if (mounted) setPersona(detail);
        }
        if (user && mounted) setAuthUser(user);
        if (mounted) await refreshConversations();
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Could not load mobile app data.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void loadInitial();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [turns.length, sending]);

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

  async function selectConversation(nextConversationId: string): Promise<void> {
    try {
      setLoading(true);
      setError(undefined);
      const detail = await api.getConversation(nextConversationId);
      setConversationId(detail.id);
      setTurns(turnsFromConversationTurns(detail.turns));
      closeDrawer();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load that chat.");
    } finally {
      setLoading(false);
    }
  }

  function newChat(): void {
    setConversationId(undefined);
    setTurns([]);
    closeDrawer();
  }

  async function submit(message: string): Promise<void> {
    if (!activePersona || sending) return;
    setSending(true);
    setError(undefined);
    const optimistic: RenderedTurn = {
      id: `pending-${Date.now()}`,
      userMessage: message,
      assistantText: "",
      outputs: [{ type: "status", status: "in_progress", message: `${activePersona.name} is thinking...` }]
    };
    setTurns((current) => [...current, optimistic]);
    try {
      const response = await api.sendChat({
        personaId: activePersona.id,
        message,
        provider,
        audio: audioEnabled,
        clientContext: getClientContext(),
        toolOptions: {
          webSearch: false,
          fileSearch: false,
          codeInterpreter: false,
          imageGeneration: false,
          appFunctions: true,
          background: true,
          vectorStoreIds: []
        },
        ...(conversationId ? { conversationId } : {})
      });
      setConversationId(response.conversationId);
      setTurns((current) => [...current.slice(0, -1), turnFromChatResponse(message, response)]);
      await refreshConversations();
    } catch (sendError) {
      const messageText = sendError instanceof Error ? sendError.message : "Message failed.";
      setError(messageText);
      setTurns((current) => current.map((turn) => (
        turn.id === optimistic.id
          ? { ...turn, outputs: [{ type: "status", status: "failed", message: messageText }] }
          : turn
      )));
    } finally {
      setSending(false);
    }
  }

  async function login(): Promise<void> {
    if (!identifier.trim() || !password) return;
    setAuthBusy(true);
    try {
      const auth = await api.login({ identifier: identifier.trim(), password });
      setAuthUser(auth.user);
      setLoginVisible(false);
      setPassword("");
      await refreshConversations();
    } catch (loginError) {
      Alert.alert("Sign in failed", loginError instanceof Error ? loginError.message : "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout(): Promise<void> {
    await api.logout();
    setAuthUser(undefined);
    setConversations([]);
    setConversationId(undefined);
    setTurns([]);
  }

  const suggestedPrompts = activePersona?.suggestedPrompts ?? [];

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <LinearGradient
        colors={[theme.background, theme.backgroundAlt, theme.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <PanGestureHandler onGestureEvent={edgeGesture} activeOffsetX={12}>
        <Animated.View style={[styles.edgeSwipe, { top: insets.top, bottom: insets.bottom }]} />
      </PanGestureHandler>

      <Animated.View style={[styles.chatPlane, chatShiftStyle]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.keyboard, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 10) }]}
        >
          <View style={styles.topBar}>
            <IconButton name="menu" label="Open chats" theme={theme} onPress={openDrawer} />
            <View style={styles.titleBlock}>
              <Text style={[styles.personaName, { color: theme.text }]} numberOfLines={1}>
                {activePersona?.name ?? "Persona Wrapper"}
              </Text>
              <Text style={[styles.themeName, { color: theme.muted }]} numberOfLines={1}>
                {theme.name} · {provider.replace("_", " ")}
              </Text>
            </View>
            <IconButton
              name={audioEnabled ? "volume-high" : "volume-mute-outline"}
              label={audioEnabled ? "Disable audio" : "Enable audio"}
              theme={theme}
              onPress={() => setAudioEnabled((value) => !value)}
            />
          </View>

          {error ? (
            <View style={[styles.error, { borderColor: theme.danger }]}>
              <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
            </View>
          ) : null}

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.history}
            showsVerticalScrollIndicator={false}
          >
            {loading && turns.length === 0 ? (
              <View style={styles.loadingState}>
                <ActivityIndicator color={theme.accent2} />
                <Text style={[styles.loadingText, { color: theme.muted }]}>Loading your personas...</Text>
              </View>
            ) : turns.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={[styles.avatarOrb, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.055)" }]}>
                  <Text style={[styles.avatarInitials, { color: theme.accent2 }]}>
                    {(activePersona?.name ?? "PW").split(" ").slice(0, 2).map((part) => part[0]).join("")}
                  </Text>
                </View>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>{activePersona?.documentTitle ?? "Persona Wrapper"}</Text>
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
                  <View style={[styles.userBubble, { backgroundColor: "rgba(255,255,255,0.10)" }]}>
                    <Text style={[styles.userText, { color: theme.text }]}>{turn.userMessage}</Text>
                  </View>
                  <View style={styles.assistantRow}>
                    <View style={[styles.assistantMark, { backgroundColor: theme.accent }]}>
                      <Text style={[styles.assistantMarkText, { color: theme.text }]}>
                        {(activePersona?.name ?? "P")[0]}
                      </Text>
                    </View>
                    <View style={styles.assistantContent}>
                      <OutputBlocks outputs={turn.outputs} theme={theme} />
                    </View>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <ChatComposer
            theme={theme}
            disabled={sending || !activePersona}
            placeholder={activePersona?.promptPlaceholder ?? "Ask anything"}
            onSubmit={(message) => void submit(message)}
          />
        </KeyboardAvoidingView>
      </Animated.View>

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
            loading={loading}
            onClose={closeDrawer}
            onNewChat={newChat}
            onSelectConversation={(id) => void selectConversation(id)}
            onSelectPersona={(id) => void selectPersona(id)}
            onShowLogin={() => setLoginVisible(true)}
            onLogout={() => void logout()}
          />
        </Animated.View>
      </PanGestureHandler>

      {loginVisible ? (
        <View style={styles.loginScrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLoginVisible(false)} />
          <View style={[styles.loginCard, { borderColor: theme.border, backgroundColor: silkNoirTheme.surfaceStrong }]}>
            <Text style={[styles.loginTitle, { color: theme.text }]}>Sign in</Text>
            <Text style={[styles.loginCopy, { color: theme.muted }]}>Use the same account as the web app.</Text>
            <TextInput
              autoCapitalize="none"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="Email or username"
              placeholderTextColor={theme.muted}
              style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]}
            />
            <TextInput
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.muted}
              style={[styles.loginInput, { borderColor: theme.border, color: theme.text }]}
            />
            <Pressable
              disabled={authBusy}
              onPress={() => void login()}
              style={[styles.loginButton, { backgroundColor: theme.text, opacity: authBusy ? 0.65 : 1 }]}
            >
              <Text style={[styles.loginButtonText, { color: theme.background }]}>
                {authBusy ? "Signing in..." : "Sign in"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
    borderRadius: 999,
    borderWidth: 1,
    height: 76,
    justifyContent: "center",
    width: 76
  },
  chatPlane: {
    flex: 1
  },
  drawerWrap: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    zIndex: 5
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
    minHeight: 520,
    paddingHorizontal: 20
  },
  emptyTitle: {
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -0.4,
    textAlign: "center"
  },
  error: {
    borderRadius: 18,
    borderWidth: 1,
    marginHorizontal: 14,
    marginTop: 8,
    padding: 12
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
  keyboard: {
    flex: 1,
    paddingHorizontal: 12
  },
  loadingState: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    minHeight: 460
  },
  loadingText: {
    fontSize: 14
  },
  loginButton: {
    alignItems: "center",
    borderRadius: 16,
    minHeight: 48,
    justifyContent: "center"
  },
  loginButtonText: {
    fontSize: 15,
    fontWeight: "900"
  },
  loginCard: {
    borderRadius: 26,
    borderWidth: 1,
    gap: 12,
    padding: 18,
    width: "88%"
  },
  loginCopy: {
    fontSize: 14,
    lineHeight: 20
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
  root: {
    flex: 1,
    overflow: "hidden"
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
    gap: 9,
    marginTop: 8,
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
