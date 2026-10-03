'use client';

import Link from 'next/link';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ActiveFilterChip, SearchStarter } from '@/lib/search/search-guidance';

/** «Empieza con…»: one tap fills the filters for a typical buyer of what the organization sells; everything stays editable. */
export function SearchStarters({ starters, onPick, disabled, missingIdealCustomer }: {
  starters: SearchStarter[];
  onPick: (starter: SearchStarter) => void;
  disabled?: boolean;
  /** No «Tu cliente ideal» in «Perfil» yet: say where to define it. */
  missingIdealCustomer?: boolean;
}) {
  if (starters.length === 0) return null;
  return (
    <section aria-label="Puntos de partida" className="space-y-2" data-tour="search-starters">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        Empieza con un punto de partida
      </p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {starters.map((starter) => (
          <button key={starter.id} type="button" disabled={disabled} onClick={() => onPick(starter)}
            className="rounded-xl border border-border/70 bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            <span className="block text-sm font-semibold">{starter.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{starter.description}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Llena los criterios de búsqueda; puedes cambiarlos antes de buscar.
        {missingIdealCustomer ? <> Define tu cliente ideal en <Link href="/profile" className="font-medium text-foreground underline underline-offset-2">Perfil</Link> para tener tu propio punto de partida.</> : null}
      </p>
    </section>
  );
}

/** Nothing came back: name the filters that narrow the search and let the person drop one with a tap. */
export function FilterRelaxHint({ chips, onRemove, disabled }: {
  chips: ActiveFilterChip[];
  onRemove: (chip: ActiveFilterChip) => void;
  disabled?: boolean;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm text-muted-foreground">Quita un filtro y vuelve a buscar:</p>
      <div className="flex flex-wrap justify-center gap-2">
        {chips.map((chip) => (
          <Button key={chip.field} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onRemove(chip)}
            aria-label={`Quitar ${chip.label}: ${chip.value}`} className="max-w-full">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="truncate"><span className="font-medium">{chip.label}:</span> {chip.value}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
