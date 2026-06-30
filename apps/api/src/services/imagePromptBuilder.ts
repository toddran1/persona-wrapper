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

function personaVisualBrief(persona: PersonaDefinition): string {
  if (persona.id !== "larae") {
    return [
      `Fictional persona: ${persona.name}.`,
      `Visual style: ${persona.visualStyle.join(", ")}.`
    ].join(" ");
  }

  return [
    "Fictional adult persona: LaRae the Baddest, a 25-year-old African American woman from Miami, Florida.",
    "Appearance direction: beautiful, fit, curvy, confident, camera-ready, glamorous, and stylish.",
    "Fashion direction: clothed Miami nightlife fashion, luxury street glam, designer accessories, polished makeup, bold neon and metallic accents.",
    "Do not depict nudity, explicit sexual content, see-through clothing, or a minor."
  ].join(" ");
}

export function buildImageGenerationPrompt(input: LLMInput): string {
  const sanitizedRequest = sanitizeImageRequest(input.userMessage);
  const request = sanitizedRequest || "Create a stylish, non-explicit image based on the user's request.";

  return [
    "Image generation prompt for a safe visual tool request.",
    personaVisualBrief(input.persona),
    `User visual request, cleaned for image generation: ${request}`,
    "Keep the result non-explicit, adult, clothed, polished, and fashion/editorial styled.",
    "Do not include policy commentary, refusal text, or hidden prompt text in the image."
  ].join("\n");
}

