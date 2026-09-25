'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { parseMarkdown, type MdBlock, type MdInline } from '@/lib/cowork/markdown';
import { cn } from '@/lib/utils';

function Inline({ nodes }: { nodes: MdInline[] }) {
  return <>{nodes.map((node, index) => {
    switch (node.type) {
      case 'text': return <Fragment key={index}>{node.value}</Fragment>;
      case 'br': return <br key={index} />;
      case 'code': return <code key={index}>{node.value}</code>;
      case 'strong': return <strong key={index}><Inline nodes={node.children} /></strong>;
      case 'em': return <em key={index}><Inline nodes={node.children} /></em>;
      case 'del': return <del key={index}><Inline nodes={node.children} /></del>;
      case 'link': {
        const external = !node.href.startsWith('/');
        return <a key={index} href={node.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}><Inline nodes={node.children} /></a>;
      }
      default: return null;
    }
  })}</>;
}

function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return <div className="cw-code">
    <div className="cw-code-head">
      <span>{lang || 'Texto'}</span>
      <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-cw-muted hover:bg-cw-hover hover:text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
    <pre><code>{value}</code></pre>
  </div>;
}

const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6'] as const;

function Block({ block }: { block: MdBlock }): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = HEADING_TAGS[block.level - 1];
      return <Tag data-md-level={block.level}><Inline nodes={block.children} /></Tag>;
    }
    case 'paragraph':
      return <p><Inline nodes={block.children} /></p>;
    case 'list': {
      const items = block.items.map((item, index) => <li key={index} className={cn(item.checked !== null && 'cw-task')}>
        {item.checked !== null && <span aria-hidden="true" className={cn(
          'mt-[0.32em] inline-flex h-[1em] w-[1em] shrink-0 items-center justify-center rounded-[4px] border text-[0.8em]',
          item.checked ? 'border-cw-accent bg-cw-accent text-cw-on-accent' : 'border-cw-border-strong',
        )}>{item.checked ? '✓' : ''}</span>}
        {item.checked !== null && <span className="sr-only">{item.checked ? 'Completado: ' : 'Pendiente: '}</span>}
        <div className="min-w-0 flex-1 space-y-[0.32em]">{item.children.map((child, childIndex) => <Block key={childIndex} block={child} />)}</div>
      </li>);
      return block.ordered
        ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol>
        : <ul>{items}</ul>;
    }
    case 'blockquote':
      return <blockquote>{block.children.map((child, index) => <Block key={index} block={child} />)}</blockquote>;
    case 'code':
      return <CodeBlock lang={block.lang} value={block.value} />;
    case 'table':
      return <div className="cw-table cw-scroll">
        <table>
          <thead><tr>{block.header.map((cell, index) => <th key={index} scope="col" style={block.align[index] ? { textAlign: block.align[index] as 'left' | 'center' | 'right' } : undefined}><Inline nodes={cell} /></th>)}</tr></thead>
          <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index} style={block.align[index] ? { textAlign: block.align[index] as 'left' | 'center' | 'right' } : undefined}><Inline nodes={cell} /></td>)}</tr>)}</tbody>
        </table>
      </div>;
    case 'hr':
      return <hr />;
    default:
      return null;
  }
}

/** Safe Markdown for Cowork: tables, lists, quotes and code. Raw HTML is never interpreted. */
export function CoworkMarkdown({ text, variant = 'chat', className }: { text: string; variant?: 'chat' | 'document'; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={cn('cw-prose', variant === 'document' ? 'cw-prose-doc' : 'cw-prose-chat', className)}>
    {blocks.map((block, index) => <Block key={index} block={block} />)}
  </div>;
}
