import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { DocumentTitle } from '@/components/document-title';

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** A short label above the title naming the section, e.g. «Configuración». */
  eyebrow?: string;
  /** How many items the page lists, next to the title. */
  count?: number | null;
  /** Where «Volver» leads, for pages one level below a section. */
  back?: { href: string; label?: string };
  /** The page's actions, main one last. `children` does the same and stays for current callers. */
  actions?: ReactNode;
  children?: ReactNode;
};

export function PageHeader({ title, description, eyebrow, count, back, actions, children }: PageHeaderProps) {
  const trailing = actions ?? children;
  return (
    <header className="mb-5 flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <DocumentTitle title={title} />
      <div className="min-w-0 space-y-1.5">
        {back && (
          <Link
            href={back.href}
            className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {back.label || 'Volver'}
          </Link>
        )}
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>}
        <h1 className="flex flex-wrap items-baseline gap-x-2.5 text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-[2rem]">
          <span className="min-w-0 break-words">{title}</span>
          {typeof count === 'number' && <span className="text-base font-medium tabular-nums text-muted-foreground sm:text-lg">{count.toLocaleString('es-CL')}</span>}
        </h1>
        {description && <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {trailing && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-shrink-0 sm:justify-end">{trailing}</div>}
    </header>
  );
}
