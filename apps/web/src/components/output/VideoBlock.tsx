type VideoBlockProps = {
  url: string;
  mimeType: string;
  title?: string | undefined;
  fileName?: string | undefined;
};

export function VideoBlock({ url, mimeType, title, fileName }: VideoBlockProps) {
  const resolvedUrl = url.startsWith("/") ? `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}${url}` : url;
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
