'use client';

import { useMemo, useState } from 'react';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import type { CoworkEvent } from '@/lib/cowork/contracts';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ExportMenu } from './ExportMenu';
import { StartResearch } from './StartResearch';
import { SaveContact } from './SaveContact';

export function ContactResults({ runId, events, onError, onAccessDenied, canResearch = false, onUseReport, onEnrichLead }: {
  runId: string;
  events: CoworkEvent[];
  onError: (message: string) => void;
  onAccessDenied: () => void;
  canResearch?: boolean;
  onUseReport?: (leadId: string) => void;
  onEnrichLead?: (leadId: string, displayName: string) => void;
}) {
  const [search, setSearch] = useState('');
  const observations = useMemo(() => events.filter(event => event.kind === 'tool.completed').map(event => event.payload), [events]);
  const rows = useMemo(() => collectCoworkLeadRows(observations), [observations]);
  const companiesOnly = rows.length > 0 && rows.every(row => row.id.startsWith('apollo-company:'));
  const hasCompanies = rows.some(row => row.id.startsWith('apollo-company:'));
  const noun = companiesOnly ? 'empresas' : hasCompanies ? 'resultados' : 'contactos';
  const heading = companiesOnly ? 'Empresas consultadas' : hasCompanies ? 'Resultados consultados' : 'Contactos consultados';
  const filtered = rows.filter(row => [row.name, row.company, row.title, row.email, row.domain]
    .some(value => String(value || '').toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))));
  const partial = observations.some(observation => {
    const result = observation.result as { truncated?: boolean } | null;
    return result?.truncated === true;
  });
  if (!rows.length) return null;

  return <section aria-label={heading} className="min-w-0 overflow-hidden rounded-xl border border-border">
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><h3 className="font-medium">{heading}</h3><p className="text-xs text-muted-foreground">{rows.length} {noun} · {rows.some(row => row.id.startsWith('apollo:') || row.id.startsWith('apollo-company:')) ? 'Incluye resultados externos no guardados' : 'Contactos propios'} · Resultado guardado</p></div>
      <ExportMenu runId={runId} kind="contacts" onError={onError} onAccessDenied={onAccessDenied} />
    </div>
    <div className="px-4 pb-4">
      <Label htmlFor={`contacts-filter-${runId}`} className="text-sm">Filtrar este resultado</Label>
      <Input id={`contacts-filter-${runId}`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre, empresa, cargo o correo" className="mt-2" />
      <p className="mt-2 text-xs text-muted-foreground">La descarga incluye {rows.length} {noun}, sin aplicar este filtro.</p>
      {partial && <p className="mt-2 text-xs text-muted-foreground">Una consulta alcanzó el límite de resultados. Esta lista no representa toda tu base.</p>}
    </div>
    <p role="status" className="sr-only">{filtered.length} {noun} visibles</p>
    {filtered.length === 0 ? <p className="border-t border-border p-4 text-sm text-muted-foreground">No hay coincidencias. Cambia o borra el filtro.</p> : <ul className="max-h-96 divide-y divide-border overflow-y-auto border-t border-border">
      {filtered.map(row => <li key={row.id} className="grid min-w-0 gap-2 p-4 sm:grid-cols-2">
        <div className="min-w-0"><p className="break-words text-sm font-medium">{String(row.name || 'Nombre no disponible')}</p><p className="break-words text-xs text-muted-foreground">{row.id.startsWith('apollo-company:') ? String(row.industry || 'Sector no informado') : [row.title, row.company].filter(Boolean).join(' · ') || 'Cargo y empresa no disponibles'}</p></div>
        <div className="min-w-0 sm:text-right"><p className="break-all text-sm">{String(row.id.startsWith('apollo-company:') ? row.domain || 'Dominio no disponible' : row.email || 'Correo no disponible')}</p><p className="break-words text-xs text-muted-foreground">{String(row.location || '')}</p>{row.id.startsWith('apollo-company:') && <p className="text-xs text-muted-foreground">{row.employees == null ? 'Dotación no informada' : `${row.employees} empleados`}</p>}</div>
        {row.id.startsWith('apollo:') && <SaveContact runId={runId} providerId={row.id} onAccessDenied={onAccessDenied} onUseContact={id => onUseReport?.(id)} />}
        {canResearch && !row.id.startsWith('apollo:') && !row.id.startsWith('apollo-company:') && <>
          {!row.email && onEnrichLead && <div className="space-y-1 text-xs sm:col-span-2">
            <button type="button" className="font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onEnrichLead(row.id, String(row.name || 'este contacto'))}>Enriquecer contacto primero</button>
            <p className="text-muted-foreground">Sin correo, la investigación rinde menos: primero el dato, después el informe.</p>
          </div>}
          <StartResearch runId={runId} leadId={row.id} onAccessDenied={onAccessDenied} onUseReport={() => onUseReport?.(row.id)} />
        </>}
      </li>)}
    </ul>}
  </section>;
}
