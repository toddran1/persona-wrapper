import { describe, expect, it } from "vitest";
import { containsHttpUrl, extractHttpUrls, extractYouTubeVideoUrls } from "../services/urlInputService.js";

describe("URL input service", () => {
  it("normalizes supported YouTube URL forms and removes tracking parameters", () => {
    expect(extractYouTubeVideoUrls([
      "Tell me about https://youtu.be/0Y4FoTy0Bf0?is=tracking",
      "and https://www.youtube.com/watch?v=0Y4FoTy0Bf0&feature=share",
      "plus https://youtube.com/shorts/abcdefghijk?si=tracking."
    ].join(" "))).toEqual([
      "https://www.youtube.com/watch?v=0Y4FoTy0Bf0",
      "https://www.youtube.com/watch?v=abcdefghijk"
    ]);
  });

  it("does not treat lookalike hosts or malformed video IDs as YouTube input", () => {
    expect(extractYouTubeVideoUrls(
      "https://youtube.com.example/watch?v=0Y4FoTy0Bf0 https://youtu.be/too-short"
    )).toEqual([]);
  });

  it("extracts ordinary public URLs without swallowing sentence punctuation", () => {
    expect(extractHttpUrls("Read (https://example.com/article?q=one), then reply."))
      .toEqual(["https://example.com/article?q=one"]);
    expect(containsHttpUrl("No link here.")).toBe(false);
  });
});
