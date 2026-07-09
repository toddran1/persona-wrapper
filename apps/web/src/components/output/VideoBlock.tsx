import { useProtectedMediaUrl } from "../../hooks/useProtectedMediaUrl.js";

type VideoBlockProps = {
  url: string;
  mimeType: string;
  title?: string | undefined;
  fileName?: string | undefined;
};

export function VideoBlock({ url, mimeType, title, fileName }: VideoBlockProps) {
  const resolvedUrl = useProtectedMediaUrl(url);
  const label = title ?? fileName ?? "Generated video";

  return (
    <figure className="media-card video-card">
      <div className="output-label">Video</div>
      <video controls preload="metadata">
        <source src={resolvedUrl} type={mimeType} />
      </video>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
