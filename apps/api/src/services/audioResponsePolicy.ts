import { env } from "../config/env.js";

const ESTIMATED_SPEECH_CHARACTERS_PER_SECOND = 15;
const RESERVATION_SAFETY_MULTIPLIER = 1.15;

function closeUnbalancedCodeFence(text: string, maxCharacters: number): string {
  const fenceCount = text.match(/```/g)?.length ?? 0;
  if (fenceCount % 2 === 0) return text;
  const suffix = "\n```";
  return `${text.slice(0, Math.max(0, maxCharacters - suffix.length)).trimEnd()}${suffix}`;
}

export function limitAudioResponseText(text: string, concise = true): string {
  const normalized = text.trim();
  if (!concise) return normalized;
  const maxCharacters = env.CHAT_AUDIO_MAX_RESPONSE_CHARACTERS;
  if (normalized.length <= maxCharacters) return normalized;

  const availableCharacters = Math.max(1, maxCharacters - 1);
  const truncated = normalized.slice(0, availableCharacters);
  const sentenceBoundary = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("! "),
    truncated.lastIndexOf("? "),
    truncated.lastIndexOf("\n\n")
  );
  const paragraphBoundary = truncated.lastIndexOf("\n");
  const wordBoundary = truncated.lastIndexOf(" ");
  const boundary = sentenceBoundary >= Math.floor(maxCharacters * 0.55)
    ? sentenceBoundary + 1
    : paragraphBoundary >= Math.floor(maxCharacters * 0.65)
      ? paragraphBoundary
      : wordBoundary >= Math.floor(maxCharacters * 0.8)
        ? wordBoundary
        : availableCharacters;
  const limited = `${truncated.slice(0, boundary).trimEnd()}…`;
  return closeUnbalancedCodeFence(limited, maxCharacters).slice(0, maxCharacters);
}

export function estimatedAudioSecondsForCharacters(characters: number): number {
  if (!Number.isFinite(characters) || characters <= 0) return 0;
  return Math.max(1, Math.ceil(characters / ESTIMATED_SPEECH_CHARACTERS_PER_SECOND));
}

export function audioUsageReservationSeconds(concise = true, codeInterpreter = false): number {
  const characters = audioUsageReservationCharacters(concise, codeInterpreter);
  return Math.ceil(
    estimatedAudioSecondsForCharacters(characters)
      * RESERVATION_SAFETY_MULTIPLIER
  );
}

export function audioUsageReservationCharacters(concise = true, codeInterpreter = false): number {
  if (codeInterpreter) {
    return Math.max(env.OPENAI_MAX_OUTPUT_TOKENS, env.OPENAI_CODE_INTERPRETER_MAX_OUTPUT_TOKENS) * 4;
  }
  return concise
    ? env.CHAT_AUDIO_MAX_RESPONSE_CHARACTERS
    : env.OPENAI_MAX_OUTPUT_TOKENS * 4;
}

export function maxOutputTokensForRequest(audioEnabled: boolean, conciseAudioResponse = true, codeInterpreter = false): number {
  // Code Interpreter runs (analysis, generated files) produce long structured
  // output and can burn most of the budget on reasoning first, so they get a
  // larger ceiling than plain chat.
  const base = codeInterpreter
    ? Math.max(env.OPENAI_MAX_OUTPUT_TOKENS, env.OPENAI_CODE_INTERPRETER_MAX_OUTPUT_TOKENS)
    : env.OPENAI_MAX_OUTPUT_TOKENS;
  // Code interpreter turns do file work rather than short spoken replies, and
  // they never use the inline TTS script format — the concise-audio cap must
  // not strangle them.
  if (codeInterpreter) return base;
  // `max_output_tokens` includes hidden reasoning tokens. Using a small token
  // ceiling to enforce concise speech can exhaust the response before the
  // model finishes its visible answer, especially on web-search turns. The
  // prompt character requirement and limitAudioResponseText enforce spoken
  // length without starving the model's reasoning budget.
  void audioEnabled;
  void conciseAudioResponse;
  return base;
}
