'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Loader2, MoreHorizontal, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToastAction } from '@/components/ui/toast';
import { InitialsAvatar } from '@/components/initials-avatar';
import { useToast } from '@/hooks/use-toast';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import type { ReconnectAlert } from '@/lib/reconnect';

type ReconnectResponse = { alerts: ReconnectAlert[]; total: number; afterDays: number; canPostpone: boolean };

const SHOWN = 3;

/**
 * «Para retomar» in «Hoy» (propuesta 7): people worth writing to again, why now, and «Retomar», which prepares a new
 * email with a different angle to review in «Redactar». Nothing shows when nobody is due.
 */
export function ReconnectCard() {
  const { organizationId } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<ReconnectResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string; href?: string } | null>(null);

  const call = useCallback((url: string, init?: RequestInit) => authenticatedApiFetch(url, {
    cache: 'no-store', ...init,
    headers: { 'Content-Type': 'application/json', ...(organizationId ? { 'x-organization-id': organizationId } : {}), ...(init?.headers || {}) },
  }), [organizationId]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await call('/api/reconnect');
      if (response.ok) setData(await response.json());
    } catch { /* «Hoy» works without this card */ }
  }, [call, organizationId]);
  useEffect(() => { void load(); }, [load]);

  if (!data || data.total === 0) return null;
  const visible = expanded ? data.alerts : data.alerts.slice(0, SHOWN);

  async function reconnect(alert: ReconnectAlert) {
    setBusy(alert.contactedId); setRowError(null);
    try {
      const response = await call(`/api/reconnect/${encodeURIComponent(alert.contactedId)}/draft`, { method: 'POST' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos preparar el correo. Intenta de nuevo.');
      if (body?.status === 'needs_research') {
        setRowError({ id: alert.contactedId, text: `Antes de escribirle, investiga a ${alert.name}: la IA usa esa investigación para el ángulo nuevo.`,
          href: body.leadId ? `/saved/leads/enriched?investigar=${encodeURIComponent(body.leadId)}` : '/saved/leads/enriched' });
        return;
      }
      router.push(`/contact/compose?draftId=${encodeURIComponent(body.draftId)}`);
    } catch (error) {
      setRowError({ id: alert.contactedId, text: (error as Error).message });
    } finally { setBusy(null); }
  }

  async function mark(alert: ReconnectAlert, action: 'snooze' | 'dismiss' | 'restore') {
    setBusy(alert.contactedId);
    try {
      const response = await call('/api/reconnect', { method: 'POST', body: JSON.stringify({ action, contactedId: alert.contactedId }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos guardarlo.');
      await load();
      if (action !== 'restore') {
        toast({
          title: action === 'snooze' ? `${alert.name}: te aviso en 30 días` : `${alert.name}: no te lo vuelvo a sugerir`,
          action: <ToastAction altText="Deshacer" onClick={() => void mark(alert, 'restore')}>Deshacer</ToastAction>,
        });
      }
    } catch (error) {
      toast({ title: 'No se pudo guardar', description: (error as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  async function changeAfter(value: string) {
    const afterDays = Number(value);
    const response = await call('/api/reconnect', { method: 'POST', body: JSON.stringify({ action: 'settings', afterDays }) }).catch(() => null);
    if (!response?.ok) { toast({ title: 'No se pudo guardar tu preferencia', variant: 'destructive' }); return; }
    await load();
  }

  return (
    <Card className="rounded-2xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300" aria-labelledby="reconnect-title">
      <CardHeader className="pb-3">
        <CardTitle id="reconnect-title" className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4 text-primary" aria-hidden="true" />
          Para retomar
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{data.total}</span>
        </CardTitle>
        <CardDescription>Personas a las que vale la pena volver a escribir, con el motivo. «Retomar» prepara un correo nuevo para que lo revises.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {visible.map(alert => (
            <li key={alert.contactedId} className="rounded-xl border border-border/60 p-3">
              <div className="flex items-start gap-3">
                <InitialsAvatar name={alert.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <Link href={`/contacted?c=${encodeURIComponent(alert.contactedId)}`} className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {alert.name}
                    </Link>
                    {alert.company ? <span className="font-normal text-muted-foreground"> · {alert.company}</span> : null}
                  </p>
                  <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                    {alert.kind === 'signal' ? <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" /> : null}
                    <span>{alert.reason}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void reconnect(alert)} aria-label={`Retomar con ${alert.name}`}>
                    {busy === alert.contactedId ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Preparando…</> : 'Retomar'}
                  </Button>
                  {data.canPostpone ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy !== null} aria-label={`Más opciones para ${alert.name}`}>
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void mark(alert, 'snooze')}>Posponer 30 días</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void mark(alert, 'dismiss')}>No retomar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>
              {busy === alert.contactedId ? <p role="status" className="mt-2 text-xs text-muted-foreground">La IA está escribiendo un correo con un ángulo nuevo. Toma menos de un minuto.</p> : null}
              {rowError?.id === alert.contactedId ? (
                <p role="alert" className="mt-2 text-xs text-foreground/80">
                  {rowError.text}{' '}
                  {rowError.href ? <Link href={rowError.href} className="font-medium text-primary underline-offset-2 hover:underline">Investigar ahora</Link> : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {data.total > SHOWN ? (
            <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
              {expanded ? 'Ver menos' : `Ver las ${data.total}`}
            </Button>
          ) : <span />}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Avisarme después de
            <Select value={String(data.afterDays)} onValueChange={value => void changeAfter(value)}>
              <SelectTrigger className="h-8 w-[120px] text-xs" aria-label="Avisarme después de"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 días</SelectItem>
                <SelectItem value="60">60 días</SelectItem>
                <SelectItem value="90">90 días</SelectItem>
                <SelectItem value="0">Nunca</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
