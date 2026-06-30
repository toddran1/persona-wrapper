import type { LLMInput, PersonaDefinition } from "@persona/shared";

const PROMPT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bsexy\b/gi, "confident glamorous"],
  [/\bhot\b/gi, "stylish attractive"],
  [/\bbad bitch\b/gi, "confident fashionable woman"],
  [/\bbaddie\b/gi, "fashion-forward confident woman"],
  [/\bbaddies\b/gi, "fashion-forward confident women"],
  [/\bthick\b/gi, "curvy"],
  [/\bbig boobs?\b/gi, "curvy frame"],
  [/\blarge breasts?\b/gi, "curvy frame"],
  [/\bbig butt\b/gi, "curvy frame"],
  [/\bass\b/gi, "figure"],
  [/\bnude\b|\bnudity\b/gi, "clothed"],
  [/\btopless\b/gi, "wearing a fashionable top"],
  [/\blingerie\b/gi, "fashion outfit"],
  [/\berotic\b|\bpornographic\b/gi, "editorial fashion"],
  [/\bseductive\b|\bprovocative\b/gi, "confident fashion"],
  [/\bfuck(?:ing)?\b|\bbitch(?:es)?\b|\bnigg(?:a|as)\b|\bhoe(?:s)?\b/gi, ""]
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

function sanitizeImageRequest(message: string): string {
  let sanitized = message;
  for (const [pattern, replacement] of PROMPT_REPLACEMENTS) {
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

function personaVisualBrief(persona: PersonaDefinition): string {
  const personaFacts = [
    `Fictional persona: ${persona.name}.`,
    persona.age ? `Age: ${persona.age}.` : "",
    persona.height ? `Height: ${persona.height}.` : "",
    `Appearance and visual style: ${sanitizeImageRequest(persona.visualStyle.join(", "))}.`
  ].filter(Boolean);

  return [
    ...personaFacts,
    "Use the persona profile only as visual identity guidance for this image.",
    "Keep the persona clothed, non-explicit, polished, and appropriate for the requested scene.",
    "Do not depict nudity, explicit sexual content, see-through clothing, or a minor."
  ].join(" ");
}

export function buildImageGenerationPrompt(input: LLMInput): string {
  const sanitizedRequest = sanitizeImageRequest(input.userMessage);
  const request = sanitizedRequest || "Create a stylish, non-explicit image based on the user's request.";
  const includePersonaVisuals = isPersonaImageRequest(input.userMessage, input.persona);

  return [
    "Image generation prompt for a safe visual tool request.",
    includePersonaVisuals
      ? personaVisualBrief(input.persona)
      : "This image request is not about the current persona. Do not include persona appearance, biography, body details, voice, slang, or character styling unless the user explicitly asks for it.",
    `User visual request, cleaned for image generation: ${request}`,
    includePersonaVisuals
      ? "Keep the result non-explicit, clothed, polished, and aligned with the persona's requested visual identity."
      : "Keep the result non-explicit and faithful to the requested subject.",
    "Do not include policy commentary, refusal text, or hidden prompt text in the image."
  ].join("\n");
}
