'use client';

import { Button } from '@/components/ui/button';
import { useEffect, useRef } from 'react';
import type { RewriteProposal } from './draft-editor-behavior';

export function RewriteProposalReview({ before, proposal, busy, disabled, autoFocus = true, onApply, onDiscard }: {
  before: { subject: string; body: string };
  proposal: RewriteProposal;
  busy?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const headingRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const previous = document.activeElement as HTMLElement | null;
    const section = headingRef.current?.closest('section');
    headingRef.current?.focus();
    return () => {
      if (previous?.isConnected && (document.activeElement === document.body || section?.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, [autoFocus]);
  return (
    <section aria-label="Comparar propuesta de IA" className="space-y-4 rounded-xl border border-border bg-muted/20 p-4" aria-busy={busy}>
      <p ref={headingRef} tabIndex={-1} className="rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Propuesta sin guardar</p>
      <p className="break-all text-xs text-muted-foreground">Versión de origen: {proposal.expectedVersionId}</p>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        {[{ label: 'Antes · tu correo', value: before }, { label: 'Después · propuesta de IA', value: proposal }].map(({ label, value }) => (
          <div key={label} className="min-w-0 space-y-2">
            <p className="text-sm font-semibold">{label}</p>
            <p className="whitespace-pre-wrap break-words text-sm"><span className="font-medium">Asunto: </span>{value.subject}</p>
            <p tabIndex={0} aria-label={`Mensaje: ${label}`} className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-sm text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{value.body}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Aplicar guarda una nueva versión que requiere revisión. No envía el correo.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" className="min-h-11" variant="outline" disabled={busy} onClick={onDiscard}>Descartar propuesta</Button>
        <Button type="button" className="min-h-11" disabled={busy || disabled} onClick={onApply}>{busy ? 'Guardando…' : 'Aplicar y guardar'}</Button>
      </div>
    </section>
  );
}
