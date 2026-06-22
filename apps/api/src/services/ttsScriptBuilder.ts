import type { PersonaDefinition } from "@persona/shared";
import { env } from "../config/env.js";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Michigan",
  MN: "Minnesota",
  MO: "Missouri",
  MS: "Mississippi",
  MT: "Montana",
  NC: "North Carolina",
  ND: "North Dakota",
  NE: "Nebraska",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NV: "Nevada",
  NY: "New York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "West Virginia",
  WY: "Wyoming",
  DC: "D.C."
};

const COMMON_SPEECH_REPLACEMENTS: Array<[RegExp, string]> = [
  [/&/g, " and "],
  [/\bUSA\b/g, "U.S.A."],
  [/\bUS\b/g, "U.S."],
  [/\bU\.S\.\b/g, "U.S."],
  [/\bU\.S\.A\.\b/g, "U.S.A."],
  [/\bAI\b/g, "A.I."],
  [/\bAPI\b/g, "A.P.I."],
  [/\bURL\b/g, "U.R.L."],
  [/\bPDF\b/g, "P.D.F."],
  [/\bCSV\b/g, "C.S.V."],
  [/\bJSON\b/g, "J.S.O.N."],
  [/\bHTML\b/g, "H.T.M.L."],
  [/\bCSS\b/g, "C.S.S."],
  [/\bSQL\b/g, "S.Q.L."],
  [/\bCEO\b/g, "C.E.O."],
  [/\bCFO\b/g, "C.F.O."],
  [/\bCTO\b/g, "C.T.O."],
  [/\bCPI\b/g, "C.P.I."],
  [/\bGDP\b/g, "G.D.P."],
  [/\bIRA\b/g, "I.R.A."],
  [/\bRoth IRA\b/g, "Roth I.R.A."],
  [/\bNBA\b/g, "N.B.A."],
  [/\bNFL\b/g, "N.F.L."],
  [/\bMLB\b/g, "M.L.B."],
  [/\bNHL\b/g, "N.H.L."],
  [/\bJFK\b/g, "J.F.K."],
  [/\bAT&T\b/g, "A.T. and T."],
  [/\bvs\.\b/gi, "versus"],
  [/\bw\/\b/gi, "with"],
  [/\bw\/o\b/gi, "without"],
  [/\betc\.\b/gi, "etcetera"],
  [/\bTX\b/g, "Texas"],
  [/\bFL\b/g, "Florida"]
];

const UNIT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(\d+(?:\.\d+)?)\s?lbs?\b/gi, "$1 pounds"],
  [/\b(\d+(?:\.\d+)?)\s?oz\b/gi, "$1 ounces"],
  [/\b(\d+(?:\.\d+)?)\s?ft\b/gi, "$1 feet"],
  [/\b(\d+(?:\.\d+)?)\s?in\b/gi, "$1 inches"],
  [/\b(\d+(?:\.\d+)?)\s?mi\b/gi, "$1 miles"],
  [/\b(\d+(?:\.\d+)?)\s?mph\b/gi, "$1 miles per hour"],
  [/\b(\d+(?:\.\d+)?)\s?GB\b/g, "$1 gigabytes"],
  [/\b(\d+(?:\.\d+)?)\s?MB\b/g, "$1 megabytes"],
  [/\b(\d+(?:\.\d+)?)\s?KB\b/g, "$1 kilobytes"],
  [/\b(\d+(?:\.\d+)?)\s?TB\b/g, "$1 terabytes"]
];

function elevenLabsModelId(persona: PersonaDefinition): string {
  return persona.voiceProfile.elevenLabs?.modelId ?? env.ELEVENLABS_MODEL_ID;
}

function supportsInlineEmotionTags(modelId: string): boolean {
  return modelId === "eleven_v3";
}

function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/sandbox:\/\S+/g, " ")
    .replace(/\[([^\]]+)]\((?:https?:\/\/|sandbox:\/)[^)]+\)/g, "$1")
    .replace(/\|/g, ". ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeMoney(text: string): string {
  return text
    .replace(/\$(\d+(?:,\d{3})*(?:\.\d+)?)([KMBT])\b/gi, (_match, amount: string, suffix: string) => {
      const suffixWord = suffix.toUpperCase() === "K" ? "thousand" :
        suffix.toUpperCase() === "M" ? "million" :
        suffix.toUpperCase() === "B" ? "billion" : "trillion";
      return `${amount} ${suffixWord} dollars`;
    })
    .replace(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/g, "$1 dollars");
}

function normalizePercentages(text: string): string {
  return text.replace(/(\d+(?:\.\d+)?)%/g, "$1 percent");
}

function normalizeTimes(text: string): string {
  return text
    .replace(/\b(\d{1,2}):(\d{2})\s?(AM|PM)\b/gi, (_match, hour: string, minute: string, period: string) => {
      const minuteText = minute === "00" ? "o'clock" : minute;
      return `${hour} ${minuteText} ${period.toUpperCase().split("").join(".")}.`;
    })
    .replace(/\b(\d{1,2})\s?(AM|PM)\b/gi, (_match, hour: string, period: string) => `${hour} ${period.toUpperCase().split("").join(".")}.`);
}

function normalizeOrdinals(text: string): string {
  return text
    .replace(/\b1st\b/gi, "first")
    .replace(/\b2nd\b/gi, "second")
    .replace(/\b3rd\b/gi, "third")
    .replace(/\b(\d+)th\b/gi, "$1th");
}

function expandStateAbbreviations(text: string): string {
  return text.replace(/\b([A-Z]{2})\b/g, (match) => STATE_NAMES[match] ?? match);
}

function applyCommonSpeechReplacements(text: string): string {
  const withCommonWords = COMMON_SPEECH_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
  return UNIT_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), withCommonWords);
}

function normalizeSymbols(text: string): string {
  return text
    .replace(/→|⇒/g, " leads to ")
    .replace(/←|⇐/g, " comes from ")
    .replace(/≥/g, " at least ")
    .replace(/≤/g, " at most ")
    .replace(/≈/g, " about ")
    .replace(/\+/g, " plus ")
    .replace(/=/g, " equals ");
}

function addPacing(text: string): string {
  return text
    .replace(/:\s*\n/g, ": ... \n")
    .replace(/;\s*/g, "; ... ")
    .replace(/([.!?])\s+(?=[A-Z0-9"“])/g, "$1 ... ")
    .replace(/\n\n/g, " ... \n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function addPersonaPerformanceCues(text: string, persona: PersonaDefinition): string {
  if (persona.id !== "larae") return text;

  const modelId = elevenLabsModelId(persona);
  if (supportsInlineEmotionTags(modelId)) {
    return `[sassy, excited]\n${text.replace(/\b(bitch|hoe|clock it|be serious)\b/gi, "$& [laughs]")}`;
  }

  return text
    .replace(/\b(Bitch,? be serious\.?)/gi, "$1 ...")
    .replace(/\b(Clock it\.?)/gi, "$1 ...")
    .replace(/\b(baby girl|baby)\b/gi, "$1,");
}

export function buildTtsScript(text: string, persona: PersonaDefinition): string {
  const cleanText = stripMarkdownForSpeech(text);
  const normalizedText = normalizeSymbols(normalizeOrdinals(normalizeTimes(normalizePercentages(normalizeMoney(cleanText)))));
  const expandedText = applyCommonSpeechReplacements(expandStateAbbreviations(normalizedText));
  return addPersonaPerformanceCues(addPacing(expandedText), persona);
}

export async function buildTtsScriptForSpeech(text: string, persona: PersonaDefinition): Promise<{ script: string; mode: "mechanical" }> {
  return { script: buildTtsScript(text, persona), mode: "mechanical" };
}
