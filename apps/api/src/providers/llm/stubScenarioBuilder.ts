import type {
  ChatMessage,
  ContentBlock,
  LLMInput,
  LLMOutput,
  ProviderId,
  ToolName
} from "@persona/shared";

type StubPromptMode = "full" | "base";

function createSvgDataUrl(title: string, accent: string, subtitle: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1d0d1f" />
          <stop offset="55%" stop-color="${accent}" />
          <stop offset="100%" stop-color="#ffc857" />
        </linearGradient>
      </defs>
      <rect width="1200" height="675" fill="url(#bg)" rx="36" />
      <text x="80" y="220" fill="#fff4f0" font-size="82" font-family="Arial, sans-serif" font-weight="700">${title}</text>
      <text x="80" y="320" fill="#fff4f0" font-size="34" font-family="Arial, sans-serif">${subtitle}</text>
      <text x="80" y="560" fill="#2b0f1a" font-size="46" font-family="Arial, sans-serif" font-weight="700">LaRae the Baddest</text>
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
}): string {
  const fullCallbacks: Record<ProviderId, string> = {
    openai: "Baby, let me set this all the way off.",
    claude: "Let me deliver this with style and just enough menace.",
    local: "Local mode, full chaos, no excuses."
  };

  const baseCallbacks: Record<ProviderId, string> = {
    openai: "Here’s the answer, plain and polished.",
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
    ? "I’m LaRae the Baddest, the glam disaster everybody stares at when I enter the room. I talk big, dress expensive, and turn one little side-eye into a full season finale."
    : params.wantsChart && params.wantsFile
      ? "Here’s the breakdown, baby: the chaos is high, the energy is messy, and the entertainment value is absolutely carrying the whole room. I lined it up with a chart and a downloadable content plan so the girls can follow along."
      : params.wantsChart
        ? "The chaos level is loud, unstable, and thriving. The chart lays it out clean: laughs are strong, gasps are steady, and quotable mess is doing exactly what it needs to do."
        : params.wantsImage
          ? "I gave this a full visual fantasy: glossy, dramatic, and camera-hungry. The image concept is built to feel like a promo drop right before the reunion airs."
          : params.wantsFile
            ? "I packaged this into something useful, not just cute. You’ve got a downloadable plan ready to shape into content, scripting, or rollout notes."
            : params.wantsSearch
              ? "I’d take this to search before I run my mouth too hard, because if we’re gathering tea, we need receipts and timestamps."
              : params.wantsAnalysis
                ? "I looked at this like a proper mess audit. The signals say high drama, strong reaction potential, and enough tension to keep people watching."
                : "Here’s the vibe: bold, funny, a little reckless, and fully on-brand. I’m giving you a confident answer, not a timid little placeholder.";

  const baseCoreText = isIntroRequest
    ? "I’m LaRae the Baddest. I’m confident, quick with a read, and never short on presence, but I can still answer directly when that’s what the moment needs."
    : params.wantsChart && params.wantsFile
      ? "The rollout looks high-energy and messy in a useful way. I broke it into a chart and a downloadable content plan so the structure is easy to follow."
      : params.wantsChart
        ? "The chaos level is high, but the signal is readable. The chart shows strong laughs, solid gasp potential, and plenty of quotable moments."
        : params.wantsImage
          ? "The visual concept should feel polished, dramatic, and promo-ready. I framed it as a strong campaign image rather than a vague mood board."
          : params.wantsFile
            ? "I packaged this into a usable deliverable so it can move straight into planning, scripting, or content production."
            : params.wantsSearch
              ? "This should go through search before anybody gets too loud about it. If we’re gathering tea, we need receipts and timestamps."
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

  return `${fullCallbacks[params.provider]} ${fullCoreText}${memoryLine} Clock it.`;
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
  const wantsFile = requested.has("file") || hasKeyword(lowerMessage, ["file", "csv", "pdf", "download", "script"]);
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
      title: "LaRae Audience Reaction Forecast",
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
      url: createSvgDataUrl("Baddest Energy", "#ff6b7f", "Promo visual stub for the frontend renderer"),
      alt: "Stylized LaRae promo artwork stub",
      prompt: "High-glam promo art with neon luxury energy"
    });
  }

  if (wantsFile) {
    outputs.push({
      type: "file",
      fileName: "larae-content-plan.csv",
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
    maybeAddToolCall(outputs, "image_generation", { prompt: input.userMessage, style: "luxury reality-TV promo" }, "planned");
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
