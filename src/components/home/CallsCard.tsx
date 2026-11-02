'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { CallOutcomeChoices } from '@/components/contact/CallOutcomePrompt';
import { outcomeLabel, type CallChannel, type CallOutcome } from '@/lib/contact-calls';
import { CALL_OUTCOME_EVENT, CALL_STARTED_EVENT, saveCallOutcome } from '@/lib/contact-calls-client';
import { usePersonalHome } from './usePersonalHome';

type PendingRow = { id: string; channel: CallChannel; name: string; company: string | null; leadId: string | null; startedAt: string };
export type CallsToday = { pending: PendingRow[]; toCall: number; partial: boolean };

export const CALLS_TO_CALL_HREF = '/saved/leads/enriched?etapa=to_call';

const when = (iso: string) => new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' }).replace(/\./g, '');
const plural = (count: number, one: string, many: string) => `${count.toLocaleString('es-CL')} ${count === 1 ? one : many}`;

/**
 * «Llamadas» in «Hoy» (src/lib/contact-calls.ts): the calls and WhatsApps still without a result, each answered with one
 * tap, and how many contacts with a mobile wait for a call. Nothing to show is no card.
 */
export function CallsCard() {
  const { data, load } = usePersonalHome<CallsToday>('/api/home/calls');
  const { toast } = useToast();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<{ id: string; outcome: CallOutcome } | null>(null);

  // A call started or answered anywhere in the app changes what this card shows.
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(CALL_STARTED_EVENT, refresh);
    window.addEventListener(CALL_OUTCOME_EVENT, refresh);
    return () => {
      window.removeEventListener(CALL_STARTED_EVENT, refresh);
      window.removeEventListener(CALL_OUTCOME_EVENT, refresh);
    };
  }, [load]);

  const choose = async (row: PendingRow, outcome: CallOutcome) => {
    setBusy({ id: row.id, outcome });
    const result = await saveCallOutcome({ id: row.id, channel: row.channel, leadId: row.leadId }, outcome);
    setBusy(null);
    if (!result.ok) {
      toast({ variant: 'destructive', title: 'No se guardó', description: result.message });
      return;
    }
    setDone(previous => new Set(previous).add(row.id));
    toast({ title: `${outcomeLabel(outcome, row.channel)}: guardado`, description: result.pipeline ? 'Quedó en el Pipeline con la reunión sugerida.' : 'Cuenta para tu meta de la semana.' });
  };

  const view = data ? { ...data, pending: data.pending.filter(row => !done.has(row.id)) } : null;
  return <CallsTodayView data={view} busy={busy} onChoose={(row, outcome) => void choose(row, outcome)} />;
}

/** The card itself, from what the route answered. */
export function CallsTodayView({
  data,
  busy,
  onChoose,
}: {
  data: CallsToday | null;
  busy: { id: string; outcome: CallOutcome } | null;
  onChoose: (row: PendingRow, outcome: CallOutcome) => void;
}) {
  if (!data || (!data.pending.length && !data.toCall)) return null;
  return (
    <Card role="region" className="rounded-2xl" aria-labelledby="calls-today-title">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <h2 id="calls-today-title" className="text-base font-semibold leading-none tracking-tight">Llamadas</h2>
        {data.toCall ? (
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href={CALLS_TO_CALL_HREF}>Por llamar<ArrowRight aria-hidden="true" /></Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {data.pending.length ? (
          <section aria-labelledby="calls-today-pending" className="space-y-2">
            <h3 id="calls-today-pending" className="text-xs font-medium text-muted-foreground">
              Sin resultado <span className="tabular-nums">· {data.pending.length.toLocaleString('es-CL')}</span>
            </h3>
            <ul className="space-y-2">
              {data.pending.map(row => (
                <li key={row.id} className="space-y-2 rounded-xl border border-border/60 p-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      {row.channel === 'whatsapp' ? <MessageCircle className="h-4 w-4" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.name || 'Contacto'}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[row.channel === 'whatsapp' ? 'WhatsApp' : 'Llamada', row.company, when(row.startedAt)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </div>
                  <CallOutcomeChoices compact channel={row.channel} busy={busy?.id === row.id ? busy.outcome : null} onChoose={outcome => onChoose(row, outcome)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {data.toCall ? (
          <p className="text-sm text-muted-foreground">
            <Link href={CALLS_TO_CALL_HREF} className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {plural(data.toCall, 'contacto con móvil espera', 'contactos con móvil esperan')} tu llamada
            </Link>
            {data.partial ? ' (contamos los primeros 1.000)' : ''}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
