import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEventListener } from "expo";
import { AppState, Image, Platform, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { api } from "../../api/client";
import type { MobileTheme } from "../../theme/personaTheme";
import { hasCompletePersonaVisualVideoSet, type PersonaVisualStage as PersonaVisualStageProfile } from "@persona/shared";

export type PersonaVisualState = "idle" | "thinking" | "speaking";

type PersonaVisualStageProps = {
  expanded: boolean;
  hidden: boolean;
  landscape?: boolean;
  rightInset?: number;
  personaName: string;
  profile: PersonaVisualStageProfile;
  state: PersonaVisualState;
  theme: MobileTheme;
  visible: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onHiddenChange: (hidden: boolean) => void;
  onAppForeground: () => void;
  onDockedLayout: (layout: { y: number; height: number }) => void;
};

type PersonaVisualClip = {
  src: string;
  label: string;
  state: PersonaVisualState;
  kind: "state" | "transition";
  media: "video" | "image";
};

function pausePlayerSafely(player: { pause: () => void }): void {
  // useVideoPlayer releases its native shared object when the visual unmounts.
  // A hide swipe can therefore race with a pending effect cleanup on either
  // platform. Pausing a released object is not recoverable, but it also is not
  // necessary because release already stops playback.
  try {
    player.pause();
  } catch {
    // The player has already been released as part of unmounting.
  }
}

function PersonaVideo({
  source,
  preloadSource,
  sequence,
  playing,
  onEnd,
  onError
}: {
  source: string;
  preloadSource?: string;
  sequence: number;
  playing: boolean;
  onEnd: (source: string) => void;
  onError: (source: string) => void;
}) {
  const activeSourceRef = useRef<string | undefined>(undefined);
  const completedSequenceRef = useRef<number | undefined>(undefined);
  const operationRef = useRef<Promise<void>>(Promise.resolve());
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);
  const playingRef = useRef(playing);
  const sequenceRef = useRef(sequence);
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
    instance.muted = true;
    instance.keepScreenOnWhilePlaying = false;
    instance.staysActiveInBackground = false;
  });
  const preloadPlayer = useVideoPlayer(null, (instance) => {
    instance.loop = false;
    instance.muted = true;
    instance.keepScreenOnWhilePlaying = false;
    instance.staysActiveInBackground = false;
  });

  playingRef.current = playing;
  sequenceRef.current = sequence;
  onEndRef.current = onEnd;
  onErrorRef.current = onError;

  const finishOnce = (): void => {
    if (completedSequenceRef.current === sequenceRef.current) return;
    completedSequenceRef.current = sequenceRef.current;
    onEndRef.current(source);
  };

  useEffect(() => {
    const requestedSequence = sequence;
    let cancelled = false;
    completedSequenceRef.current = undefined;
    operationRef.current = operationRef.current
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        try {
          pausePlayerSafely(player);
          if (activeSourceRef.current === source) {
            player.currentTime = 0;
          } else {
            await player.replaceAsync({ uri: source, useCaching: true });
            activeSourceRef.current = source;
          }
          if (!cancelled && requestedSequence === sequenceRef.current && playingRef.current) player.play();
        } catch {
          if (!cancelled && requestedSequence === sequenceRef.current) onErrorRef.current(source);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [player, sequence, source]);

  useEffect(() => {
    if (!playing || !preloadSource || preloadSource === source) {
      pausePlayerSafely(preloadPlayer);
      return;
    }
    let cancelled = false;
    void preloadPlayer.replaceAsync({ uri: preloadSource, useCaching: true })
      .then(() => {
        if (!cancelled) pausePlayerSafely(preloadPlayer);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [playing, preloadPlayer, preloadSource, source]);

  useEffect(() => {
    try {
      if (playing) {
        if (completedSequenceRef.current !== sequence) player.play();
      } else {
        pausePlayerSafely(player);
      }
    } catch {
      onErrorRef.current(source);
    }
  }, [player, playing, sequence, source]);

  useEffect(() => {
    if (!playing || completedSequenceRef.current === sequence) return;
    const watchdog = setInterval(() => {
      const duration = player.duration;
      const currentTime = player.currentTime;
      if (Number.isFinite(duration) && duration > 0 && currentTime >= duration - 0.2) {
        finishOnce();
      }
    }, 1_500);
    return () => clearInterval(watchdog);
  }, [player, playing, sequence]);

  useEventListener(player, "playToEnd", finishOnce);
  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "error") onErrorRef.current(source);
    else if (status === "readyToPlay" && playingRef.current && !player.playing && completedSequenceRef.current !== sequenceRef.current) {
      try {
        player.play();
      } catch {
        onErrorRef.current(source);
      }
    }
  });

  return (
    <VideoView
      player={player}
      contentFit="cover"
      nativeControls={false}
      {...(Platform.OS === "android" ? { surfaceType: "textureView" as const } : {})}
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
  if (!hasCompletePersonaVisualVideoSet(profile, failedSources)) {
    return {
      src: profile.fallbackImages[state],
      label: stateLabels[state],
      state,
      kind: "state",
      media: "image"
    };
  }

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

function pickPreloadSource(
  profile: PersonaVisualStageProfile,
  activeClip: PersonaVisualClip,
  targetState: PersonaVisualState,
  failedSources: ReadonlySet<string>
): string | undefined {
  if (!hasCompletePersonaVisualVideoSet(profile, failedSources)) return undefined;
  const nextState = activeClip.kind === "transition" ? targetState : activeClip.state;
  return profile.loops[nextState].find((source) => source !== activeClip.src && !failedSources.has(source))
    ?? profile.loops[nextState].find((source) => !failedSources.has(source));
}

export function PersonaVisualStage({ expanded, hidden, landscape = false, rightInset = 0, personaName, profile, state, theme, visible, onExpandedChange, onHiddenChange, onAppForeground, onDockedLayout }: PersonaVisualStageProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const compactLayout = windowWidth < 360 || windowHeight < 700;
  const tabletLayout = Math.min(windowWidth, windowHeight) >= 600;
  const stageWidth = landscape ? 112 : tabletLayout ? 132 : compactLayout ? 88 : 104;
  const stageTop = landscape ? 68 : tabletLayout ? 120 : compactLayout ? 100 : 112;
  const hiddenTranslate = stageWidth + 24;
  const [activeClip, setActiveClip] = useState<PersonaVisualClip>(() => pickStateClip(profile, state));
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  const [clipSequence, setClipSequence] = useState(0);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
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
      setAppActive(nextAppState === "active");

      if (wasBackgrounded && nextAppState === "active") {
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

    const transitionSrc = hasCompletePersonaVisualVideoSet(profile, failedSourcesRef.current)
      ? profile.transitions[`${fromState}-${state}`]
      : undefined;
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
    setClipSequence((current) => current + 1);
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

    const preloadSource = pickPreloadSource(profile, activeClip, targetStateRef.current, failedSourcesRef.current);
    return (
      <PersonaVideo
        source={source.uri}
        {...(preloadSource ? { preloadSource: api.resolveUrl(preloadSource) } : {})}
        sequence={clipSequence}
        playing={appActive && visible && (!hidden || expanded)}
        onError={() => handleMediaError(activeClip.src)}
        onEnd={() => finishClip(activeClip.src)}
      />
    );
  }

  if (hidden) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show persona card"
        onPress={() => onHiddenChange(false)}
        style={[
          styles.revealButton,
          { top: stageTop + 10, right: rightInset - 1, borderColor: theme.border, backgroundColor: "rgba(23,15,33,0.90)" }
        ]}
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
        onLayout={(event: LayoutChangeEvent) => {
          const { y, height } = event.nativeEvent.layout;
          onDockedLayout({ y, height });
        }}
        style={[
          styles.stage,
          { top: stageTop, right: 11 + rightInset, width: stageWidth, borderColor: theme.border, backgroundColor: "rgba(7,5,12,0.62)" },
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
  }
});
