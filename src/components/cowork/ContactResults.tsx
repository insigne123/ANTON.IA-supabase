'use client';

import { useMemo, useState } from 'react';
import { Building2, ExternalLink, Search } from 'lucide-react';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import type { CoworkEvent } from '@/lib/cowork/contracts';
import { coworkContactsTitle } from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';
import { ExportMenu } from './ExportMenu';
import { StartResearch } from './StartResearch';
import { EnrichContact } from './EnrichContact';
import { SaveContact } from './SaveContact';

const AVATAR_TONES = [
  'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200',
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·';
}

function tone(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

function safeUrl(value: unknown) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

export function ContactResults({ runId, events, onError, onAccessDenied, canResearch = false, onUseReport, showHeader = true }: {
  runId: string;
  events: CoworkEvent[];
  onError: (message: string) => void;
  onAccessDenied: () => void;
  canResearch?: boolean;
  onUseReport?: (leadId: string) => void;
  showHeader?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [enriched, setEnriched] = useState<Record<string, string | null>>({});
  const observations = useMemo(() => events.filter(event => event.kind === 'tool.completed').map(event => event.payload), [events]);
  const rows = useMemo(() => collectCoworkLeadRows(observations), [observations]);
  const { title: heading, noun, companies: companiesOnly, external } = coworkContactsTitle(rows);
  const term = search.trim().toLocaleLowerCase('es');
  const filtered = rows.filter(row => [row.name, row.company, row.title, row.email, row.domain, row.location]
    .some(value => String(value || '').toLocaleLowerCase('es').includes(term)));
  const partial = observations.some(observation => {
    const result = observation.result as { truncated?: boolean } | null;
    return result?.truncated === true;
  });
  if (!rows.length) return null;

  return <section aria-label={heading} className="min-w-0">
    {showHeader && <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight">{heading}</h3>
        <p className="mt-0.5 text-[12.5px] text-cw-muted">{rows.length} {noun(rows.length)} · {external ? 'Incluye resultados externos no guardados' : 'Contactos propios'}</p>
      </div>
      <ExportMenu runId={runId} kind="contacts" onError={onError} onAccessDenied={onAccessDenied} />
    </div>}
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`contacts-filter-${runId}`} className="sr-only">Filtrar este resultado</label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cw-faint" aria-hidden="true" />
          <input id={`contacts-filter-${runId}`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Filtrar por nombre, empresa, cargo o correo"
            className="h-9 w-full rounded-[10px] border border-cw-border bg-cw-elevated pl-9 pr-3 text-[13.5px] text-cw-text placeholder:text-cw-faint focus-visible:border-cw-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]" />
        </div>
        {!showHeader && <ExportMenu runId={runId} kind="contacts" onError={onError} onAccessDenied={onAccessDenied} />}
      </div>
      <p className="text-[12px] text-cw-muted">La descarga incluye {rows.length} {noun(rows.length)}, sin aplicar este filtro.</p>
      {partial && <p className="rounded-lg bg-cw-warning-soft px-2.5 py-1.5 text-[12px] text-cw-warning">Una consulta alcanzó el límite de resultados. Esta lista no representa toda tu base.</p>}
    </div>
    <p role="status" className="sr-only">{filtered.length} {noun(filtered.length)} {filtered.length === 1 ? 'visible' : 'visibles'}</p>
    {filtered.length === 0
      ? <p className="mt-3 rounded-xl border border-dashed border-cw-border px-4 py-6 text-center text-[13px] text-cw-muted">No hay coincidencias. Cambia o borra el filtro.</p>
      : <ul className="mt-3 divide-y divide-cw-border overflow-hidden rounded-2xl border border-cw-border bg-cw-elevated">
        {filtered.map(row => {
          const company = row.id.startsWith('apollo-company:');
          const name = String(row.name || (company ? 'Empresa sin nombre' : 'Nombre no disponible'));
          const profile = safeUrl(row.linkedin_url) || safeUrl(row.company_website) || safeUrl(row.company_linkedin);
          const subtitle = company ? String(row.industry || 'Sector no informado')
            : [row.title, row.company].filter(Boolean).join(' · ') || 'Cargo y empresa no disponibles';
          const contact = company ? String(row.domain || 'Dominio no disponible')
            : String(row.email || enriched[row.id] || 'Correo no disponible');
          const hasContact = company ? Boolean(row.domain) : Boolean(row.email || enriched[row.id]);
          return <li key={row.id} className="group px-4 py-3 transition-colors hover:bg-cw-panel">
            <div className="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,0.9fr)]">
              <span aria-hidden="true" className={cn('row-span-2 mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold', tone(name))}>
                {company ? <Building2 className="h-4 w-4" /> : initials(name)}
              </span>
              <div className="min-w-0">
                <p className="flex min-w-0 items-center gap-1.5 text-[14px] font-medium">
                  <span className="truncate">{name}</span>
                  {profile && <a href={profile} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded text-cw-faint hover:text-cw-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]" aria-label={`Abrir perfil de ${name}`}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>}
                </p>
                <p className="truncate text-[12.5px] text-cw-muted">{subtitle}</p>
              </div>
              <div className="col-start-2 min-w-0 sm:col-start-3 sm:row-start-1 sm:text-right">
                {row.id.startsWith('apollo:') && !hasContact
                  ? <p><span className="inline-flex rounded-md bg-cw-hover px-1.5 py-0.5 text-[11.5px] font-medium text-cw-muted">No guardado · sin correo</span></p>
                  : <p className={hasContact ? 'truncate text-[13px] text-cw-text' : 'truncate text-[13px] text-cw-faint'}>{contact}</p>}
                <p className="truncate text-[12px] text-cw-muted">{String(row.location || '')}{company ? `${row.location ? ' · ' : ''}${row.employees == null ? 'Dotación no informada' : `${row.employees} empleados`}` : ''}</p>
              </div>
            </div>
            {(row.id.startsWith('apollo:') || (canResearch && !company)) && <div className="mt-2 pl-11">
              {row.id.startsWith('apollo:') && <SaveContact runId={runId} providerId={row.id} onAccessDenied={onAccessDenied} onUseContact={id => onUseReport?.(id)} />}
              {canResearch && !row.id.startsWith('apollo:') && !company && <>
                {(row.email || row.id in enriched)
                  ? <StartResearch key={`${row.id}:${row.id in enriched ? 'enriched' : 'email'}`} runId={runId} leadId={row.id} onAccessDenied={onAccessDenied} onUseReport={() => onUseReport?.(row.id)} />
                  : <EnrichContact runId={runId} leadId={row.id} displayName={name} company={String(row.company || '')} onAccessDenied={onAccessDenied}
                    onEnriched={email => setEnriched(previous => ({ ...previous, [row.id]: email }))} />}
              </>}
            </div>}
          </li>;
        })}
      </ul>}
    {companiesOnly && <p className="mt-2 text-[12px] text-cw-muted">Son empresas, no contactos: pide buscar personas en sus dominios para continuar.</p>}
  </section>;
}
