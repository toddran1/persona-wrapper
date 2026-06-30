import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ImageBlockProps = {
  url: string;
  alt: string;
  prompt?: string | undefined;
  mimeType?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

type IconName = "download" | "edit" | "more" | "close" | "external";

function Icon({ name }: { name: IconName }) {
  if (name === "download") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 20h14" />
      </svg>
    );
  }

  if (name === "edit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }

  if (name === "close") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    );
  }

  if (name === "external") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 3h7v7" />
        <path d="m10 14 11-11" />
        <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12h.01" />
      <path d="M19 12h.01" />
      <path d="M5 12h.01" />
    </svg>
  );
}

function slugifyFilePart(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return slug || "generated-image";
}

function shortImageId(metadata?: Record<string, unknown>): string | undefined {
  const id = typeof metadata?.id === "string" ? metadata.id : undefined;
  return id?.replace(/[^a-zA-Z0-9_-]+/g, "").slice(-12) || undefined;
}

function imageFileName(alt: string, prompt?: string, mimeType?: string, metadata?: Record<string, unknown>): string {
  const extension = mimeType?.includes("jpeg") || mimeType?.includes("jpg") ? "jpg" : "png";
  const baseName = slugifyFilePart(prompt ?? alt);
  const suffix = shortImageId(metadata);
  return `${baseName}${suffix ? `-${suffix}` : ""}.${extension}`;
}

function resolveMediaUrl(url: string): string {
  return url.startsWith("/") ? `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}${url}` : url;
}

export function ImageBlock({ url, alt, prompt, mimeType, metadata }: ImageBlockProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const resolvedUrl = resolveMediaUrl(url);

  useEffect(() => {
    if (!modalOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [modalOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);

    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  const modal = modalOpen ? (
    <div className="image-modal" role="dialog" aria-modal="true" aria-label="Full size image viewer" onClick={() => setModalOpen(false)}>
      <button
        type="button"
        className="image-modal-close-button"
        aria-label="Close full size image"
        title="Close"
        onClick={() => setModalOpen(false)}
      >
        <Icon name="close" />
      </button>
      <div className="image-modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="image-modal-toolbar">
          <span>{alt}</span>
          <div className="image-modal-actions">
            <a className="image-icon-button" href={resolvedUrl} download={imageFileName(alt, prompt, mimeType, metadata)} aria-label="Download image" title="Download image">
              <Icon name="download" />
            </a>
            <button type="button" className="image-icon-button" aria-label="Close full size image" title="Close" onClick={() => setModalOpen(false)}>
              <Icon name="close" />
            </button>
          </div>
        </div>
        <img src={resolvedUrl} alt={alt} />
      </div>
    </div>
  ) : null;

  return (
    <>
      <figure className="media-card image-card">
        <div className="image-frame">
          <button type="button" className="image-preview-button" onClick={() => setModalOpen(true)} aria-label="Open image full size">
            <img src={resolvedUrl} alt={alt} />
          </button>
          <div className="image-action-bar" aria-label="Image actions">
            <a className="image-icon-button" href={resolvedUrl} download={imageFileName(alt, prompt, mimeType, metadata)} aria-label="Download image" title="Download image">
              <Icon name="download" />
            </a>
            <div className="image-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="image-icon-button"
                aria-label="More image actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuId}
                title="More"
                onClick={() => setMenuOpen((current) => !current)}
              >
                <Icon name="more" />
              </button>
              {menuOpen ? (
                <div id={menuId} className="image-menu" role="menu">
                  <a href={resolvedUrl} target="_blank" rel="noreferrer" role="menuitem" onClick={() => setMenuOpen(false)}>
                    <Icon name="external" />
                    <span>Open original</span>
                  </a>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void navigator.clipboard?.writeText(prompt ?? alt); }}>
                    <Icon name="edit" />
                    <span>Copy prompt</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <button type="button" className="image-edit-button" onClick={() => setModalOpen(true)}>
            <Icon name="edit" />
            <span>Edit</span>
          </button>
        </div>
      </figure>

      {modal ? createPortal(modal, document.body) : null}
    </>
  );
}
