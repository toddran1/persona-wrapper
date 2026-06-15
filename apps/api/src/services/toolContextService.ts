import type { ChatMessage, ClientContext } from "@persona/shared";

type ToolContextResult = {
  name: "current_date" | "user_location" | "web_search";
  status: "completed" | "failed" | "skipped";
  summary: string;
  data?: unknown;
};

export type ToolContext = {
  message: ChatMessage;
  results: ToolContextResult[];
};

const CURRENT_INFO_PATTERN =
  /\b(latest|recent|news|current events|current information|current|right now|as of|this year|last year|newest|most recent)\b/i;
const WEB_SEARCH_PATTERN = /\b(web search|internet search|search the web|look up|google|online|browse|internet)\b/i;
const DATE_PATTERN = /\b(today|current date|what date|what day|current time|date of today|what time|time is it|right now)\b/i;
const LOCATION_PATTERN = /\b(my location|where am i|where i am|near me|nearby|local to me|in my area)\b/i;
const EVENT_RESULT_PATTERN =
  /\b(who won|winner|won the|champion|championship|finals|top\s*\d+|standings|score|scores|election|results?|official event|lineup|roster|schedule|release date)\b/i;
const STALE_CUTOFF_YEAR = 2023;

function formatCurrentDate(clientContext?: ClientContext): string {
  const date = clientContext?.currentDateTime ? new Date(clientContext.currentDateTime) : new Date();
  const timeZone = clientContext?.timeZone ?? "America/Chicago";
  const locale = clientContext?.locale ?? "en-US";

  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function shouldRunDateTool(message: string): boolean {
  return DATE_PATTERN.test(message);
}

function shouldRunWebSearch(message: string): boolean {
  return (
    WEB_SEARCH_PATTERN.test(message) ||
    hasPostCutoffYear(message) ||
    EVENT_RESULT_PATTERN.test(message) ||
    (CURRENT_INFO_PATTERN.test(message) && !shouldRunDateTool(message))
  );
}

function hasPostCutoffYear(message: string): boolean {
  const currentYear = new Date().getFullYear();
  const years = message.match(/\b20\d{2}\b/g) ?? [];
  return years.some((year) => {
    const numericYear = Number(year);
    return numericYear > STALE_CUTOFF_YEAR && numericYear <= currentYear + 1;
  });
}

function normalizeSearchQuery(message: string): string {
  return message
    .replace(/\b(can you|please|do an?|internet search|web search|search the web|look up|google|online|browse)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenRelatedTopics(topics: unknown): string[] {
  if (!Array.isArray(topics)) {
    return [];
  }

  const results: string[] = [];
  for (const topic of topics) {
    if (!topic || typeof topic !== "object") {
      continue;
    }

    const maybeText = "Text" in topic ? topic.Text : undefined;
    if (typeof maybeText === "string" && maybeText.trim()) {
      results.push(maybeText.trim());
    }

    const nested = "Topics" in topic ? topic.Topics : undefined;
    results.push(...flattenRelatedTopics(nested));
  }

  return results;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, codePoint: string) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint: string) => String.fromCodePoint(parseInt(codePoint, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "));
}

function extractDuckDuckGoResults(html: string): string[] {
  const results: string[] = [];
  const resultPattern =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(resultPattern)) {
    const rawUrl = decodeHtml(match[1] ?? "");
    const title = stripHtml(match[2] ?? "");
    const snippet = stripHtml(match[3] ?? "");
    const url = normalizeDuckDuckGoUrl(rawUrl);
    const parts = [title, snippet, url].filter(Boolean);

    if (title && snippet) {
      results.push(parts.join(" - "));
    }

    if (results.length >= 5) {
      break;
    }
  }

  return results;
}

function normalizeDuckDuckGoUrl(rawUrl: string): string {
  if (!rawUrl) {
    return "";
  }

  try {
    const url = rawUrl.startsWith("//")
      ? new URL(`https:${rawUrl}`)
      : rawUrl.startsWith("/")
        ? new URL(rawUrl, "https://duckduckgo.com")
        : new URL(rawUrl);
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.toString();
  } catch {
    return rawUrl;
  }
}

async function runDuckDuckGoInstantAnswer(query: string): Promise<string[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo Instant Answer failed with status ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const abstractText = typeof payload.AbstractText === "string" ? payload.AbstractText.trim() : "";
  const answer = typeof payload.Answer === "string" ? payload.Answer.trim() : "";
  const relatedTopics = flattenRelatedTopics(payload.RelatedTopics).slice(0, 3);

  return [answer, abstractText, ...relatedTopics].filter(Boolean);
}

async function runDuckDuckGoHtmlSearch(query: string): Promise<string[]> {
  const body = new URLSearchParams({
    q: query,
    kl: "us-en"
  });

  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "persona-wrapper-app/0.1"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML search failed with status ${response.status}`);
  }

  return extractDuckDuckGoResults(await response.text());
}

function buildSearchQueries(message: string): string[] {
  const normalized = normalizeSearchQuery(message) || message;
  const targetedCandidates: string[] = [];
  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  const year = yearMatch?.[1];

  if (year && /\bworld series\b/i.test(normalized)) {
    targetedCandidates.push(`${year} World Series`);
  }

  if (year && /\bnba finals\b/i.test(normalized)) {
    targetedCandidates.push(`${year} NBA Finals`);
  }

  if (year && /\bsuper bowl\b/i.test(normalized)) {
    targetedCandidates.push(`${year} Super Bowl`);
  }

  if (year && /\bstanley cup\b/i.test(normalized)) {
    targetedCandidates.push(`${year} Stanley Cup Finals`);
  }

  const candidates = [...targetedCandidates, normalized];
  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

function wikipediaPageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
}

async function runWikipediaSummary(title: string): Promise<string | undefined> {
  const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
    headers: {
      accept: "application/json",
      "user-agent": "persona-wrapper-app/0.1"
    }
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const extract = typeof payload.extract === "string" ? payload.extract.trim() : "";
  const contentUrls = payload.content_urls;
  const desktopUrl =
    contentUrls && typeof contentUrls === "object" && "desktop" in contentUrls
      ? (contentUrls.desktop as Record<string, unknown> | undefined)?.page
      : undefined;
  const url = typeof desktopUrl === "string" ? desktopUrl : wikipediaPageUrl(title);

  return extract ? `${title}: ${extract} - ${url}` : undefined;
}

async function runWikipediaSearch(query: string): Promise<string[]> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", "3");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "persona-wrapper-app/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Wikipedia search failed with status ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const queryPayload = payload.query;
  const searchResults =
    queryPayload && typeof queryPayload === "object" && "search" in queryPayload && Array.isArray(queryPayload.search)
      ? queryPayload.search
      : [];

  const results: string[] = [];
  for (const result of searchResults.slice(0, 3)) {
    if (!result || typeof result !== "object" || !("title" in result) || typeof result.title !== "string") {
      continue;
    }

    const summary = await runWikipediaSummary(result.title);
    if (summary) {
      results.push(summary);
      continue;
    }

    const snippet = "snippet" in result && typeof result.snippet === "string" ? stripHtml(result.snippet) : "";
    if (snippet) {
      results.push(`${result.title}: ${snippet} - ${wikipediaPageUrl(result.title)}`);
    }
  }

  return results;
}

async function runWebSearch(userMessage: string): Promise<ToolContextResult> {
  const queries = buildSearchQueries(userMessage);
  const primaryQuery = queries[0] ?? userMessage;
  const summaryParts: string[] = [];
  const sources: string[] = [];

  try {
    for (const query of queries) {
      if (summaryParts.length >= 5) {
        break;
      }

      const instantResults = await runDuckDuckGoInstantAnswer(query);
      if (instantResults.length > 0) {
        summaryParts.push(...instantResults);
        sources.push("DuckDuckGo Instant Answer API");
      } else {
        const htmlResults = await runDuckDuckGoHtmlSearch(query);
        if (htmlResults.length > 0) {
          summaryParts.push(...htmlResults);
          sources.push("DuckDuckGo HTML results");
        } else {
          const wikipediaResults = await runWikipediaSearch(query);
          if (wikipediaResults.length > 0) {
            summaryParts.push(...wikipediaResults);
            sources.push("Wikipedia search and page summaries");
          }
        }
      }

      if (summaryParts.length > 0) {
        break;
      }
    }

    return {
      name: "web_search",
      status: summaryParts.length > 0 ? "completed" : "skipped",
      summary:
        summaryParts.length > 0
          ? `Web search results for "${primaryQuery}":\n- ${summaryParts.slice(0, 5).join("\n- ")}`
          : `Web search ran for "${primaryQuery}", but returned no concise result. Answer cautiously and say if the result is unavailable.`,
      data: {
        query: primaryQuery,
        attemptedQueries: queries,
        source: [...new Set(sources)].join(", ") || "DuckDuckGo and Wikipedia"
      }
    };
  } catch (error) {
    return {
      name: "web_search",
      status: "failed",
      summary: `Web search failed for query "${primaryQuery}": ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export class ToolContextService {
  async buildContext(userMessage: string, clientContext?: ClientContext, skipWebSearch = false): Promise<ToolContext | undefined> {
    const results: ToolContextResult[] = [];

    if (shouldRunDateTool(userMessage)) {
      results.push({
        name: "current_date",
        status: "completed",
        summary: `Current date/time from the user's browser context: ${formatCurrentDate(clientContext)}. Time zone: ${
          clientContext?.timeZone ?? "unknown"
        }. Locale: ${clientContext?.locale ?? "unknown"}.`
      });
    }

    if (LOCATION_PATTERN.test(userMessage)) {
      const location = clientContext?.location;
      results.push({
        name: "user_location",
        status: location ? "completed" : "skipped",
        summary: location
          ? `User browser location coordinates: latitude ${location.latitude}, longitude ${location.longitude}, accuracy ${
              location.accuracyMeters ?? "unknown"
            } meters.`
          : "No browser geolocation was provided. Ask the user for their city or enable location sharing before answering location-specific questions."
      });
    }

    if (!skipWebSearch && shouldRunWebSearch(userMessage)) {
      results.push(await runWebSearch(userMessage));
    }

    if (results.length === 0) {
      return undefined;
    }

    const content = [
      "Tool context for the next answer:",
      "Use these tool results as authoritative context when answering the user.",
      "If current date/time is provided here, do not say you lack access to the current date.",
      "If user timezone or location context is provided, use it for local time and local recommendations.",
      "If web search failed or returned no useful result, say that plainly instead of inventing facts.",
      "",
      ...results.map((result) => `Tool: ${result.name}\nStatus: ${result.status}\n${result.summary}`)
    ].join("\n");

    return {
      message: {
        role: "user",
        content
      },
      results
    };
  }
}
