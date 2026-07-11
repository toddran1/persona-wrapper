import { basename } from "node:path";

export function contentDisposition(disposition: "attachment" | "inline", fileName: string): string {
  const safeName = basename(fileName)
    .replace(/[\u0000-\u001f\u007f"\\]/g, "_")
    .slice(0, 180) || "download";
  return `${disposition}; filename="${safeName}"`;
}
