'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { MercadoPublicoTicketCard, TicketGuide } from '@/components/commercial-opportunities/MercadoPublicoTicket';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TicketStatus } from '@/lib/commercial-opportunities/ticket';

/**
 * Conexiones: the person's own Mercado Público ticket (Plan 10), for whoever can open «Oportunidades». It asks the same
 * access question as the menu first; without that access the card is not shown at all.
 */
export function MercadoPublicoConnectionCard() {
  const [status, setStatus] = useState<TicketStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      // The same question as the menu, which answers 200 to everyone: people without «Oportunidades» never hit a 404.
      const access = await fetch('/api/commercial-opportunities/access', { cache: 'no-store' });
      const available = access.ok && ((await access.json().catch(() => ({}))) as { available?: boolean }).available === true;
      if (!available) { setHidden(true); return; }
      const response = await fetch('/api/commercial-opportunities/ticket', { cache: 'no-store' });
      if (response.status === 404) { setHidden(true); return; }
      if (!response.ok) throw new Error(String(response.status));
      setStatus(((await response.json()) as { ticket: TicketStatus }).ticket);
    } catch {
      setError('No pudimos revisar tu ticket de Mercado Público.');
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Nothing until the first answer: people without «Oportunidades» never see the card appear and go.
  if (hidden || !loaded) return null;
  return (
    <>
      <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)] dark:bg-card/70">
        <CardHeader className="border-b border-border/60 px-5 py-5 sm:px-6">
          <CardTitle className="text-lg">Mercado Público</CardTitle>
          <CardDescription>Tu ticket personal para buscar licitaciones y Compra Ágil en Oportunidades.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-5 py-5 sm:px-6">
          {error ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              {error}
              <Button variant="ghost" size="sm" onClick={() => void load()}>Reintentar</Button>
            </p>
          ) : status ? (
            <MercadoPublicoTicketCard status={status} onChange={setStatus} onOpenGuide={() => setGuideOpen(true)} className="border-0 p-0 shadow-none" />
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Revisando tu ticket…
            </p>
          )}
        </CardContent>
      </Card>
      <TicketGuide open={guideOpen} onOpenChange={setGuideOpen} onSaved={setStatus} />
    </>
  );
}
