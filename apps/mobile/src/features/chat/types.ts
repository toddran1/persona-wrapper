import type { ContentBlock } from "@persona/shared";

export type RenderedTurn = {
  id: string;
  userMessage: string;
  userAssets?: Array<{
    id: string;
    kind: "image" | "file";
    fileName: string;
    mimeType: string;
    url?: string | undefined;
  }>;
  assistantText: string;
  outputs: ContentBlock[];
};
