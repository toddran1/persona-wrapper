type FileBlockProps = {
  fileName: string;
  url: string;
  mimeType: string;
  description?: string | undefined;
};

export function FileBlock({ fileName, url, mimeType, description }: FileBlockProps) {
  return (
    <div className="output-file">
      <div className="output-label">{mimeType}</div>
      <a href={url} target="_blank" rel="noreferrer">
        {fileName}
      </a>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
