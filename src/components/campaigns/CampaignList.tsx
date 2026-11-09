'use client';

import { ChevronRight, Megaphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/dates';
import type { BulkCampaign, CampaignListStats } from '@/lib/bulk-campaigns';
import { campaignStatusBadge } from './campaign-status';

export type CampaignListItem = Omit<BulkCampaign, 'recipients'> & { stats?: CampaignListStats };

const plural = (count: number, one: string, many: string) => `${count.toLocaleString('es-CL')} ${count === 1 ? one : many}`;

/**
 * «Tus campañas» (9 Nov 2026 review): each row says its state with the same badge as inside, how far it went and when it was
 * created or approved, so the one that waits for its author stands out without opening every campaign.
 */
export function CampaignList({ items, loading, busy, onOpen, onNew }: {
  items: CampaignListItem[];
  loading: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  if (loading && !items.length) {
    return (
      <div className="divide-y rounded-2xl border bg-card" role="status" aria-label="Cargando campañas">
        {[0, 1].map(index => (
          <div key={index} className="space-y-2 p-5">
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-3 w-40 max-w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="rounded-2xl border bg-card">
        <EmptyState icon={Megaphone} headingLevel="h3" title="Aún no tienes campañas"
          description="Eliges a quién escribir, la IA redacta el primer correo y sus seguimientos, y tú los apruebas una sola vez."
          action={<Button disabled={busy} onClick={onNew}>Nueva campaña</Button>} />
      </div>
    );
  }
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-card" aria-label="Tus campañas">
      {items.map(item => {
        const badge = campaignStatusBadge(item.status, item.stats?.finished);
        const launched = (item.status === 'approved' || item.status === 'paused') && Boolean(item.approved_at);
        const stats = launched ? item.stats : undefined;
        const reached = stats && stats.recipients ? Math.round((stats.sent / stats.recipients) * 100) : 0;
        return (
          <li key={item.id}>
            <button type="button" disabled={busy} onClick={() => onOpen(item.id)}
              className="group flex w-full min-w-0 items-center gap-4 px-4 !py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-60 sm:px-5">
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words font-medium text-foreground">{item.definition.name}</span>
                  <Badge variant={badge.variant} className="font-medium">{badge.label}</Badge>
                </span>
                {stats ? (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span aria-hidden="true" className="relative h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${reached}%` }} />
                    </span>
                    <span>Enviada a {stats.sent.toLocaleString('es-CL')} de {plural(stats.recipients, 'persona', 'personas')} · {plural(stats.replied, 'respuesta', 'respuestas')}</span>
                  </span>
                ) : (
                  <span className="block text-sm text-muted-foreground">
                    {plural(item.definition.emails.length, 'persona', 'personas')} · {plural(item.definition.messages.length, 'correo', 'correos')} por persona
                  </span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {launched ? `Aprobada el ${formatDate(item.approved_at)}` : `Creada el ${formatDate(item.created_at)}`}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
