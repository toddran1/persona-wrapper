import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);
  const label = language || "text";

  useEffect(() => () => {
    if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
  }, []);

  const copy = async () => {
    setCopyFailed(false);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        let copiedByBrowser = false;
        try {
          textarea.select();
          copiedByBrowser = document.execCommand("copy");
        } finally {
          textarea.remove();
        }
        if (!copiedByBrowser) throw new Error("Browser copy command was rejected.");
      }
      setCopied(true);
      if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopyFailed(false), 2400);
    }
  };

  return (
    <section className="markdown-code-block" aria-label={`${label} code block`}>
      <div className="markdown-code-toolbar">
        <span>{label}</span>
        <button type="button" className="markdown-code-copy" onClick={() => void copy()} aria-label={copyFailed ? "Copy failed" : "Copy code"}>
          {copyFailed ? "Copy failed" : copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code className={`language-${label}`}>{code}</code></pre>
    </section>
  );
}

const components: Components = {
  a({ href, children }) {
    if (!href) return <>{children}</>;
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  code({ className, children, node, ...props }) {
    const language = /language-([^\s]+)/.exec(className ?? "")?.[1];
    const isBlock = Boolean(language) || node?.position?.start.line !== node?.position?.end.line;
    if (!isBlock) return <code className="markdown-inline-code" {...props}>{children}</code>;
    const code = String(children).replace(/\n$/, "");
    return <CodeBlock code={code} language={language?.toLowerCase() || "text"} />;
  },
  pre({ children }) {
    return <>{children as ReactNode}</>;
  },
  table({ children }) {
    return <div className="markdown-table-shell"><table>{children}</table></div>;
  }
};

export function MarkdownText({ text, className = "markdown-text" }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
