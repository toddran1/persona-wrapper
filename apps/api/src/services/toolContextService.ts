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

const CURRENT_INFO_PATTERN = /\b(latest|recent|news|current events|current information)\b/i;
const WEB_SEARCH_PATTERN = /\b(web search|internet search|search the web|look up|google|online|browse|internet)\b/i;
const DATE_PATTERN = /\b(today|current date|what date|what day|current time|date of today|what time|time is it|right now)\b/i;
const LOCATION_PATTERN = /\b(my location|where am i|where i am|near me|nearby|local to me|in my area)\b/i;

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
  return WEB_SEARCH_PATTERN.test(message) || (CURRENT_INFO_PATTERN.test(message) && !shouldRunDateTool(message));
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

async function runWebSearch(userMessage: string): Promise<ToolContextResult> {
  const query = normalizeSearchQuery(userMessage) || userMessage;
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      return {
        name: "web_search",
        status: "failed",
        summary: `Web search failed with status ${response.status} for query: ${query}`
      };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const abstractText = typeof payload.AbstractText === "string" ? payload.AbstractText.trim() : "";
    const answer = typeof payload.Answer === "string" ? payload.Answer.trim() : "";
    const relatedTopics = flattenRelatedTopics(payload.RelatedTopics).slice(0, 3);
    const summaryParts = [answer, abstractText, ...relatedTopics].filter(Boolean);

    return {
      name: "web_search",
      status: summaryParts.length > 0 ? "completed" : "skipped",
      summary:
        summaryParts.length > 0
          ? `Web search results for "${query}":\n- ${summaryParts.join("\n- ")}`
          : `Web search ran for "${query}", but returned no concise result. Answer cautiously and say if the result is unavailable.`,
      data: {
        query,
        source: "DuckDuckGo Instant Answer API"
      }
    };
  } catch (error) {
    return {
      name: "web_search",
      status: "failed",
      summary: `Web search failed for query "${query}": ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export class ToolContextService {
  async buildContext(userMessage: string, clientContext?: ClientContext): Promise<ToolContext | undefined> {
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

    if (shouldRunWebSearch(userMessage)) {
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
