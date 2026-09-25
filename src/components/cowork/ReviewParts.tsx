'use client';

import type { ReactNode } from 'react';
import { LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CwButton } from './ui';

/** Shared building blocks so every approval reads the same way. */
export function ReviewLoading({ label }: { label: string }) {
  return <div className="space-y-2.5" aria-busy="true">
    <p role="status" className="flex items-center gap-2 text-[13px] text-cw-muted">
      <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />{label}
    </p>
    <div className="h-2.5 w-3/4 rounded-full bg-cw-hover motion-safe:animate-pulse" />
    <div className="h-2.5 w-1/2 rounded-full bg-cw-hover motion-safe:animate-pulse" />
  </div>;
}

export function ReviewError({ message }: { message: string }) {
  return <p role="alert" className="flex items-start gap-2 rounded-xl bg-cw-danger-soft px-3 py-2.5 text-[13px] leading-5 text-cw-danger">
    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{message}</span>
  </p>;
}

export function ReviewFields({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid grid-cols-1 gap-x-5 gap-y-1 text-[13.5px] sm:grid-cols-[minmax(7rem,max-content)_1fr] sm:gap-y-2.5', className)}>{children}</dl>;
}

export function ReviewField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="contents">
    <dt className="pt-1.5 text-[12.5px] font-medium text-cw-muted sm:pt-0">{label}</dt>
    <dd className="min-w-0 break-words text-cw-text">{children}</dd>
  </div>;
}

export function ReviewChips({ values, empty = 'Sin filtro' }: { values: readonly unknown[] | null | undefined; empty?: string }) {
  const items = (values || []).map(value => String(value)).filter(Boolean);
  if (!items.length) return <span className="text-cw-muted">{empty}</span>;
  return <span className="flex flex-wrap gap-1.5">
    {items.map(item => <span key={item} className="rounded-md border border-cw-border bg-cw-panel px-1.5 py-0.5 text-[12.5px] leading-5">{item}</span>)}
  </span>;
}

export function ReviewPaper({ children, mono = false, className }: { children: ReactNode; mono?: boolean; className?: string }) {
  return <div className={cn(
    'cw-scroll max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-cw-border bg-cw-panel px-4 py-3',
    mono ? 'font-cw-mono text-[12.5px] leading-6' : 'text-[14px] leading-6',
    className,
  )}>{children}</div>;
}

export function ReviewNote({ ok = true, children }: { ok?: boolean; children: ReactNode }) {
  return <p className={cn('flex items-start gap-2 text-[12.5px] leading-5', ok ? 'text-cw-muted' : 'rounded-lg bg-cw-warning-soft px-2.5 py-2 text-cw-warning')}>
    {ok ? <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
    <span>{children}</span>
  </p>;
}

export function ReviewActions({ onReject, onApprove, approveLabel, rejectLabel = 'Descartar', disabled = false, resolving, resolvingLabel = 'Guardando aprobación…' }: {
  onReject: () => void; onApprove: () => void; approveLabel: string; rejectLabel?: string;
  disabled?: boolean; resolving: boolean; resolvingLabel?: string;
}) {
  return <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
    <CwButton variant="ghost" disabled={resolving} onClick={onReject}>{rejectLabel}</CwButton>
    <CwButton variant="primary" disabled={resolving || disabled} onClick={onApprove}>{resolving ? resolvingLabel : approveLabel}</CwButton>
  </div>;
}
