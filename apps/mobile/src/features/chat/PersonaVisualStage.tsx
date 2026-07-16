import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEventListener } from "expo";
import { AppState, Image, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { api } from "../../api/client";
import type { MobileTheme } from "../../theme/personaTheme";
import type { PersonaVisualStage as PersonaVisualStageProfile } from "@persona/shared";

export type PersonaVisualState = "idle" | "thinking" | "speaking";

type PersonaVisualStageProps = {
  expanded: boolean;
  hidden: boolean;
  personaName: string;
  profile: PersonaVisualStageProfile;
  state: PersonaVisualState;
  theme: MobileTheme;
  onExpandedChange: (expanded: boolean) => void;
  onHiddenChange: (hidden: boolean) => void;
  onAppForeground: () => void;
};

type PersonaVisualClip = {
  src: string;
  label: string;
  state: PersonaVisualState;
  kind: "state" | "transition";
  media: "video" | "image";
};

function PersonaVideo({
  source,
  playing,
  restartToken,
  onEnd,
  onError
}: {
  source: string;
  playing: boolean;
  restartToken: number;
  onEnd: (source: string) => void;
  onError: (source: string) => void;
}) {
  const lastRestartTokenRef = useRef(restartToken);
  const player = useVideoPlayer({ uri: source, useCaching: true }, (instance) => {
    instance.loop = false;
    instance.muted = true;
    if (playing) instance.play();
  });

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);

  useEffect(() => {
    if (restartToken === lastRestartTokenRef.current) return;
    lastRestartTokenRef.current = restartToken;

    try {
      player.replay();
    } catch {
      onError(source);
    }
  }, [onError, player, restartToken, source]);

  useEventListener(player, "playToEnd", () => onEnd(source));
  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "error") onError(source);
  });

  return (
    <VideoView
      player={player}
      contentFit="cover"
      nativeControls={false}
      style={styles.media}
    />
  );
}

const stateLabels: Record<PersonaVisualState, string> = {
  idle: "Idle",
  thinking: "Thinking",
  speaking: "Speaking"
};

function pickStateClip(profile: PersonaVisualStageProfile, state: PersonaVisualState, previousSrc?: string, failedSources: ReadonlySet<string> = new Set()): PersonaVisualClip {
  const sources = profile.loops[state].filter((src) => !failedSources.has(src));
  const fallbackSource = sources[0];
  if (!fallbackSource) {
    return {
      src: profile.fallbackImages[state],
      label: stateLabels[state],
      state,
      kind: "state",
      media: "image"
    };
  }

  const choices = sources.length > 1 ? sources.filter((src) => src !== previousSrc) : sources;
  const index = Math.floor(Math.random() * choices.length);
  return {
    src: choices[index] ?? fallbackSource,
    label: stateLabels[state],
    state,
    kind: "state",
    media: "video"
  };
}

export function PersonaVisualStage({ expanded, hidden, personaName, profile, state, theme, onExpandedChange, onHiddenChange, onAppForeground }: PersonaVisualStageProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const compactLayout = windowWidth < 360 || windowHeight < 700;
  const tabletLayout = windowWidth >= 768;
  const stageWidth = tabletLayout ? 132 : compactLayout ? 88 : 104;
  const stageTop = tabletLayout ? 120 : compactLayout ? 100 : 112;
  const hiddenTranslate = stageWidth + 24;
  const [activeClip, setActiveClip] = useState<PersonaVisualClip>(() => pickStateClip(profile, state));
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  const [playbackGeneration, setPlaybackGeneration] = useState(0);
  const activeClipRef = useRef<PersonaVisualClip | null>(activeClip);
  const failedSourcesRef = useRef<Set<string>>(new Set());
  const lastPressAtRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const onAppForegroundRef = useRef(onAppForeground);
  const settledStateRef = useRef<PersonaVisualState>(state);
  const targetStateRef = useRef<PersonaVisualState>(state);
  const expandedProgress = useSharedValue(expanded ? 1 : 0);
  const translateX = useSharedValue(hidden ? hiddenTranslate : 0);

  useEffect(() => {
    translateX.value = withTiming(hidden ? hiddenTranslate : 0, { duration: 260 });
  }, [hidden, hiddenTranslate, translateX]);

  useEffect(() => {
    expandedProgress.value = withTiming(expanded ? 1 : 0, { duration: 280 });
  }, [expanded, expandedProgress]);

  useEffect(() => {
    onAppForegroundRef.current = onAppForeground;
  }, [onAppForeground]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const wasBackgrounded = appStateRef.current === "background" || appStateRef.current === "inactive";
      appStateRef.current = nextAppState;

      if (wasBackgrounded && nextAppState === "active") {
        // Native video surfaces may remain paused or frozen after returning from
        // the background. Restart the existing player and return to idle.
        setPlaybackGeneration((generation) => generation + 1);
        onAppForegroundRef.current();
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    failedSourcesRef.current.clear();
    settledStateRef.current = state;
    targetStateRef.current = state;
    showClip(pickStateClip(profile, state));
  }, [profile]);

  useEffect(() => {
    if (targetStateRef.current === state) return;

    setMediaUnavailable(false);
    const currentClip = activeClipRef.current;
    const fromState = currentClip?.kind === "state" ? settledStateRef.current : targetStateRef.current;
    targetStateRef.current = state;

    if (fromState === state) {
      settledStateRef.current = state;
      showClip(pickStateClip(profile, state, currentClip?.src, failedSourcesRef.current));
      return;
    }

    const transitionSrc = profile.transitions[`${fromState}-${state}`];
    if (transitionSrc && !failedSourcesRef.current.has(transitionSrc)) {
      showClip({ src: transitionSrc, label: stateLabels[state], kind: "transition", media: "video", state });
      return;
    }

    settledStateRef.current = state;
    showClip(pickStateClip(profile, state, currentClip?.src, failedSourcesRef.current));
  }, [profile, state]);

  function showClip(clip: PersonaVisualClip): void {
    setMediaUnavailable(false);
    activeClipRef.current = clip;
    setActiveClip(clip);
  }

  function finishClip(source: string): void {
    const currentClip = activeClipRef.current;
    if (!currentClip || currentClip.src !== source) return;

    if (currentClip.kind === "transition") {
      const nextState = targetStateRef.current;
      settledStateRef.current = nextState;
      showClip(pickStateClip(profile, nextState, undefined, failedSourcesRef.current));
      return;
    }

    if (currentClip.state === targetStateRef.current) {
      showClip(pickStateClip(profile, currentClip.state, currentClip.src, failedSourcesRef.current));
    }
  }

  function handleMediaError(source: string): void {
    const currentClip = activeClipRef.current;
    if (!currentClip || currentClip.src !== source) return;
    failedSourcesRef.current.add(currentClip.src);

    if (currentClip.media === "image") {
      setMediaUnavailable(true);
      return;
    }

    if (currentClip.kind === "transition") {
      const nextState = targetStateRef.current;
      settledStateRef.current = nextState;
      showClip(pickStateClip(profile, nextState, undefined, failedSourcesRef.current));
      return;
    }

    showClip(pickStateClip(profile, currentClip.state, currentClip.src, failedSourcesRef.current));
  }

  const gestureStartX = useSharedValue(0);
  const panGesture = Gesture.Pan().activeOffsetX(12)
    .onBegin(() => {
      gestureStartX.value = translateX.value;
    })
    .onUpdate((event) => {
      translateX.value = Math.max(0, Math.min(hiddenTranslate + 4, gestureStartX.value + event.translationX));
    })
    .onEnd((event) => {
      const shouldHide = translateX.value > 52 || event.velocityX > 360;
      translateX.value = withTiming(shouldHide ? hiddenTranslate : 0, { duration: 220 });
      if (shouldHide) runOnJS(onHiddenChange)(true);
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(340)
    .onEnd((_event, success) => {
      if (success) runOnJS(onExpandedChange)(true);
    });

  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }]
  }));

  const expandedStyle = useAnimatedStyle(() => ({
    opacity: 1,
    transform: [
      { scale: 0.72 + expandedProgress.value * 0.28 }
    ]
  }));

  function handleStagePress(): void {
    const now = Date.now();
    if (now - lastPressAtRef.current < 320) {
      lastPressAtRef.current = 0;
      onExpandedChange(true);
      return;
    }
    lastPressAtRef.current = now;
  }

  function renderClip(): ReactNode {
    if (mediaUnavailable) {
      return (
        <View style={[styles.mediaFallback, { borderColor: theme.border }]}>
          <Ionicons name="person-circle-outline" size={30} color={theme.accent2} />
        </View>
      );
    }

    const source = { uri: api.resolveUrl(activeClip.src) };
    if (activeClip.media === "image") {
      return (
        <Image
          accessible={false}
          source={source}
          resizeMode="cover"
          style={styles.media}
          onError={() => handleMediaError(activeClip.src)}
        />
      );
    }

    return (
      <PersonaVideo
        source={source.uri}
        playing={!hidden || expanded}
        restartToken={playbackGeneration}
        onError={handleMediaError}
        onEnd={finishClip}
      />
    );
  }

  if (hidden) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show persona card"
        onPress={() => onHiddenChange(false)}
        style={[styles.revealButton, { top: stageTop + 10, borderColor: theme.border, backgroundColor: "rgba(23,15,33,0.90)" }]}
      >
        <Ionicons name="person-circle-outline" size={20} color={theme.accent2} />
      </Pressable>
    );
  }

  if (expanded) {
    return (
      <Animated.View
        pointerEvents="box-none"
        accessibilityLabel={`${personaName} fullscreen visual background: ${stateLabels[state]}`}
        style={[styles.expandedStage, expandedStyle]}
      >
        <View pointerEvents="none" style={styles.expandedMedia}>
          {renderClip()}
        </View>
      </Animated.View>
    );
  }

  return (
    <GestureDetector gesture={Gesture.Simultaneous(panGesture, doubleTapGesture)}>
      <Animated.View
        accessibilityLabel={`${personaName} visual state: ${stateLabels[state]}`}
        style={[
          styles.stage,
          { top: stageTop, width: stageWidth, borderColor: theme.border, backgroundColor: "rgba(7,5,12,0.62)" },
          stageStyle
        ]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Expand persona visual" onPress={handleStagePress} style={styles.frame}>
          {renderClip()}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  expandedMedia: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  expandedStage: {
    bottom: -8,
    left: -8,
    overflow: "hidden",
    position: "absolute",
    right: -8,
    top: -8,
    zIndex: 0
  },
  frame: {
    aspectRatio: 4 / 5,
    backgroundColor: "#050408",
    borderRadius: 15,
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  media: {
    height: "100%",
    width: "100%"
  },
  mediaFallback: {
    alignItems: "center",
    borderRadius: 15,
    borderWidth: 1,
    height: "100%",
    justifyContent: "center",
    width: "100%"
  },
  revealButton: {
    alignItems: "center",
    borderBottomLeftRadius: 16,
    borderTopLeftRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    position: "absolute",
    right: -1,
    top: 92,
    width: 36,
    zIndex: 4
  },
  stage: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 5,
    position: "absolute",
    right: 11,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    top: 82,
    width: 104,
    zIndex: 4
  },
});
