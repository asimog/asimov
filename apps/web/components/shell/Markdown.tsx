// A small Markdown renderer for our own protected texts (CONSTITUTION.md, SOUL.md): headings, paragraphs, lists,
// emphasis and code. Only for files in this repo; never for visitor or feed text.
import type { ReactNode } from "react";

function inline(s: string): ReactNode[] {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: parts are split from one string, position is identity
    part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code>
    // biome-ignore lint/suspicious/noArrayIndexKey: parts are split from one string, position is identity
    : part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong>
    // biome-ignore lint/suspicious/noArrayIndexKey: parts are split from one string, position is identity
    : part.startsWith("*") && part.length > 2 ? <em key={i}>{part.slice(1, -1)}</em>
    : part,
  );
}

export function Markdown({ text }: { text: string }) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, ""); // front matter is shown separately
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    // biome-ignore lint/suspicious/noArrayIndexKey: list lines are split from one string, position is identity
    if (list.length) out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    if (!lines[0]) continue;
    if (lines.every((l) => /^[-*] /.test(l))) {
      list.push(...lines.map((l) => l.slice(2)));
      continue;
    }
    flush();
    const h = lines[0].match(/^(#{1,3}) (.*)/);
    if (h) {
      const Tag = (["h2", "h2", "h3"] as const)[h[1]!.length - 1]!;
      out.push(<Tag key={out.length}>{inline(h[2]!)}</Tag>);
      if (lines.length > 1) out.push(<p key={out.length}>{inline(lines.slice(1).join(" "))}</p>);
    } else out.push(<p key={out.length}>{inline(lines.join(" "))}</p>);
  }
  flush();
  return <>{out}</>;
}
