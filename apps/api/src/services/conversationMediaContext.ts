import type { ContentBlock, ConversationUserAsset, UploadedAsset } from "@persona/shared";
import { logger } from "../utils/logger.js";
import { generatedMediaService } from "./generatedMediaService.js";
import { analyzeImageReferenceRequirement } from "./imageReferenceRequirement.js";
import { uploadService, type ResolvedUploadAsset } from "./uploadService.js";

export type ConversationWithOutputs = {
  id?: string;
  turns?: Array<{
    userMessage?: string;
    userAssets?: ConversationUserAsset[];
    assistantText?: string;
    outputs: ContentBlock[];
    visualClarification?: {
      status: "ambiguous";
      originalRequest: string;
      selectedPositions: number[];
    } | undefined;
  }>;
};

type ConversationMediaContextOptions = {
  message: string;
  ownerId?: string;
  maxImages?: number;
  currentImageCount?: number;
  minimumImages?: number;
  expectsNewUploads?: boolean;
};

export type ConversationMediaAttachment = UploadedAsset & {
  localPath?: string;
  storageKey?: string;
};

export type ConversationMediaContextResult = {
  referenced: boolean;
  candidateCount: number;
  attachments: ConversationMediaAttachment[];
  unavailableCount: number;
  minimumImages: number;
  source: "none" | "user_uploads" | "generated_outputs";
  intent: "inspect" | "transform";
  ambiguityMessage?: string;
  promptContext?: string;
  selectedTurnIndexes: number[];
  selectedPositions: number[];
};

export const CONVERSATION_MEDIA_UNAVAILABLE_TEXT =
  "I still have the chat text, but that image file is no longer available. Please re-upload it or regenerate it.";

const MEDIA_REFERENCE_PATTERNS = [
  // Direct references to recent visual/media output.
  /\b(this|that|these|those|the|last|latest|previous|prior|same|recent|new|current|above|below|attached|shown|displayed|generated|created|sent)\s+(image|images|picture|pictures|photo|photos|pic|pics|media|asset|assets|attachment|attachments|file|files|visual|visuals|render|renders|output|outputs|result|results|one|ones)\b/i,
  /\b(image|images|picture|pictures|photo|photos|pic|pics|media|asset|assets|attachment|attachments|file|files|visual|visuals|render|renders|output|outputs|result|results)\s+(you|u|we|it)\s+(just\s+|recently\s+|previously\s+)?(sent|made|generated|created|gave|showed|displayed|rendered|produced|uploaded|attached|returned|provided|shared)\b/i,
  /\b(the|that|this|same|last|previous|prior|recent)\s+(one|ones|thing|version|result|output|render|file|upload|attachment)\b/i,
  /\b(what|who|where|when|why|how|which)\b.*\b(image|images|picture|pictures|photo|photos|pic|pics|media|asset|assets|attachment|attachments|visual|visuals|render|renders|output|outputs|result|results|it|that|this|these|those|one|ones)\b/i,

  // Natural inspection questions that often omit the word "image".
  /\b(what|which)\s+(breed|kind|type|color|colour|style|outfit|clothes|clothing|shirt|dress|hair|pose|position|angle|view|background|setting|scene|room|place|location|object|thing|animal|dog|puppy|cat|person|character|brand|logo|text|word|words|lettering|language|expression|emotion|mood)\b/i,
  /\b(can|could|would)\s+you\s+(see|tell|figure\s+out|identify|recognize|recognise|guess|check|look)\b.*\b(it|that|this|one|image|picture|photo|pic|asset|attachment|file|visual)\b/i,
  /\b(does|do|is|are|was|were)\b.*\b(in|on|inside|shown|visible|pictured|displayed)\b.*\b(it|that|this|one|image|picture|photo|pic|visual|scene)\b/i,
  /\b(is|are|does|do)\s+(it|that|this|one|they|those|these)\s+(look|seem|appear|show|have|include|contain)\b/i,
  /\b(what\s+does|how\s+does)\s+(she|he|it|the\s+(?:person|character|subject))\s+look\s+like\b/i,
  /\b(does|do|is|are)\s+(she|he|they|the\s+(?:person|character|subject|people|characters?))\s+(have|wearing|holding|standing|sitting|look|appear)\b/i,
  /\b(who|what)\s+is\s+(standing|sitting|shown|pictured|next\s+to|behind|beside|in\s+front\s+of)\b/i,
  /\b(can|could)\s+you\s+(read|make\s+out|transcribe)\s+(the|that|this)\s+(sign|text|label|writing|words?|lettering)\b/i,

  // Explicit visual analysis language.
  /\b(describe|caption|inspect|analyze|analyse|identify|recognize|recognise|classify|interpret|review|critique|judge|rate|compare|zoom|crop|enhance|upscale|clean\s+up|look\s+at|take\s+a\s+look\s+at|tell\s+me\s+about|walk\s+me\s+through|break\s+down|explain)\b.*\b(image|images|picture|pictures|photo|photos|pic|pics|media|asset|assets|attachment|attachments|file|files|visual|visuals|render|renders|output|outputs|result|results|it|that|this|these|those|one|ones)\b/i,
  /\b(what\s+am\s+i\s+looking\s+at|what\s+are\s+we\s+looking\s+at|what\s+is\s+going\s+on\s+here|what\s+do\s+you\s+see|tell\s+me\s+what\s+you\s+see|describe\s+what\s+you\s+see|caption\s+this|caption\s+it)\b/i,

  // Edit requests against the prior asset.
  /\b(edit|change|modify|update|revise|redo|remake|regenerate|rerender|re-render|recreate|rework|fix|adjust|tweak|improve|enhance|clean\s+up|touch\s+up|retouch|restore|sharpen|upscale|crop|resize|reframe|rotate|flip|mirror|extend|expand|outpaint|inpaint|remove|erase|delete|replace|swap|add|insert|include|put|make|turn|convert|transform|stylize|style|restyle|colorize|recolor|lighten|darken|brighten|blur|unblur|smooth)\b.*\b(it|that|this|these|those|image|images|picture|pictures|photo|photos|pic|pics|asset|assets|attachment|attachments|file|files|visual|visuals|render|renders|output|outputs|result|results|one|ones)\b/i,
  /\b(make|turn|change|convert|transform)\s+(it|that|this|one)\s+(into|to|more|less|look|feel|like)\b/i,
  /\b(add|remove|replace|swap|change|fix)\s+(the|her|his|their|its|that|this)\s+(background|outfit|clothes|clothing|shirt|dress|hair|face|eyes|mouth|pose|lighting|color|colour|style|text|logo|object|person|animal)\b/i,

  // Follow-up pronouns commonly used after an image response.
  /\b(use|reuse|keep|base|reference|match|copy|continue\s+with|go\s+with|work\s+from|start\s+from)\b.*\b(it|them|that|this|these|those|one|ones|image|picture|photo|pic|reference|asset|attachment|file|visual|render)\b/i,
  /\b(again|same\s+again|one\s+more|another\s+version|new\s+version|different\s+version|version\s+of\s+that|do\s+it\s+again|try\s+again|run\s+it\s+back|remake\s+that|redo\s+that)\b/i,
  /\b(keep|preserve|maintain|do\s+not\s+change|don'?t\s+change|leave)\b.*\b(same|skin\s*tone|face|person|character|pose|background|style|color|colour|outfit|lighting|composition|angle|camera|image|picture|photo)\b/i,

  // Deictic and UI-location references.
  /\b(the\s+one\s+(above|below|before|after|on\s+top|at\s+the\s+bottom|you\s+showed|you\s+made|you\s+generated|you\s+sent))\b/i,
  /\b(top|bottom|first|second|third|fourth|left|right|middle|center|centre)\s+(image|picture|photo|pic|one|result|render|version|attachment|asset)\b/i,
  /\b(the\s+(first|second|third|fourth|left|right|top|bottom|middle|center|centre)\s+(one|image|picture|photo|pic|result|render|version))\b/i,

  // Short natural follow-ups that usually mean "use the prior output" in image threads.
  /\b(now|next)\s+(make|change|add|remove|replace|turn|convert|show|give|do)\b.*\b(it|that|this|one|same|again|version)\b/i,
  /\b(can\s+you|could\s+you|please|now)\s+(make|change|add|remove|replace|turn|convert|show|give|do)\b.*\b(more|less|same|again|another|different|instead|with|without)\b/i,
  /\b(what\s+about|how\s+about)\s+(making|changing|adding|removing|replacing|turning|doing)\s+(it|that|this|one)\b/i,

  // Prior upload/reference wording.
  /\b(upload|uploaded|attached|reference|source|original|input|file)\b.*\b(image|picture|photo|pic|asset|attachment|file|visual|it|that|this|one)\b/i,
  /\b(use|look\s+at|compare\s+to|match)\b.*\b(reference|original|upload|uploaded|attachment|attached\s+file|source\s+image|input\s+image)\b/i,

  // Follow-ups that refer to visual subjects rather than saying "image".
  /\b(mix|combine|blend|merge|fuse|morph|composite|remix|cross|hybridize|compare)\b.*\b(them|both|their|the\s+two|all\s+of\s+them|these|those|faces?|features?|looks?|appearances?|designs?|characters?|subjects?|people|outfits?)\b/i,
  /\b(their|both|the\s+two|these|those)\s+(faces?|features?|looks?|appearances?|designs?|characters?|subjects?|outfits?)\b/i,
  /\b(now|next|then)\b.*\b(merge|combine|blend|mix|morph|edit|change|modify|transform|restyle|remake|redo)\b/i,

  // Natural subject and attribute follow-ups after a visual turn.
  /\b(make|put|place|move|dress|show|turn|transform|style|restyle|change|give)\s+(her|him|them|it|the\s+(?:person|character|subject|woman|man|girl|boy|people|characters?))\b/i,
  /\b(make|change|turn|set)\s+the\s+(background|outfit|clothes|clothing|shirt|dress|hair|face|eyes|mouth|pose|lighting|color|colour|style|expression|camera|angle|setting|scene)\b/i,
  /\b(with|without)\s+(a|an|the|her|his|their)?\s*(red|blue|green|black|white|new|different|same|brighter|darker|realistic|cartoon|anime|smiling|serious)?\s*(background|outfit|clothes|clothing|shirt|dress|hair|eyes|pose|lighting|expression|hat|jacket|shoes?)\b/i,
  /^(more|less)\s+(realistic|cartoonish|stylized|detailed|dramatic|colorful|colourful|bright|dark|cinematic|natural|professional|polished)\b/i,
  /\b(same|keep\s+the)\s+(pose|person|character|face|subject|background|outfit|style|lighting|composition|camera|angle)\b.*\b(different|new|but|with|without|change)\b/i,
  /\b(go\s+back\s+to|return\s+to|use|reuse)\s+(the\s+)?(originals?|uploads?|sources?|first\s+attempt|earlier\s+version)\b/i,
  /\b(this|that)\s+(new|current)\s+(image|picture|photo|upload|reference)\b.*\b(original|previous|prior|earlier|last)\b/i,
  /\b(original|previous|prior|earlier|last)\s+(image|picture|photo|upload|reference)\b.*\b(this|that)\s+(new|current)\b/i,
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+(and\s+(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+)?(one|ones|image|images|picture|pictures|photo|photos|result|results|version|versions|upload|uploads|reference|references)\b/i,
  /\b(images?|pictures?|photos?|pics?|results?|renders?|outputs?|uploads?|references?)\s+(?:number\s+|#\s*)?(?:\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s*(?:,|and)\s*(?:the\s+)?(?:\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth))*\b/i,
  /\b(?:put|place|show|arrange)\b.*\b(?:images?|pictures?|photos?|pics?|them|these|those)\b.*\bside[-\s]?by[-\s]?side\b/i,
  /\b(?:make|try|render|show)\s+(?:it|them|that|this)\s+(?:in|as|with)\s+(?:a\s+)?(?:watercolor|oil\s+painting|sketch|anime|cartoon|photorealistic|realistic|cinematic|comic|illustration|different|new)\b/i,
  /\b(?:do|apply)\s+the\s+same\b.*\b(?:other|next|previous)\s+one\b/i,
  // Concise visual continuations that rely on the immediately preceding visual set.
  /^(?:zoom\s+(?:in|out)|crop\s+(?:it\s+)?(?:tighter|closer)|remove\s+(?:the\s+)?background|add\s+(?:a|an|the)\s+\w+|put\s+.+\s+on\s+(?:her|him|them|it))[\s.!?]*$/i,
  /\b(?:choose|pick|select)\s+(?:the\s+)?(?:best|clearest|sharpest|favorite|favourite)\s+(?:one|image|picture|photo|result)\b/i,
  /\b(?:use|choose|pick|select)\s+(?:the\s+)?one\s+(?:where|with|that\s+has|showing)\b/i
];

export function shouldUseConversationMediaContext(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return MEDIA_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

const EXPLICIT_HISTORICAL_MEDIA_PATTERN =
  /\b(previous|prior|earlier|last|latest|recent|generated|created|result|output|above|first\s+attempt|you\s+(?:made|generated|created|sent|showed|gave)|same|again|go\s+back|return\s+to)\b/i;
const HISTORICAL_MEDIA_RESET_PATTERNS = [
  /\b(?:do\s+not|don['’]?t|never|ignore|skip|exclude|leave\s+out)\s+(?:use|reuse|include|reference|attach|consider|look\s+at)?\s*(?:the\s+)?(?:previous|prior|earlier|last|latest|recent|generated|original)\s+(?:images?|pictures?|photos?|pics?|results?|outputs?|renders?|ones?|uploads?|references?)\b/i,
  /\bnot\s+(?:the\s+)?(?:previous|prior|earlier|last|latest|recent|generated|original)\s+(?:images?|pictures?|photos?|pics?|results?|outputs?|renders?|ones?|uploads?|references?)\b/i,
  /\b(?:start|begin)\s+(?:over\s+)?(?:from\s+scratch|fresh)\b/i,
  /\b(?:create|make|generate)\s+(?:a\s+)?(?:brand\s+)?new\s+(?:image|picture|photo|visual|render|result)\s+(?:from\s+scratch|without\s+(?:using\s+)?(?:the\s+)?(?:previous|prior|original|earlier|last))\b/i
];
const USER_UPLOAD_PREFERENCE_PATTERN =
  /\b(sources?|uploaded|uploads?|attached|attachments?|inputs?|references?)\b/i;
const GENERATED_OUTPUT_PREFERENCE_PATTERN =
  /\b(generated|results?|outputs?|renders?|versions?|attempts?|you\s+(?:made|generated|created))\b/i;
const VISUAL_TRANSFORM_PATTERN = [
  /\b(edit|change|modify|update|revise|redo|remake|regenerate|rerender|re-render|recreate|rework|fix|adjust|tweak|improve|enhance|clean\s+up|touch\s+up|retouch|restore|sharpen|upscale|crop|resize|reframe|rotate|flip|mirror|extend|expand|outpaint|inpaint|remove|erase|delete|replace|swap|add|insert|include|put|make|turn|convert|transform|stylize|style|restyle|colorize|recolor|lighten|darken|brighten|blur|unblur|smooth|zoom|mix|combine|blend|merge|fuse|morph|composite|remix|cross|hybridize|dress|place|move|give)\b/i,
  /\b(?:make|try|render|show)\s+(?:it|them|that|this)\s+(?:in|as|with)\s+(?:a\s+)?(?:watercolor|oil\s+painting|sketch|anime|cartoon|photorealistic|realistic|cinematic|comic|illustration|different|new)\b/i,
  /^(more|less)\s+(realistic|cartoonish|stylized|detailed|dramatic|colorful|colourful|bright|dark|cinematic|natural|professional|polished)\b/i,
  /\b(same|keep\s+the)\s+(pose|person|character|face|subject|background|outfit|style|lighting|composition|camera|angle)\b.*\b(different|new|but|with|without|change)\b/i,
  /^(?:do\s+it\s+again|run\s+it\s+back|same\s+again|one\s+more|try\s+again)[\s.!?]*(?:but\b.*)?$/i,
  /^(?:now\s+)?(?:with|without)\s+(?:a|an|the|her|his|their)?\s*.+/i,
  /^(?:zoom\s+(?:in|out)|crop\s+(?:it\s+)?(?:tighter|closer)|remove\s+(?:the\s+)?background|add\s+(?:a|an|the)\s+.+|put\s+.+\s+on\s+(?:her|him|them|it))[\s.!?]*$/i
];
const MULTI_IMAGE_FOLLOW_UP_PATTERN = [
  /\b(both|the\s+two|two|pair|multiple)\b/i,
  /\b(mix|combine|blend|merge|fuse|morph|composite|remix|cross|hybridize|compare|collage|montage|stitch|rank)\b.*\b(them|their|these|those|all|images?|pictures?|photos?|pics?)\b/i,
  /\b(their|these|those)\s+(faces?|features?|looks?|appearances?|designs?|characters?|subjects?|people|outfits?)\b/i,
  /\b(side[-\s]?by[-\s]?side|each\s+other)\b/i
];

export function inferConversationMediaMinimum(message: string): number {
  const normalized = message.replace(/\s+/g, " ").trim();
  return MULTI_IMAGE_FOLLOW_UP_PATTERN.some((pattern) => pattern.test(normalized)) ? 2 : 1;
}

function inferVisualIntent(message: string): "inspect" | "transform" {
  return VISUAL_TRANSFORM_PATTERN.some((pattern) => pattern.test(message)) ? "transform" : "inspect";
}

function resetsHistoricalMedia(message: string): boolean {
  return HISTORICAL_MEDIA_RESET_PATTERNS.some((pattern) => pattern.test(message));
}

function hasExplicitHistoricalReference(message: string): boolean {
  if (resetsHistoricalMedia(message)) return false;
  return EXPLICIT_HISTORICAL_MEDIA_PATTERN.test(message) ||
    /\b(with|plus|alongside|along\s+with|combine\s+with|mix\s+with|use|reuse)\s+(?:the\s+)?originals?\b/i.test(message) ||
    /\bfrom\s+(?:the\s+)?(?:original|earlier|previous|prior|last)\b/i.test(message);
}

function emptyMediaContextResult(
  referenced: boolean,
  minimumImages: number,
  intent: "inspect" | "transform",
  overrides: Partial<ConversationMediaContextResult> = {}
): ConversationMediaContextResult {
  return {
    referenced,
    candidateCount: 0,
    attachments: [],
    unavailableCount: 0,
    minimumImages,
    source: "none",
    intent,
    selectedTurnIndexes: [],
    selectedPositions: [],
    ...overrides
  };
}

export function extractGeneratedMediaId(block: ContentBlock): string | undefined {
  if (block.type !== "image") return undefined;
  const metadataId = block.metadata?.generatedMediaId;
  if (typeof metadataId === "string" && metadataId.trim()) {
    return metadataId.trim();
  }

  const match = /\/api\/generated-media\/([^/?#]+)/.exec(block.url);
  return match?.[1];
}

function dataImageMimeType(url: string): string | undefined {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(url);
  return match?.[1];
}

function dataUrlSizeBytes(url: string): number {
  const encoded = url.split(",", 2)[1]?.replace(/\s/g, "") ?? "";
  if (!encoded) return 0;
  return Buffer.byteLength(encoded, "base64");
}

function isConversationImageCandidate(block: ContentBlock): block is Extract<ContentBlock, { type: "image" }> {
  return block.type === "image" && Boolean(extractGeneratedMediaId(block) || dataImageMimeType(block.url));
}

export function findRecentGeneratedImages(conversation: ConversationWithOutputs, maxImages = 1): Array<Extract<ContentBlock, { type: "image" }>> {
  const images: Array<Extract<ContentBlock, { type: "image" }>> = [];
  const turns = conversation.turns ?? [];
  for (let turnIndex = turns.length - 1; turnIndex >= 0 && images.length < maxImages; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;
    for (let outputIndex = turn.outputs.length - 1; outputIndex >= 0 && images.length < maxImages; outputIndex -= 1) {
      const output = turn.outputs[outputIndex];
      if (output && isConversationImageCandidate(output)) {
        images.push(output);
      }
    }
  }
  return images;
}

type ConversationImageGroup =
  | {
    source: "user_uploads";
    turnIndex: number;
    userMessage: string;
    assistantText: string;
    assets: ConversationUserAsset[];
  }
  | {
    source: "generated_outputs";
    turnIndex: number;
    userMessage: string;
    assistantText: string;
    outputs: Array<Extract<ContentBlock, { type: "image" }>>;
  };

function groupSize(group: ConversationImageGroup): number {
  return group.source === "user_uploads" ? group.assets.length : group.outputs.length;
}

function conversationImageGroups(conversation: ConversationWithOutputs): ConversationImageGroup[] {
  const groups: ConversationImageGroup[] = [];
  const turns = conversation.turns ?? [];

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;
    const userAssets = (turn.userAssets ?? []).filter((asset) => asset.kind === "image");
    const generatedOutputs = turn.outputs.filter(isConversationImageCandidate);
    const uploadGroup: ConversationImageGroup | undefined = userAssets.length > 0
      ? {
          source: "user_uploads",
          turnIndex,
          userMessage: turn.userMessage ?? "",
          assistantText: turn.assistantText ?? "",
          assets: userAssets
        }
      : undefined;
    const generatedGroup: ConversationImageGroup | undefined = generatedOutputs.length > 0
      ? {
          source: "generated_outputs",
          turnIndex,
          userMessage: turn.userMessage ?? "",
          assistantText: turn.assistantText ?? "",
          outputs: generatedOutputs
        }
      : undefined;

    if (generatedGroup) groups.push(generatedGroup);
    if (uploadGroup) groups.push(uploadGroup);
  }

  return groups;
}

const ORDINAL_VALUES: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10
};
const ORDINAL_WORD_PATTERN = Object.keys(ORDINAL_VALUES).join("|");
const VISUAL_ITEM_NOUN_PATTERN =
  String.raw`(?:ones?|images?|pictures?|photos?|pics?|results?|renders?|outputs?|uploads?|references?)`;

function ordinalValue(value: string): number | undefined {
  const normalized = value.toLowerCase();
  const wordValue = ORDINAL_VALUES[normalized];
  if (wordValue) return wordValue;
  const numeric = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function requestedVisualPositions(message: string): number[] {
  const withoutGroupOrdinals = message.replace(
    new RegExp(
      String.raw`\b(?:${ORDINAL_WORD_PATTERN}|\d+(?:st|nd|rd|th))\s+(?:attempt|version|result|output|render)\b`,
      "gi"
    ),
    " "
  );
  const positions = new Set<number>();
  const beforeNoun = new RegExp(
    String.raw`\b(${ORDINAL_WORD_PATTERN}|\d+(?:st|nd|rd|th))\s*(?=(?:${VISUAL_ITEM_NOUN_PATTERN})\b|(?:,|\band\b))`,
    "gi"
  );
  const afterNoun = new RegExp(
    String.raw`\b${VISUAL_ITEM_NOUN_PATTERN}\s*(?:number|#)?\s*(\d+)\b`,
    "gi"
  );
  const afterNounList = new RegExp(
    String.raw`\b${VISUAL_ITEM_NOUN_PATTERN}\s+((?:(?:the\s+)?(?:${ORDINAL_WORD_PATTERN}|\d+(?:st|nd|rd|th)?))(?:\s*(?:,|and)\s*(?:the\s+)?(?:${ORDINAL_WORD_PATTERN}|\d+(?:st|nd|rd|th)?))*)\b`,
    "gi"
  );
  const ordinalToken = new RegExp(String.raw`\b(${ORDINAL_WORD_PATTERN}|\d+(?:st|nd|rd|th)?)\b`, "gi");

  for (const match of withoutGroupOrdinals.matchAll(beforeNoun)) {
    const value = match[1] ? ordinalValue(match[1]) : undefined;
    if (value) positions.add(value);
  }
  for (const match of withoutGroupOrdinals.matchAll(afterNoun)) {
    const value = match[1] ? ordinalValue(match[1]) : undefined;
    if (value) positions.add(value);
  }
  for (const match of withoutGroupOrdinals.matchAll(afterNounList)) {
    for (const token of (match[1] ?? "").matchAll(ordinalToken)) {
      const value = token[1] ? ordinalValue(token[1]) : undefined;
      if (value) positions.add(value);
    }
  }
  return [...positions].sort((left, right) => left - right);
}

function requestedExcludedVisualPositions(message: string): number[] {
  const positions = new Set<number>();
  const exclusionClause = new RegExp(
    String.raw`\b(?:except|excluding|exclude|but\s+not|not|skip|omit|leave\s+out|without)\s+(?:the\s+)?((?:(?:${ORDINAL_WORD_PATTERN}|\d+(?:st|nd|rd|th)?))(?:\s*(?:,|and)\s*(?:the\s+)?(?:${ORDINAL_WORD_PATTERN}|\d+(?:st|nd|rd|th)?))*)\s*(?:${VISUAL_ITEM_NOUN_PATTERN})?\b`,
    "gi"
  );
  const ordinalToken = new RegExp(String.raw`\b(${ORDINAL_WORD_PATTERN}|\d+(?:st|nd|rd|th)?)\b`, "gi");
  for (const match of message.matchAll(exclusionClause)) {
    for (const token of (match[1] ?? "").matchAll(ordinalToken)) {
      const value = token[1] ? ordinalValue(token[1]) : undefined;
      if (value) positions.add(value);
    }
  }
  return [...positions].sort((left, right) => left - right);
}

function requestedVisualGroupPosition(message: string): number | undefined {
  const match = new RegExp(
    String.raw`\b(${ORDINAL_WORD_PATTERN}|\d+(?:st|nd|rd|th))\s+(?:attempt|version|result|output|render)\b`,
    "i"
  ).exec(message);
  return match?.[1] ? ordinalValue(match[1]) : undefined;
}

function requestsEveryVisual(message: string): boolean {
  return /\b(?:all(?:\s+of)?\s+(?:them|these|those|the\s+images?|images?|pictures?|photos?|pics?|results?|outputs?|renders?|uploads?|references?)|every\s+(?:image|picture|photo|result|output|render|upload|reference))\b/i.test(message);
}

function requestsSemanticVisualSelection(message: string): boolean {
  return [
    /\b(?:choose|pick|select|use)\s+(?:the\s+)?(?:best|clearest|sharpest|favorite|favourite|most\s+\w+)\s+(?:one|image|picture|photo|result)\b/i,
    /\b(?:use|choose|pick|select)\s+(?:the\s+)?one\s+(?:where|with|that\s+has|showing)\b/i
  ].some((pattern) => pattern.test(message));
}

function requestedSpatialVisualPosition(
  message: string,
  size: number
): { position?: number; ambiguityMessage?: string } {
  const visualNoun = String.raw`(?:image|picture|photo|pic|one|result|render|version)`;
  if (new RegExp(
    String.raw`\b(?:(?:left|top)\s+${visualNoun}|${visualNoun}\s+(?:on|at)\s+(?:the\s+)?(?:left|top))\b`,
    "i"
  ).test(message)) {
    return { position: 1 };
  }
  if (new RegExp(
    String.raw`\b(?:(?:right|bottom)\s+${visualNoun}|${visualNoun}\s+(?:on|at)\s+(?:the\s+)?(?:right|bottom))\b`,
    "i"
  ).test(message)) {
    return { position: size };
  }
  if (new RegExp(
    String.raw`\b(?:(?:middle|center|centre)\s+${visualNoun}|${visualNoun}\s+(?:in|at)\s+(?:the\s+)?(?:middle|center|centre))\b`,
    "i"
  ).test(message)) {
    if (size % 2 === 0) {
      return {
        ambiguityMessage: `There are two middle images in this visual set (#${size / 2} and #${size / 2 + 1}). Please choose one of them.`
      };
    }
    return { position: Math.ceil(size / 2) };
  }
  return {};
}

type VisualSelection = {
  group?: ConversationImageGroup;
  positions: number[];
  ambiguityMessage?: string;
};

function visualSelection(
  group: ConversationImageGroup | undefined,
  positions: number[]
): VisualSelection {
  return group ? { group, positions } : { positions };
}

function visualSelectionWithAvailablePositions(
  group: ConversationImageGroup | undefined,
  positions: number[],
  message: string
): VisualSelection {
  if (!group) return { positions };
  const groupCount = groupSize(group);
  const exclusions = requestedExcludedVisualPositions(message);
  const highestExcludedPosition = exclusions.at(-1);
  if (highestExcludedPosition !== undefined && highestExcludedPosition > groupCount) {
    return {
      positions,
      ambiguityMessage: `I couldn't find excluded image #${highestExcludedPosition} in the selected visual set. Please choose an available image position.`
    };
  }

  const spatial = requestedSpatialVisualPosition(message, groupCount);
  if (spatial.ambiguityMessage) {
    return {
      positions,
      ambiguityMessage: spatial.ambiguityMessage
    };
  }

  let resolvedPositions = requestsEveryVisual(message) || requestsSemanticVisualSelection(message)
    ? Array.from({ length: groupCount }, (_, index) => index + 1)
    : [...positions];
  if (spatial.position !== undefined) {
    resolvedPositions = [spatial.position];
  }
  resolvedPositions = resolvedPositions.filter((position) => !exclusions.includes(position));
  if (exclusions.length > 0 && resolvedPositions.length === 0 && positions.length === 0) {
    resolvedPositions = Array.from({ length: groupCount }, (_, index) => index + 1)
      .filter((position) => !exclusions.includes(position));
  }
  if (resolvedPositions.length === 0 && exclusions.length >= groupCount) {
    return {
      positions: resolvedPositions,
      ambiguityMessage: "That selection excludes every available image. Please leave at least one image selected."
    };
  }

  const highestPosition = resolvedPositions.at(-1);
  if (highestPosition !== undefined && highestPosition > groupCount) {
    const requested = resolvedPositions.map((position) => `#${position}`).join(", ");
    return {
      positions: resolvedPositions,
      ambiguityMessage: `I couldn't find image ${requested} in the selected visual set. Please choose an available image position or upload the image again.`
    };
  }
  return visualSelection(group, resolvedPositions);
}

function visualGroupLabel(group: ConversationImageGroup): string {
  const origin = group.source === "user_uploads" ? "uploaded source set" : "generated result set";
  return `${origin} from visual turn ${group.turnIndex + 1}`;
}

function selectConversationImageGroup(
  groups: ConversationImageGroup[],
  message: string,
  minimumImages: number
): VisualSelection {
  const mentionsUploads = USER_UPLOAD_PREFERENCE_PATTERN.test(message);
  const mentionsGenerated = GENERATED_OUTPUT_PREFERENCE_PATTERN.test(message);
  const explicitlyReturnsToUploads =
    /\b(go\s+back\s+to|return\s+to|use|reuse|from|with)\s+(?:the\s+)?(?:originals?|uploads?|sources?|inputs?|attachments?|references?)\b/i.test(message) ||
    /\b(?:source|uploaded|input|attached|reference)\s+(?:images?|pictures?|photos?|uploads?|references?|attachments?)\b/i.test(message) ||
    /\boriginal\s+(?:uploads?|sources?|inputs?|attachments?|references?)\b/i.test(message);
  const prefersUploads = explicitlyReturnsToUploads || (mentionsUploads && !mentionsGenerated);
  const prefersGenerated = !prefersUploads && mentionsGenerated;
  const sourceFiltered = groups.filter((group) =>
    prefersUploads ? group.source === "user_uploads" :
      prefersGenerated ? group.source === "generated_outputs" :
        true
  );
  const eligible = sourceFiltered.filter((group) => groupSize(group) >= minimumImages);
  const candidates = eligible.length > 0 ? eligible : sourceFiltered;
  const requestedPositions = requestedVisualPositions(message);
  const excludedPositions = requestedExcludedVisualPositions(message);
  const positions = requestedPositions.filter((position) => !excludedPositions.includes(position));
  const groupPosition = requestedVisualGroupPosition(message);
  const requestsOriginal =
    /\b(originals?|earliest)\b/i.test(message) ||
    /\b(?:go\s+back\s+to|return\s+to)\s+(?:the\s+)?(?:original|first|earliest)\b/i.test(message);
  const requestsLatest = /\b(last|latest|recent|previous|prior|above|same|again)\b/i.test(message);

  if (groupPosition) {
    const chronological = [...candidates].reverse();
    const group = chronological[groupPosition - 1];
    return group
      ? visualSelectionWithAvailablePositions(group, positions, message)
      : {
          positions,
          ambiguityMessage: `I couldn't find a ${groupPosition === 1 ? "first" : `number ${groupPosition}`} visual version in this chat. Please choose one of the available images or upload it again.`
        };
  }

  if (requestsOriginal) {
    return visualSelectionWithAvailablePositions(candidates.at(-1), positions, message);
  }
  if (requestsLatest) {
    return visualSelectionWithAvailablePositions(candidates[0], positions, message);
  }

  if (positions.length > 0) {
    const highestPosition = positions.at(-1) ?? 1;
    const matchingGroups = candidates.filter((group) => groupSize(group) >= highestPosition);
    if (matchingGroups.length > 1) {
      return {
        positions,
        ambiguityMessage: `I found ${matchingGroups.length} earlier visual sets containing those positions. Please specify the latest result, the original uploads, or which earlier version you mean.`
      };
    }
    if (matchingGroups.length === 0 && candidates.length > 0) {
      return visualSelectionWithAvailablePositions(candidates[0], positions, message);
    }
    return visualSelectionWithAvailablePositions(matchingGroups[0], positions, message);
  }

  return visualSelectionWithAvailablePositions(candidates[0], positions, message);
}

function isVisualClarificationReply(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 240) return false;
  return [
    /^(?:use\s+|choose\s+|pick\s+|select\s+|go\s+back\s+to\s+|return\s+to\s+)?(?:the\s+)?(?:last|latest|recent|previous|prior|original|earliest)\b/i,
    /^(?:use\s+|choose\s+|pick\s+|select\s+)?(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)?)\s+(?:attempt|version|result|output|image|picture|photo|one)\b/i,
    /^(?:use\s+|choose\s+|pick\s+|select\s+)?(?:the\s+)?(?:uploads?|sources?|references?|generated\s+(?:results?|outputs?)|results?|outputs?)\b/i
  ].some((pattern) => pattern.test(normalized));
}

function effectiveConversationMediaMessage(
  conversation: ConversationWithOutputs,
  currentMessage: string
): string {
  const lastTurn = conversation.turns?.at(-1);
  const clarification = lastTurn?.visualClarification;
  if (
    clarification?.status !== "ambiguous" ||
    !clarification.originalRequest.trim() ||
    !isVisualClarificationReply(currentMessage)
  ) {
    return currentMessage;
  }
  return `${clarification.originalRequest.trim()}\nVisual selection clarification: ${currentMessage.trim()}`;
}

export function shouldPlanHistoricalVisualTransformation(
  conversation: ConversationWithOutputs,
  message: string,
  currentImageCount = 0
): boolean {
  const effectiveMessage = effectiveConversationMediaMessage(conversation, message);
  const requirement = analyzeImageReferenceRequirement(effectiveMessage);
  const explicitlyReferencesHistory = hasExplicitHistoricalReference(effectiveMessage);
  if (
    resetsHistoricalMedia(effectiveMessage) ||
    !shouldUseConversationMediaContext(effectiveMessage) ||
    inferVisualIntent(effectiveMessage) !== "transform" ||
    (currentImageCount > 0 && !explicitlyReferencesHistory) ||
    (requirement.expectsNewUploads && !explicitlyReferencesHistory)
  ) {
    return false;
  }
  return conversationImageGroups(conversation).length > 0;
}

async function resolveGeneratedOutput(
  image: Extract<ContentBlock, { type: "image" }>,
  options: ConversationMediaContextOptions,
  attachmentIndex: number
): Promise<ConversationMediaAttachment | undefined> {
  const mediaId = extractGeneratedMediaId(image);
  if (mediaId) {
    const media = await generatedMediaService.download(mediaId, options.ownerId);
    return {
      id: `conversation-media:${mediaId}`,
      kind: "image",
      fileName: media.fileName,
      mimeType: media.mimeType,
      sizeBytes: media.buffer.byteLength,
      url: `data:${media.mimeType};base64,${media.buffer.toString("base64")}`
    };
  }

  const mimeType = dataImageMimeType(image.url);
  if (!mimeType) return undefined;
  return {
    id: `conversation-media:data-url:${attachmentIndex + 1}`,
    kind: "image",
    fileName: `conversation-image-${attachmentIndex + 1}.${mimeType.split("/")[1] ?? "png"}`,
    mimeType,
    sizeBytes: dataUrlSizeBytes(image.url),
    url: image.url
  };
}

function historicalUploadAttachment(asset: ResolvedUploadAsset): ConversationMediaAttachment {
  return {
    ...asset,
    id: `conversation-upload:${asset.id}`
  };
}

export async function resolveConversationMediaContext(
  conversation: ConversationWithOutputs,
  options: ConversationMediaContextOptions
): Promise<ConversationMediaContextResult> {
  const effectiveMessage = effectiveConversationMediaMessage(conversation, options.message);
  const effectiveRequirement = analyzeImageReferenceRequirement(effectiveMessage);
  const referenced = shouldUseConversationMediaContext(effectiveMessage);
  const intent = inferVisualIntent(effectiveMessage);
  const historicalMediaReset = resetsHistoricalMedia(effectiveMessage);
  const explicitHistoricalReference = hasExplicitHistoricalReference(effectiveMessage);
  const currentImageCount = options.currentImageCount ?? 0;
  if (
    historicalMediaReset ||
    !referenced ||
    (currentImageCount > 0 && !explicitHistoricalReference) ||
    ((options.expectsNewUploads || effectiveRequirement.expectsNewUploads) && !explicitHistoricalReference)
  ) {
    return emptyMediaContextResult(false, 0, intent);
  }

  const inferredMinimum = inferConversationMediaMinimum(effectiveMessage);
  const requestedPositions = requestedVisualPositions(effectiveMessage);
  const minimumImages = Math.max(
    options.minimumImages ?? 0,
    effectiveRequirement.minimumImages,
    inferredMinimum,
    requestedPositions.length,
    explicitHistoricalReference && currentImageCount > 0 ? currentImageCount + 1 : 0
  );
  const historicalMinimum = Math.max(1, minimumImages - currentImageCount);
  const groups = conversationImageGroups(conversation);
  const selection = selectConversationImageGroup(
    groups,
    effectiveMessage,
    historicalMinimum
  );
  if (selection.ambiguityMessage) {
    return emptyMediaContextResult(true, minimumImages, intent, {
      candidateCount: groups.reduce((total, group) => total + groupSize(group), 0),
      ambiguityMessage: selection.ambiguityMessage,
      selectedPositions: selection.positions
    });
  }

  const group = selection.group;
  if (!group) {
    return emptyMediaContextResult(true, minimumImages, intent);
  }

  const attachments: ConversationMediaAttachment[] = [];
  let unavailableCount = 0;
  const maxImages = options.maxImages ?? groupSize(group);
  const selectedIndexes = selection.positions.length > 0
    ? selection.positions.map((position) => position - 1)
    : minimumImages > 1
      ? Array.from({ length: Math.min(groupSize(group), maxImages) }, (_, index) => index)
      : [groupSize(group) - 1];
  const limitedIndexes = selectedIndexes
    .filter((index) => index >= 0 && index < groupSize(group))
    .slice(0, maxImages);
  const selectedPositions = limitedIndexes.map((index) => index + 1);

  if (group.source === "user_uploads") {
    const limitedCandidates = limitedIndexes.flatMap((index) => {
      const candidate = group.assets[index];
      return candidate ? [candidate] : [];
    });
    for (const candidate of limitedCandidates) {
      try {
        if (!options.ownerId) throw new Error("Historical uploads require an authenticated owner.");
        const [asset] = await uploadService.resolveAssets(options.ownerId, [candidate.id]);
        if (!asset || asset.kind !== "image") throw new Error("Historical image upload is unavailable.");
        attachments.push(historicalUploadAttachment(asset));
      } catch (error) {
        unavailableCount += 1;
        logger.warn("Failed to resolve uploaded media for conversation context", {
          conversationId: conversation.id,
          assetId: candidate.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  } else {
    const limitedCandidates = limitedIndexes.flatMap((index) => {
      const candidate = group.outputs[index];
      return candidate ? [candidate] : [];
    });
    for (const candidate of limitedCandidates) {
      try {
        const attachment = await resolveGeneratedOutput(candidate, options, attachments.length);
        if (attachment) attachments.push(attachment);
        else unavailableCount += 1;
      } catch (error) {
        unavailableCount += 1;
        logger.warn("Failed to resolve generated media for conversation context", {
          conversationId: conversation.id,
          mediaId: extractGeneratedMediaId(candidate),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  const originRequest = group.userMessage.trim();
  const originResponse = group.assistantText.trim();
  const itemDescription = group.source === "user_uploads"
    ? selectedPositions.map((position, index) => {
        const asset = group.assets[limitedIndexes[index] ?? -1];
        return `position ${position}${asset?.fileName ? ` (${asset.fileName})` : ""}`;
      }).join(", ")
    : selectedPositions.map((position, index) => {
        const output = group.outputs[limitedIndexes[index] ?? -1];
        return `position ${position}${output?.alt ? ` (${output.alt})` : ""}`;
      }).join(", ");
  const promptContext = [
    `Resolved visual lineage: ${visualGroupLabel(group)}.`,
    itemDescription ? `Selected visual items: ${itemDescription}.` : "",
    originRequest ? `Originating user request: ${originRequest.slice(0, 900)}` : "",
    originResponse ? `Originating assistant response: ${originResponse.slice(0, 900)}` : ""
  ].filter(Boolean).join("\n");

  return {
    referenced: true,
    candidateCount: groupSize(group),
    attachments,
    unavailableCount,
    minimumImages,
    source: group.source,
    intent,
    promptContext,
    selectedTurnIndexes: [group.turnIndex],
    selectedPositions
  };
}
