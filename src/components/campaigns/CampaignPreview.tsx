'use client';

import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CampaignRecipient } from '@/lib/bulk-campaigns';

const stepTitle = (index: number, delayDays: number) => (index === 0
  ? 'Primer correo'
  : `Seguimiento ${index} · ${delayDays} ${delayDays === 1 ? 'día' : 'días'} después del anterior`);

/**
 * Each person's e-mails as they will receive them (9 Nov 2026 review). Editing one e-mail for one person is a quiet action on
 * that e-mail, and the editor opens in its place, instead of a row of «Editar … de esta persona» buttons above every preview.
 */
export function CampaignPreview({ recipients, overrides, selected, onSelect, editable, busy, editing, onEdit, editor }: {
  recipients: CampaignRecipient[];
  overrides: Array<{ email: string; messageIndex: number }>;
  selected: number;
  onSelect: (index: number) => void;
  /** A draft: each e-mail can be edited for one person. */
  editable: boolean;
  busy: boolean;
  editing: { email: string; messageIndex: number } | null;
  onEdit: (email: string, messageIndex: number) => void;
  /** The editor shown in place of the e-mail being edited. */
  editor: ReactNode;
}) {
  const person = recipients[selected];
  const name = person ? person.name || person.email : '';
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <section aria-labelledby="campaign-review-people" className="min-w-0 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="campaign-review-people" className="text-sm font-semibold">Personas ({recipients.length.toLocaleString('es-CL')})</h3>
          <p className="text-xs text-muted-foreground">Elige a quién ver</p>
        </div>
        <ul className="max-h-56 divide-y overflow-y-auto rounded-xl border sm:max-h-[28rem]" aria-label="Personas de la campaña">
          {recipients.map((recipient, index) => {
            const edited = overrides.some(value => value.email === recipient.email);
            const current = index === selected;
            return (
              <li key={recipient.email}>
                <button type="button" aria-current={current ? 'true' : undefined} disabled={Boolean(editing)} onClick={() => onSelect(index)}
                  className={cn('block w-full min-w-0 px-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-60',
                    current && 'bg-muted font-medium')}>
                  <span className="block break-words">{recipient.name || recipient.email}</span>
                  {recipient.name ? <span className="block break-all text-xs font-normal text-muted-foreground">{recipient.email}</span> : null}
                  {edited ? <Badge variant="neutral" className="mt-1 font-normal">Editado para esta persona</Badge> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-label={person ? `Correos para ${name}` : 'Correos'} className="min-w-0 space-y-3">
        {person?.messages.map((message, index) => {
          if (editing && editing.email === person.email && editing.messageIndex === index) return <div key={message.draftId}>{editor}</div>;
          const step = index === 0 ? 'primer correo' : `seguimiento ${index}`;
          return (
            <article key={message.draftId} className="rounded-xl border bg-background p-4 sm:p-5">
              <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-xs text-muted-foreground">{stepTitle(index, message.delayDays)}</p>
                {editable ? (
                  <Button variant="ghost" size="sm" className="-mr-2 text-primary hover:text-primary" disabled={busy || Boolean(editing)}
                    aria-label={`Editar solo para esta persona: ${step} de ${name}`} onClick={() => onEdit(person.email, index)}>
                    <Pencil aria-hidden="true" />Editar solo para esta persona
                  </Button>
                ) : null}
              </div>
              <h4 className="mt-1 break-words font-semibold">{message.subject}</h4>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
            </article>
          );
        })}
      </section>
    </div>
  );
}
