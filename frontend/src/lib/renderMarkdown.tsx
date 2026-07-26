import { Fragment, type ReactNode } from "react";

const INLINE_PATTERN = /(\*\*(.+?)\*\*|`(.+?)`)/g;

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[2] !== undefined) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      parts.push(<code key={key++}>{match[3]}</code>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

/**
 * Renders the narrow markdown subset the backend actually produces (see
 * backend/app/runs.py's _render_context_md/_render_requirements_md/_render_tasks_md):
 * "#"/"##" headings, "- " bullet lists, "**bold**", and inline `code`. Not a general
 * markdown parser — deliberately scoped to what we control the generation of.
 */
export function renderMarkdown(content: string): ReactNode {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length === 0) return;
    const items = listItems;
    blocks.push(
      // index-as-key: bullet items are a static, ordered, position-only list
      <ul key={key++}>
        {items.map((item, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flushList();
      blocks.push(<h2 key={key++}>{line.slice(3)}</h2>);
    } else if (line.startsWith("# ")) {
      flushList();
      blocks.push(<h1 key={key++}>{line.slice(2)}</h1>);
    } else if (line.startsWith("- ") || /^\d+\.\s/.test(line)) {
      listItems.push(line.replace(/^-\s|^\d+\.\s/, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={key++}>{renderInline(line)}</p>);
    }
  }
  flushList();

  return <Fragment>{blocks}</Fragment>;
}
