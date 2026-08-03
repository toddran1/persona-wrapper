import { describe, expect, it } from "vitest";
import { displayTextFromDualText, parseDualTextPayload } from "../providers/llm/OpenAIProvider.js";

describe("OpenAI inline TTS payload parsing", () => {
  it("parses visible text and hidden TTS script from strict JSON", () => {
    const result = parseDualTextPayload(JSON.stringify({
      visible_text: "Dallas is loud as hell.",
      tts_script: "Dallas is loud as hell..."
    }));

    expect(result.status).toBe("parsed");
    expect(result.payload).toEqual({
      visibleText: "Dallas is loud as hell.",
      ttsScript: "Dallas is loud as hell..."
    });
  });

  it("accepts accidental markdown-fenced JSON", () => {
    const result = parseDualTextPayload("```json\n{\"visible_text\":\"Hey baby\",\"tts_script\":\"Hey baby...\"}\n```");

    expect(result.status).toBe("parsed");
    expect(result.payload?.visibleText).toBe("Hey baby");
    expect(result.payload?.ttsScript).toBe("Hey baby...");
  });

  it("treats normal text as not requested", () => {
    const result = parseDualTextPayload("Just a normal answer.");

    expect(result.status).toBe("not_requested");
    expect(result.payload).toBeUndefined();
    expect(displayTextFromDualText("Just a normal answer.")).toBe("Just a normal answer.");
  });

  it("hides malformed JSON behind a recoverable display message", () => {
    const result = parseDualTextPayload("{\"visible_text\":\"Almost there\"");

    expect(result.status).toBe("malformed_json");
    expect(displayTextFromDualText("{\"visible_text\":\"Almost there\"")).toContain("response formatting issue");
  });

  it("hides invalid dual-text payloads behind a recoverable display message", () => {
    const result = parseDualTextPayload("{\"tts_script\":\"No visible text\"}");

    expect(result.status).toBe("invalid_payload");
    expect(displayTextFromDualText("{\"tts_script\":\"No visible text\"}")).toContain("response formatting issue");
  });
});
