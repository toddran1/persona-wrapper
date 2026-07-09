import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL, api, resolveApiUrl } from "../lib/api.js";

function shouldFetchWithAuth(url: string): boolean {
  if (url.startsWith("/api/")) return true;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  return url.startsWith(`${API_BASE_URL}/api/`);
}

export function useProtectedMediaUrl(url: string): string {
  const directUrl = useMemo(() => resolveApiUrl(url), [url]);
  const [objectUrl, setObjectUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!shouldFetchWithAuth(url)) {
      setObjectUrl(undefined);
      return undefined;
    }

    const controller = new AbortController();
    let nextObjectUrl: string | undefined;
    setObjectUrl(undefined);

    void api.fetchUploadBlob(url, controller.signal)
      .then((blob) => {
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setObjectUrl(undefined);
      });

    return () => {
      controller.abort();
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [url]);

  return objectUrl ?? directUrl;
}

export async function downloadProtectedMedia(url: string, fileName: string): Promise<void> {
  const blob = shouldFetchWithAuth(url)
    ? await api.fetchUploadBlob(url)
    : await fetch(resolveApiUrl(url)).then((response) => {
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      return response.blob();
    });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
