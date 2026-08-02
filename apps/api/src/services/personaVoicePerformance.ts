import type { PersonaDefinition } from "@persona/shared";

type PerformancePreset = {
  transformMechanicalScript: (text: string, modelId: string) => string;
  promptInstructions: (persona: PersonaDefinition, modelId: string) => string[];
};

function isFishS2Model(modelId: string): boolean {
  return modelId === "s2-pro" || modelId === "s2.1-pro" || modelId === "s2.1-pro-free";
}

function fishS2PromptInstructions(): string[] {
  return [
    "Write the hidden tts_script for the ear, not the screen. Use conversational contractions, natural spoken sentence structure, and shorter spoken thoughts when visible_text contains long written sentences.",
    "Create a coherent emotional arc across the response instead of assigning an unrelated performance to every sentence. Keep the persona recognizable without exaggerating the delivery into a caricature; prioritize clarity, believable rhythm, warmth, and emotional continuity.",
    "For Fish Audio S2 and S2.1 models (including s2-pro, s2.1-pro, and s2.1-pro-free), use a bracket cue only when it materially changes how a line should be performed, such as [confident], [amused], [excited], [serious], [whispering], [chuckling], [sighing], or [break].",
    "Do not place a cue on every sentence, stack multiple cues, or repeat one cue mechanically. Usually let two or three related sentences share one emotional direction, and reserve [break] for a meaningful transition, reveal, or punchline.",
    "Treat supported bracket cues as silent performance controls. Everything outside a supported bracket must be text that should actually be spoken aloud.",
    "Use punctuation for micro-pacing: commas for brief breaths, em dashes for interruptions or pivots, ellipses for genuine hesitation or suspense, and paragraph breaks for larger emotional transitions. Do not overuse ellipses, exclamation marks, capitalization, filler words, vocal reactions, or dramatic pauses.",
    "Resolve difficult pronunciations in tts_script when needed while preserving the visible spelling, exact identity, and factual meaning in visible_text.",
    "Do not put Fish Audio cues in visible_text. Do not include emoji, markdown, URLs, citations, source markers, interface language, stage directions outside supported brackets, or cues that conflict with the response meaning in tts_script."
  ];
}

const neutralPreset: PerformancePreset = {
  transformMechanicalScript: (text) => text,
  promptInstructions: () => [
    "Match the current persona's configured speaking style while keeping the narration natural and easy to understand."
  ]
};

const laraeConfessionalPreset: PerformancePreset = {
  transformMechanicalScript: (text, modelId) => {
    if (modelId === "eleven_v3") {
      return `[sassy, mean-girl humor, excited]\n${text.replace(/\b(bitch|hoe|clock it|be serious)\b/gi, "$& [laughs]")}`;
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

    if (isFishS2Model(modelId)) {
      return [...common, ...fishS2PromptInstructions()];
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

const bambamPartyPreset: PerformancePreset = {
  transformMechanicalScript: (text) => text,
  promptInstructions: (persona, modelId) => {
    const name = persona.shortName ?? persona.name;
    const common = [
      `Perform the narration in ${name}'s lively, charismatic, playful, warm, and theatrically confident style.`,
      "Use expressive timing, warm humor, clear emphasis, and occasional party-host energy without turning every sentence into a shout."
    ];
    if (isFishS2Model(modelId)) return [...common, ...fishS2PromptInstructions()];
    if (modelId === "eleven_v3") {
      return [...common, "Use short ElevenLabs v3 audio tags sparingly when they improve the performance."];
    }
    return [...common, "Use punctuation and paragraph breaks to create natural pacing without provider-specific markup."];
  }
};

const presets: Record<string, PerformancePreset> = {
  neutral: neutralPreset,
  "larae-confessional": laraeConfessionalPreset,
  "bambam-party": bambamPartyPreset
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
