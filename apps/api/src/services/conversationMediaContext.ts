import type { ContentBlock, ConversationUserAsset, ProviderId, UploadedAsset } from "@persona/shared";
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
  provider?: ProviderId;
  maxImages?: number;
  currentImageCount?: number;
  minimumImages?: number;
  expectsNewUploads?: boolean;
  // Tool-router verdict used as a backstop when the deterministic patterns
  // miss a visual reference ("ok now remove the sunglasses" style phrasing).
  mediaReferenceHint?: "none" | "inspect" | "transform";
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

// Wardrobe, accessory, grooming, and styling nouns shared by the edit-object
// and swap patterns below, so any phrasing like "replace the sunglasses with
// goggles" or "swap the heels for sneakers" matches consistently everywhere.
// Kept as a string fragment so the patterns cannot drift apart.
const ACCESSORY_NOUN_PATTERN = [
  // Eyewear
  "sunglasses", "shades", "eyewear", "glasses", "goggles", "monocle", "contacts?", "lenses",
  // Jewelry / body adornment
  "jewelry", "jewellery", "necklace", "chains?", "pendant", "choker", "earrings?", "bracelet", "bangle",
  "anklet", "watch", "rings?", "brooch", "piercings?", "grillz?", "cufflinks?", "tiara", "crown",
  "tattoos?", "nails",
  // Headwear / face coverings
  "hat", "caps?", "beanie", "visor", "helmet", "headband", "bandana", "durag", "bonnet", "veil", "mask",
  // Bags / carried items
  "bags?", "purse", "handbag", "backpack", "tote", "clutch", "wallet", "fanny\\s+pack", "crossbody",
  "duffel", "suitcase", "umbrella", "cane", "staff", "microphone", "mic", "phone", "camera", "bouquet",
  // Footwear
  "shoes?", "heels", "stilettos", "sneakers", "boots", "sandals", "flats", "loafers", "wedges", "slippers",
  // Clothing
  "jacket", "coat", "blazer", "hoodie", "sweater", "sweatshirt", "cardigan", "vest", "cape", "robe",
  "suit", "tuxedo", "tux", "uniform", "costume", "apron", "jersey", "raincoat", "parka", "scarf", "scarves",
  "belt", "tie", "bowtie", "gloves?", "mittens?", "top", "blouse", "tank", "tee", "t[-\\s]?shirt",
  "pants", "jeans", "trousers", "shorts", "skirt", "gown", "bikini", "swimsuit", "swimwear", "lingerie",
  "bra", "stockings", "socks?", "leggings", "joggers", "overalls", "corset", "bodysuit", "jumpsuit", "romper",
  // Hair / grooming / makeup
  "wig", "weave", "extensions", "braids", "locs", "dreads", "ponytail", "bun", "bangs", "mohawk", "fade",
  "haircut", "hairstyle", "beard", "mustache", "goatee", "stubble", "makeup", "lipstick", "lip\\s+gloss",
  "eyeliner", "mascara", "eyeshadow", "blush", "foundation", "lashes", "eyelashes", "eyebrows", "brows",
  // Costume extras
  "wings", "halo", "horns", "tail", "collar"
].join("|");

function accessoryAwareRegExp(pattern: string): RegExp {
  return new RegExp(pattern.replaceAll("__ACCESSORIES__", ACCESSORY_NOUN_PATTERN), "i");
}

// Terse single-intent follow-ups people send right after a visual turn
// ("Ghibli version please.", "Different background.", "Sharper.").
// All are anchored so ordinary prose cannot match, and they are shared by
// media-reference detection and transform-intent inference to keep them in sync.
const TERSE_VISUAL_TRANSFORM_PATTERNS = [
  // "Ghibli version please.", "Poster version." (not "love this version").
  /^(?!.*\b(?:love|like|hate)\b)(?:[\w-]+\s+){0,2}version(?:\s+please)?(?:\s+and\s+[\w\s'-]{1,48})?[\s.!]*$/i,
  // "Comic book style please." (not "what's your style?" or "nice, I like your style.").
  /^(?!.*\b(?:your|my|his|her|our|their|love|like)\b)(?:(?:a|an)\s+)?(?:[\w-]+\s+){0,2}(?:style|aesthetic|look|vibe|theme|filter)(?:\s+please)?[\s.!]*$/i,
  // Style used as a verb: "Cyberpunk it.", "Anime this."
  /^(?:cyberpunk|vaporwave|anime|manga|cartoon|ghibli|pixar|lego|claymation|pixel|noir)(?:\s*ify)?\s+(?:it|this|that|them)[\s.!]*$/i,
  // "Different background.", "New hairstyle.", "Another angle.", "New sunglasses."
  accessoryAwareRegExp("^(?:a\\s+)?(?:different|new|another)\\s+(?:background|backdrop|outfit|hairstyle|hair|pose|expression|setting|scene|location|angle|filter|font|lighting|perspective|color\\s+scheme|colour\\s+scheme|__ACCESSORIES__)[\\s.!]*$"),
  // "Smiling instead.", "Red hair instead."
  /^(?:[\w'-]+\s+){0,3}instead[\s.!]*$/i,
  // "Same but different.", "Same but in oil painting style."
  /^same\s*,?\s+but\b[\s\S]*$/i,
  // Single comparative adjective: "Sharper.", "Brighter.", "Moodier." (optionally "Sharper and brighter.")
  /^(?:sharper|brighter|darker|crisper|cleaner|smoother|softer|bolder|clearer|warmer|cooler|moodier|dreamier|prettier|cuter|sexier|fancier|edgier|classier|slicker)(?:\s+and\s+[\w\s'-]{1,48})?[\s.!]*$/i,
  // "Higher quality.", "Better resolution."
  /^(?:higher|better)\s+(?:quality|resolution|detail|definition)[\s.!]*$/i,
  // "Wider shot.", "Closer frame."
  /^(?:a\s+)?(?:wider|closer|tighter|broader)\s+(?:shot|frame|crop|view|angle)[\s.!]*$/i,
  // "Close up on her face."
  /^close[-\s]?up\b[\s\S]*$/i,
  // Direct single-object edit verbs: "Remove the sunglasses.", "Add a necklace.",
  // "Swap the earrings.", "Try on the red dress.", "Dye her hair blonde."
  // ("change"/"give"/"make" stay out so ordinary chat can't match).
  /^(?:(?:now|next|then|ok(?:ay)?)[\s,]+)?(?:please\s+)?(?:remove|take\s+out|get\s+rid\s+of|erase|delete|add|insert|replace|swap|switch|exchange|substitute|wear|put\s+on|try\s+on|dye|curl|straighten|braid|trim|shorten|lengthen|restyle|touch\s+up|repaint|recolor|redraw|fix|adjust|tweak|tighten|loosen)\s+(?:the\s+|a\s+|an\s+|her\s+|his\s+|their\s+|your\s+)?[\w\s'-]{1,40}[\s.!]*$/i,
  // "Portrait orientation.", "Landscape.", "Vertical."
  /^(?:portrait|landscape|square|widescreen|vertical|horizontal)(?:\s+(?:orientation|format|aspect\s+ratio|ratio|crop|version))?[\s.!]*$/i,
  // Bare aspect ratio: "16:9", "4x3".
  /^\d{1,2}\s*[:x×]\s*\d{1,2}(?:\s+aspect\s+ratio)?[\s.!]*$/i,
  // Bare season/weather/time-of-day recasts: "Snow.", "Winter version.", "Golden hour." (not "Winter is coming.").
  /^(?:winter|summer|spring|fall|autumn|snow|rain|fog|snowy|rainy|sunny|cloudy|stormy|nighttime|daytime|sunset|sunrise|golden\s+hour)(?:\s+(?:version|scene|setting|mode|weather|vibes?))?[\s.!]*$/i,
  // Format/medium recasts: "As an album cover.", "Turn it into a logo" handled elsewhere.
  /^(?:(?:now|next|then|ok(?:ay)?)[\s,]+)?(?:in|into|as|like)\s+(?:an?\s+)?(?:sticker|logo|poster|wallpaper|meme|banner|thumbnail|avatar|icon|postcard|billboard|tattoo|mural|gif|animation|loop|album\s+cover|book\s+cover|movie\s+poster|comic\s+strip|greeting\s+card|t[-\s]?shirt(?:\s+design)?)\b[\s.!]*$/i,
  // "Phone wallpaper.", "Poster.", "Album cover."
  /^(?:a\s+)?(?:phone\s+|desktop\s+)?(?:wallpaper|poster|sticker|logo|meme|banner|thumbnail|avatar|icon|postcard|billboard|tattoo|mural|gif|animation|album\s+cover|book\s+cover|movie\s+poster|comic\s+strip|greeting\s+card)(?:\s+version)?[\s.!]*$/i,
  // Time/place shifts: "And now at night.", "Now in the rain.", "In the rain."
  /^(?:(?:and\s+)?(?:now|next|then)\s*,?\s+)?(?:at\s+(?:night|sunset|sunrise|dusk|dawn)|in\s+the\s+(?:rain|snow|fog|desert|city|forest|mountains|future|past|morning|evening|afternoon|dark)|during\s+(?:the\s+)?(?:day|night|winter|summer|daytime|nighttime))[\s.!]*$/i,
  // Context-dependent continuations: "Now the same for Bam Bam.", "Do the same with the other one."
  /\b(?:do|now|next|then)\s+(?:the\s+)?same\s+(?:for|with)\b/i,
  // Multi-image assembly named as a noun: "Collage of all three.", "Montage of them."
  /\b(?:collage|montage|mash\s*up)\s+(?:of|with|from|using)\b/i
];

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
  /\b(edit|change|modify|update|revise|redo|remake|regenerate|rerender|re-render|recreate|rework|remix|fix|adjust|tweak|improve|enhance|clean\s+up|touch\s+up|retouch|restore|sharpen|upscale|crop|resize|reframe|rotate|flip|mirror|extend|expand|outpaint|inpaint|remove|erase|delete|replace|swap|add|insert|include|put|make|turn|convert|transform|stylize|style|restyle|colorize|recolor|lighten|darken|brighten|blur|unblur|smooth|animate)\b.*\b(it|that|this|these|those|image|images|picture|pictures|photo|photos|pic|pics|asset|assets|attachment|attachments|file|files|visual|visuals|render|renders|output|outputs|result|results|one|ones)\b/i,
  /\b(make|turn|change|convert|transform)\s+(it|that|this|one)\s+(into|to|more|less|look|feel|like)\b/i,
  accessoryAwareRegExp("\\b(add|remove|take\\s+out|get\\s+rid\\s+of|cut\\s+out|replace|swap|switch|exchange|change|fix)\\s+(the|her|his|their|its|your|yo|that|this)\\s+(background|outfit|clothes|clothing|shirt|dress|hair|face|eyes|mouth|nose|lips|smile|teeth|skin|body|pose|lighting|color|colour|style|text|caption|watermark|sign|logo|object|person|animal|sky|__ACCESSORIES__)\\b"),

  // Follow-up pronouns commonly used after an image response.
  /\b(use|reuse|keep|base|reference|match|copy|continue\s+with|go\s+with|work\s+from|start\s+from)\b.*\b(it|them|that|this|these|those|one|ones|image|picture|photo|pic|reference|asset|attachment|file|visual|render)\b/i,
  /\b(again|same\s+again|one\s+more|another\s+one|another\s+version|new\s+version|different\s+version|version\s+of\s+that|do\s+it\s+again|try\s+again|run\s+it\s+back|remake\s+that|redo\s+that)\b/i,
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
  /\b(mix|combine|blend|merge|fuse|morph|composite|remix|mash|cross|hybridize|compare)\b.*\b(them|both|their|the\s+two|all\s+of\s+them|these|those|faces?|features?|looks?|appearances?|designs?|characters?|subjects?|people|outfits?)\b/i,
  /\b(their|both|the\s+two|these|those)\s+(faces?|features?|looks?|appearances?|designs?|characters?|subjects?|outfits?)\b/i,
  /\b(now|next|then)\b.*\b(merge|combine|blend|mix|morph|edit|change|modify|transform|restyle|remake|redo)\b/i,

  // Natural subject and attribute follow-ups after a visual turn.
  // NOTE: "change" is deliberately excluded here so "let's change the subject" stays non-visual;
  // attribute changes are still caught by the edit-request patterns above.
  /\b(make|put|place|move|dress|show|turn|transform|style|restyle|give)\s+(her|him|them|it|yourself|the\s+(?:person|character|subject|woman|man|girl|boy|people|characters?))\b/i,
  /\b(make|change|turn|set)\s+(?:the|your|her|his|their|its|yo)\s+(background|outfit|clothes|clothing|shirt|dress|hair|face|eyes|mouth|pose|lighting|color|colour|style|expression|camera|angle|setting|scene|sky)\b/i,
  accessoryAwareRegExp("\\b(with|without)\\s+(a|an|the|her|his|their|your)?\\s*(?:[\\w'-]+\\s+){0,2}(background|outfit|clothes|clothing|shirt|dress|hair|eyes|pose|lighting|expression|__ACCESSORIES__)\\b"),
  /^(more|less)\s+(realistic|cartoonish|stylized|detailed|detail|details|texture|dramatic|colorful|colourful|bright|dark|cinematic|natural|professional|polished|blurry|grainy|sharp|dull|flat|saturated|vivid|washed\s+out|badass|edgy)\b/i,
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
  /^(?:zoom\s+(?:in|out)(?:\s+(?:a\s+)?(?:bit|little|touch|more|further|farther|closer|tighter))?|crop\s+(?:it\s+)?(?:tighter|closer)|remove\s+(?:the\s+)?background|add\s+(?:a|an|the)\s+.+|put\s+.+\s+on\s+(?:her|him|them|it))[\s.!?]*$/i,
  // Terse style-only follow-ups after a visual turn ("Now in anime style.", "In watercolor.", "Now as a cartoon").
  /^(?:(?:now|next|then|ok(?:ay)?)[\s,]+)?(?:you\s+)?(?:in|into|as)\s+(?:an?\s+)?[\w\s-]{1,32}?\b(?:style|aesthetic|look|vibe|theme|filter)\b(?:\s+and\s+[\w\s'-]{1,48})?[\s.!?]*$/i,
  /^(?:(?:now|next|then|ok(?:ay)?)[\s,]+)?(?:you\s+)?(?:in|into|as|like)\s+(?:an?\s+)?(?:anime|manga|cartoon|comic|watercolor|watercolour|oil\s+painting|sketch|pixel\s+art|photorealistic|realistic|cinematic|illustration|pop\s+art|cyberpunk|vaporwave|claymation|line\s+art|noir|ghibli|pixar|disney|3d|lego|clay)\b(?:\s+and\s+[\w\s'-]{1,48})?[\s.!?]*$/i,
  /\b(?:choose|pick|select)\s+(?:the\s+)?(?:best|clearest|sharpest|favorite|favourite)\s+(?:one|image|picture|photo|result)\b/i,
  /\b(?:use|choose|pick|select)\s+(?:the\s+)?one\s+(?:where|with|that\s+has|showing)\b/i,

  // Terse transform follow-ups shared with transform-intent inference (see above).
  ...TERSE_VISUAL_TRANSFORM_PATTERNS,

  // Swapping one depicted thing for another: "Swap the car for a motorcycle.",
  // "Replace the sunglasses with goggles." Noun list shared via __ACCESSORIES__.
  accessoryAwareRegExp("\\b(?:swap|replace|exchange|substitute|switch)\\s+(?:the\\s+|a\\s+|an\\s+|her\\s+|his\\s+|their\\s+)?(?:car|vehicle|object|person|character|background|outfit|text|logo|color|colour|dog|cat|tree|building|font|frame|__ACCESSORIES__)\\b[\\w\\s-]{0,40}\\b(?:for|with)\\b"),
  // Quality work on the current visual: "Enhance the details.", "Boost the contrast."
  /\b(?:enhance|improve|sharpen|boost|increase)\s+(?:the\s+)?(?:details?|sharpness|clarity|quality|resolution|contrast|colors?|colours?|lighting)\b/i,
  // Ordinal selection without a noun: "Use the third.", "Pick the second."
  /\b(?:use|choose|pick|select)\s+(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\b/i,
  // Spatial selection: "The one on the left."
  /\bthe\s+one\s+on\s+the\s+(?:left|right|top|bottom)\b/i
];

// Voice/STT dictation often prepends filler words ("um", "so", "like") with no
// punctuation. Strip them before testing so the anchored terse patterns still match.
const LEADING_FILLER_PATTERN = /^(?:(?:um+|uh+|er+|ah+|well|so|like|hey|ok(?:ay)?)[\s,]+)+/i;

function stripLeadingFillers(message: string): string {
  return message.replace(LEADING_FILLER_PATTERN, "").trim();
}

function matchesAnyPattern(patterns: RegExp[], message: string): boolean {
  const withoutFillers = stripLeadingFillers(message);
  return patterns.some((pattern) =>
    pattern.test(message) ||
    (withoutFillers.length > 0 && withoutFillers !== message && pattern.test(withoutFillers))
  );
}

export function shouldUseConversationMediaContext(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return matchesAnyPattern(MEDIA_REFERENCE_PATTERNS, normalized);
}

/**
 * A missing historical file should only replace the normal chat answer when
 * the current wording independently demonstrates that the file is necessary.
 * This deliberately uses a narrower rule than context selection: selection
 * may use advisory model hints, while an error response must not.
 */
export function shouldBlockForUnavailableHistoricalMedia(message: string): boolean {
  const normalized = stripLeadingFillers(message.replace(/\s+/g, " ").trim());
  if (!normalized) return false;

  const namesVisualMedia = /\b(?:image|images|picture|pictures|photo|photos|pic|pics|visual|visuals|render|renders|upload|uploads|attachment|attachments)\b/i.test(normalized);
  const pointsBackward = /\b(?:it|its|this|that|these|those|them|one|ones|same|above|below|previous|prior|earlier|last|latest|recent)\b/i.test(normalized);
  const actsOnOrInspects = /\b(?:take|remove|add|put|change|edit|modify|replace|swap|make|turn|convert|transform|style|restyle|redo|remake|regenerate|use|reuse|keep|fix|adjust|enhance|upscale|crop|zoom|combine|mix|merge|describe|inspect|identify|recognize|read|see|show|look|tell|explain|analyze|analyse|compare|review|check|what|who|where|which|how)\b/i.test(normalized);
  const referencesDeliveredContent = /\b(?:did\s+you\s+(?:just\s+)?(?:send|make|generate|create|give|show|upload|attach|provide|share)|have\s+you\s+(?:just\s+)?(?:sent|made|generated|created|given|shown|uploaded|attached|provided|shared)|you\s+(?:just|previously|recently)\s+(?:sent|made|generated|created|gave|showed|uploaded|attached|provided|shared))\b/i.test(normalized);
  const ellipticalVisualInspection = /^(?:please\s+)?(?:just\s+|only\s+)?(?:give|tell|show|read|transcribe|extract|identify)?\s*(?:me\s+)?(?:just\s+|only\s+)?(?:the\s+)?(?:title|text|words?|name|label|caption|writing|lettering)(?:\s+(?:only|instead))?[\s.!?]*$/i.test(normalized);

  return namesVisualMedia || referencesDeliveredContent || ellipticalVisualInspection || (pointsBackward && actsOnOrInspects);
}

function shouldTrustMediaReferenceHint(
  message: string,
  hint: ConversationMediaContextOptions["mediaReferenceHint"]
): boolean {
  if (!hint || hint === "none") return false;

  // Router output is advisory. Require language that actually points back to
  // prior content before allowing a model guess to attach historical media.
  // This keeps useful elliptical follow-ups such as "take those off" while
  // preventing ordinary questions like "what is the best option" from being
  // redirected to an old image in the conversation.
  const normalized = stripLeadingFillers(message.replace(/\s+/g, " ").trim());
  const hasBackwardPointer = /\b(?:it|its|this|that|these|those|them|one|ones|same|again|above|below|previous|prior|earlier|last|latest|recent)\b/i.test(normalized);
  if (!hasBackwardPointer) return false;

  if (hint === "transform") {
    return /\b(?:take|remove|add|put|change|edit|modify|replace|swap|make|turn|convert|transform|style|restyle|redo|remake|regenerate|use|reuse|keep|fix|adjust|enhance|upscale|crop|zoom|combine|mix|merge|do|try)\b/i.test(normalized);
  }

  return /\b(?:what|who|where|which|how|why|describe|inspect|identify|recognize|read|see|show|look|tell|explain|analyze|analyse|compare|review|check|is|are|does|do|can|could)\b/i.test(normalized);
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
  /\b(edit|change|modify|update|revise|redo|remake|regenerate|rerender|re-render|recreate|rework|fix|adjust|tweak|improve|enhance|clean\s+up|touch\s+up|retouch|restore|sharpen|upscale|crop|resize|reframe|rotate|flip|mirror|extend|expand|outpaint|inpaint|remove|erase|delete|take\s+out|get\s+rid\s+of|cut\s+out|replace|swap|add|insert|include|put|make|turn|convert|transform|stylize|style|restyle|colorize|recolor|lighten|darken|brighten|blur|unblur|smooth|zoom|mix|combine|blend|merge|fuse|morph|composite|remix|mash|cross|hybridize|dress|place|move|animate|smile|frown|grin|wink|pout)\b/i,
  /\bgive\s+(?:her|him|them|it|yourself|the\s+(?:person|character|subject|woman|man|girl|boy|people|characters?))\b/i,
  /\b(?:make|try|render|show)\s+(?:it|them|that|this)\s+(?:in|as|with)\s+(?:a\s+)?(?:watercolor|oil\s+painting|sketch|anime|cartoon|photorealistic|realistic|cinematic|comic|illustration|different|new)\b/i,
  /^(more|less)\s+(realistic|cartoonish|stylized|detailed|detail|details|texture|dramatic|colorful|colourful|bright|dark|cinematic|natural|professional|polished|blurry|grainy|sharp|dull|flat|saturated|vivid|washed\s+out|badass|edgy)\b/i,
  /\b(same|keep\s+the)\s+(pose|person|character|face|subject|background|outfit|style|lighting|composition|camera|angle)\b.*\b(different|new|but|with|without|change)\b/i,
  /^(?:again|do\s+it\s+again|run\s+it\s+back|same\s+again|one\s+more(?:\s+(?:one|version|time|please))?|try\s+again|another\s+one)[\s.!?]*(?:\s*(?:but|with)\b[\s\S]*)?$/i,
  /\b(?:can\s+i\s+(?:get|have)|could\s+i\s+(?:get|have)|send\s+me|give\s+me|let\s+me\s+get)\s+(?:another|one\s+more)\b/i,
  /^(?:now\s+)?(?:with|without)\s+(?:a|an|the|her|his|their)?\s*.+/i,
  // Terse style-only follow-ups ("Now in anime style.", "In watercolor.", "Now as a cartoon").
  /^(?:(?:now|next|then|ok(?:ay)?)[\s,]+)?(?:you\s+)?(?:in|into|as)\s+(?:an?\s+)?[\w\s-]{1,32}?\b(?:style|aesthetic|look|vibe|theme|filter)\b(?:\s+and\s+[\w\s'-]{1,48})?[\s.!?]*$/i,
  /^(?:(?:now|next|then|ok(?:ay)?)[\s,]+)?(?:you\s+)?(?:in|into|as|like)\s+(?:an?\s+)?(?:anime|manga|cartoon|comic|watercolor|watercolour|oil\s+painting|sketch|pixel\s+art|photorealistic|realistic|cinematic|illustration|pop\s+art|cyberpunk|vaporwave|claymation|line\s+art|noir|ghibli|pixar|disney|3d|lego|clay)\b(?:\s+and\s+[\w\s'-]{1,48})?[\s.!?]*$/i,
  /^(?:zoom\s+(?:in|out)(?:\s+(?:a\s+)?(?:bit|little|touch|more|further|farther|closer|tighter))?|crop\s+(?:it\s+)?(?:tighter|closer)|remove\s+(?:the\s+)?background|add\s+(?:a|an|the)\s+.+|put\s+.+\s+on\s+(?:her|him|them|it))[\s.!?]*$/i,
  // Terse transform follow-ups shared with media-reference detection (see above).
  ...TERSE_VISUAL_TRANSFORM_PATTERNS
];
const MULTI_IMAGE_FOLLOW_UP_PATTERN = [
  /\b(both|the\s+two|two|pair|multiple)\b/i,
  /\b(mix|combine|blend|merge|fuse|morph|composite|remix|mash|cross|hybridize|compare|collage|montage|stitch|rank)\b.*\b(them|their|these|those|all|images?|pictures?|photos?|pics?)\b/i,
  /\b(their|these|those)\s+(faces?|features?|looks?|appearances?|designs?|characters?|subjects?|people|outfits?)\b/i,
  /\b(side[-\s]?by[-\s]?side|each\s+other)\b/i
];

export function inferConversationMediaMinimum(message: string): number {
  const normalized = message.replace(/\s+/g, " ").trim();
  return MULTI_IMAGE_FOLLOW_UP_PATTERN.some((pattern) => pattern.test(normalized)) ? 2 : 1;
}

export function inferVisualIntent(message: string): "inspect" | "transform" {
  return matchesAnyPattern(VISUAL_TRANSFORM_PATTERN, message) ? "transform" : "inspect";
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
    const normalized = currentMessage.replace(/\s+/g, " ").trim();
    const priorMessage = lastTurn?.userMessage?.replace(/\s+/g, " ").trim() ?? "";
    const priorHasVisuals = Boolean(
      lastTurn &&
      ((lastTurn.userAssets ?? []).some((asset) => asset.kind === "image") ||
        lastTurn.outputs.some(isConversationImageCandidate))
    );
    const isEllipticalInspectionFollowUp = normalized.length > 0 && normalized.length <= 180 && [
      /^(?:please\s+)?(?:just\s+|only\s+)?(?:give|tell|show|read|transcribe|extract|identify)\s+(?:me\s+)?(?:just\s+|only\s+)?(?:the\s+)?(?:title|text|words?|name|label|caption|writing|lettering|answer)(?:\s+(?:only|instead))?[\s.!?]*$/i,
      /^(?:please\s+)?(?:just\s+|only\s+)?(?:the\s+)?(?:title|text|words?|name|label|caption|writing|lettering|answer)(?:\s+(?:only|instead))?[\s.!?]*$/i,
      /^(?:so\s+)?what(?:'s|\s+is)\s+(?:the\s+)?(?:title|text|name|label|caption|writing|answer)(?:\s+then)?[\s.!?]*$/i
    ].some((pattern) => pattern.test(normalized));
    if (
      priorHasVisuals &&
      isEllipticalInspectionFollowUp &&
      priorMessage &&
      (shouldUseConversationMediaContext(priorMessage) || (lastTurn?.userAssets ?? []).some((asset) => asset.kind === "image"))
    ) {
      return `${priorMessage}\nVisual inspection follow-up: ${normalized}`;
    }
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
      url: `data:${media.mimeType};base64,${media.buffer.toString("base64")}`,
      ...(typeof image.metadata?.seed === "number" ? { seed: image.metadata.seed } : {})
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
    url: image.url,
    ...(typeof image.metadata?.seed === "number" ? { seed: image.metadata.seed } : {})
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
  const patternReferenced = shouldUseConversationMediaContext(effectiveMessage);
  const patternIntent = inferVisualIntent(effectiveMessage);
  const hint = options.mediaReferenceHint;
  // Patterns are the deterministic base; the router hint only upgrades a
  // pattern miss when the user's words also point back to prior content.
  const trustedHint = shouldTrustMediaReferenceHint(effectiveMessage, hint);
  const hintedIntent = trustedHint && hint && hint !== "none" ? hint : undefined;
  const referenced = patternReferenced || trustedHint;
  const intent = patternReferenced ? patternIntent : hintedIntent ?? patternIntent;
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
        const [asset] = await uploadService.resolveAssets(options.ownerId, [candidate.id], options.provider);
        if (!asset || asset.kind !== "image") throw new Error("Historical image upload is unavailable.");
        attachments.push(historicalUploadAttachment(asset));
      } catch (error) {
        unavailableCount += 1;
        logger.warn("Failed to resolve uploaded media for conversation context", {
          conversationId: conversation.id,
          assetId: candidate.id,
          patternReferenced,
          trustedHint,
          mediaReferenceHint: hint ?? "none",
          explicitHistoricalReference,
          effectiveMessageChanged: effectiveMessage !== options.message,
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
