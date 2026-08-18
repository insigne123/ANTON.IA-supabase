'use client';

import { useCallback, useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { CheckCircle2, Clock3, FileText, Loader2, Mail, MousePointerClick, RefreshCw, Reply, SearchCheck, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CommercialTimelineEvent } from '@/lib/commercial-intelligence';
import { cn } from '@/lib/utils';

type Props = {
  leadId?: string | null;
  gid?: string | null;
  email?: string | null;
  name?: string | null;
  company?: string | null;
  className?: string;
};

function iconFor(kind: CommercialTimelineEvent['kind']) {
  switch (kind) {
    case 'email_sent':
      return <Mail className="h-4 w-4" />;
    case 'email_opened':
      return <CheckCircle2 className="h-4 w-4" />;
    case 'email_clicked':
      return <MousePointerClick className="h-4 w-4" />;
    case 'reply_received':
      return <Reply className="h-4 w-4" />;
    case 'bounce_detected':
    case 'privacy_blocked':
      return <ShieldAlert className="h-4 w-4" />;
    case 'research_completed':
      return <SearchCheck className="h-4 w-4" />;
    case 'crm_updated':
      return <Clock3 className="h-4 w-4" />;
    default:
      return <FileText className="h-4 w-4" />;
  }
}

function toneClasses(tone: CommercialTimelineEvent['tone']) {
  switch (tone) {
    case 'success':
      return 'border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300';
    case 'info':
      return 'border-sky-200 text-sky-700 dark:border-sky-500/30 dark:text-sky-300';
    case 'warning':
      return 'border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-300';
    case 'danger':
      return 'border-rose-200 text-rose-700 dark:border-rose-500/30 dark:text-rose-300';
    default:
      return 'border-border text-muted-foreground';
  }
}

function buildTimelineUrl(input: Props) {
  const params = new URLSearchParams();
  if (input.leadId) params.set('leadId', input.leadId);
  if (input.gid) params.set('gid', input.gid);
  if (input.email) params.set('email', input.email);
  if (input.name) params.set('name', input.name);
  if (input.company) params.set('company', input.company);
  return `/api/commercial/timeline?${params.toString()}`;
}

export function CommercialTimeline(props: Props) {
  const { leadId, gid, email, name, company, className } = props;
  const [events, setEvents] = useState<CommercialTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!leadId && !gid && !email) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildTimelineUrl({ leadId, gid, email, name, company }), { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudo cargar el historial comercial.');
      const data = await res.json();
      setEvents((data.events || []) as CommercialTimelineEvent[]);
    } catch (err) {
      console.error('[CommercialTimeline] fetch error:', err);
      setError('No pudimos cargar la actividad comercial ahora. Intenta de nuevo en unos segundos.');
    } finally {
      setLoading(false);
    }
  }, [leadId, gid, email, name, company]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <section className={cn('space-y-4', className)} aria-labelledby="commercial-timeline-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="commercial-timeline-title" className="text-lg font-semibold tracking-tight">Timeline 360</h3>
          <p className="text-sm text-muted-foreground">Investigacion, contacto y senales de respuesta en un solo historial.</p>
        </div>
        <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={fetchEvents} disabled={loading} aria-label="Actualizar timeline comercial">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-4 rounded-xl border bg-card p-4">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="font-medium">Timeline no disponible</p>
          <p className="mt-1 text-xs opacity-80">{error}</p>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Todavia no hay senales comerciales para este lead. Cuando ANTONIA investigue, contacte o reciba una respuesta, aparecera aqui.
        </div>
      ) : (
        <div className="relative ml-2 space-y-5 border-l border-border pl-5">
          {events.map((event) => {
            const occurredAt = new Date(event.occurredAt);
            return (
              <article key={event.id} className="relative rounded-xl border bg-card/70 p-4 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.2)] dark:bg-card/60">
                <span className={cn('absolute -left-[34px] top-4 rounded-full border-2 bg-background p-1.5', toneClasses(event.tone))} aria-hidden="true">
                  {iconFor(event.kind)}
                </span>
                <div className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">{event.title}</h4>
                      <p className="text-xs text-muted-foreground" title={format(occurredAt, 'PPpp', { locale: es })}>
                        {formatDistanceToNow(occurredAt, { addSuffix: true, locale: es })}
                      </p>
                    </div>
                    {event.source && <Badge variant="outline" className="w-fit text-[11px]">{event.source}</Badge>}
                  </div>
                  {event.description && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{event.description}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
