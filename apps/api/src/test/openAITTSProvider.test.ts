import { describe, expect, it } from "vitest";
import { larae } from "../personas/larae.persona.js";
import { OpenAITTSProvider } from "../providers/tts/OpenAITTSProvider.js";

describe("OpenAITTSProvider", () => {
  it("fails safely instead of persisting the legacy placeholder audio URL", async () => {
    await expect(new OpenAITTSProvider().synthesize({
      text: "Legacy provider request",
      persona: larae
    })).rejects.toMatchObject({
      statusCode: 503
    });
  });
});
