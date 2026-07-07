import type { ContentBlock, UploadedAsset } from "@persona/shared";
import { logger } from "../utils/logger.js";
import { generatedMediaService } from "./generatedMediaService.js";

type ConversationWithOutputs = {
  id?: string;
  turns?: Array<{
    outputs: ContentBlock[];
  }>;
};

type ConversationMediaContextOptions = {
  message: string;
  ownerId?: string;
  maxImages?: number;
};

export type ConversationMediaContextResult = {
  referenced: boolean;
  candidateCount: number;
  attachments: UploadedAsset[];
  unavailableCount: number;
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

  // Explicit visual analysis language.
  /\b(describe|caption|inspect|analyze|analyse|identify|recognize|recognise|classify|interpret|review|critique|judge|rate|compare|zoom|crop|enhance|upscale|clean\s+up|look\s+at|take\s+a\s+look\s+at|tell\s+me\s+about|walk\s+me\s+through|break\s+down|explain)\b.*\b(image|images|picture|pictures|photo|photos|pic|pics|media|asset|assets|attachment|attachments|file|files|visual|visuals|render|renders|output|outputs|result|results|it|that|this|these|those|one|ones)\b/i,
  /\b(what\s+am\s+i\s+looking\s+at|what\s+are\s+we\s+looking\s+at|what\s+is\s+going\s+on\s+here|what\s+do\s+you\s+see|tell\s+me\s+what\s+you\s+see|describe\s+what\s+you\s+see|caption\s+this|caption\s+it)\b/i,

  // Edit requests against the prior asset.
  /\b(edit|change|modify|update|revise|redo|remake|regenerate|rerender|re-render|recreate|rework|fix|adjust|tweak|improve|enhance|clean\s+up|touch\s+up|retouch|restore|sharpen|upscale|crop|resize|reframe|rotate|flip|mirror|extend|expand|outpaint|inpaint|remove|erase|delete|replace|swap|add|insert|include|put|make|turn|convert|transform|stylize|style|restyle|colorize|recolor|lighten|darken|brighten|blur|unblur|smooth)\b.*\b(it|that|this|these|those|image|images|picture|pictures|photo|photos|pic|pics|asset|assets|attachment|attachments|file|files|visual|visuals|render|renders|output|outputs|result|results|one|ones)\b/i,
  /\b(make|turn|change|convert|transform)\s+(it|that|this|one)\s+(into|to|more|less|look|feel|like)\b/i,
  /\b(add|remove|replace|swap|change|fix)\s+(the|her|his|their|its|that|this)\s+(background|outfit|clothes|clothing|shirt|dress|hair|face|eyes|mouth|pose|lighting|color|colour|style|text|logo|object|person|animal)\b/i,

  // Follow-up pronouns commonly used after an image response.
  /\b(use|reuse|keep|base|reference|match|copy|continue\s+with|go\s+with|work\s+from|start\s+from)\b.*\b(it|that|this|these|those|one|ones|image|picture|photo|pic|reference|asset|attachment|file|visual|render)\b/i,
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
  /\b(use|look\s+at|compare\s+to|match)\b.*\b(reference|original|upload|uploaded|attachment|attached\s+file|source\s+image|input\s+image)\b/i
];

export function shouldUseConversationMediaContext(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return MEDIA_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized));
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

export function findRecentGeneratedImages(conversation: ConversationWithOutputs, maxImages = 1): Array<Extract<ContentBlock, { type: "image" }>> {
  const images: Array<Extract<ContentBlock, { type: "image" }>> = [];
  const turns = conversation.turns ?? [];
  for (let turnIndex = turns.length - 1; turnIndex >= 0 && images.length < maxImages; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;
    for (let outputIndex = turn.outputs.length - 1; outputIndex >= 0 && images.length < maxImages; outputIndex -= 1) {
      const output = turn.outputs[outputIndex];
      if (output?.type === "image" && extractGeneratedMediaId(output)) {
        images.push(output);
      }
    }
  }
  return images;
}

export async function resolveConversationMediaContext(
  conversation: ConversationWithOutputs,
  options: ConversationMediaContextOptions
): Promise<ConversationMediaContextResult> {
  if (!shouldUseConversationMediaContext(options.message)) {
    return {
      referenced: false,
      candidateCount: 0,
      attachments: [],
      unavailableCount: 0
    };
  }

  const images = findRecentGeneratedImages(conversation, options.maxImages ?? 1);
  const attachments: UploadedAsset[] = [];
  let unavailableCount = 0;
  for (const image of images) {
    const mediaId = extractGeneratedMediaId(image);
    if (!mediaId) continue;
    try {
      const media = await generatedMediaService.download(mediaId, options.ownerId);
      attachments.push({
        id: `conversation-media:${mediaId}`,
        kind: "image",
        fileName: media.fileName,
        mimeType: media.mimeType,
        sizeBytes: media.buffer.byteLength,
        url: `data:${media.mimeType};base64,${media.buffer.toString("base64")}`
      });
    } catch (error) {
      unavailableCount += 1;
      logger.warn("Failed to resolve generated media for conversation context", {
        conversationId: conversation.id,
        mediaId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    referenced: true,
    candidateCount: images.length,
    attachments,
    unavailableCount
  };
}
