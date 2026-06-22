import { MarkdownText } from "../MarkdownText.js";

export function TextBlock({ text }: { text: string }) {
  return <MarkdownText text={text} className="output-text markdown-text" />;
}
