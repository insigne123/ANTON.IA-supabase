'use client';

import type { ReactNode } from 'react';

import { ActionBar } from '@/components/ui/action-bar';

/** The main action of the search results: «Buscar contactos» for the chosen companies, «Guardar» for the chosen people. */
export function ResultsActionBar({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return <ActionBar ariaLabel="Acción principal de los resultados" label={label} hint={hint}>{children}</ActionBar>;
}
