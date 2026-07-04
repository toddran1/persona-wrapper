import { resolveApiUrl } from "../../lib/api.js";

type AudioBlockProps = {
  url: string;
  mimeType: string;
  transcript?: string | undefined;
};

export function AudioBlock({ url, mimeType }: AudioBlockProps) {
  const resolvedUrl = resolveApiUrl(url);

  return (
    <div className="media-card">
      <div className="output-label">Audio</div>
      <audio controls>
        <source src={resolvedUrl} type={mimeType} />
      </audio>
    </div>
  );
}
