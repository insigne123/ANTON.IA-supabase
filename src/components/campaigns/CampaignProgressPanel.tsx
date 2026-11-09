'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/dates';
import type { CampaignHistoryEvent } from '@/lib/bulk-campaigns';
import type { CampaignProgress, RecipientProgress } from '@/lib/bulk-campaign-progress';
import { RECIPIENT_TONE_VARIANT } from './campaign-status';

const number = (value: number) => value.toLocaleString('es-CL');

/** The four numbers of a launched campaign, in the tiles of «Campañas anteriores». */
export function CampaignProgressTiles({ progress }: { progress: CampaignProgress }) {
  const tiles: Array<{ label: string; value: string; of?: string; tone?: 'warning' }> = [
    { label: 'Correos enviados', value: number(progress.sentMessages), of: `de ${number(progress.totalMessages)}` },
    { label: 'Personas alcanzadas', value: number(progress.reached), of: `de ${number(progress.recipients)}` },
    ...(progress.replied === null ? [] : [{ label: 'Respuestas', value: number(progress.replied) }]),
    { label: 'Requieren atención', value: number(progress.attention), ...(progress.attention ? { tone: 'warning' as const } : {}) },
  ];
  return (
    <dl className={cn('grid grid-cols-2 gap-2', tiles.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
      {tiles.map(tile => (
        <div key={tile.label} className={cn('rounded-xl border bg-muted/30 px-3 py-2.5', tile.tone === 'warning' && 'border-transparent bg-cw-warning-soft')}>
          <dt className="text-xs text-foreground/70">{tile.label}</dt>
          <dd className="mt-0.5 flex items-baseline gap-1.5">
            <span className={cn('text-xl font-semibold tabular-nums', tile.tone === 'warning' && 'text-cw-warning')}>{tile.value}</span>
            {tile.of ? <span className="text-xs text-muted-foreground">{tile.of}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The line under a person: the reason or what comes next, with its date in words («sale el 10 nov, 14:58»). */
function detailLine(row: RecipientProgress) {
  if (!row.at) return row.detail;
  const when = formatDateTime(row.at);
  if (row.tone === 'scheduled') return `${row.detail || 'Próximo correo'} sale el ${when}.`;
  if (row.tone === 'retrying') return `${row.detail || ''} Próximo intento: ${when}.`.trim();
  return [row.detail, when].filter(Boolean).join(' · ');
}

/**
 * Where each person stands (9 Nov 2026 review): a badge, the reason or what comes next with its date, how many e-mails went
 * out, and the unified history on demand.
 */
export function CampaignRecipientsStatus({ progress, busy, canRetry, history, historyLoading, onRetry, onHistory }: {
  progress: CampaignProgress;
  busy: boolean;
  canRetry: boolean;
  history: Record<string, CampaignHistoryEvent[]>;
  historyLoading: string;
  onRetry: (draftId: string) => void;
  onHistory: (email: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <ul className="divide-y rounded-xl border" aria-label="Estado por destinatario">
      {progress.rows.map(({ recipient, progress: row }) => {
        const name = recipient.name || recipient.email;
        const events = history[recipient.email];
        const expanded = Boolean(open[recipient.email]);
        const panelId = `campaign-history-${recipient.email.replace(/[^a-z0-9]/gi, '-')}`;
        const line = detailLine(row);
        return (
          <li key={recipient.email} className="space-y-1.5 px-4 py-3.5 text-sm">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 break-words">
                <span className="font-medium">{name}</span>
                {recipient.name ? <span className="block break-all text-xs text-muted-foreground sm:ml-2 sm:inline">{recipient.email}</span> : null}
              </p>
              <Badge variant={RECIPIENT_TONE_VARIANT[row.tone]} className="shrink-0 font-medium">{row.label}</Badge>
            </div>
            {line ? <p className={cn('leading-6', row.tone === 'attention' || row.tone === 'failed' ? 'text-foreground' : 'text-muted-foreground')}>{line}</p> : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden="true" className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${row.total ? Math.round((row.sent / row.total) * 100) : 0}%` }} />
                </span>
                {row.sent} de {row.total} {row.total === 1 ? 'correo' : 'correos'}
              </span>
              <button type="button" aria-expanded={expanded} aria-controls={panelId}
                className="rounded px-1 text-xs font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => { if (!expanded) onHistory(recipient.email); setOpen(value => ({ ...value, [recipient.email]: !expanded })); }}>
                {expanded ? 'Ocultar historial' : 'Ver historial'}
              </button>
              {row.retryDraftId ? (
                <Button variant="outline" size="sm" className="sm:ml-auto" disabled={busy || !canRetry} onClick={() => onRetry(row.retryDraftId as string)}
                  aria-label={`Volver a comprobar el envío a ${name}`}>Volver a comprobar</Button>
              ) : null}
            </div>
            {expanded ? (
              <div id={panelId} className="pt-1">
                {historyLoading === recipient.email ? <p className="text-xs text-muted-foreground" role="status">Cargando historial…</p> : null}
                {events?.length ? (
                  <ol className="space-y-2 border-l pl-3">
                    {events.map((event, index) => (
                      <li key={index} className="text-xs">
                        <p><span className="font-medium text-foreground">{event.label}</span>{event.at ? <span className="text-muted-foreground"> · {formatDateTime(event.at)}</span> : null}</p>
                        {event.detail ? <p className="break-words text-muted-foreground">{event.detail}</p> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {events && !events.length ? <p className="text-xs text-muted-foreground">Sin actividad registrada.</p> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
