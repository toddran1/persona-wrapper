const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function trimTrailingPunctuation(value: string): string {
  let candidate = value;
  while (/[.,!?;:]$/.test(candidate)) candidate = candidate.slice(0, -1);
  while (candidate.endsWith(")") &&
    (candidate.match(/\(/g)?.length ?? 0) < (candidate.match(/\)/g)?.length ?? 0)) {
    candidate = candidate.slice(0, -1);
  }
  while (candidate.endsWith("]") &&
    (candidate.match(/\[/g)?.length ?? 0) < (candidate.match(/\]/g)?.length ?? 0)) {
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}

export function extractHttpUrls(message: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of message.matchAll(HTTP_URL_PATTERN)) {
    const candidate = trimTrailingPunctuation(match[0]);
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      const normalized = parsed.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
    } catch {
      // Invalid URL-like text remains ordinary prompt text.
    }
  }
  return urls;
}

export function youtubeVideoId(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let candidate: string | null | undefined;
  if (hostname === "youtu.be") {
    candidate = parsed.pathname.split("/").filter(Boolean)[0];
  } else if (hostname === "youtube.com" || hostname.endsWith(".youtube.com") ||
    hostname === "youtube-nocookie.com" || hostname.endsWith(".youtube-nocookie.com")) {
    if (parsed.pathname === "/watch") {
      candidate = parsed.searchParams.get("v");
    } else {
      const [kind, id] = parsed.pathname.split("/").filter(Boolean);
      if (kind === "shorts" || kind === "embed" || kind === "live") candidate = id;
    }
  }
  return candidate && YOUTUBE_VIDEO_ID_PATTERN.test(candidate) ? candidate : undefined;
}

export type UrlInputKind = "youtube_video" | "web_page" | "image" | "document" | "audio" | "video" | "unknown";

const EXTENSION_KIND: Array<[RegExp, UrlInputKind]> = [
  [/\.(?:avif|gif|jpe?g|png|webp)$/i, "image"],
  [/\.(?:pdf|docx?|xlsx?|pptx?|csv|tsv|txt|rtf)$/i, "document"],
  [/\.(?:aac|flac|m4a|mp3|ogg|opus|wav)$/i, "audio"],
  [/\.(?:m4v|mkv|mov|mp4|webm)$/i, "video"]
];

export function classifyHttpUrl(value: string): UrlInputKind {
  if (youtubeVideoId(value)) return "youtube_video";
  try {
    const pathname = new URL(value).pathname;
    for (const [pattern, kind] of EXTENSION_KIND) {
      if (pattern.test(pathname)) return kind;
    }
    return "web_page";
  } catch {
    return "unknown";
  }
}

export function extractYouTubeVideoUrls(message: string): string[] {
  const urls: string[] = [];
  const seenIds = new Set<string>();
  for (const url of extractHttpUrls(message)) {
    const id = youtubeVideoId(url);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    urls.push(`https://www.youtube.com/watch?v=${id}`);
  }
  return urls;
}

export function containsHttpUrl(message: string): boolean {
  return extractHttpUrls(message).length > 0;
}
