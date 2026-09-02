import { MAX_CHAT_ATTACHMENTS } from "@persona/shared";

const CORE_IMAGE_NOUN = String.raw`(?:images?|photos?|pictures?|pics?|visuals?)`;
const IMAGE_NOUN = String.raw`(?:${CORE_IMAGE_NOUN}|(?:reference|source|input)\s+${CORE_IMAGE_NOUN}|image\s+(?:references?|attachments?|uploads?))`;
const IMAGE_COUNT_MODIFIER = String.raw`(?:(?:attached|uploaded|reference|source|input)\s+)?`;
const UPLOAD_INTENT = String.raw`(?:(?:i|we)\s*(?:am|are|'m|'re|will)|i(?:['’]ll)|we(?:['’]ll)|im|(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+going\s+to|were)\s+(?:uploading|attaching|sending|upload|attach|send)`;
const COMPLETED_UPLOAD_INTENT = String.raw`(?:i|we)\s+(?:(?:have|just)\s+)?(?:uploaded|attached|sent)`;
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
};
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).join("|");
const OPTIONAL_IMAGE_COUNT = String.raw`(?:(?:\d+|${NUMBER_WORD_PATTERN})\s+)?`;
const EXCLUDED_HISTORICAL_REFERENCE_PATTERNS = [
  /\b(?:do\s+not|don['’]?t|never|ignore|skip|exclude|leave\s+out)\s+(?:use|reuse|include|reference|attach|consider|look\s+at)?\s*(?:the\s+)?(?:previous|prior|earlier|last|latest|recent|generated|original)\s+(?:images?|pictures?|photos?|pics?|results?|outputs?|renders?|ones?|uploads?|references?)\b/gi,
  /\bnot\s+(?:the\s+)?(?:previous|prior|earlier|last|latest|recent|generated|original)\s+(?:images?|pictures?|photos?|pics?|results?|outputs?|renders?|ones?|uploads?|references?)\b/gi
];

export type ImageReferenceRequirement = {
  required: boolean;
  minimumImages: number;
  expectsNewUploads: boolean;
};

function requestedImageCount(message: string): number | undefined {
  if (new RegExp(String.raw`\bboth\s+${IMAGE_NOUN}\b`, "i").test(message)) return 2;

  const explicitCount = new RegExp(
    String.raw`\b(?:all\s+)?(?:these|those|the|my|our|your|attached|uploaded)?\s*(\d+|${NUMBER_WORD_PATTERN})\s+${IMAGE_COUNT_MODIFIER}${IMAGE_NOUN}\b`,
    "i"
  ).exec(message)?.[1]?.toLowerCase();
  if (!explicitCount) return undefined;

  const numericCount = Number(explicitCount);
  if (Number.isSafeInteger(numericCount) && numericCount > 0) return numericCount;
  return NUMBER_WORDS[explicitCount];
}

export function analyzeImageReferenceRequirement(message: string): ImageReferenceRequirement {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return { required: false, minimumImages: 0, expectsNewUploads: false };
  const referenceMessage = EXCLUDED_HISTORICAL_REFERENCE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, " "),
    normalized
  ).replace(/\s+/g, " ").trim();

  const expectsNewUploads = [
    new RegExp(String.raw`\b${UPLOAD_INTENT}\b[\s\S]{0,80}\b${IMAGE_NOUN}\b`, "i"),
    new RegExp(String.raw`\b${IMAGE_NOUN}\b[\s\S]{0,80}\b${UPLOAD_INTENT}\b`, "i"),
    new RegExp(String.raw`\b${COMPLETED_UPLOAD_INTENT}\s+${OPTIONAL_IMAGE_COUNT}${IMAGE_NOUN}\b`, "i"),
    new RegExp(String.raw`\b(?:attached|uploaded)\s+${OPTIONAL_IMAGE_COUNT}${IMAGE_NOUN}\b`, "i")
  ].some((pattern) => pattern.test(normalized));

  const referencesRequired = [
    new RegExp(
      String.raw`\b(?:mix|combine|blend|merge|fuse|mash\s*up|composite|stitch|arrange|compare|rank|review)\b[\s\S]{0,100}\b(?:this|these|those|both|attached|uploaded|uploading|reference|source|input|my|our|the)\b[\s\S]{0,50}\b${IMAGE_NOUN}\b`,
      "i"
    ),
    new RegExp(
      String.raw`\b(?:edit|change|modify|retouch|enhance|crop|resize|remove|replace|swap|recolor|restyle|transform|use|reuse|match|reference|base)\b[\s\S]{0,100}\b(?:this|these|those|both|attached|uploaded|uploading|previous|prior|last|original|reference|source|input|my|our)\b[\s\S]{0,50}\b${IMAGE_NOUN}\b`,
      "i"
    ),
    new RegExp(
      String.raw`\b(?:this|these|those|both|attached|uploaded|uploading|previous|prior|last|original|reference|source|input|my|our)\b[\s\S]{0,50}\b${IMAGE_NOUN}\b[\s\S]{0,100}\b(?:mix|combine|blend|merge|edit|change|modify|retouch|enhance|use|match|transform|turn|make|create|compare|rank|review|choose|pick|select|arrange|stitch)\b`,
      "i"
    ),
    new RegExp(
      String.raw`\b(?:use|with|from|based\s+on|using)\b[\s\S]{0,50}\b(?:the\s+)?(?:attached|uploaded|previous|prior|last|original|reference|source|input)\s+${IMAGE_NOUN}\b`,
      "i"
    ),
    new RegExp(String.raw`\b(?:mix|combine|blend|merge|fuse|composite|stitch|compare|rank|review)\b[\s\S]{0,80}\b${IMAGE_NOUN}\b`, "i"),
    new RegExp(String.raw`\b(?:collage|montage|comparison|side[-\s]?by[-\s]?side)\b[\s\S]{0,80}\b(?:this|these|those|both|attached|uploaded|my|our|the)?\s*${IMAGE_NOUN}\b`, "i"),
    new RegExp(String.raw`\b(?:put|place|show|arrange)\b[\s\S]{0,80}\b(?:this|these|those|both|attached|uploaded|my|our|the)\s+(?:(?:\d+|${NUMBER_WORD_PATTERN})\s+)?${IMAGE_NOUN}\b[\s\S]{0,80}\bside[-\s]?by[-\s]?side\b`, "i"),
    new RegExp(String.raw`\b${UPLOAD_INTENT}\b[\s\S]{0,80}\b${IMAGE_NOUN}\b`, "i"),
    new RegExp(String.raw`\b${IMAGE_NOUN}\b[\s\S]{0,80}\b${UPLOAD_INTENT}\b`, "i"),
    new RegExp(String.raw`\b${COMPLETED_UPLOAD_INTENT}\s+${OPTIONAL_IMAGE_COUNT}${IMAGE_NOUN}\b`, "i")
  ].some((pattern) => pattern.test(referenceMessage));

  if (!referencesRequired) {
    return { required: false, minimumImages: 0, expectsNewUploads: false };
  }

  const explicitCount = requestedImageCount(referenceMessage);
  const pluralCombination = new RegExp(
    String.raw`\b(?:mix|combine|blend|merge|fuse|mash\s*up|composite|stitch|compare|rank|review|collage|montage|arrange)\b[\s\S]{0,100}\b${IMAGE_NOUN}\b`,
    "i"
  ).test(referenceMessage);

  return {
    required: true,
    minimumImages: explicitCount ?? (pluralCombination ? 2 : 1),
    expectsNewUploads
  };
}

export function missingImageReferenceMessage(requiredImages: number, availableImages: number): string {
  if (requiredImages > MAX_CHAT_ATTACHMENTS) {
    return `This request needs ${requiredImages} images, but you can attach up to ${MAX_CHAT_ATTACHMENTS} files to one message. Please split the request into smaller groups.`;
  }
  const missingImages = Math.max(requiredImages - availableImages, 1);
  if (availableImages > 0) {
    return `I have ${availableImages === 1 ? "one image" : `${availableImages} images`}, but this request needs ${requiredImages}. Please attach ${missingImages === 1 ? "one more image" : `${missingImages} more images`}, then send the request again.`;
  }
  if (requiredImages === 1) {
    return "Please attach the image you want me to use, then send the request again.";
  }
  return `Please attach the ${requiredImages} images you want me to use, then send the request again.`;
}
