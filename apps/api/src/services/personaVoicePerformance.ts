import type { PersonaDefinition } from "@persona/shared";

type PerformancePreset = {
  transformMechanicalScript: (text: string, modelId: string) => string;
  promptInstructions: (persona: PersonaDefinition, modelId: string) => string[];
};

const neutralPreset: PerformancePreset = {
  transformMechanicalScript: (text) => text,
  promptInstructions: () => [
    "Match the current persona's configured speaking style while keeping the narration natural and easy to understand."
  ]
};

const laraeConfessionalPreset: PerformancePreset = {
  transformMechanicalScript: (text, modelId) => {
    if (modelId === "eleven_v3") {
      return `[sassy, excited]\n${text.replace(/\b(bitch|hoe|clock it|be serious)\b/gi, "$& [laughs]")}`;
    }

    return text
      .replace(/\b(baby girl|baby)\b,*\s*/gi, "$1, ")
      .replace(/,{2,}/g, ",")
      .trim();
  },
  promptInstructions: (persona, modelId) => {
    const name = persona.shortName ?? persona.name;
    const common = [
      `Perform the narration in ${name}'s sassy, animated, rapid-fire confessional style.`,
      "Carry amused disbelief, side-eye, dramatic emphasis, playful confidence, and quick punchline timing through the whole script."
    ];

    if (modelId === "eleven_v3") {
      return [
        ...common,
        "Use short ElevenLabs v3 audio tags like [laughs], [sassy], [excited], [whispers], or [dramatic pause] sparingly when they improve the performance."
      ];
    }

    return [
      ...common,
      "Do not include bracketed emotion tags because this voice model may read them aloud.",
      "Use phonetic reactions like Haha, Heh, Ahaha!, HA!, or Oh, pfft— when laughter or amused disbelief fits.",
      "Use human-readable vocal fragments like Ugh..., Oh... god..., *sniff*, or No... no... only when emotionally appropriate.",
      "Use ellipses and long dashes for breath, hesitation, pitch drops, and dramatic timing.",
      "Use occasional ALL CAPS on one or two key words and ?! for sharp upward bewildered inflection. Do not overuse either.",
      "Use contextual lead-ins like Listen..., Look—, Baby..., or Bitch— to cue urgency, sass, or a lower register.",
      "Use punctuation and paragraph breaks at major beats to create natural pauses without provider-specific markup."
    ];
  }
};

const presets: Record<string, PerformancePreset> = {
  neutral: neutralPreset,
  "larae-confessional": laraeConfessionalPreset
};

function presetFor(persona: PersonaDefinition): PerformancePreset {
  return presets[persona.voiceProfile.performancePreset] ?? neutralPreset;
}

export function applyPersonaVoicePerformance(
  text: string,
  persona: PersonaDefinition,
  modelId: string
): string {
  return presetFor(persona).transformMechanicalScript(text, modelId);
}

export function personaVoicePromptInstructions(
  persona: PersonaDefinition,
  modelId: string
): string[] {
  return presetFor(persona).promptInstructions(persona, modelId);
}
