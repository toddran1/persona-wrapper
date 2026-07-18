import { useEffect, useRef, useState } from "react";
import type { PersonaVisualStage as PersonaVisualStageProfile } from "@persona/shared";

export type PersonaVisualState = "idle" | "thinking" | "speaking";

type PersonaVisualStageProps = {
  state: PersonaVisualState;
  personaName: string;
  profile: PersonaVisualStageProfile;
  hidden?: boolean;
  onHide?: () => void;
};

type PersonaVisualClip = {
  src: string;
  label: string;
  loop: boolean;
  state: PersonaVisualState;
  kind: "state" | "transition";
  media: "video" | "image";
  startTime?: number;
};

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
      loop: false,
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
    loop: false,
    state,
    kind: "state",
    media: "video"
  };
}

export function PersonaVisualStage({ state, personaName, profile, hidden = false, onHide }: PersonaVisualStageProps) {
  const [activeClip, setActiveClip] = useState<PersonaVisualClip>(() => pickStateClip(profile, state));
  const [previousClip, setPreviousClip] = useState<PersonaVisualClip | null>(null);
  const activeClipRef = useRef<PersonaVisualClip | null>(null);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const failedSourcesRef = useRef<Set<string>>(new Set());
  const crossfadeTimerRef = useRef<number | null>(null);
  const settledStateRef = useRef<PersonaVisualState>(state);
  const targetStateRef = useRef<PersonaVisualState>(state);

  if (activeClipRef.current === null) {
    activeClipRef.current = activeClip;
  }

  const showClip = (clip: PersonaVisualClip) => {
    const currentClip = activeClipRef.current;
    if (currentClip && currentClip.src !== clip.src) {
      const startTime = activeVideoRef.current?.currentTime;
      const previousDisplayClip =
        typeof startTime === "number" && Number.isFinite(startTime) ? { ...currentClip, startTime } : currentClip;
      setPreviousClip(previousDisplayClip);
      if (crossfadeTimerRef.current !== null) {
        window.clearTimeout(crossfadeTimerRef.current);
      }
      crossfadeTimerRef.current = window.setTimeout(() => {
        setPreviousClip(null);
        crossfadeTimerRef.current = null;
      }, 420);
    }

    activeClipRef.current = clip;
    setActiveClip(clip);
  };

  useEffect(() => {
    return () => {
      if (crossfadeTimerRef.current !== null) {
        window.clearTimeout(crossfadeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    failedSourcesRef.current.clear();
    settledStateRef.current = state;
    targetStateRef.current = state;
    showClip(pickStateClip(profile, state));
  }, [profile]);

  useEffect(() => {
    if (targetStateRef.current === state) return;

    const currentClip = activeClipRef.current;
    const fromState = currentClip?.kind === "state" ? settledStateRef.current : targetStateRef.current;
    targetStateRef.current = state;

    if (fromState === state) {
      settledStateRef.current = state;
      showClip(pickStateClip(profile, state, currentClip?.src, failedSourcesRef.current));
      return;
    }

    const transitionSrc = profile.transitions[`${fromState}-${state}`];
    if (transitionSrc) {
      showClip({ src: transitionSrc, label: stateLabels[state], loop: false, kind: "transition", media: "video", state });
      return;
    }

    settledStateRef.current = state;
    showClip(pickStateClip(profile, state, currentClip?.src, failedSourcesRef.current));
  }, [profile, state]);

  const finishClip = () => {
    const currentClip = activeClipRef.current;
    if (!currentClip) return;

    if (currentClip.kind === "state") {
      if (currentClip.state === targetStateRef.current) {
        showClip(pickStateClip(profile, currentClip.state, currentClip.src, failedSourcesRef.current));
      }
      return;
    }

    const nextState = targetStateRef.current;
    settledStateRef.current = nextState;
    showClip(pickStateClip(profile, nextState, undefined, failedSourcesRef.current));
  };

  const handleMediaError = () => {
    const currentClip = activeClipRef.current;
    if (!currentClip) return;

    failedSourcesRef.current.add(currentClip.src);

    if (currentClip.kind === "transition") {
      const nextState = targetStateRef.current;
      settledStateRef.current = nextState;
      showClip(pickStateClip(profile, nextState, undefined, failedSourcesRef.current));
      return;
    }

    showClip(pickStateClip(profile, currentClip.state, currentClip.src, failedSourcesRef.current));
  };

  const renderClip = (clip: PersonaVisualClip, layer: "active" | "previous") => {
    const className = `persona-stage-media persona-stage-media-${layer}`;
    if (clip.media === "image") {
      return (
        <img
          key={`${layer}-${clip.src}`}
          src={clip.src}
          className={className}
          alt={`${personaName} ${clip.label.toLowerCase()} fallback`}
          data-active={layer === "active" ? "true" : undefined}
          onError={layer === "active" ? handleMediaError : undefined}
        />
      );
    }

    return (
      <video
        key={`${layer}-${clip.src}`}
        ref={layer === "active" ? activeVideoRef : undefined}
        src={clip.src}
        className={className}
        aria-label={`${personaName} ${clip.label.toLowerCase()} state`}
        autoPlay={layer === "active"}
        loop={clip.loop}
        muted
        playsInline
        preload="auto"
        data-active={layer === "active" ? "true" : undefined}
        onLoadedMetadata={(event) => {
          if (layer !== "previous" || typeof clip.startTime !== "number") return;
          event.currentTarget.currentTime = Math.max(0, clip.startTime);
          event.currentTarget.pause();
        }}
        onEnded={layer === "active" ? finishClip : undefined}
        onError={layer === "active" ? handleMediaError : undefined}
      />
    );
  };

  return (
    <aside className={`persona-stage persona-stage-${state}${hidden ? " persona-stage-hidden" : ""}`} aria-label={`${personaName} visual state`}>
      {onHide ? (
        <button
          type="button"
          className="persona-stage-toggle"
          aria-label="Hide persona card"
          title="Hide persona card"
          onClick={onHide}
        >
          Hide
        </button>
      ) : null}
      <div className="persona-stage-frame">
        {previousClip ? renderClip(previousClip, "previous") : null}
        {renderClip(activeClip, "active")}
      </div>
      <div className="persona-stage-status">
        <span>{stateLabels[state]}</span>
      </div>
    </aside>
  );
}
