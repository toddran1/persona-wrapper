import type { ContentBlock } from "@persona/shared";

export type ProfessionalLanguageResult = {
  text: string;
  replacements: number;
};

export type ProfessionalContentBlockResult = {
  block: ContentBlock;
  replacements: number;
};

const PROFESSIONAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bmotherf[\W_]*u[\W_]*c[\W_]*k(?:(?:[\W_]*e[\W_]*r[\W_]*s?)|(?:[\W_]*i[\W_]*n[\W_]*g))?\b/giu, "troublemaker"],
  [/\bf[\W_]*u[\W_]*c[\W_]*k(?:(?:[\W_]*e[\W_]*d)|(?:[\W_]*e[\W_]*r[\W_]*s?)|(?:[\W_]*i[\W_]*n[\W_]*g)|s|face|head)?\b/giu, "seriously"],
  [/\bshit(?:ty|ting|ted|s|head|show|storm)?\b/giu, "mess"],
  [/\bbitches\b/giu, "friends"],
  [/\bbitch(?:y|ing)?\b/giu, "friend"],
  [/\bn[\W_]*i[\W_]*g[\W_]*g(?:as|ers)\b/giu, "friends"],
  [/\bn[\W_]*i[\W_]*g[\W_]*g(?:a|er)\b/giu, "friend"],
  [/\bhoes\b/giu, "people"],
  [/\b(?:hoe|ho)\b/giu, "person"],
  [/\bassholes?\b/giu, "jerk"],
  [/\bdumb[\W_]*ass(?:es)?\b/giu, "fool"],
  [/\bkicked\s+ass\b/giu, "excelled"],
  [/\bkicking\s+ass\b/giu, "excelling"],
  [/\bkick\s+ass\b/giu, "excel"],
  [/\bpain in the ass\b/giu, "nuisance"],
  [/\bbastards?\b/giu, "jerk"],
  [/\bbullshit\b/giu, "nonsense"],
  [/\bdamn(?:ed|ing)?\b/giu, "serious"],
  [/\bhell\b/giu, "heck"],
  [/\bcunts?\b/giu, "person"],
  [/\bpuss(?:y|ies)\b/giu, "coward"],
  [/\bdickheads?\b/giu, "jerk"],
  [/\bcockheads?\b/giu, "jerk"]
];

// These spans carry exact user/source/technical content. Rewriting them can
// break code and links or falsify a quotation, so only persona-authored prose
// outside the spans is normalized.
const PROTECTED_SPAN_PATTERN = /```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s)>]+|^\s*>[^\n]*(?:\n|$)|“[^”\n]*”|"[^"\n]*"/gmu;

function preserveLeadingCase(replacement: string, matched: string): string {
  const firstLetter = matched.search(/\p{L}/u);
  if (firstLetter < 0) return replacement;
  const letter = matched[firstLetter] ?? "";
  if (letter === letter.toLocaleUpperCase("en-US")) {
    return `${replacement[0]?.toLocaleUpperCase("en-US") ?? ""}${replacement.slice(1)}`;
  }
  return replacement;
}

function sanitizeUnprotectedText(text: string): ProfessionalLanguageResult {
  let replacements = 0;
  const sanitized = PROFESSIONAL_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, (matched) => {
      replacements += 1;
      return preserveLeadingCase(replacement, matched);
    }),
    text
  );
  return { text: sanitized, replacements };
}

export function sanitizeProfessionalLanguage(text: string): ProfessionalLanguageResult {
  let cursor = 0;
  let replacements = 0;
  let sanitized = "";
  for (const match of text.matchAll(PROTECTED_SPAN_PATTERN)) {
    const index = match.index;
    if (index === undefined) continue;
    const before = sanitizeUnprotectedText(text.slice(cursor, index));
    sanitized += before.text;
    sanitized += match[0];
    replacements += before.replacements;
    cursor = index + match[0].length;
  }
  const remainder = sanitizeUnprotectedText(text.slice(cursor));
  return {
    text: sanitized + remainder.text,
    replacements: replacements + remainder.replacements
  };
}

export function sanitizeProfessionalSpeech(text: string): ProfessionalLanguageResult {
  return sanitizeUnprotectedText(text);
}

function sanitizeOptional(value: string | undefined): ProfessionalLanguageResult | undefined {
  return value === undefined ? undefined : sanitizeProfessionalLanguage(value);
}

export function sanitizeProfessionalContentBlock(block: ContentBlock): ProfessionalContentBlockResult {
  if (block.type === "text") {
    const result = sanitizeProfessionalLanguage(block.text);
    return { block: { ...block, text: result.text }, replacements: result.replacements };
  }
  if (block.type === "audio") {
    const transcript = sanitizeOptional(block.transcript);
    return transcript
      ? { block: { ...block, transcript: transcript.text }, replacements: transcript.replacements }
      : { block, replacements: 0 };
  }
  if (block.type === "image") {
    const alt = sanitizeProfessionalLanguage(block.alt);
    const prompt = sanitizeOptional(block.prompt);
    return {
      block: { ...block, alt: alt.text, ...(prompt ? { prompt: prompt.text } : {}) },
      replacements: alt.replacements + (prompt?.replacements ?? 0)
    };
  }
  if (block.type === "video") {
    const title = sanitizeOptional(block.title);
    return title
      ? { block: { ...block, title: title.text }, replacements: title.replacements }
      : { block, replacements: 0 };
  }
  if (block.type === "chart") {
    const title = sanitizeProfessionalLanguage(block.title);
    const summary = sanitizeOptional(block.summary);
    return {
      block: { ...block, title: title.text, ...(summary ? { summary: summary.text } : {}) },
      replacements: title.replacements + (summary?.replacements ?? 0)
    };
  }
  if (block.type === "file") {
    const description = sanitizeOptional(block.description);
    return description
      ? { block: { ...block, description: description.text }, replacements: description.replacements }
      : { block, replacements: 0 };
  }
  if (block.type === "table" || block.type === "code") {
    const title = sanitizeOptional(block.title);
    return title
      ? { block: { ...block, title: title.text }, replacements: title.replacements }
      : { block, replacements: 0 };
  }
  if (block.type === "status") {
    const message = sanitizeProfessionalLanguage(block.message);
    return { block: { ...block, message: message.text }, replacements: message.replacements };
  }
  if (block.type === "action") {
    const label = sanitizeProfessionalLanguage(block.label);
    return { block: { ...block, label: label.text }, replacements: label.replacements };
  }
  // JSON, table cells, code bodies, tool data, and source metadata may be
  // machine-readable or verbatim third-party content and must remain exact.
  return { block, replacements: 0 };
}
