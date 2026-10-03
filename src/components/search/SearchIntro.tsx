'use client';

import { Building2, Save, Users } from 'lucide-react';

import { SearchStarters } from '@/components/search/SearchGuidance';
import type { SearchStarter } from '@/lib/search/search-guidance';

const STEPS = [
  { icon: Building2, title: 'Elige empresas', text: 'Filtra por rubro, sede o tamaño y marca las que te interesan.' },
  { icon: Users, title: 'Busca contactos', text: 'Por cargo y nivel, solo dentro de esas empresas.' },
  { icon: Save, title: 'Guarda los que sirven', text: 'Llegan a «Por completar», donde buscas su correo.' },
] as const;

/** Before the first search: how the search works, in three steps, and the starting points that fill the filters. */
export function SearchIntro({ starters, onPick, disabled, missingIdealCustomer }: {
  starters: SearchStarter[];
  onPick: (starter: SearchStarter) => void;
  disabled?: boolean;
  missingIdealCustomer?: boolean;
}) {
  return (
    <section aria-labelledby="search-intro-title" className="space-y-5 rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h2 id="search-intro-title" className="text-base font-semibold tracking-tight">Encuentra a quién escribirle</h2>
        <p className="text-sm text-foreground/70">La búsqueda va de empresas a personas, así cada contacto calza con tu cliente.</p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-xl bg-muted/40 p-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">{index + 1}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <step.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                {step.title}
              </span>
              <span className="mt-0.5 block text-xs text-foreground/70">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <SearchStarters starters={starters} onPick={onPick} disabled={disabled} missingIdealCustomer={missingIdealCustomer} />
    </section>
  );
}
