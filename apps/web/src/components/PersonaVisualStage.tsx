type PersonaVisualState = "idle" | "thinking" | "speaking";

type PersonaVisualStageProps = {
  state: PersonaVisualState;
  personaName: string;
};

const visualAssets: Record<PersonaVisualState, { src: string; label: string }> = {
  idle: {
    src: "/personas/larae/larae_vid_idle.png",
    label: "Idle"
  },
  thinking: {
    src: "/personas/larae/larae_vid_thinking.png",
    label: "Thinking"
  },
  speaking: {
    src: "/personas/larae/larae_vid_speaking_1.png",
    label: "Speaking"
  }
};

export function PersonaVisualStage({ state, personaName }: PersonaVisualStageProps) {
  const activeVisual = visualAssets[state];

  return (
    <aside className={`persona-stage persona-stage-${state}`} aria-label={`${personaName} visual state`}>
      <div className="persona-stage-frame">
        <img src={activeVisual.src} alt={`${personaName} ${activeVisual.label.toLowerCase()} state`} />
      </div>
      <div className="persona-stage-status">
        <span>{activeVisual.label}</span>
      </div>
    </aside>
  );
}
