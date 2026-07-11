import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Video, ResizeMode } from "expo-av";
import type { AVPlaybackStatus } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { PanGestureHandler, type PanGestureHandlerGestureEvent } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { api } from "../../api/client";
import type { MobileTheme } from "../../theme/personaTheme";

export type PersonaVisualState = "idle" | "thinking" | "speaking";

type PersonaVisualStageProps = {
  expanded: boolean;
  hidden: boolean;
  personaName: string;
  state: PersonaVisualState;
  theme: MobileTheme;
  onExpandedChange: (expanded: boolean) => void;
  onHiddenChange: (hidden: boolean) => void;
};

type PersonaVisualClip = {
  src: string;
  label: string;
  state: PersonaVisualState;
  kind: "state" | "transition";
  media: "video" | "image";
};

type GestureContext = {
  startX: number;
};

const stateLabels: Record<PersonaVisualState, string> = {
  idle: "Idle",
  thinking: "Thinking",
  speaking: "Speaking"
};

const stateClipSources: Record<PersonaVisualState, string[]> = {
  idle: [
    "/personas/larae/videos/loops/larae-video-idle-10s-1st.mp4",
    "/personas/larae/videos/loops/larae-video-idle-10s-2nd.mp4",
    "/personas/larae/videos/loops/larae-video-idle-10s-3rd.mp4",
    "/personas/larae/videos/loops/larae-video-idle-10s-4th.mp4",
    "/personas/larae/videos/loops/larae-video-idle-10s-5th.mp4",
    "/personas/larae/videos/loops/larae-video-idle-10s-6th.mp4"
  ],
  thinking: [
    "/personas/larae/videos/loops/larae-video-thinking-10s-1st.mp4",
    "/personas/larae/videos/loops/larae-video-thinking-10s-2nd.mp4",
    "/personas/larae/videos/loops/larae-video-thinking-10s-3rd.mp4"
  ],
  speaking: [
    "/personas/larae/videos/loops/larae-video-talking-10s-1st.mp4",
    "/personas/larae/videos/loops/larae-video-talking-10s-2nd.mp4",
    "/personas/larae/videos/loops/larae-video-talking-10s-3rd.mp4",
    "/personas/larae/videos/loops/larae-video-talking-10s-4th.mp4"
  ]
};

const transitionClips: Partial<Record<`${PersonaVisualState}-${PersonaVisualState}`, Omit<PersonaVisualClip, "state">>> = {
  "idle-thinking": {
    src: "/personas/larae/videos/transitions/larae-video-idle-to-thinking-1s-1st.mp4",
    label: "Thinking",
    kind: "transition",
    media: "video"
  },
  "idle-speaking": {
    src: "/personas/larae/videos/transitions/larae-video-idle-to-talking-1s-1st.mp4",
    label: "Speaking",
    kind: "transition",
    media: "video"
  },
  "thinking-speaking": {
    src: "/personas/larae/videos/transitions/larae-video-thinking-to-talking-1s-1st.mp4",
    label: "Speaking",
    kind: "transition",
    media: "video"
  },
  "thinking-idle": {
    src: "/personas/larae/videos/transitions/larae-video-thinking-to-idle-1s.mp4",
    label: "Idle",
    kind: "transition",
    media: "video"
  },
  "speaking-idle": {
    src: "/personas/larae/videos/transitions/larae-video-talking-to-idle-2s-1st.mp4",
    label: "Idle",
    kind: "transition",
    media: "video"
  }
};

const fallbackImages: Record<PersonaVisualState, string> = {
  idle: "/personas/larae/larae_vid_idle.png",
  thinking: "/personas/larae/larae_vid_thinking.png",
  speaking: "/personas/larae/larae_vid_speaking_1.png"
};

function pickStateClip(state: PersonaVisualState, previousSrc?: string, failedSources: ReadonlySet<string> = new Set()): PersonaVisualClip {
  const sources = stateClipSources[state].filter((src) => !failedSources.has(src));
  const fallbackSource = sources[0];
  if (!fallbackSource) {
    return {
      src: fallbackImages[state],
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

export function PersonaVisualStage({ expanded, hidden, personaName, state, theme, onExpandedChange, onHiddenChange }: PersonaVisualStageProps) {
  const [activeClip, setActiveClip] = useState<PersonaVisualClip>(() => pickStateClip(state));
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  const activeClipRef = useRef<PersonaVisualClip | null>(activeClip);
  const failedSourcesRef = useRef<Set<string>>(new Set());
  const lastPressAtRef = useRef(0);
  const settledStateRef = useRef<PersonaVisualState>(state);
  const targetStateRef = useRef<PersonaVisualState>(state);
  const expandedProgress = useSharedValue(expanded ? 1 : 0);
  const translateX = useSharedValue(hidden ? 124 : 0);

  useEffect(() => {
    translateX.value = withTiming(hidden ? 124 : 0, { duration: 260 });
  }, [hidden, translateX]);

  useEffect(() => {
    expandedProgress.value = withTiming(expanded ? 1 : 0, { duration: 280 });
  }, [expanded, expandedProgress]);

  useEffect(() => {
    if (targetStateRef.current === state) return;

    setMediaUnavailable(false);
    const currentClip = activeClipRef.current;
    const fromState = currentClip?.kind === "state" ? settledStateRef.current : targetStateRef.current;
    targetStateRef.current = state;

    if (fromState === state) {
      settledStateRef.current = state;
      showClip(pickStateClip(state, currentClip?.src, failedSourcesRef.current));
      return;
    }

    const transition = transitionClips[`${fromState}-${state}`];
    if (transition && !failedSourcesRef.current.has(transition.src)) {
      showClip({ ...transition, state });
      return;
    }

    settledStateRef.current = state;
    showClip(pickStateClip(state, currentClip?.src, failedSourcesRef.current));
  }, [state]);

  function showClip(clip: PersonaVisualClip): void {
    setMediaUnavailable(false);
    activeClipRef.current = clip;
    setActiveClip(clip);
  }

  function finishClip(): void {
    const currentClip = activeClipRef.current;
    if (!currentClip) return;

    if (currentClip.kind === "transition") {
      const nextState = targetStateRef.current;
      settledStateRef.current = nextState;
      showClip(pickStateClip(nextState, undefined, failedSourcesRef.current));
      return;
    }

    if (currentClip.state === targetStateRef.current) {
      showClip(pickStateClip(currentClip.state, currentClip.src, failedSourcesRef.current));
    }
  }

  function handleMediaError(): void {
    const currentClip = activeClipRef.current;
    if (!currentClip) return;
    failedSourcesRef.current.add(currentClip.src);

    if (currentClip.media === "image") {
      setMediaUnavailable(true);
      return;
    }

    if (currentClip.kind === "transition") {
      const nextState = targetStateRef.current;
      settledStateRef.current = nextState;
      showClip(pickStateClip(nextState, undefined, failedSourcesRef.current));
      return;
    }

    showClip(pickStateClip(currentClip.state, currentClip.src, failedSourcesRef.current));
  }

  const panGesture = useAnimatedGestureHandler<PanGestureHandlerGestureEvent, GestureContext>({
    onStart: (_, context) => {
      context.startX = translateX.value;
    },
    onActive: (event, context) => {
      translateX.value = Math.max(0, Math.min(128, context.startX + event.translationX));
    },
    onEnd: (event) => {
      const shouldHide = translateX.value > 52 || event.velocityX > 360;
      translateX.value = withTiming(shouldHide ? 124 : 0, { duration: 220 });
      if (shouldHide) runOnJS(onHiddenChange)(true);
    }
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

  function handlePlaybackStatus(status: AVPlaybackStatus): void {
    if (!status.isLoaded) return;
    if (status.didJustFinish) finishClip();
  }

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
          source={source}
          resizeMode="cover"
          style={styles.media}
          onError={handleMediaError}
        />
      );
    }

    return (
      <Video
        key={activeClip.src}
        source={source}
        resizeMode={ResizeMode.COVER}
        shouldPlay={!hidden || expanded}
        isLooping={false}
        isMuted
        useNativeControls={false}
        style={styles.media}
        onError={handleMediaError}
        onPlaybackStatusUpdate={handlePlaybackStatus}
      />
    );
  }

  if (hidden) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show persona card"
        onPress={() => onHiddenChange(false)}
        style={[styles.revealButton, { borderColor: theme.border, backgroundColor: "rgba(23,15,33,0.90)" }]}
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
    <PanGestureHandler onGestureEvent={panGesture} activeOffsetX={12}>
      <Animated.View
        accessibilityLabel={`${personaName} visual state: ${stateLabels[state]}`}
        style={[styles.stage, { borderColor: theme.border, backgroundColor: "rgba(7,5,12,0.62)" }, stageStyle]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Expand persona visual" onPress={handleStagePress} style={styles.frame}>
          {renderClip()}
        </Pressable>
      </Animated.View>
    </PanGestureHandler>
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
