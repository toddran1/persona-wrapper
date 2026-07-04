import type { ReactNode } from "react";

function parseInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let lastIndex = 0;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${index}`}>{match[2]}</strong>);
    } else if (match[4] && match[5]) {
      nodes.push(
        <a key={`${keyPrefix}-link-${index}`} href={match[5]} target="_blank" rel="noreferrer">
          {match[4]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
    index += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderParagraph(lines: string[], key: string): ReactNode {
  const text = lines.join("\n");
  return <p key={key}>{parseInlineMarkdown(text, key)}</p>;
}

function renderList(lines: string[], key: string): ReactNode {
  const ordered = lines.every((line) => /^\s*\d+\.\s+/.test(line));
  const items = lines.map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
  const start = ordered ? Number(lines[0]?.match(/^\s*(\d+)\.\s+/)?.[1] ?? "1") : undefined;

  if (ordered) {
    return (
      <ol key={key} start={start}>
        {items.map((item, index) => (
          <li key={`${key}-item-${index}`}>{parseInlineMarkdown(item, `${key}-item-${index}`)}</li>
        ))}
      </ol>
    );
  }

  return (
    <ul key={key}>
      {items.map((item, index) => (
        <li key={`${key}-item-${index}`}>{parseInlineMarkdown(item, `${key}-item-${index}`)}</li>
      ))}
    </ul>
  );
}

function renderTable(lines: string[], key: string): ReactNode {
  const headers = parseTableRow(lines[0] ?? "");
  const rows = lines.slice(2).map(parseTableRow);

  return (
    <div key={key} className="markdown-table-shell">
      <table>
        <thead>
          <tr>{headers.map((header, index) => <th key={`${key}-head-${index}`} scope="col">{parseInlineMarkdown(header, `${key}-head-${index}`)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${key}-row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${key}-cell-${rowIndex}-${cellIndex}`}>{parseInlineMarkdown(cell, `${key}-cell-${rowIndex}-${cellIndex}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownText({ text, className = "markdown-text" }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index]?.trim()) {
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && lines[index]?.includes("|") && isTableSeparator(lines[index + 1] ?? "")) {
      const tableLines = [lines[index] ?? "", lines[index + 1] ?? ""];
      index += 2;
      while (index < lines.length && lines[index]?.includes("|") && lines[index]?.trim()) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(renderTable(tableLines, `table-${index}`));
      continue;
    }

    if (/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index] ?? "")) {
      const listLines: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(lines[index] ?? "");
      while (
        index < lines.length &&
        (ordered ? /^\s*\d+\.\s+/.test(lines[index] ?? "") : /^\s*[-*]\s+/.test(lines[index] ?? ""))
      ) {
        listLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(renderList(listLines, `list-${index}`));
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index]?.trim() &&
      !(index + 1 < lines.length && lines[index]?.includes("|") && isTableSeparator(lines[index + 1] ?? "")) &&
      !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index] ?? "")
    ) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(renderParagraph(paragraphLines, `paragraph-${index}`));
  }

  return <div className={className}>{blocks}</div>;
}
