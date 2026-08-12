import { extname } from "node:path";
import { fileOutputSchema, type ContentBlock } from "@persona/shared";
import JSZip from "jszip";
import { z } from "zod";
import { openAIArtifactService } from "./openAIArtifactService.js";

const MAX_SHEETS = 10;
const MAX_COLUMNS = 100;
const MAX_ROWS = 10_000;
const MAX_TOTAL_CELLS = 250_000;
const MAX_CELL_CHARACTERS = 10_000;
const MAX_TEXT_CHARACTERS = 2_000_000;
const MAX_ZIP_FILES = 100;
const MAX_ARCHIVE_UNCOMPRESSED_CHARACTERS = 10_000_000;
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;

const artifactScalarSchema = z.union([
  z.string().max(MAX_CELL_CHARACTERS),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

const artifactSheetSchema = z.object({
  name: z.string().trim().min(1).max(31),
  columns: z.array(z.string().max(500)).min(1).max(MAX_COLUMNS),
  rows: z.array(z.array(artifactScalarSchema).max(MAX_COLUMNS)).max(MAX_ROWS)
});

const archiveFileSchema = z.object({
  path: z.string().trim().min(1).max(240),
  content: z.string().max(MAX_TEXT_CHARACTERS)
});

export const artifactGenerationArgumentsSchema = z.object({
  format: z.enum(["csv", "tsv", "xlsx", "json", "text", "markdown", "zip"]),
  fileName: z.string().trim().min(1).max(120),
  title: z.string().trim().max(300).nullable(),
  description: z.string().trim().max(1_000).nullable(),
  content: z.string().max(MAX_TEXT_CHARACTERS).nullable(),
  sheets: z.array(artifactSheetSchema).max(MAX_SHEETS),
  files: z.array(archiveFileSchema).max(MAX_ZIP_FILES)
}).superRefine((value, context) => {
  const cells = value.sheets.reduce(
    (total, sheet) => total + sheet.columns.length + sheet.rows.reduce((rowTotal, row) => rowTotal + row.length, 0),
    0
  );
  if (cells > MAX_TOTAL_CELLS) {
    context.addIssue({ code: "custom", message: `Artifacts may contain at most ${MAX_TOTAL_CELLS} cells.`, path: ["sheets"] });
  }
  if (["csv", "tsv", "xlsx"].includes(value.format) && value.sheets.length === 0) {
    context.addIssue({ code: "custom", message: "Spreadsheet artifacts require at least one sheet.", path: ["sheets"] });
  }
  for (const [sheetIndex, sheet] of value.sheets.entries()) {
    for (const [rowIndex, row] of sheet.rows.entries()) {
      if (row.length !== sheet.columns.length) {
        context.addIssue({
          code: "custom",
          message: "Every spreadsheet row must contain exactly one value for each column.",
          path: ["sheets", sheetIndex, "rows", rowIndex]
        });
      }
    }
  }
  if (["json", "text", "markdown"].includes(value.format) && value.content === null) {
    context.addIssue({ code: "custom", message: "This artifact format requires content.", path: ["content"] });
  }
  if (value.format === "json" && value.content !== null) {
    try {
      JSON.parse(value.content);
    } catch {
      context.addIssue({ code: "custom", message: "JSON artifact content must be valid JSON.", path: ["content"] });
    }
  }
  if (value.format === "zip" && value.files.length === 0) {
    context.addIssue({ code: "custom", message: "ZIP artifacts require at least one file.", path: ["files"] });
  }
  if (value.files.reduce((total, file) => total + file.content.length, 0) > MAX_ARCHIVE_UNCOMPRESSED_CHARACTERS) {
    context.addIssue({
      code: "custom",
      message: `ZIP contents may contain at most ${MAX_ARCHIVE_UNCOMPRESSED_CHARACTERS} characters in total.`,
      path: ["files"]
    });
  }
});

export type ArtifactGenerationArguments = z.infer<typeof artifactGenerationArgumentsSchema>;

const extensionByFormat: Record<ArtifactGenerationArguments["format"], string> = {
  csv: ".csv",
  tsv: ".tsv",
  xlsx: ".xlsx",
  json: ".json",
  text: ".txt",
  markdown: ".md",
  zip: ".zip"
};

function normalizedFileName(fileName: string, format: ArtifactGenerationArguments["format"]): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 110) || "artifact";
  const expected = extensionByFormat[format];
  return extname(safe).toLowerCase() === expected ? safe : `${safe.replace(/\.[^.]+$/, "")}${expected}`;
}

function delimitedValue(value: z.infer<typeof artifactScalarSchema>, delimiter: string): string {
  if (value === null) return "";
  const rawText = String(value);
  // Spreadsheet applications can interpret CSV/TSV cells beginning with these
  // characters as formulas. Treat model-produced strings as literal data.
  const text = typeof value === "string" && /^[\t\r ]*[=+@-]/.test(rawText) ? `'${rawText}` : rawText;
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function delimitedBuffer(sheet: z.infer<typeof artifactSheetSchema>, delimiter: string): Buffer {
  const lines = [sheet.columns, ...sheet.rows]
    .map((row) => row.map((value) => delimitedValue(value, delimiter)).join(delimiter));
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function worksheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const ending = ` ${suffix}`;
    candidate = `${base.slice(0, 31 - ending.length)}${ending}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function cellXml(value: z.infer<typeof artifactScalarSchema>, reference: string, header = false): string {
  if (value === null) return `<c r="${reference}"${header ? ' s="1"' : ""}/>`;
  if (typeof value === "number") return `<c r="${reference}"${header ? ' s="1"' : ""}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${reference}" t="b"${header ? ' s="1"' : ""}><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${reference}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

async function xlsxBuffer(sheets: z.infer<typeof artifactSheetSchema>[]): Promise<Buffer> {
  const zip = new JSZip();
  const names = new Set<string>();
  const resolved = sheets.map((sheet) => ({ ...sheet, name: worksheetName(sheet.name, names) }));
  const sheetOverrides = resolved.map((_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`);
  const workbookSheets = resolved.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`);
  const relationships = resolved.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${resolved.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);

  resolved.forEach((sheet, sheetIndex) => {
    const rows: z.infer<typeof artifactScalarSchema>[][] = [sheet.columns, ...sheet.rows];
    const rowXml = rows.map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => cellXml(value, `${columnName(columnIndex)}${rowIndex + 1}`, rowIndex === 0)).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    const lastColumn = columnName(sheet.columns.length - 1);
    zip.file(`xl/worksheets/sheet${sheetIndex + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${lastColumn}${rows.length}"/></worksheet>`);
  });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function safeArchivePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (
    normalized.startsWith("/")
    || /^[a-zA-Z]:/.test(normalized)
    || parts.some((part) => part === ".." || part === "" || part === ".")
    || normalized.includes("\0")
  ) {
    throw new Error(`Unsafe ZIP entry path: ${path}`);
  }
  return normalized;
}

async function zipBuffer(files: z.infer<typeof archiveFileSchema>[]): Promise<Buffer> {
  const zip = new JSZip();
  const seen = new Set<string>();
  for (const file of files) {
    const path = safeArchivePath(file.path);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate ZIP entry path: ${path}`);
    seen.add(key);
    zip.file(path, file.content);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function buildArtifactBuffer(input: ArtifactGenerationArguments): Promise<Buffer> {
  if (input.format === "csv") return delimitedBuffer(input.sheets[0]!, ",");
  if (input.format === "tsv") return delimitedBuffer(input.sheets[0]!, "\t");
  if (input.format === "xlsx") return xlsxBuffer(input.sheets);
  if (input.format === "zip") return zipBuffer(input.files);
  if (input.format === "json") return Buffer.from(`${JSON.stringify(JSON.parse(input.content!), null, 2)}\n`, "utf8");
  return Buffer.from(input.content!, "utf8");
}

export async function generateArtifact(rawArguments: unknown): Promise<ContentBlock> {
  const input = artifactGenerationArgumentsSchema.parse(rawArguments);
  const buffer = await buildArtifactBuffer(input);
  if (buffer.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error(`Generated artifacts may not exceed ${Math.round(MAX_ARTIFACT_BYTES / 1024 / 1024)} MB.`);
  }
  const fileName = normalizedFileName(input.fileName, input.format);
  const url = await openAIArtifactService.registerBuffer(buffer, fileName, {
    metadata: { storage: "application_artifact", artifactFormat: input.format }
  });
  return fileOutputSchema.parse({
    type: "file",
    fileName,
    url,
    mimeType: input.format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : input.format === "zip"
        ? "application/zip"
        : input.format === "json"
          ? "application/json"
          : input.format === "csv"
            ? "text/csv"
            : input.format === "tsv"
              ? "text/tab-separated-values"
              : input.format === "markdown"
                ? "text/markdown"
                : "text/plain",
    ...(input.description ? { description: input.description } : input.title ? { description: input.title } : {}),
    metadata: { storage: "application_artifact", artifactFormat: input.format }
  });
}
