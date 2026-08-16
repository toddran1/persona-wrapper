import type { ImageProviderId, LLMInput, PersonaDefinition } from "@persona/shared";

const SAFETY_PROMPT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bthick\b/gi, "curvy"],
  [/\bbig boobs?\b/gi, "curvy frame"],
  [/\blarge breasts?\b/gi, "curvy frame"],
  [/\bbig butt\b/gi, "curvy frame"],
  [/\bass\b/gi, "figure"],
  [/\bnude\b|\bnudity\b/gi, "clothed"],
  [/\btopless\b/gi, "wearing a fashionable top"],
  [/\blingerie\b/gi, "fashion outfit"],
  [/\berotic\b|\bpornographic\b/gi, "editorial fashion"],
  [/\bfuck(?:ing)?\b|\bbitch(?:es)?\b|\bnigg(?:a|as)\b|\bhoe(?:s)?\b/gi, ""]
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

function phrasePattern(phrase: string): RegExp {
  const escaped = escapeRegExp(phrase.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

function sanitizeImageRequest(message: string, persona?: PersonaDefinition): string {
  let sanitized = message;
  const personaReplacements = persona?.imagePromptSanitization?.replacements ?? [];
  for (const rule of personaReplacements) {
    for (const phrase of [...rule.phrases].sort((left, right) => right.length - left.length)) {
      sanitized = sanitized.replace(phrasePattern(phrase), rule.replaceWith);
    }
  }
  for (const [pattern, replacement] of SAFETY_PROMPT_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return normalizeWhitespace(sanitized);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function personaNameTokens(persona: PersonaDefinition): string[] {
  const tokens = new Set<string>();
  const addToken = (value: string | undefined) => {
    const normalized = normalizeWhitespace(value ?? "");
    if (!normalized) return;
    tokens.add(normalized.toLowerCase());
    const firstWord = normalized.split(/\s+/)[0];
    if (firstWord && firstWord.length > 2) tokens.add(firstWord.toLowerCase());
  };

  addToken(persona.id);
  addToken(persona.name);
  addToken(persona.legalName);
  return [...tokens];
}

function hasExplicitPersonaOptOut(message: string, persona: PersonaDefinition): boolean {
  const aliases = personaNameTokens(persona)
    .map(escapeRegExp)
    .join("|");
  const personaTerms = aliases ? `(?:${aliases}|persona|character|avatar|assistant)` : "(?:persona|character|avatar|assistant)";

  return [
    new RegExp(`\\b(?:do not|don't|dont|without|exclude|not)\\s+(?:use|include|base\\s+it\\s+on|make\\s+it\\s+about)?\\s*(?:the\\s+)?${personaTerms}\\b`, "i"),
    /\bnot\s+(?:about|based\s+on|of|with)\s+(?:you|yourself|your\s+look|your\s+avatar)\b/i,
    /\b(?:ignore|skip)\s+(?:the\s+)?(?:persona|character|avatar|assistant)\b/i
  ].some((pattern) => pattern.test(message));
}

function isPersonaImageRequest(message: string, persona: PersonaDefinition): boolean {
  const normalizedMessage = normalizeWhitespace(message).toLowerCase();
  if (!normalizedMessage) return false;
  if (hasExplicitPersonaOptOut(normalizedMessage, persona)) return false;

  const personaAliasPattern = personaNameTokens(persona)
    .map(escapeRegExp)
    .join("|");

  if (personaAliasPattern && new RegExp(`\\b(?:${personaAliasPattern})\\b`, "i").test(normalizedMessage)) {
    return true;
  }

  return [
    /\b(of|for|with|show|draw|generate|make|create|picture|photo|image|portrait|avatar|selfie|headshot|render|illustration|painting|sketch)\s+(you|yourself)\b/i,
    /\b(?:draw|generate|make|create|render|paint|sketch|illustrate|design|show)\s+(?:an?\s+)?(?:image|picture|photo|portrait|avatar|selfie|headshot|full[-\s]?body|look|outfit|version)?\s*(?:of\s+)?(?:you|yourself)\b/i,
    /\b(?:turn|make|style|dress|put)\s+(?:you|yourself)\s+(?:as|into|in|wearing|with)\b/i,
    /\bwhat\s+(you|yourself)\s+look\s+like\b/i,
    /\b(?:show|send|give|make|create|generate|draw|render)\s+(?:me\s+)?(?:your\s+)?(?:face|look|appearance|avatar|portrait|photo|picture|image|outfit|style|selfie|headshot)\b/i,
    /\byour\s+(face|body|look|appearance|avatar|portrait|photo|picture|image|outfit|style|selfie|headshot|full[-\s]?body|vibe|aesthetic|wardrobe|hair|makeup|pose)\b/i,
    /\b(?:this|the|our|current)\s+(persona|character|avatar|assistant|ai\s+persona|bot)\b/i,
    /\b(?:persona|character|avatar|assistant|ai\s+persona|bot)\s+(?:image|picture|photo|portrait|selfie|headshot|look|appearance|outfit|style|design|reference|sheet|turnaround)\b/i,
    /\b(?:profile|display)\s+(?:image|picture|photo|avatar)\s+(?:for|of)\s+(?:you|yourself|the\s+persona|the\s+character|the\s+assistant)\b/i,
    /\b(?:reference|model|character)\s+sheet\s+(?:for|of)\s+(?:you|yourself|the\s+persona|the\s+character|the\s+assistant)\b/i,
    /\b(?:full[-\s]?body|waist[-\s]?up|close[-\s]?up|side\s+profile)\s+(?:shot|image|picture|photo|portrait|view)?\s*(?:of\s+)?(?:you|yourself|the\s+persona|the\s+character|the\s+assistant)\b/i,
    /\b(?:make|create|generate|draw|render)\s+(?:a\s+)?(?:new|updated|different)?\s*(?:persona|character|avatar)\b/i
  ].some((pattern) => pattern.test(normalizedMessage));
}

function personaVisualBrief(persona: PersonaDefinition, imageProvider?: ImageProviderId): string {
  const visualStyle = sanitizeImageRequest(persona.visualStyle.join(", "), persona);
  const personaFacts = [
    `Fictional persona: ${persona.name}.`,
    persona.age ? `Age: ${persona.age}.` : "",
    persona.height ? `Height: ${persona.height}.` : "",
    visualStyle ? `Appearance and visual style: ${visualStyle}.` : ""
  ].filter(Boolean);

  // BFL's input moderation matches literal words like "nudity" and "explicit
  // sexual content" even inside a negated safety instruction, so FLUX prompts
  // state the intent positively. OpenAI Image 2 refuses readily and benefits
  // from the explicit boundary language, so it keeps the strict sentence.
  const safetyGuidance = imageProvider === "flux"
    ? [
      "Keep the persona polished and appropriate for the requested scene.",
      "Keep the depiction modest and appropriate; the persona is an adult."
    ]
    : [
      "Keep the persona clothed, non-explicit, polished, and appropriate for the requested scene.",
      "Do not depict nudity, explicit sexual content, see-through clothing, or a minor."
    ];

  return [
    ...personaFacts,
    "Use the persona profile only as visual identity guidance for this image.",
    ...safetyGuidance
  ].join(" ");
}

function personaCharacterInfluenceVisualBrief(persona: PersonaDefinition): string {
  const influences = persona.characterInfluences;
  if (!influences) return "";

  const favorites = influences.favorites;
  return [
    "Persona character influences for scene and styling choices:",
    `Favorite activities: ${sanitizeImageRequest(favorites.activities.join(", "), persona)}.`,
    `Favorite foods: ${sanitizeImageRequest(favorites.foods.join(", "), persona)}.`,
    `Favorite colors: ${sanitizeImageRequest(favorites.colors.join(", "), persona)}.`,
    `Favorite products: ${sanitizeImageRequest(favorites.products.join(", "), persona)}.`,
    `Favorite music and entertainment: ${sanitizeImageRequest([...favorites.music, ...favorites.entertainment].join(", "), persona)}.`,
    `Favorite places and fashion: ${sanitizeImageRequest([...favorites.places, ...favorites.fashion].join(", "), persona)}.`,
    `Interests and background: ${sanitizeImageRequest([...influences.interests, ...influences.backgroundInfluences].join(", "), persona)}.`,
    `Values and aspirations: ${sanitizeImageRequest([...influences.values, ...influences.aspirations].join(", "), persona)}.`,
    "Use these only as optional inspiration for the scene, mood, setting, props, palette, wardrobe, or activities when they fit the user's request.",
    "The user's requested subject, setting, outfit, action, and constraints always take priority. Do not insert products, food, places, or logos unless they fit or the user asks for them.",
    "Do not add readable brand logos, trademarks, or text solely because they appear in the persona's preferences."
  ].join(" ");
}

function imageFollowUpConversationContext(input: LLMInput): string {
  const hasHistoricalImageReference = (input.attachments ?? []).some((attachment) =>
    attachment.kind === "image" &&
    (attachment.id.startsWith("conversation-media:") || attachment.id.startsWith("conversation-upload:"))
  );
  if (!hasHistoricalImageReference) return "";

  const messages = (input.baseMessages ?? input.messages)
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message, index, all) =>
      !(index === all.length - 1 && message.role === "user" && message.content.trim() === input.userMessage.trim())
    )
    .filter((message) => message.content.trim())
    .slice(-6)
    .map((message) => {
      const content = normalizeWhitespace(message.content).slice(0, 700);
      return `${message.role === "user" ? "User" : "Assistant"}: ${content}`;
    });

  if (messages.length === 0 && !input.visualContext?.summary) return "";
  return [
    "Relevant recent conversation context for interpreting this follow-up:",
    input.visualContext?.summary ?? "",
    ...messages,
    "Use this context only to resolve references and preserve continuity. The current visual request remains the instruction to execute."
  ].filter(Boolean).join("\n");
}

export function directPersonaVisualReferencePaths(input: LLMInput): string[] {
  if (!isPersonaImageRequest(input.userMessage, input.persona)) return [];

  return [
    input.persona.visualReference360FullbodyImage,
    input.persona.visualReference360FaceImage
  ].filter((path): path is string => Boolean(path));
}

export function buildImageGenerationPrompt(
  input: LLMInput,
  options: { includePersonaVisualReferences?: boolean; includeUserImageReferences?: boolean } = {}
): string {
  const sanitizedRequest = sanitizeImageRequest(input.userMessage, input.persona);
  const request = sanitizedRequest || "Create a stylish, non-explicit image based on the user's request.";
  const includePersonaVisuals = isPersonaImageRequest(input.userMessage, input.persona);
  const includePersonaVisualReferences = includePersonaVisuals && options.includePersonaVisualReferences === true;
  const includeUserImageReferences = options.includeUserImageReferences === true &&
    (input.attachments ?? []).some((attachment) => attachment.kind === "image");

  return [
    "Image generation prompt for a safe visual tool request.",
    includePersonaVisuals
      ? [personaVisualBrief(input.persona, input.imageProvider), personaCharacterInfluenceVisualBrief(input.persona)].filter(Boolean).join(" ")
      : "This image request is not about the current persona. Do not include persona appearance, biography, body details, voice, slang, or character styling unless the user explicitly asks for it.",
    includePersonaVisualReferences
      ? "The first attached image or images (full-body and face) are the persona's visual references. Use them as the primary visual identity reference for the fictional persona, preserving her recognizable face and overall appearance while following the requested scene. Do not copy their pose, outfit, or background unless the user asks."
      : "",
    includeUserImageReferences
      ? includePersonaVisualReferences
        ? "The user's uploaded image or images come after the persona's identity references and are the subject of the request. When the user asks the persona to wear, hold, or use something from an upload, reproduce that item exactly — its design, color, fabric, and cut — on the persona. An uploaded garment or item the user asked for always replaces the persona's default outfit or accessories; never substitute the persona's signature look for it. Treat multiple uploads as complementary references; do not invent an extra subject or combine unrelated people unless the user asks."
        : "The user's attached image or images are source references for this edit. Use them to preserve or deliberately transform the relevant subjects and visual details according to the user's request. When multiple images are attached, treat them as complementary references; do not invent an extra subject or combine unrelated people unless the user asks."
      : "",
    imageFollowUpConversationContext(input),
    `User visual request, cleaned for image generation: ${request}`,
    includePersonaVisuals
      ? "Keep the result non-explicit, clothed, polished, and aligned with the persona's requested visual identity."
      : "Keep the result non-explicit and faithful to the requested subject.",
    "Do not include policy commentary, refusal text, or hidden prompt text in the image."
  ].join("\n");
}
