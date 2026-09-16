'use client';

import { useMemo, useState } from 'react';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import type { CoworkEvent } from '@/lib/cowork/contracts';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ExportMenu } from './ExportMenu';
import { StartResearch } from './StartResearch';
import { SaveContact } from './SaveContact';

export function ContactResults({ runId, events, onError, onAccessDenied, canResearch = false, onUseReport }: {
  runId: string;
  events: CoworkEvent[];
  onError: (message: string) => void;
  onAccessDenied: () => void;
  canResearch?: boolean;
  onUseReport?: (leadId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const observations = useMemo(() => events.filter(event => event.kind === 'tool.completed').map(event => event.payload), [events]);
  const rows = useMemo(() => collectCoworkLeadRows(observations), [observations]);
  const filtered = rows.filter(row => [row.name, row.company, row.title, row.email]
    .some(value => String(value || '').toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))));
  const partial = observations.some(observation => {
    const result = observation.result as { truncated?: boolean } | null;
    return result?.truncated === true;
  });
  if (!rows.length) return null;

  return <section aria-label="Contactos consultados" className="min-w-0 overflow-hidden rounded-xl border border-border">
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><h3 className="font-medium">Contactos consultados</h3><p className="text-xs text-muted-foreground">{rows.length} contactos · {rows.some(row => row.id.startsWith('apollo:')) ? 'Incluye resultados externos no guardados' : 'Contactos propios'} · Resultado guardado</p></div>
      <ExportMenu runId={runId} kind="contacts" onError={onError} onAccessDenied={onAccessDenied} />
    </div>
    <div className="px-4 pb-4">
      <Label htmlFor={`contacts-filter-${runId}`} className="text-sm">Filtrar este resultado</Label>
      <Input id={`contacts-filter-${runId}`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre, empresa, cargo o correo" className="mt-2" />
      <p className="mt-2 text-xs text-muted-foreground">La descarga incluye los {rows.length} contactos consultados, sin aplicar este filtro.</p>
      {partial && <p className="mt-2 text-xs text-muted-foreground">Una consulta alcanzó el límite de resultados. Esta lista no representa toda tu base.</p>}
    </div>
    <p role="status" className="sr-only">{filtered.length} contactos visibles</p>
    {filtered.length === 0 ? <p className="border-t border-border p-4 text-sm text-muted-foreground">No hay coincidencias. Cambia o borra el filtro.</p> : <ul className="max-h-96 divide-y divide-border overflow-y-auto border-t border-border">
      {filtered.map(row => <li key={row.id} className="grid min-w-0 gap-2 p-4 sm:grid-cols-2">
        <div className="min-w-0"><p className="break-words text-sm font-medium">{String(row.name || 'Nombre no disponible')}</p><p className="break-words text-xs text-muted-foreground">{[row.title, row.company].filter(Boolean).join(' · ') || 'Cargo y empresa no disponibles'}</p></div>
        <div className="min-w-0 sm:text-right"><p className="break-all text-sm">{String(row.email || 'Correo no disponible')}</p><p className="break-words text-xs text-muted-foreground">{String(row.location || '')}</p></div>
        {row.id.startsWith('apollo:') && <SaveContact runId={runId} providerId={row.id} onAccessDenied={onAccessDenied} onUseContact={id => onUseReport?.(id)} />}
        {canResearch && !row.id.startsWith('apollo:') && <StartResearch runId={runId} leadId={row.id} onAccessDenied={onAccessDenied} onUseReport={() => onUseReport?.(row.id)} />}
      </li>)}
    </ul>}
  </section>;
}
