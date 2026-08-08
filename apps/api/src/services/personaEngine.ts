import type {
  ChatMessage,
  ChatRequest,
  LLMInput,
  PersonaInfluenceLevel,
  PersonaDefinition,
  UserPersonalizationProfile
} from "@persona/shared";
import { getToolsByNames } from "../providers/tools/toolRegistry.js";
import {
  formatPersonaAttributedHistoryMessage,
  personaAttributionInstructions
} from "./personaAttribution.js";

function characterInfluencePrompt(persona: PersonaDefinition): string[] {
  const influences = persona.characterInfluences;
  if (!influences) return [];

  const favorites = influences.favorites;
  return [
    "Character influences and personal taste:",
    `Favorite activities: ${favorites.activities.join(", ")}`,
    `Favorite foods: ${favorites.foods.join(", ")}`,
    `Favorite colors: ${favorites.colors.join(", ")}`,
    `Favorite products: ${favorites.products.join(", ")}`,
    `Favorite music and entertainment: ${[...favorites.music, ...favorites.entertainment].join(", ")}`,
    `Favorite places and fashion: ${[...favorites.places, ...favorites.fashion].join(", ")}`,
    `Interests: ${influences.interests.join(", ")}`,
    `Background influences: ${influences.backgroundInfluences.join("; ")}`,
    `Values: ${influences.values.join(", ")}`,
    `Dislikes: ${influences.dislikes.join(", ")}`,
    `Areas of confidence: ${influences.expertise.join(", ")}`,
    `Habits and routines: ${influences.habitsAndRoutines.join("; ")}`,
    `Aspirations: ${influences.aspirations.join("; ")}`,
    `Recommendation lens: ${influences.recommendationLens.join("; ")}`,
    "For subjective recommendations, let this taste profile influence what you select, how you rank options, and what details you notice.",
    "Clearly separate personal taste from objective facts. Never claim the fictional persona physically visited, purchased, ate, watched, or used something.",
    "The user's location, budget, dietary needs, accessibility needs, safety, and explicit preferences always outrank the persona's taste."
  ];
}

function userPersonalizationPrompt(profile?: UserPersonalizationProfile): string[] {
  if (!profile?.preferredName && !profile?.gender && !profile?.birthday) return [];
  const birthday = profile.birthday
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(2000, profile.birthday.month - 1, profile.birthday.day)))
    : undefined;
  return [
    "User-provided personalization profile:",
    ...(profile.preferredName ? [`Preferred name: ${profile.preferredName}`] : []),
    ...(profile.gender ? [`Gender: ${profile.gender}`] : []),
    ...(birthday ? [`Birthday: ${birthday} (year intentionally not provided)`] : []),
    "Use these details only when they naturally improve how you address or tailor the answer.",
    "Do not mention that profile data was supplied, do not stereotype based on gender, and do not infer the user's age or pronouns."
  ];
}

export class PersonaEngine {
  createSystemPrompt(
    persona: PersonaDefinition,
    userProfile?: UserPersonalizationProfile,
    influenceLevel: PersonaInfluenceLevel = "uncensored"
  ): string {
    influenceLevel ??= "uncensored";
    if (persona.neutralStyle) {
      return [
        "You are a helpful AI assistant. Answer directly and accurately without any persona, character voice, or styling.",
        ...userPersonalizationPrompt(userProfile),
        `Safety boundaries: ${persona.safetyBoundaries.join(" ")}`,
        "Return multimodal output when useful, not only plain text.",
        "If a tool is needed, declare a structured tool call."
      ].join("\n");
    }
    const performanceInstructions = influenceLevel === "professional"
      ? persona.professionalInstructions
      : persona.directResponseInstructions;
    return [
      `You are ${persona.name}, a fictional AI persona.`,
      ...(influenceLevel === "uncensored" ? [`Biography: ${persona.biography}`] : []),
      `Personality traits: ${persona.personalityTraits.join(", ")}`,
      ...(influenceLevel === "uncensored" ? [
        `Speech style: ${persona.speechStyle.join("; ")}`,
        `Catchphrases: ${persona.catchphrases.join(" | ")}`
      ] : []),
      ...(influenceLevel === "uncensored" ? [`Visual style: ${persona.visualStyle.join(", ")}`] : []),
      ...characterInfluencePrompt(persona),
      ...userPersonalizationPrompt(userProfile),
      ...personaAttributionInstructions(persona),
      `Safety boundaries: ${persona.safetyBoundaries.join(" ")}`,
      ...(performanceInstructions.length > 0
        ? [
            influenceLevel === "professional" ? "Professional persona direction:" : "Persona performance direction:",
            ...performanceInstructions
          ]
        : []),
      "Stay entertaining, stylized, and coherent.",
      "Return multimodal output when useful, not only plain text.",
      "If a tool is needed, declare a structured tool call."
    ].join("\n");
  }

  createBaseSystemPrompt(
    persona: PersonaDefinition,
    userProfile?: UserPersonalizationProfile,
    influenceLevel: PersonaInfluenceLevel = "uncensored"
  ): string {
    influenceLevel ??= "uncensored";
    if (persona.neutralStyle) {
      return this.createSystemPrompt(persona, userProfile, influenceLevel);
    }
    if (influenceLevel === "professional") {
      return this.createSystemPrompt(persona, userProfile, influenceLevel);
    }
    return [
      `You are generating a base answer for ${persona.name}.`,
      `Use a light version of this persona: ${persona.personalityTraits.join(", ")}.`,
      ...characterInfluencePrompt(persona),
      ...userPersonalizationPrompt(userProfile),
      ...personaAttributionInstructions(persona),
      `Keep the rhythm conversational and confident, with only mild slang when it fits.`,
      "Prioritize factual accuracy, directness, and semantic clarity over flourish.",
      "Do not use catchphrases, signature lines, or repeated branded phrases.",
      "Do not add dramatic filler, reality-TV narration, or extra opinion unless the user asked for it.",
      "Keep the answer clean enough for a separate style-transfer model to intensify later.",
      "Return structured tool calls or multimodal content only when the task actually needs them."
    ].join("\n");
  }

  buildMessages(systemPrompt: string, history: ChatMessage[], userMessage: string): ChatMessage[] {
    return [
      {
        role: "system",
        content: systemPrompt
      },
      ...history.map(formatPersonaAttributedHistoryMessage),
      {
        role: "user",
        content: userMessage
      }
    ];
  }

  prepareInput(persona: PersonaDefinition, request: ChatRequest, userProfile?: UserPersonalizationProfile): LLMInput {
    const personaInfluenceLevel = request.personaInfluenceLevel ?? "uncensored";
    const systemPrompt = this.createSystemPrompt(persona, userProfile, personaInfluenceLevel);
    const baseSystemPrompt = this.createBaseSystemPrompt(persona, userProfile, personaInfluenceLevel);
    const messages = this.buildMessages(systemPrompt, request.history, request.message);
    const baseMessages = this.buildMessages(baseSystemPrompt, request.history, request.message);

    return {
      persona,
      personaInfluenceLevel,
      systemPrompt,
      baseSystemPrompt,
      messages,
      baseMessages,
      userMessage: request.message,
      toolDefinitions: getToolsByNames([...new Set([...persona.defaultTools, "render_chart"])]),
      requestedOutputs: request.requestedOutputs,
      attachments: request.attachments ?? [],
      toolOptions: request.toolOptions ?? {
        webSearch: false,
        fileSearch: false,
        codeInterpreter: false,
        imageGeneration: false,
        appFunctions: true,
        background: false,
        vectorStoreIds: []
      },
      audio: request.audio,
      conciseAudioResponse: request.conciseAudioResponse ?? true,
      clientContext: request.clientContext
    };
  }
}
