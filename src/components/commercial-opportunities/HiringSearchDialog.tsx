'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { CHILE_REGIONS } from '@/lib/commercial-opportunities/hiring';
import { MANUAL_JSEARCH_QUERIES, MAX_SEARCH_ROLES, hiringQueries, type RoleVariants } from '@/lib/commercial-opportunities/search-terms';
import { formatUsd } from '@/lib/commercial-opportunities/view';
import { cn } from '@/lib/utils';

export type HiringSearchChoice = { roles: string[]; regions: string[]; variants: RoleVariants; save: boolean };
type PlanSource = { source: 'jsearch' | 'linkedin'; label: string; enabled: boolean; requests: number; estimateUsd: number; missing: string | null };
type Plan = { sources: PlanSource[]; estimateUsd: number; queries: string[]; left: number };

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const regionLabel = (region: string) => (region === 'Metropolitana' ? 'Metropolitana (Santiago)' : region);

/**
 * «Buscar ahora» for companies that are hiring (Plan 15): the person chooses the roles and the regions right here, sees the
 * variants each role brings (other names and the English title, which they can take out), what each source will be asked
 * and what it may cost, and decides whether the daily search keeps these choices.
 */
export function HiringSearchDialog({ open, onOpenChange, initialRoles, initialRegions, month, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; initialRoles: string[]; initialRegions: string[];
  month: { spentUsd: number; capUsd: number }; onConfirm: (choice: HiringSearchChoice) => void;
}) {
  const [roles, setRoles] = useState<string[]>(initialRoles);
  const [draft, setDraft] = useState('');
  const [regions, setRegions] = useState<string[]>(initialRegions);
  const [save, setSave] = useState(true);
  const [proposed, setProposed] = useState<RoleVariants>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  const request = useRef(0);

  useEffect(() => {
    if (!open) return;
    setRoles(initialRoles); setRegions(initialRegions); setDraft(''); setSave(true); setRemoved(new Set()); setProblem('');
  }, [open, initialRoles, initialRegions]);

  // The variants and the plan come from the server; asked again half a second after the roles or regions change.
  useEffect(() => {
    if (!open) return;
    const id = ++request.current;
    if (!roles.length) { setPlan(null); setProposed({}); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/commercial-opportunities/plan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roles, regions }),
        });
        const data = await response.json().catch(() => ({}));
        if (id !== request.current) return;
        if (!response.ok) throw new Error((data as { error?: string }).error || 'No pudimos preparar la búsqueda.');
        setProposed((data as { variants?: RoleVariants }).variants || {});
        setPlan((data as { plan: Plan }).plan);
        setProblem('');
      } catch (failure) {
        if (id === request.current) { setPlan(null); setProblem(failure instanceof Error ? failure.message : 'No pudimos preparar la búsqueda.'); }
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [open, roles, regions]);

  const variants = useMemo(() => Object.fromEntries(Object.entries(proposed)
    .map(([role, list]) => [role, list.filter(variant => !removed.has(fold(variant)))])
    .filter(([, list]) => list.length)) as RoleVariants, [proposed, removed]);
  // The cost follows the variants the person kept: Google for Jobs charges each question.
  const local = useMemo(() => hiringQueries(roles, variants, regions, MANUAL_JSEARCH_QUERIES), [roles, variants, regions]);
  const sources = (plan?.sources || []).map(source => {
    if (source.source !== 'jsearch') return { ...source, enabled: source.enabled && roles.length > 0 };
    const perRequest = source.requests ? source.estimateUsd / source.requests : 0.0025;
    return { ...source, enabled: !source.missing && local.queries.length > 0, requests: local.queries.length,
      estimateUsd: Math.round(local.queries.length * perRequest * 10_000) / 10_000 };
  });
  const estimate = Math.round(sources.filter(source => source.enabled).reduce((sum, source) => sum + source.estimateUsd, 0) * 10_000) / 10_000;
  const overCap = month.spentUsd + estimate > month.capUsd;
  const noSource = Boolean(plan) && sources.every(source => source.missing);

  const addRole = () => {
    const role = draft.replace(/\s+/g, ' ').trim().slice(0, 80);
    setDraft('');
    if (role.length < 2 || roles.some(item => fold(item) === fold(role)) || roles.length >= MAX_SEARCH_ROLES) return;
    setRoles(current => [...current, role]);
  };
  const toggleRegion = (region: string) => setRegions(current => current.includes(region)
    ? current.filter(item => item !== region) : CHILE_REGIONS.filter(item => item === region || current.includes(item)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Buscar empresas que están contratando</DialogTitle>
          <DialogDescription>Elige los cargos y dónde. Buscamos también las otras formas en que las empresas los escriben.</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="hiring-search-roles" className="space-y-2">
          <Label id="hiring-search-roles" htmlFor="hiring-search-role-input">Cargos</Label>
          {roles.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Cargos elegidos">
              {roles.map(role => (
                <li key={role} className="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-sm font-medium text-primary">
                  {role}
                  <button type="button" onClick={() => setRoles(current => current.filter(item => item !== role))}
                    className="rounded-full p-0.5 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Quitar ${role}`}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Input id="hiring-search-role-input" value={draft} maxLength={80} placeholder={roles.length ? 'Agregar otro cargo' : 'Ej. cajero, bodeguero, guardia'}
              onChange={event => setDraft(event.target.value)} aria-describedby="hiring-search-roles-hint"
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addRole(); }
                if (event.key === 'Backspace' && !draft && roles.length) setRoles(current => current.slice(0, -1));
              }} />
            <Button type="button" variant="outline" onClick={addRole} disabled={draft.trim().length < 2 || roles.length >= MAX_SEARCH_ROLES}>
              <Plus className="h-4 w-4" aria-hidden="true" />Agregar
            </Button>
          </div>
          <p id="hiring-search-roles-hint" className="text-xs text-muted-foreground">
            Escribe un cargo y pulsa Enter. «Cajera» y «cajeros» ya cuentan como «cajero». Hasta {MAX_SEARCH_ROLES} cargos.
          </p>
        </section>

        {roles.length ? (
          <section aria-labelledby="hiring-search-variants" className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <h3 id="hiring-search-variants" className="text-sm font-medium text-foreground">También buscamos</h3>
            {loading ? (
              <div className="space-y-2" aria-busy="true"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-1/2" /><span className="sr-only">Buscando otras formas de escribir los cargos</span></div>
            ) : Object.keys(variants).length ? (
              <ul className="space-y-1.5">
                {roles.filter(role => variants[role]?.length).map(role => (
                  <li key={role} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-medium text-foreground">{role}:</span>
                    {variants[role].map(variant => (
                      <span key={variant} className="flex items-center gap-1 rounded-full bg-background py-0.5 pl-2 pr-1 text-foreground ring-1 ring-border/70">
                        {variant}
                        <button type="button" onClick={() => setRemoved(current => new Set(current).add(fold(variant)))}
                          className="rounded-full p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`No buscar ${variant}`}>
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted-foreground">Sin otras formas para estos cargos: buscamos tal como los escribiste.</p>}
          </section>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Dónde</legend>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={!regions.length} onClick={() => setRegions([])}
              className={cn('rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                !regions.length ? 'bg-primary text-primary-foreground ring-primary' : 'bg-background text-foreground ring-border hover:bg-muted')}>
              Todo Chile
            </button>
            {CHILE_REGIONS.map(region => (
              <button key={region} type="button" aria-pressed={regions.includes(region)} onClick={() => toggleRegion(region)}
                className={cn('rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  regions.includes(region) ? 'bg-primary text-primary-foreground ring-primary' : 'bg-background text-foreground ring-border hover:bg-muted')}>
                {regionLabel(region)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Con regiones, cada cargo se busca en cada una y los avisos de otras regiones no cuentan.</p>
        </fieldset>

        <section aria-label="Fuentes y costo" className="space-y-2">
          {!roles.length ? null : !plan && loading ? <Skeleton className="h-16 w-full" /> : (
            <ul className="space-y-2 text-sm">
              {sources.map(source => (
                <li key={source.source} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                  <div>
                    <p className="font-medium text-foreground">{source.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {source.missing ? 'No está conectada' : source.source === 'jsearch' ? `${source.requests} consultas, avisos del último mes` : `hasta ${source.requests} avisos de los últimos 7 días`}
                    </p>
                  </div>
                  <span className={cn('shrink-0 tabular-nums', source.enabled ? 'text-foreground' : 'text-muted-foreground')}>{source.enabled ? `hasta ${formatUsd(source.estimateUsd)}` : 'no se usa'}</span>
                </li>
              ))}
            </ul>
          )}
          {local.left ? <p className="text-xs text-cw-warning">{local.left} {local.left === 1 ? 'consulta no cabe' : 'consultas no caben'} en esta búsqueda: quita cargos, variantes o regiones para incluirlas.</p> : null}
          {roles.length ? (
            <p className="text-sm text-foreground">
              Costo máximo: <strong>{formatUsd(estimate)}</strong>. Este mes llevas {formatUsd(month.spentUsd)} de {formatUsd(month.capUsd)}.
            </p>
          ) : null}
          {overCap ? <p className="rounded-lg bg-cw-warning-soft px-3 py-2 text-sm text-cw-warning">Esta búsqueda pasaría el tope de gasto del mes. Quita cargos o regiones, o pide a quien administra ANTON.IA que suba el tope.</p> : null}
          {noSource ? <p className="rounded-lg bg-cw-warning-soft px-3 py-2 text-sm text-cw-warning">Ninguna fuente de avisos está conectada. Pide a quien administra ANTON.IA que las active.</p> : null}
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        </section>

        <label className="flex items-start gap-2 text-sm text-foreground">
          <Checkbox checked={save} onCheckedChange={checked => setSave(checked === true)} className="mt-0.5" />
          <span>Usar estos cargos y regiones en la búsqueda diaria</span>
        </label>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" disabled={!roles.length || loading || !plan || overCap || noSource}
            onClick={() => onConfirm({ roles, regions, variants, save })}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}Buscar ahora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
