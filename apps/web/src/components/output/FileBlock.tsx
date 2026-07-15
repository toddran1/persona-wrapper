import { downloadProtectedMedia, useProtectedMediaUrl } from "../../hooks/useProtectedMediaUrl.js";

type FileBlockProps = {
  fileName: string;
  url: string;
  mimeType: string;
  description?: string | undefined;
};

function fileKind(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "xlsx" || extension === "xls" || extension === "csv") return "Spreadsheet";
  if (extension === "pdf") return "PDF document";
  if (extension === "docx" || extension === "doc") return "Document";
  if (extension === "pptx" || extension === "ppt") return "Presentation";
  return "Generated file";
}

export function FileBlock({ fileName, url }: FileBlockProps) {
  const resolvedUrl = useProtectedMediaUrl(url);
  return (
    <div className="output-file">
      <div className="output-file-kind">{fileKind(fileName)}</div>
      <a
        href={resolvedUrl}
        target="_blank"
        rel="noreferrer"
        className="output-file-name"
        onClick={(event) => {
          event.preventDefault();
          void downloadProtectedMedia(url, fileName);
        }}
      >
        {fileName}
      </a>
      <button
        type="button"
        className="output-file-download"
        onClick={() => void downloadProtectedMedia(url, fileName)}
      >
        Download
      </button>
    </div>
  );
}
