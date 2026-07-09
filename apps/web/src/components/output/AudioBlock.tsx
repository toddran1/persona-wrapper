import { useProtectedMediaUrl } from "../../hooks/useProtectedMediaUrl.js";

type AudioBlockProps = {
  url: string;
  mimeType: string;
  transcript?: string | undefined;
};

export function AudioBlock({ url, mimeType }: AudioBlockProps) {
  const resolvedUrl = useProtectedMediaUrl(url);

  return (
    <div className="media-card">
      <div className="output-label">Audio</div>
      <audio controls>
        <source src={resolvedUrl} type={mimeType} />
      </audio>
    </div>
  );
}
