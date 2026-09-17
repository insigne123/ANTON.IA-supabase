'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const fencePattern = new RegExp(`^\\s*${String.fromCharCode(96).repeat(3)}`);

function safeHref(value: string) {
  const href = value.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : '';
}

/** Inline **bold**, `code` and [text](https://…) only. Raw HTML is never interpreted. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+?)\*\*|`([^`]+?)`|\[([^\]]+?)\]\(([^)\s]+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [raw, , boldText, codeText, linkText, linkHref] = match;
    if (boldText) {
      nodes.push(<strong key={`${keyPrefix}-b-${match.index}`} className="font-semibold">{boldText}</strong>);
    } else if (codeText) {
      nodes.push(<code key={`${keyPrefix}-c-${match.index}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">{codeText}</code>);
    } else if (linkText && linkHref) {
      const href = safeHref(linkHref);
      nodes.push(href ? (
        <a key={`${keyPrefix}-a-${match.index}`} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{linkText}</a>
      ) : raw);
    } else {
      nodes.push(raw);
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length ? nodes : [text];
}

const unorderedLine = (line: string) => /^\s*[-*]\s+/.test(line);
const orderedLine = (line: string) => /^\s*\d+[.)]\s+/.test(line);
const boundary = (line: string) =>
  !line.trim() || fencePattern.test(line) || /^\s{0,3}#{1,3}\s+/.test(line) || unorderedLine(line) || orderedLine(line);

/** Minimal Markdown for assistant replies: headings, lists, code, paragraphs. */
export function MarkdownText({ text, className }: { text: string; className?: string }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').trim().split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (fencePattern.test(line)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !fencePattern.test(lines[index] || '')) {
        codeLines.push(lines[index] || '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<div key={`code-${index}`} className="overflow-x-auto rounded-xl bg-muted p-4"><pre className="font-mono text-sm leading-6">{codeLines.join('\n')}</pre></div>);
      continue;
    }
    const heading = /^\s{0,3}(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<p key={`h-${index}`} className="text-lg font-semibold tracking-tight">{renderInline(heading[2].trim(), `h-${index}`)}</p>);
      index += 1;
      continue;
    }
    if (unorderedLine(line) || orderedLine(line)) {
      const ordered = orderedLine(line);
      const items: string[] = [];
      while (index < lines.length && (ordered ? orderedLine(lines[index] || '') : unorderedLine(lines[index] || ''))) {
        items.push((lines[index] || '').replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, '').trim());
        index += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={`list-${index}`} className={ordered ? 'list-decimal space-y-1 pl-6' : 'list-disc space-y-1 pl-6'}>
          {items.map((item, itemIndex) => <li key={`${itemIndex}`}>{renderInline(item, `list-${index}-${itemIndex}`)}</li>)}
        </ListTag>,
      );
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length && !boundary(lines[index] || '')) {
      paragraphLines.push((lines[index] || '').trim());
      index += 1;
    }
    if (paragraphLines.length === 0) {
      paragraphLines.push(trimmed);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraphLines.join(' '), `p-${index}`)}</p>);
  }
  return <div className={cn('space-y-3 break-words text-base leading-7', className)}>{blocks}</div>;
}
