type AudioBlockProps = {
  url: string;
  mimeType: string;
  transcript?: string | undefined;
};

export function AudioBlock({ url, mimeType }: AudioBlockProps) {
  return (
    <div className="media-card">
      <div className="output-label">Audio</div>
      <audio controls>
        <source src={url} type={mimeType} />
      </audio>
    </div>
  );
}
