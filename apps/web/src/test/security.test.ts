import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "../lib/security.js";

describe("safeExternalUrl", () => {
  it("allows only HTTP and HTTPS links", () => {
    expect(safeExternalUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(safeExternalUrl("http://localhost:4000/api/file")).toBe("http://localhost:4000/api/file");
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("intent://open-app")).toBeUndefined();
    expect(safeExternalUrl("not a url")).toBeUndefined();
  });
});
