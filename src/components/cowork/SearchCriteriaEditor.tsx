'use client';

import { useId, useState } from 'react';
import { COWORK_SEARCH_MAX, coworkSearchStrategy, type CoworkSearchCriteria } from '@/lib/cowork/search-proposal';
import { cn } from '@/lib/utils';
import { ReviewError } from './ReviewParts';
import { CwButton } from './ui';

const field = 'w-full rounded-lg border border-cw-border-strong bg-cw-elevated px-2.5 text-[13.5px] text-cw-text placeholder:text-cw-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-60';

/** One term per line: a place keeps its comma («Santiago, Chile»). The server splits a packed title as Cowork's own. */
export function coworkTermsFromText(text: string) {
  return text.split('\n').map(term => term.trim()).filter(Boolean).slice(0, 5);
}

type Draft = { titles: string; industries: string; locations: string; companyLocations: string; limit: string };

/**
 * «Editar criterios» of a search Cowork proposes (COW-29): the cargos, the sectores, the place and how many, as the card shows
 * them. Saving changes the search that waits for approval; the approval then runs what the card shows.
 */
export function SearchCriteriaEditor({ runId, criteria, onSaved, onCancel }: {
  runId: string; criteria: CoworkSearchCriteria;
  onSaved: (criteria: CoworkSearchCriteria) => void; onCancel: () => void;
}) {
  const ids = useId();
  const companies = coworkSearchStrategy(criteria) === 'companies';
  const companiesFirst = coworkSearchStrategy(criteria) === 'companies_first';
  const [draft, setDraft] = useState<Draft>({
    titles: criteria.titles.join('\n'), industries: criteria.industries.join('\n'), locations: criteria.locations.join('\n'),
    companyLocations: (criteria.companyLocations || []).join('\n'), limit: String(criteria.limit),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const limit = Number(draft.limit);
  const limitOk = Number.isInteger(limit) && limit >= 1 && limit <= COWORK_SEARCH_MAX;

  const save = async () => {
    setSaving(true); setError('');
    try {
      const body = companies
        ? { industries: coworkTermsFromText(draft.industries), companyLocations: coworkTermsFromText(draft.companyLocations), limit }
        : { titles: coworkTermsFromText(draft.titles), industries: coworkTermsFromText(draft.industries), locations: coworkTermsFromText(draft.locations), limit };
      const response = await fetch(`/api/cowork/runs/${runId}/search-approval`, {
        method: 'PATCH', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar el cambio de la búsqueda.');
      onSaved(data.criteria as CoworkSearchCriteria);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No se pudo guardar el cambio de la búsqueda.');
    } finally {
      setSaving(false);
    }
  };

  const input = (key: keyof Draft, label: string, placeholder: string) => <div>
    <label htmlFor={`${ids}-${key}`} className="mb-1 block text-[12.5px] font-medium text-cw-text">{label}</label>
    <textarea id={`${ids}-${key}`} className={cn(field, 'block resize-y py-1.5 leading-6')} rows={Math.min(5, Math.max(2, draft[key].split('\n').length))}
      value={draft[key]} disabled={saving} placeholder={placeholder} aria-describedby={`${ids}-hint`}
      onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
  </div>;

  return <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (limitOk) void save(); }}>
    <p id={`${ids}-hint`} className="text-[12.5px] text-cw-muted">Uno por línea; hasta 5 en cada uno.</p>
    {!companies && input('titles', companiesFirst ? 'Cargos (y parecidos)' : 'Cargos', 'Gerente de Personas\nJefe de Selección')}
    {input('industries', companiesFirst ? 'Rubros de las empresas' : 'Sectores', 'Retail\nLogística')}
    {companies ? input('companyLocations', 'Ubicación de las empresas', 'Chile') : input('locations', 'Ubicación de la persona', 'Santiago, Chile')}
    <div>
      <label htmlFor={`${ids}-limit`} className="mb-1 block text-[12.5px] font-medium text-cw-text">Cantidad</label>
      <input id={`${ids}-limit`} type="number" inputMode="numeric" min={1} max={COWORK_SEARCH_MAX} className={cn(field, 'h-9 w-28 tabular-nums')}
        value={draft.limit} disabled={saving} aria-invalid={!limitOk} onChange={event => setDraft({ ...draft, limit: event.target.value })} />
      {!limitOk && <p role="alert" className="mt-1 text-[12.5px] text-cw-danger">{`Elige entre 1 y ${COWORK_SEARCH_MAX}.`}</p>}
    </div>
    {error && <ReviewError message={error} />}
    <div className="flex flex-wrap justify-end gap-2">
      <CwButton variant="ghost" size="sm" disabled={saving} onClick={onCancel}>Cancelar</CwButton>
      <CwButton type="submit" variant="primary" size="sm" disabled={saving || !limitOk}>{saving ? 'Guardando…' : 'Guardar cambios'}</CwButton>
    </div>
  </form>;
}
