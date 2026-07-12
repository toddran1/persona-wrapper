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

  it("falls back to Wikipedia summaries when DuckDuckGo has no concise result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ Answer: "", AbstractText: "", RelatedTopics: [] }))
      .mockResolvedValueOnce(createHtmlResponse(""))
      .mockResolvedValueOnce(
        createJsonResponse({
          query: {
            search: [
              {
                title: "2009 World Series",
                snippet: "The 2009 World Series was the championship series of Major League Baseball."
              }
            ]
          }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          extract:
            "The 2009 World Series was contested between the Philadelphia Phillies and the New York Yankees. The Yankees defeated the Phillies, 4 games to 2.",
          content_urls: {
            desktop: {
              page: "https://en.wikipedia.org/wiki/2009_World_Series"
            }
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = await new ToolContextService().buildContext("Who won the MLB 2009 World Series?");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(context?.results[0]?.name).toBe("web_search");
    expect(context?.results[0]?.status).toBe("completed");
    expect(context?.message.content).toContain("The Yankees defeated the Phillies, 4 games to 2");
    expect(context?.message.content).toContain("2009 World Series");
  });

  it("continues to the next search source when an earlier source fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Instant Answer unavailable"))
      .mockResolvedValueOnce(
        createHtmlResponse(`
          <a class="result__a" href="https://example.com/weather">Dallas forecast</a>
          <a class="result__snippet">A clear forecast is available for Dallas.</a>
        `)
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = await new ToolContextService().buildContext("What is the weather in Dallas tomorrow?");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(context?.results[0]).toMatchObject({ name: "web_search", status: "completed" });
    expect(context?.message.content).toContain("Dallas forecast");
  });

  it("does not run web search for stable evergreen questions", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const context = await new ToolContextService().buildContext("What is the capital of France?");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(context).toBeUndefined();
  });
});
