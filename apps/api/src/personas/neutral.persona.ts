import { NEUTRAL_PERSONA_ID, type PersonaDefinitionInput } from "@persona/shared";

export const neutralPersona: PersonaDefinitionInput = {
  id: NEUTRAL_PERSONA_ID,
  name: "No persona",
  shortName: "None",
  legalName: "",
  age: "",
  height: "",
  weight: "",
  tagline: "Plain assistant answers with no persona styling.",
  description:
    "No persona is the neutral option: responses come straight from the model as a plain, helpful assistant with no character voice, styling, or catchphrases. Tools like web search, files, charts, and image generation still work.",
  avatarColor: "#9aa0a6",
  theme: {
    mode: "dark",
    themeName: "Neutral",
    background: "linear-gradient(135deg, #101216 0%, #181c22 42%, #0c0e11 100%)",
    backgroundAlt: "#181c22",
    backgroundAccent: "rgba(125, 145, 175, 0.20)",
    backgroundAccentSecondary: "rgba(160, 170, 185, 0.16)",
    surface: "rgba(22, 26, 32, 0.84)",
    surfaceStrong: "rgba(32, 37, 45, 0.96)",
    rail: "#9aa5b1",
    border: "rgba(154, 165, 177, 0.16)",
    accent: "#7d91af",
    accent2: "#a0aab9",
    text: "#f2f4f7",
    muted: "#b6bdc7",
    chartColors: [
      "#7d91af",
      "#a0aab9",
      "#69c4b1",
      "#7899e8",
      "#ef8d5b",
      "#e06f9f"
    ]
  },
  documentTitle: "For the Baddiez",
  promptPlaceholder: "Ask anything",
  suggestedPrompts: [],
  supportedProviders: ["openai", "gemini", "claude", "local"],
  available: true,
  neutralStyle: true,
  biography: "",
  personalityTraits: [],
  speechStyle: [],
  catchphrases: [],
  visualStyle: [],
  safetyBoundaries: [
    "Do not impersonate a real celebrity, activist, public figure, or community leader."
  ],
  voiceProfile: {
    defaultVoiceId: "neutral",
    speakingStyle: "clear, neutral, and professional"
  },
  defaultTools: [
    "web_search",
    "file_search",
    "data_analysis",
    "image_generation",
    "current_time"
  ]
};
