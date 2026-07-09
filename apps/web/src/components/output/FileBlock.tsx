import { downloadProtectedMedia, useProtectedMediaUrl } from "../../hooks/useProtectedMediaUrl.js";

type FileBlockProps = {
  fileName: string;
  url: string;
  mimeType: string;
  description?: string | undefined;
};

export function FileBlock({ fileName, url, mimeType, description }: FileBlockProps) {
  const resolvedUrl = useProtectedMediaUrl(url);
  return (
    <div className="output-file">
      <div className="output-label">{mimeType}</div>
      <a
        href={resolvedUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.preventDefault();
          void downloadProtectedMedia(url, fileName);
        }}
      >
        {fileName}
      </a>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
