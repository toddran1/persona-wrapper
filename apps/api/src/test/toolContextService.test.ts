import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolContextService } from "../services/toolContextService.js";

function createJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload
  } as Response;
}

function createHtmlResponse(html: string): Response {
  return {
    ok: true,
    text: async () => html
  } as Response;
}

describe("ToolContextService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs web search for post-cutoff sports results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ Answer: "", AbstractText: "", RelatedTopics: [] }))
      .mockResolvedValueOnce(
        createHtmlResponse(`
          <a class="result__a" href="https://example.com/nba-finals">2025 NBA Finals</a>
          <a class="result__snippet">The Oklahoma City Thunder defeated the Indiana Pacers to win the 2025 NBA Finals.</a>
        `)
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = await new ToolContextService().buildContext("What NBA team won the NBA finals in 2025?");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(context?.results[0]?.name).toBe("web_search");
    expect(context?.results[0]?.status).toBe("completed");
    expect(context?.message.content).toContain("2025 NBA Finals");
  });

  it("runs web search for official event and top-result questions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ Answer: "", AbstractText: "", RelatedTopics: [] }))
      .mockResolvedValueOnce(
        createHtmlResponse(`
          <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fevo-smash">EVO Super Smash Bros. Ultimate results</a>
          <a class="result__snippet">Super Smash Bros. Ultimate was last held as an official EVO event in 2019.</a>
        `)
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = await new ToolContextService().buildContext(
      "What was the last year Super Smash Bros. Ultimate was an official event at EVO, and who made top 8?"
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(context?.results[0]?.name).toBe("web_search");
    expect(context?.message.content).toContain("Super Smash Bros. Ultimate");
    expect(context?.message.content).toContain("https://example.com/evo-smash");
  });

  it("does not run web search for stable evergreen questions", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const context = await new ToolContextService().buildContext("What is the capital of France?");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(context).toBeUndefined();
  });
});
