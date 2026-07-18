import type { ChatMessage, ClientContext } from "@persona/shared";

type ToolContextResult = {
  name: "current_date" | "user_location";
  status: "completed" | "skipped";
  summary: string;
};

export type ToolContext = {
  message: ChatMessage;
  results: ToolContextResult[];
};

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

export class ToolContextService {
  async buildContext(userMessage: string, clientContext?: ClientContext): Promise<ToolContext | undefined> {
    const results: ToolContextResult[] = [];

    if (DATE_PATTERN.test(userMessage)) {
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

    if (results.length === 0) return undefined;

    return {
      message: {
        role: "user",
        content: [
          "Tool context for the next answer:",
          "Use these client-provided results as authoritative context when answering the user.",
          "Web search is handled by the provider's built-in search tool and is not included here.",
          "",
          ...results.map((result) => `Tool: ${result.name}\nStatus: ${result.status}\n${result.summary}`)
        ].join("\n")
      },
      results
    };
  }
}
