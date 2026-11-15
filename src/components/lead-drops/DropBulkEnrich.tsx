'use client';

import { useId } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DROP_EMAIL_AND_PHONE_CREDITS } from '@/lib/lead-drop-call';
import { cn } from '@/lib/utils';

/**
 * «Enriquecer los N» on the page the morning email opens (15 Nov 2026, the owner: «el botón que te deje darle a enriquecer todos con
 * teléfono + mail … o solo mail»). The email's button only brings the person here with its choice made: what looks the contacts up,
 * and uses the credits, is this button, never the arrival (a mail scanner follows links). A mobile's lookup brings the email with
 * it for the same credits, so there are two choices, not three: the email alone, or the email and the mobile.
 */
export function DropBulkEnrich({ count, phone, onPhone, onStart, running, disabled }: {
  /** How many contacts still have no email. */
  count: number;
  phone: boolean; onPhone: (phone: boolean) => void; onStart: () => void;
  /** The lookups going on: how many are done, and whether the answer to the person's inbox is being written. */
  running: { done: number; total: number; mailing: boolean } | null;
  disabled: boolean;
}) {
  const name = useId();
  const total = running?.total ?? count;
  const credits = (withPhone: boolean) => total * (withPhone ? DROP_EMAIL_AND_PHONE_CREDITS : 1);
  const choice = (withPhone: boolean, label: string, hint: string) => <label className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors',
    'focus-within:ring-2 focus-within:ring-ring', phone === withPhone ? 'border-primary bg-primary/5' : 'hover:bg-muted/50', (running || disabled) && 'cursor-not-allowed opacity-60')}>
    <input type="radio" name={name} className="mt-1 h-4 w-4 accent-primary" checked={phone === withPhone} disabled={Boolean(running) || disabled} onChange={() => onPhone(withPhone)} />
    <span className="min-w-0">
      <span className="block font-medium text-foreground">{label} · {credits(withPhone)} créditos</span>
      <span className="block text-muted-foreground">{hint}</span>
    </span>
  </label>;
  return <Card className="mt-6 rounded-2xl">
    <CardContent className="space-y-4 p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{`Enriquecer los ${total} de una vez`}</h2>
        <p className="text-sm text-muted-foreground">Al terminar te respondemos en tu correo, en la conversación de esta mañana, con cada campaña lista para aprobar.</p>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Qué buscar de cada contacto</legend>
        {choice(false, 'Solo correo', '1 crédito por contacto.')}
        {choice(true, 'Correo y teléfono', `${DROP_EMAIL_AND_PHONE_CREDITS} por contacto. El teléfono llega en minutos, con el guion de la llamada.`)}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onStart} disabled={Boolean(running) || disabled}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {running ? (running.mailing ? 'Preparando tu correo…' : `Buscando ${Math.min(running.done + 1, running.total)} de ${running.total}…`) : `Enriquecer los ${total} · ${credits(phone)} créditos`}
        </Button>
        <p className="text-xs text-muted-foreground" aria-live="polite">{running ? 'No cierres esta página hasta que termine.' : 'Los créditos se usan recién al confirmar aquí.'}</p>
      </div>
    </CardContent>
  </Card>;
}
