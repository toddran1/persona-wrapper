import { describe, expect, it, vi } from "vitest";
import { LinkResolutionService } from "../services/linkResolutionService.js";

function publicOnly(): (url: URL) => Promise<void> {
  return async () => undefined;
}

describe("LinkResolutionService", () => {
  it("extracts bounded readable context from an accessible web page", async () => {
    const fetchMock = vi.fn(async () => new Response(`
      <html><head><title>Example story</title><script>ignore me</script></head>
      <body><main><h1>Important headline</h1><p>Verified article text.</p></main></body></html>
    `, { headers: { "content-type": "text/html; charset=utf-8" } }));
    const service = new LinkResolutionService({ fetch: fetchMock, assertPublicUrl: publicOnly() });

    const [link] = await service.resolveMessage("Summarize https://example.com/story");

    expect(link).toMatchObject({
      canonicalUrl: "https://example.com/story",
      kind: "web_page",
      status: "accessible",
      title: "Example story",
      resolutionMethod: "direct_fetch"
    });
    expect(link?.extractedText).toContain("Important headline");
    expect(link?.extractedText).not.toContain("ignore me");
  });

  it("preserves malformed numeric entities without failing page inspection", async () => {
    const service = new LinkResolutionService({
      fetch: vi.fn(async () => new Response(
        "<title>Malformed &#99999999; title</title><p>Readable text &#x110000; and &#55296; remains.</p>",
        { headers: { "content-type": "text/html" } }
      )),
      assertPublicUrl: publicOnly()
    });

    const result = await service.resolve("https://example.com/malformed-entities");

    expect(result).toMatchObject({ status: "accessible", title: "Malformed &#99999999; title" });
    expect(result.extractedText).toContain("Readable text &#x110000;");
    expect(result.extractedText).toContain("&#55296;");
  });

  it("canonicalizes YouTube links and adds verified captions when available", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      title: "A real video",
      author_name: "Example channel"
    }), { headers: { "content-type": "application/json" } }));
    const service = new LinkResolutionService({
      fetch: fetchMock,
      assertPublicUrl: publicOnly(),
      youtubeTranscript: {
        fetch: vi.fn(async () => ({ text: "Verified spoken words.", language: "en", segmentCount: 1 }))
      }
    });

    const [link] = await service.resolveMessage("Tell me about https://youtu.be/0Y4FoTy0Bf0?feature=share");

    expect(link).toMatchObject({
      canonicalUrl: "https://www.youtube.com/watch?v=0Y4FoTy0Bf0",
      kind: "youtube_video",
      status: "accessible",
      title: "A real video",
      providerInputUrl: "https://www.youtube.com/watch?v=0Y4FoTy0Bf0"
    });
    expect(link?.detail).toContain("metadata and captions");
    expect(link?.extractedText).toContain("Verified spoken words");
  });

  it("downloads bounded binary content and strips authorization on a cross-origin redirect", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.com/file.pdf" }
      }))
      .mockResolvedValueOnce(new Response(Buffer.from("%PDF-1.7\n"), {
        headers: { "content-type": "application/pdf" }
      }));
    const service = new LinkResolutionService({ fetch: fetchMock, assertPublicUrl: publicOnly() });

    const downloaded = await service.download("https://files.example.com/file", {
      maximumBytes: 1024,
      headers: { Authorization: "Bearer private-token" }
    });

    expect(downloaded.mimeType).toBe("application/pdf");
    expect(downloaded.buffer.toString()).toContain("%PDF");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer private-token" });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty("Authorization");
  });

  it("reuses a recent link for an explicit follow-up reference", async () => {
    const fetchMock = vi.fn(async () => new Response("<title>Linked article</title><p>Useful facts</p>", {
      headers: { "content-type": "text/html" }
    }));
    const service = new LinkResolutionService({ fetch: fetchMock, assertPublicUrl: publicOnly() });

    const links = await service.resolveMessage("What else does that article say?", [
      "Read https://example.com/article"
    ]);

    expect(links).toHaveLength(1);
    expect(links[0]?.title).toBe("Linked article");
  });

  it("uses links from only the nearest relevant message for an explicit follow-up", async () => {
    const fetchedUrls: string[] = [];
    const service = new LinkResolutionService({
      fetch: vi.fn(async (input) => {
        fetchedUrls.push(String(input));
        return new Response("<p>Useful facts</p>", { headers: { "content-type": "text/html" } });
      }),
      assertPublicUrl: publicOnly()
    });

    const links = await service.resolveMessage("Open the link you gave me.", [
      "Older suggestion: https://old.example.com/article",
      "Newest suggestion: https://new.example.com/article"
    ]);

    expect(links).toHaveLength(1);
    expect(links[0]?.canonicalUrl).toBe("https://new.example.com/article");
    expect(fetchedUrls).toEqual(["https://new.example.com/article"]);
  });

  it("collects several recent links for an explicit plural follow-up", async () => {
    const service = new LinkResolutionService({
      fetch: vi.fn(async () => new Response("<p>Useful facts</p>", {
        headers: { "content-type": "text/html" }
      })),
      assertPublicUrl: publicOnly()
    });

    const links = await service.resolveMessage("Compare those links for me.", [
      "First option: https://one.example.com/article",
      "Second option: https://two.example.com/article"
    ]);

    expect(links.map((link) => link.canonicalUrl)).toEqual([
      "https://two.example.com/article",
      "https://one.example.com/article"
    ]);
  });

  it("blocks loopback URLs before network access", async () => {
    const fetchMock = vi.fn();
    const service = new LinkResolutionService({ fetch: fetchMock });

    const [link] = await service.resolveMessage("Open http://127.0.0.1:4000/private");

    expect(link).toMatchObject({ status: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks URLs containing embedded credentials before network access", async () => {
    const fetchMock = vi.fn();
    const service = new LinkResolutionService({ fetch: fetchMock });

    const [link] = await service.resolveMessage("Open https://user:secret@example.com/private");

    expect(link).toMatchObject({ status: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses an honest temporary status when fetching fails", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("<p>Recovered</p>", { headers: { "content-type": "text/html" } }));
    const service = new LinkResolutionService({
      fetch: fetchMock,
      assertPublicUrl: publicOnly()
    });

    const [link] = await service.resolveMessage("Check https://example.com/outage");
    const [retriedLink] = await service.resolveMessage("Check https://example.com/outage");

    expect(link).toMatchObject({ status: "temporarily_unavailable" });
    expect(link?.detail).toContain("does not prove");
    expect(retriedLink).toMatchObject({ status: "accessible" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects excessively long URLs without network access", async () => {
    const fetchMock = vi.fn();
    const service = new LinkResolutionService({ fetch: fetchMock, assertPublicUrl: publicOnly() });

    const result = await service.resolve(`https://example.com/?value=${"x".repeat(4_100)}`);

    expect(result).toMatchObject({ status: "unsupported" });
    expect(result.detail).toContain("inspection limit");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revalidates every redirect destination", async () => {
    const assertedHosts: string[] = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.example.com/page" } }))
      .mockResolvedValueOnce(new Response("<p>Final page</p>", { headers: { "content-type": "text/html" } }));
    const service = new LinkResolutionService({
      fetch: fetchMock,
      assertPublicUrl: async (url) => {
        assertedHosts.push(url.hostname);
      }
    });

    const result = await service.resolve("https://example.com/start");

    expect(result.status).toBe("accessible");
    expect(assertedHosts).toEqual(["example.com", "cdn.example.com"]);
  });

  it("classifies a successful private-document sign-in page as blocked", async () => {
    const service = new LinkResolutionService({
      fetch: vi.fn(async () => new Response(
        "<html><title>Sign in</title><p>Sign in with your Google Account to access this file.</p></html>",
        { headers: { "content-type": "text/html" } }
      )),
      assertPublicUrl: publicOnly()
    });

    const result = await service.resolve("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view");

    expect(result).toMatchObject({ status: "blocked" });
    expect(result.detail).toContain("sign-in page");
  });
});
