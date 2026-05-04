type ImageBlockProps = {
  url: string;
  alt: string;
  prompt?: string | undefined;
};

export function ImageBlock({ url, alt, prompt }: ImageBlockProps) {
  return (
    <figure className="media-card">
      <img src={url} alt={alt} />
      <figcaption>{prompt ?? alt}</figcaption>
    </figure>
  );
}
