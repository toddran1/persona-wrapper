import { describe, expect, it } from "vitest";
import {
  AuthenticatedLinkConnectorService,
  googleDriveFileId
} from "../services/authenticatedLinkConnectorService.js";

describe("authenticated link connector parsing", () => {
  it.each([
    "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
    "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit",
    "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit"
  ])("extracts a Google Drive file ID from %s", (url) => {
    expect(googleDriveFileId(url)).toBe("1AbCdEfGhIjKlMnOp");
  });

  it("does not classify lookalike domains as Google Drive", () => {
    expect(googleDriveFileId("https://drive.google.com.attacker.example/file/d/1AbCdEfGhIjKlMnOp/view"))
      .toBeUndefined();
  });

  it("turns a public Dropbox share into a direct-download import without cookies", async () => {
    const service = new AuthenticatedLinkConnectorService();

    const result = await service.resolve("user_one", "https://www.dropbox.com/s/example/report.pdf?dl=0");

    expect(result).toMatchObject({ status: "download", provider: "dropbox" });
    expect(result && result.status === "download" ? new URL(result.url).searchParams.get("dl") : undefined)
      .toBe("1");
    expect(result && result.status === "download" ? result.headers : undefined).toBeUndefined();
  });

  it("requires an official connector for private social-media content", async () => {
    const service = new AuthenticatedLinkConnectorService();

    const result = await service.resolve("user_one", "https://www.instagram.com/p/example/");

    expect(result).toMatchObject({
      status: "authorization_required",
      provider: "social_media"
    });
    expect(result && result.status === "authorization_required" ? result.detail : "").toContain("browser cookies");
  });
});
