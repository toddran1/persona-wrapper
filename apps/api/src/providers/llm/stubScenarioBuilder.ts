import type {
  ChatMessage,
  ContentBlock,
  LLMInput,
  LLMOutput,
  PersonaDefinition,
  ProviderId,
  ToolName
} from "@persona/shared";

type StubPromptMode = "full" | "base";

function createSvgDataUrl(title: string, accent: string, accent2: string, subtitle: string, personaName: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1d0d1f" />
          <stop offset="55%" stop-color="${accent}" />
          <stop offset="100%" stop-color="${accent2}" />
        </linearGradient>
      </defs>
      <rect width="1200" height="675" fill="url(#bg)" rx="36" />
      <text x="80" y="220" fill="#fff4f0" font-size="82" font-family="Arial, sans-serif" font-weight="700">${title}</text>
      <text x="80" y="320" fill="#fff4f0" font-size="34" font-family="Arial, sans-serif">${subtitle}</text>
      <text x="80" y="560" fill="#2b0f1a" font-size="46" font-family="Arial, sans-serif" font-weight="700">${personaName}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createCsvDownload(rows: string[][]): string {
  const csv = rows.map((row) => row.join(",")).join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}

function findLastUserMessage(history: ChatMessage[]): string | undefined {
  const reversed = [...history].reverse();
  return reversed.find((message) => message.role === "user")?.content;
}

function hasKeyword(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) => message.includes(keyword));
}

function buildText(params: {
  provider: ProviderId;
  mode: StubPromptMode;
  userMessage: string;
  priorMessage?: string;
  wantsChart: boolean;
  wantsImage: boolean;
  wantsFile: boolean;
  wantsSearch: boolean;
  wantsAnalysis: boolean;
  persona: PersonaDefinition;
}): string {
  const personaName = params.persona.shortName ?? params.persona.name;
  const catchphrase = params.persona.catchphrases[0];
  const fullCallbacks: Record<ProviderId, string> = {
    openai: catchphrase ?? `${personaName} is on it.`,
    openai_persona: catchphrase ?? `${personaName} is on it.`,
    claude: `${personaName} is bringing the answer with personality.`,
    local: `${personaName} local persona mode is active.`
  };

  const baseCallbacks: Record<ProviderId, string> = {
    openai: "Here’s the answer, plain and polished.",
    openai_persona: "Here’s the answer, plain and polished.",
    claude: "Here’s the clean version with a little attitude.",
    local: "Here’s the direct version with a light persona touch."
  };

  const introPatterns = [
    "introduce yourself",
    "who are you",
    "walked into the reunion",
    "dramatic intro"
  ];
  const isIntroRequest = hasKeyword(params.userMessage.toLowerCase(), introPatterns);

  const fullCoreText = isIntroRequest
    ? `I’m ${params.persona.name}. ${params.persona.description}`
    : params.wantsChart && params.wantsFile
      ? `I lined up the requested chart and downloadable content plan in ${personaName}'s style so the result is useful and easy to follow.`
      : params.wantsChart
        ? `The chart is ready with sample reaction data, presented in ${personaName}'s configured voice.`
        : params.wantsImage
          ? `I built the visual concept around ${params.persona.visualStyle.slice(0, 3).join(", ")}.`
          : params.wantsFile
            ? "I packaged this into a downloadable plan ready for content, scripting, or rollout notes."
            : params.wantsSearch
              ? "I’d take this to search before making a claim so the answer can use current sources and timestamps."
              : params.wantsAnalysis
                ? "I analyzed the sample signals and summarized the strongest reaction and engagement patterns."
                : `Here’s the answer in ${personaName}'s configured voice: ${params.persona.speechStyle.slice(0, 2).join(" and ")}.`;

  const baseCoreText = isIntroRequest
    ? `I’m ${params.persona.name}. ${params.persona.tagline}`
    : params.wantsChart && params.wantsFile
      ? "I broke the request into a chart and a downloadable content plan so the structure is easy to follow."
      : params.wantsChart
        ? "The sample chart makes the reaction and engagement signals easy to compare."
      : params.wantsImage
          ? "The visual concept follows the persona profile and is framed as a clear campaign image."
          : params.wantsFile
            ? "I packaged this into a usable deliverable so it can move straight into planning, scripting, or content production."
            : params.wantsSearch
              ? "This should go through search before drawing a conclusion so the answer can use current evidence."
              : params.wantsAnalysis
                ? "I looked at this analytically. The strongest signals are high reaction potential, good audience engagement, and clear tension points."
                : "Here’s the answer in a confident, clean voice. It stays on-brand without turning into a full performance.";

  const memoryLine = params.priorMessage
    ? params.mode === "full"
      ? " I’m also keeping up with the thread, so this turn builds on what we were already doing instead of starting from zero."
      : " I’m also keeping the thread in view, so this answer builds on the prior turn instead of restarting the whole thing."
    : "";

  if (params.mode === "base") {
    return `${baseCallbacks[params.provider]} ${baseCoreText}${memoryLine}`;
  }

  return `${fullCallbacks[params.provider]} ${fullCoreText}${memoryLine}${catchphrase ? ` ${catchphrase}` : ""}`;
}

function maybeAddToolCall(outputs: ContentBlock[], toolName: ToolName, args: Record<string, unknown>, status: "planned" | "completed"): void {
  outputs.push({
    type: "tool_call",
    toolName,
    arguments: args,
    status
  });
}

export function buildStubOutput(input: LLMInput, provider: ProviderId, mode: StubPromptMode = "full"): LLMOutput {
  const lowerMessage = input.userMessage.toLowerCase();
  const requested = new Set(input.requestedOutputs ?? []);
  const wantsChart = requested.has("chart") || hasKeyword(lowerMessage, ["chart", "graph", "data", "breakdown", "analytics"]);
  const wantsImage = requested.has("image") || hasKeyword(lowerMessage, ["image", "poster", "cover", "look", "outfit", "photo"]);
  const wantsFile = requested.has("file") || hasKeyword(lowerMessage, [
    "csv",
    "pdf",
    "spreadsheet",
    "excel",
    "xlsx",
    "download",
    "create a file",
    "make a file",
    "generate a file"
  ]);
  const wantsJson = requested.has("json") || hasKeyword(lowerMessage, ["json", "structured", "payload"]);
  const wantsSearch = hasKeyword(lowerMessage, ["search", "find", "look up", "research", "news", "web"]);
  const wantsAnalysis = hasKeyword(lowerMessage, ["analyze", "analysis", "compare", "numbers"]);
  const wantsImageTool = hasKeyword(lowerMessage, ["generate image", "make an image", "poster", "cover art"]);
  const previousUserMessage = findLastUserMessage(input.messages.slice(0, -1));
  const outputs: ContentBlock[] = [
    {
      type: "text",
      text: buildText({
        provider,
        mode,
        userMessage: input.userMessage,
        wantsChart,
        wantsImage,
        wantsFile,
        wantsSearch,
        wantsAnalysis,
        persona: input.persona,
        ...(previousUserMessage ? { priorMessage: previousUserMessage } : {})
      })
    }
  ];

  if (wantsJson || outputs.length === 1) {
    outputs.push({
      type: "json",
      data: {
        mode: "stub",
        provider,
        personaId: input.persona.id,
        rememberedPreviousUserMessage: previousUserMessage ?? null,
        requestedOutputs: [...requested]
      }
    });
  }

  if (wantsChart) {
    outputs.push({
      type: "chart",
      title: `${input.persona.shortName ?? input.persona.name} Audience Reaction Forecast`,
      chartType: "bar",
      series: [
        { label: "Laughs", value: 91 },
        { label: "Gasps", value: 76 },
        { label: "Quotes", value: 84 }
      ]
    });
  }

  if (wantsImage) {
    outputs.push({
      type: "image",
      url: createSvgDataUrl(
        `${input.persona.shortName ?? input.persona.name} Energy`,
        input.persona.theme.accent,
        input.persona.theme.accent2,
        "Persona promo visual stub for the frontend renderer",
        input.persona.name
      ),
      alt: `Stylized ${input.persona.name} promo artwork stub`,
      prompt: `Persona promo art inspired by ${input.persona.visualStyle.slice(0, 3).join(", ")}`
    });
  }

  if (wantsFile) {
    outputs.push({
      type: "file",
      fileName: `${input.persona.id}-content-plan.csv`,
      url: createCsvDownload([
        ["segment", "hook", "tone"],
        ["intro", "Walk in hot and unbothered", "dramatic"],
        ["middle", "Escalate the tea with receipts", "funny"],
        ["outro", "Leave them quoting you", "confident"]
      ]),
      mimeType: "text/csv",
      description: "Stubbed downloadable content plan for short-form scripting."
    });
  }

  if (wantsSearch) {
    maybeAddToolCall(outputs, "web_search", { query: input.userMessage }, "planned");
  }

  if (wantsAnalysis) {
    maybeAddToolCall(outputs, "data_analysis", { task: input.userMessage, datasetRef: "stub://audience-signals" }, "completed");
  }

  if (wantsImageTool) {
    maybeAddToolCall(outputs, "image_generation", {
      prompt: input.userMessage,
      style: input.persona.visualStyle.slice(0, 3).join(", ") || "persona profile"
    }, "planned");
  }

  return {
    provider,
    rawText: `${input.persona.name} stub response generated for ${provider}.`,
    content: outputs,
    usage: {
      inputTokens: 140 + input.messages.length * 18,
      outputTokens: 80 + outputs.length * 24
    },
    metadata: {
      providerModel: `stub-${provider}-model`,
      promptTrack: mode,
      scenarioFlags: {
        wantsChart,
        wantsImage,
        wantsFile,
        wantsSearch,
        wantsAnalysis
      }
    }
  };
}
