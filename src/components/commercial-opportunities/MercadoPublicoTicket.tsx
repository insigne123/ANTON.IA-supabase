'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { useConfirm } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  TICKET_EXAMPLE, TICKET_FORMAT_ERROR, TICKET_GUIDE, TICKET_PORTAL_URL, TICKET_SAVED, looksLikeTicket, ticketNeedsAction, ticketStatusLine,
  type TicketCheck, type TicketStatus,
} from '@/lib/commercial-opportunities/ticket';
import { cn } from '@/lib/utils';

/**
 * The person's own Mercado Público ticket (Plan 10): paste it and it is checked before saving, replace or remove it, and a
 * three-step guide to get one. The ticket never comes back from the server; the page shows its last four characters.
 */
const ENDPOINT = '/api/commercial-opportunities/ticket';

async function send(method: 'PUT' | 'DELETE', ticket?: string) {
  const response = await fetch(ENDPOINT, {
    method, cache: 'no-store',
    ...(ticket ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || 'No pudimos guardar el ticket. Intenta de nuevo.');
  return data as { ticket: TicketStatus; check?: TicketCheck };
}

/** Paste and check: the form of the card and of the guide's last step. */
function TicketForm({ onSaved, autoFocus }: { onSaved: (status: TicketStatus, message: string) => void; autoFocus?: boolean }) {
  const id = useId();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!looksLikeTicket(value)) { setError(TICKET_FORMAT_ERROR); return; }
    setSaving(true);
    setError('');
    try {
      const result = await send('PUT', value);
      setValue('');
      onSaved(result.ticket, TICKET_SAVED[result.check === 'busy' ? 'busy' : 'valid']);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pudimos guardar el ticket. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <Label htmlFor={`${id}-ticket`}>Tu ticket de Mercado Público</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id={`${id}-ticket`} value={value} onChange={event => { setValue(event.target.value); if (error) setError(''); }}
          placeholder={TICKET_EXAMPLE} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus={autoFocus}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : `${id}-hint`} className="min-w-0 font-mono text-sm sm:flex-1" />
        <Button type="submit" disabled={saving || !value.trim()} className="shrink-0">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? 'Probando…' : 'Probar y guardar'}
        </Button>
      </div>
      {error ? <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p> : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">Antes de guardarlo lo probamos con una consulta a Mercado Público. Queda cifrado y solo verás sus últimos 4 caracteres.</p>
      )}
    </form>
  );
}

/**
 * Without a ticket (or with one Mercado Público refused): the card to connect it, with the guide one click away. With a
 * ticket: one line with its last four characters and when it was checked, «Reemplazar» and «Quitar».
 */
export function MercadoPublicoTicketCard({ status, onChange, onOpenGuide, className }: {
  status: TicketStatus | null | undefined; onChange: (status: TicketStatus) => void; onOpenGuide: () => void; className?: string;
}) {
  const confirm = useConfirm();
  const headingId = useId();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const saved = (next: TicketStatus, message: string) => { onChange(next); setNotice(message); setEditing(false); };

  const remove = async () => {
    const confirmed = await confirm({
      title: '¿Quitar tu ticket de Mercado Público?',
      description: 'Dejarás de buscar licitaciones y Compra Ágil con él. La búsqueda diaria de tu organización sigue solo si otra persona conectó el suyo.',
      confirmLabel: 'Quitar ticket',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });
    if (!confirmed) return;
    setRemoving(true);
    setError('');
    setNotice('');
    try {
      onChange((await send('DELETE')).ticket);
      setNotice('Quitamos tu ticket.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pudimos quitar el ticket. Intenta de nuevo.');
    } finally {
      setRemoving(false);
    }
  };

  if (!status || editing || ticketNeedsAction(status)) {
    const title = status?.lastError ? 'Reemplaza tu ticket de Mercado Público'
      : status?.connected ? 'Reemplaza tu ticket de Mercado Público'
        : status?.shared ? 'Conecta tu propio ticket de Mercado Público' : 'Conecta tu ticket de Mercado Público';
    return (
      <section aria-labelledby={headingId} className={cn('rounded-xl border border-border/70 bg-card p-4 shadow-sm', className)}>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><KeyRound className="h-4 w-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="space-y-1">
              <h3 id={headingId} className="text-sm font-semibold text-foreground">{title}</h3>
              {status?.lastError
                ? <p role="alert" className="rounded-lg bg-cw-warning-soft px-2.5 py-1.5 text-sm text-cw-warning">{status.lastError}</p>
                : <p className="text-sm text-muted-foreground">Es gratis y personal. Con él buscamos para ti licitaciones y Compra Ágil cada mañana.</p>}
            </div>
            <TicketForm onSaved={saved} autoFocus={editing} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button type="button" variant="link" className="h-auto p-0" onClick={onOpenGuide}>¿No lo tienes? Cómo conseguirlo</Button>
              {editing ? <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button> : null}
            </div>
            {notice ? <p role="status" className="text-sm text-cw-success">{notice}</p> : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
        <Badge variant={status.connected ? 'success' : 'info'}>{status.connected ? 'Conectado' : 'Compartido'}</Badge>
        <span className="min-w-0 break-words">{ticketStatusLine(status)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => { setNotice(''); setEditing(true); }}>
          {status.connected ? 'Reemplazar' : 'Usar mi propio ticket'}
        </Button>
        {status.connected ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => void remove()} disabled={removing}>
            {removing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Quitar
          </Button>
        ) : null}
      </div>
      {notice ? <p role="status" className="text-sm text-cw-success">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** «Cómo conseguirlo»: what the ticket is, how to request it in the official portal, and pasting it here. */
export function TicketGuide({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: (status: TicketStatus) => void }) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  // Whatever opened the guide (a link in the card, the empty state) gets the focus back when it closes, if it is still there.
  const opener = useRef<HTMLElement | null>(null);
  // A layout effect runs before Radix moves the focus into the sheet (a passive effect of its child).
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement as HTMLElement | null;
    opener.current = active && typeof active.focus === 'function' && active !== document.body ? active : null;
    setStep(0); setDone(''); moved.current = false;
  }, [open]);
  // After «Siguiente» or «Atrás» the focus goes to the new step's title, so a screen reader reads it.
  useEffect(() => { if (open && moved.current) headingRef.current?.focus(); }, [open, step]);
  const go = (next: number) => { moved.current = true; setStep(next); };
  const last = TICKET_GUIDE.steps.length - 1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
        onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
        <SheetHeader className="space-y-1 pr-8 text-left">
          <SheetTitle>{TICKET_GUIDE.title}</SheetTitle>
          <SheetDescription>{TICKET_GUIDE.description}</SheetDescription>
        </SheetHeader>

        <ol aria-label="Pasos" className="mt-5 flex gap-1.5">
          {TICKET_GUIDE.steps.map((title, index) => (
            <li key={title} aria-current={index === step ? 'step' : undefined}
              className={cn('h-1.5 flex-1 rounded-full', index <= step ? 'bg-primary' : 'bg-muted')}>
              <span className="sr-only">Paso {index + 1}: {title}{index < step ? ' (hecho)' : ''}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs font-medium text-muted-foreground">Paso {step + 1} de {TICKET_GUIDE.steps.length}</p>
        <h3 ref={headingRef} tabIndex={-1} className="mt-1 text-base font-semibold text-foreground outline-none focus-visible:shadow-none">{TICKET_GUIDE.steps[step]}</h3>

        <div className="mt-3 flex-1 space-y-4 text-sm">
          {step === 0 ? (
            <ul className="space-y-2.5">
              {TICKET_GUIDE.what.map(item => (
                <li key={item.lead} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span><strong className="font-semibold text-foreground">{item.lead}</strong> <span className="text-muted-foreground">{item.text}</span></span>
                </li>
              ))}
            </ul>
          ) : step === 1 ? (
            <>
              <ol className="list-decimal space-y-2 pl-5 text-foreground marker:text-muted-foreground">
                {TICKET_GUIDE.request.map(item => <li key={item}>{item}</li>)}
              </ol>
              <Button asChild variant="outline">
                <a href={TICKET_PORTAL_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Abrir chilecompra.cl/api
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">{TICKET_GUIDE.noClaveUnica}</p>
            </>
          ) : done ? (
            <div role="status" className="flex gap-2 rounded-lg bg-cw-success-soft p-3 text-cw-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{done}</p>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground">Copia el ticket desde el correo de ChileCompra y pégalo aquí.</p>
              <TicketForm autoFocus onSaved={(status, message) => { onSaved(status); setDone(message); }} />
            </>
          )}
        </div>

        <SheetFooter className="mt-6 flex-row justify-between gap-2 sm:justify-between">
          {step > 0 && !done ? <Button type="button" variant="ghost" onClick={() => go(step - 1)}>Atrás</Button> : <span />}
          {step < last ? <Button type="button" onClick={() => go(step + 1)}>Siguiente</Button>
            : <Button type="button" variant={done ? 'default' : 'outline'} onClick={() => onOpenChange(false)}>{done ? 'Listo' : 'Cerrar'}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
