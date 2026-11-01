'use client';

// The step right after saving contacts without email: what to look up for each one (work email, or email and mobile),
// with the cost, so they reach «Por escribir» without a stop in between.
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Phone } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { APOLLO_EMAIL_ENRICHMENT_CREDITS, APOLLO_PHONE_ENRICHMENT_CREDITS, apolloEnrichmentCreditCost } from '@/lib/apollo-credit-costs';
import type { ContactLookup } from '@/lib/leads-workspace/complete-contacts';

export type CompleteContactsPerson = { id: string; name: string; title?: string | null; company?: string | null };

const OPTIONS: Array<{ value: ContactLookup; label: string; short: string }> = [
  { value: 'email', label: 'Solo correo', short: 'Correo' },
  { value: 'email_phone', label: 'Correo + teléfono', short: 'Correo + teléfono' },
];

function Segmented({ value, onChange, label, compact, mixed }: { value: ContactLookup | null; onChange: (value: ContactLookup) => void; label: string; compact?: boolean; mixed?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex shrink-0 rounded-full bg-muted p-0.5', compact && 'w-full sm:w-auto')}>
      {OPTIONS.map(option => {
        const selected = !mixed && value === option.value;
        return (
          <button key={option.value} type="button" role="radio" aria-checked={selected} onClick={() => onChange(option.value)}
            className={cn('inline-flex items-center justify-center gap-1.5 rounded-full px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              compact ? 'h-8 flex-1 text-xs sm:h-7 sm:flex-none' : 'h-8 text-sm',
              selected ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
            {option.value === 'email' ? <Mail className="h-3.5 w-3.5" aria-hidden="true" /> : <Phone className="h-3.5 w-3.5" aria-hidden="true" />}
            {compact ? option.short : option.label}
          </button>
        );
      })}
    </div>
  );
}

export function CompleteContactsDialog({ open, onOpenChange, people, onConfirm, onSkip, skipLabel = 'Guardar sin buscar', loading }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: CompleteContactsPerson[];
  onConfirm: (lookups: Record<string, ContactLookup>) => void;
  /** Keeps them saved without looking anything up; they wait at the end of «Por escribir». */
  onSkip: () => void;
  skipLabel?: string;
  loading?: boolean;
}) {
  const [lookups, setLookups] = useState<Record<string, ContactLookup>>({});
  useEffect(() => {
    if (open) setLookups(Object.fromEntries(people.map(person => [person.id, 'email' as ContactLookup])));
  }, [open, people]);

  const values = useMemo(() => people.map(person => lookups[person.id] ?? 'email'), [people, lookups]);
  const all = values.every(value => value === values[0]) ? values[0] ?? 'email' : null;
  const withPhone = values.filter(value => value === 'email_phone').length;
  // What each lookup costs, the same figure Administración and the credit notices use: 1 for the email, 8 for email and mobile.
  const credits = values.reduce((sum, value) => sum + apolloEnrichmentCreditCost({ revealEmail: true, revealPhone: value === 'email_phone' }), 0);
  const setAll = (value: ContactLookup) => setLookups(Object.fromEntries(people.map(person => [person.id, value])));

  return (
    <Dialog open={open} onOpenChange={next => { if (!loading) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1.5 p-6 pb-4 text-left">
          <DialogTitle>{people.length === 1 ? 'Completa sus datos para escribirle' : `Completa los datos de ${people.length} contactos`}</DialogTitle>
          <DialogDescription>
            Buscamos su correo laboral y, si lo pides, su móvil. Quien tenga datos pasa directo a «Por escribir».
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border/60 bg-muted/20 px-6 py-3">
          <span className="text-sm font-medium">Para todos</span>
          <Segmented value={all} mixed={!all} onChange={setAll} label="Qué buscar para todos" />
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto px-6" aria-label="Qué buscar para cada contacto">
          {people.map(person => (
            <li key={person.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="min-w-0 sm:flex-1">
                <p className="truncate text-sm font-medium">{person.name || 'Sin nombre'}</p>
                {(person.title || person.company) && (
                  <p className="truncate text-xs text-muted-foreground">{[person.title, person.company].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              <Segmented compact value={lookups[person.id] ?? 'email'} onChange={value => setLookups(prev => ({ ...prev, [person.id]: value }))}
                label={`Qué buscar para ${person.name || 'este contacto'}`} />
            </li>
          ))}
        </ul>

        <DialogFooter className="flex-col-reverse gap-2 border-t border-border/60 p-6 pt-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
          <Button type="button" variant="ghost" onClick={onSkip} disabled={loading}>{skipLabel}</Button>
          <div className="flex flex-col items-stretch gap-1 sm:items-end">
            <Button type="button" onClick={() => onConfirm(lookups)} disabled={loading || people.length === 0}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {loading ? 'Buscando datos…' : `Buscar datos · ${credits} ${credits === 1 ? 'crédito' : 'créditos'}`}
            </Button>
            <p className="text-center text-xs text-muted-foreground sm:text-right" aria-live="polite">
              {withPhone ? `${withPhone} con móvil · ` : ''}Correo: {APOLLO_EMAIL_ENRICHMENT_CREDITS} crédito · Correo y móvil: {APOLLO_PHONE_ENRICHMENT_CREDITS}
            </p>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
