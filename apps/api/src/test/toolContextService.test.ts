import { describe, expect, it, vi } from "vitest";
import { ToolContextService } from "../services/toolContextService.js";

describe("ToolContextService", () => {
  it("adds client-local date context without making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const context = await new ToolContextService().buildContext("What time is it right now?", {
      locale: "en-US",
      timeZone: "America/Chicago",
      currentDateTime: "2026-07-17T20:00:00.000Z",
      utcOffsetMinutes: -300
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(context?.results[0]).toMatchObject({ name: "current_date", status: "completed" });
    expect(context?.message.content).toContain("America/Chicago");
    vi.unstubAllGlobals();
  });

  it("leaves web search to the provider's built-in tool", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const context = await new ToolContextService().buildContext("Who won the NBA finals in 2025?");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(context).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
