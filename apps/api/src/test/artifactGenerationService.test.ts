import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAIArtifactService } from "../services/openAIArtifactService.js";
import { generateArtifact } from "../services/artifactGenerationService.js";

const registerBuffer = vi.spyOn(openAIArtifactService, "registerBuffer");

afterEach(() => {
  registerBuffer.mockReset();
});

describe("artifactGenerationService", () => {
  it("creates a downloadable CSV with escaped values", async () => {
    let captured: Buffer | undefined;
    registerBuffer.mockImplementation(async (buffer) => {
      captured = buffer;
      return "/api/openai-artifacts/artifact-test";
    });

    const output = await generateArtifact({
      format: "csv",
      fileName: "quarterly report",
      title: "Quarterly report",
      description: null,
      content: null,
      sheets: [{
        name: "Revenue",
        columns: ["Quarter", "Notes"],
        rows: [["Q1", "Strong, steady"], ["Q2", "She said \"go\""], ["Q3", "=1+1"]]
      }],
      files: []
    });

    expect(output).toMatchObject({
      type: "file",
      fileName: "quarterly_report.csv",
      mimeType: "text/csv",
      url: "/api/openai-artifacts/artifact-test"
    });
    expect(captured?.toString("utf8")).toBe(
      '\uFEFFQuarter,Notes\r\nQ1,"Strong, steady"\r\nQ2,"She said ""go"""\r\nQ3,\'=1+1\r\n'
    );
  });

  it("creates a valid multi-sheet XLSX package", async () => {
    let captured: Buffer | undefined;
    registerBuffer.mockImplementation(async (buffer) => {
      captured = buffer;
      return "/api/openai-artifacts/artifact-xlsx";
    });

    await generateArtifact({
      format: "xlsx",
      fileName: "metrics.xlsx",
      title: null,
      description: null,
      content: null,
      sheets: [
        { name: "Summary", columns: ["Metric", "Value"], rows: [["Users", 12]] },
        { name: "Details", columns: ["Active"], rows: [[true]] }
      ],
      files: []
    });

    expect(captured).toBeDefined();
    const zip = await JSZip.loadAsync(captured!);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    expect(zip.file("xl/workbook.xml")).not.toBeNull();
    expect(zip.file("xl/worksheets/sheet1.xml")).not.toBeNull();
    expect(zip.file("xl/worksheets/sheet2.xml")).not.toBeNull();
    await expect(zip.file("xl/worksheets/sheet1.xml")?.async("string"))
      .resolves.toContain("Users");
  });

  it("creates ZIP archives and rejects unsafe entry paths", async () => {
    let captured: Buffer | undefined;
    registerBuffer.mockImplementation(async (buffer) => {
      captured = buffer;
      return "/api/openai-artifacts/artifact-zip";
    });

    await generateArtifact({
      format: "zip",
      fileName: "starter.zip",
      title: null,
      description: null,
      content: null,
      sheets: [],
      files: [
        { path: "src/index.js", content: "console.log('ready');\n" },
        { path: "README.md", content: "# Starter\n" }
      ]
    });

    const zip = await JSZip.loadAsync(captured!);
    await expect(zip.file("src/index.js")?.async("string"))
      .resolves.toBe("console.log('ready');\n");

    await expect(generateArtifact({
      format: "zip",
      fileName: "unsafe.zip",
      title: null,
      description: null,
      content: null,
      sheets: [],
      files: [{ path: "../secret.txt", content: "nope" }]
    })).rejects.toThrow("Unsafe ZIP entry path");
  });

  it("rejects inconsistent spreadsheet rows before writing a file", async () => {
    await expect(generateArtifact({
      format: "xlsx",
      fileName: "broken.xlsx",
      title: null,
      description: null,
      content: null,
      sheets: [{ name: "Broken", columns: ["A", "B"], rows: [[1]] }],
      files: []
    })).rejects.toThrow();
    expect(registerBuffer).not.toHaveBeenCalled();
  });
});
