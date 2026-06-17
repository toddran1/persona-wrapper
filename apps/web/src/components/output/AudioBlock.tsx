type AudioBlockProps = {
  url: string;
  mimeType: string;
  transcript?: string | undefined;
};

export function AudioBlock({ url, mimeType }: AudioBlockProps) {
  const resolvedUrl = url.startsWith("/") ? `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}${url}` : url;

  return (
    <div className="media-card">
      <div className="output-label">Audio</div>
      <audio controls>
        <source src={resolvedUrl} type={mimeType} />
      </audio>
    </div>
  );
}
