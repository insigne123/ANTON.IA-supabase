'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CHILE_REGIONS } from '@/lib/commercial-opportunities/hiring';
import { SEARCH_SOURCES, SEARCH_SOURCE_LABELS, type CriteriaDraft, type SearchSource } from '@/lib/commercial-opportunities/search-settings';
import { filterChip } from './OpportunityFilters';

const SOURCE_HINTS: Record<SearchSource, string> = {
  tenders: 'Las licitaciones abiertas de Mercado Público, cada mañana.',
  compraAgil: 'Las cotizaciones de Compra Ágil con tus palabras.',
  posts: 'Publicaciones de quienes cuentan que necesitan lo que ofreces.',
  hiring: 'Empresas que contratan los cargos que revelan una necesidad.',
};

function Lines({ id, label, hint, value, onChange, rows = 3 }: { id: string; label: string; hint?: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
    <Textarea id={id} value={value} onChange={event => onChange(event.target.value)} rows={rows} aria-describedby={hint ? `${id}-hint` : undefined} />
  </div>;
}

/**
 * «Qué buscamos» (OPP-51): where the daily search looks (each source on or off, the job ads every day or on Mondays) and what for. The
 * tenders get their own rules: an amount range and buyers to avoid leave one out before the AI reads it; buyers to follow, regions and
 * UNSPSC codes are preferences it weighs. LinkedIn's boxes show only while LinkedIn is on. Pure: the page keeps the draft and saves it.
 */
export function SearchCriteriaFields({ draft, onChange }: { draft: CriteriaDraft; onChange: (next: CriteriaDraft) => void }) {
  const set = <K extends keyof CriteriaDraft>(key: K, value: CriteriaDraft[K]) => onChange({ ...draft, [key]: value });
  const tenders = draft.sources.tenders || draft.sources.compraAgil;
  const linkedin = draft.sources.posts || draft.sources.hiring;
  const toggleRegion = (region: string) => set('regions', draft.regions.includes(region) ? draft.regions.filter(item => item !== region) : [...draft.regions, region]);
  return <div className="space-y-6">
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Fuentes</legend>
      <p className="text-xs text-muted-foreground">Lo que no te sirve se apaga: deja de buscarse y de gastar presupuesto.</p>
      <div className="divide-y rounded-xl border">
        {SEARCH_SOURCES.map(source => <div key={source} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <Label htmlFor={`op-source-${source}`} className="text-sm">{SEARCH_SOURCE_LABELS[source]}</Label>
            <p className="text-xs text-muted-foreground">{SOURCE_HINTS[source]}</p>
            {source === 'hiring' && draft.sources.hiring ? <div role="group" aria-label="Cada cuánto buscar avisos de trabajo" className="mt-2 flex gap-1">
              {([['day', 'Cada día'], ['week', 'Los lunes']] as const).map(([value, label]) =>
                <button key={value} type="button" aria-pressed={draft.hiringEvery === value} onClick={() => set('hiringEvery', value)} className={filterChip(draft.hiringEvery === value, 'sm')}>{label}</button>)}
            </div> : null}
          </div>
          <Switch id={`op-source-${source}`} checked={draft.sources[source]} onCheckedChange={checked => set('sources', { ...draft.sources, [source]: checked })} />
        </div>)}
      </div>
    </fieldset>

    {tenders ? <fieldset className="space-y-4">
      <legend className="text-sm font-semibold">Licitaciones y Compra Ágil</legend>
      <Lines id="op-criteria-keywords" label="Palabras que buscamos" hint="Una por línea. Compra Ágil busca algunas cada día." value={draft.keywords} onChange={value => set('keywords', value)} rows={4} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="op-min-amount">Monto mínimo (CLP) · opcional</Label>
          <Input id="op-min-amount" inputMode="numeric" placeholder="Ej.: 5.000.000" value={draft.minAmount} onChange={event => set('minAmount', event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="op-max-amount">Monto máximo (CLP) · opcional</Label>
          <Input id="op-max-amount" inputMode="numeric" placeholder="Sin máximo" value={draft.maxAmount} onChange={event => set('maxAmount', event.target.value)} /></div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Fuera del rango quedan en «No recomendadas» sin gastar en la IA. Las que no informan monto se leen igual.</p>
      <Lines id="op-avoid-buyers" label="Organismos que evitamos · opcional" hint="Uno por línea: sus licitaciones quedan fuera." value={draft.avoidBuyers} onChange={value => set('avoidBuyers', value)} rows={2} />
      <Lines id="op-buyers" label="Organismos que seguimos · opcional" hint="Uno por línea: la IA los pone más arriba." value={draft.buyers} onChange={value => set('buyers', value)} rows={2} />
      <div className="space-y-1.5">
        <p className="text-sm font-medium" id="op-regions-label">Regiones donde trabajamos · opcional</p>
        <div role="group" aria-labelledby="op-regions-label" className="flex flex-wrap gap-1.5">
          {CHILE_REGIONS.map(region => <button key={region} type="button" aria-pressed={draft.regions.includes(region)} onClick={() => toggleRegion(region)} className={filterChip(draft.regions.includes(region), 'sm')}>{region}</button>)}
        </div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="op-unspsc">Códigos UNSPSC · opcional</Label>
        <p id="op-unspsc-hint" className="text-xs text-muted-foreground">De 2 a 8 dígitos, separados por espacio. Un código corto incluye a los que empiezan con él.</p>
        <Input id="op-unspsc" inputMode="numeric" placeholder="Ej.: 7611 801116" value={draft.unspsc} onChange={event => set('unspsc', event.target.value)} aria-describedby="op-unspsc-hint" /></div>
    </fieldset> : null}

    {linkedin ? <fieldset className="space-y-4">
      <legend className="text-sm font-semibold">LinkedIn</legend>
      {draft.sources.posts ? <Lines id="op-criteria-postQueries" label="Búsquedas de publicaciones" hint="Una por línea. LinkedIn necesita al menos una." value={draft.postQueries} onChange={value => set('postQueries', value)} rows={5} /> : null}
      {draft.sources.hiring ? <Lines id="op-criteria-roles" label="Cargos en avisos de trabajo que revelan una necesidad" value={draft.roles} onChange={value => set('roles', value)} /> : null}
      <Lines id="op-criteria-decisionMakerTitles" label="Cargos de quienes deciden la compra" value={draft.decisionMakerTitles} onChange={value => set('decisionMakerTitles', value)} />
    </fieldset> : null}
  </div>;
}
