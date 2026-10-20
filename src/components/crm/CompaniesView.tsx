'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, Check, ChevronRight, ExternalLink, Loader2, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { InitialsAvatar } from '@/components/initials-avatar';
import { CompanyLogo } from './CompanyLogo';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { buildCompanies, companyKey, coverageGrid, industryLabel, LEVELS, levelLabel, areaLabel, sizeBands, type Company, type CommitteeSlot } from '@/lib/companies/coverage';
import { similarSearchError } from '@/lib/companies/similar';
import { PIPELINE_STAGES } from '@/lib/crm-types';
import { searchCompanies } from '@/lib/leads-client';
import { companySearchHref } from '@/lib/search/company-prefill';
import { profileService } from '@/lib/services/profile-service';
import { cn } from '@/lib/utils';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

type Similar = { id: string; name: string; industry?: string | null; size?: number | null; city?: string | null; country?: string | null; domain?: string | null; why?: string };
type SimilarState = { status: 'loading' } | { status: 'ready'; items: Similar[]; note?: string; found?: Similar[] } | { status: 'error'; text: string };
/** What the company does, from its own website (api/crm/companies/about): read once per company opened. */
type About = { status: 'loading' } | { status: 'ready'; text: string | null; website: string };

const stageLabel = (stage: string) => PIPELINE_STAGES.find(item => item.id === stage)?.label ?? 'Nuevos';
const SLOT_HINT: Record<CommitteeSlot['role'], string> = {
  decide: 'Nadie que decida todavía',
  usa: 'Nadie que lo use en el día a día',
  paga: 'Nadie de finanzas o compras',
};
const sizeText = (size: number | null | undefined) => size ? `${size.toLocaleString('es-CL')} empleados` : null;
const peopleText = (count: number) => `${count} ${count === 1 ? 'contacto' : 'contactos'}`;
/** One section of the company's panel: its title and, under it, what it shows in a sentence. */
function SectionTitle({ id, title, hint }: { id: string; title: string; hint: string }) {
  return <div className="space-y-0.5"><h3 id={id} className="text-sm font-semibold">{title}</h3><p className="text-xs leading-5 text-muted-foreground">{hint}</p></div>;
}

function targetRolesOf(signatures: any): string[] {
  const roles = signatures?.profile_extended?.targetRoles;
  return (Array.isArray(roles) ? roles : String(roles || '').split(/[,;\n]+/)).map(role => String(role).trim()).filter(Boolean).slice(0, 20);
}

/** The three roles of a sale in one company, as small marks: filled when someone is there. */
function CommitteeMarks({ company }: { company: Company }) {
  return <span className="flex flex-wrap gap-1.5">
    {company.committee.map(slot => <span key={slot.role}
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', slot.people.length ? 'border-transparent bg-primary/10 text-primary' : 'border-dashed text-muted-foreground')}>
      {slot.people.length ? <Check className="h-3 w-3" aria-hidden="true" /> : null}{slot.label}
      <span className="sr-only">{slot.people.length ? ': cubierto' : ': falta'}</span>
    </span>)}
  </span>;
}

/**
 * «Empresas» in the Pipeline (propuestas 5 y 6): who you know in each company, who is missing for a sale (who decides,
 * who uses it, who pays) with Búsqueda ready to find them, their coverage by area and level, and companies like it.
 */
export function CompaniesView({ rows, onOpenPerson }: { rows: UnifiedRow[]; onOpenPerson: (gid: string) => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [similar, setSimilar] = useState<Record<string, SimilarState>>({});
  const [about, setAbout] = useState<Record<string, About>>({});

  useEffect(() => {
    let alive = true;
    profileService.getProfile().then(profile => { if (alive) setTargetRoles(targetRolesOf(profile?.signatures)); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const { companies, main } = useMemo(() => buildCompanies(rows, { targetRoles }), [rows, targetRoles]);
  const visible = useMemo(() => {
    const wanted = companyKey(query);
    return wanted ? companies.filter(company => company.key.includes(wanted)) : companies;
  }, [companies, query]);
  const company = companies.find(item => item.key === selected) ?? null;
  const missing = companies.filter(item => item.open && item.covered < item.committee.length).length;
  // Opening a company reads what it does from its website, once per company and session (the browser keeps it a day).
  const aboutKey = company?.domain || null;
  useEffect(() => {
    if (!aboutKey || about[aboutKey]) return;
    setAbout(current => ({ ...current, [aboutKey]: { status: 'loading' } }));
    authenticatedApiFetch(`/api/crm/companies/about?${new URLSearchParams({ domain: aboutKey, name: company?.name || '' })}`)
      .then(async response => { const body = await response.json().catch(() => null); return response.ok ? body : null; }).catch(() => null)
      .then(body => setAbout(current => ({ ...current, [aboutKey]: { status: 'ready', text: typeof body?.about === 'string' ? body.about : null, website: typeof body?.website === 'string' ? body.website : `https://${aboutKey}` } })));
  }, [aboutKey, about, company?.name]);
  const companyAbout = aboutKey ? about[aboutKey] : undefined;

  const findSimilar = async (base: Company) => {
    setSimilar(current => ({ ...current, [base.key]: { status: 'loading' } }));
    try {
      const found = await searchCompanies({ company_keywords: [base.industry!], company_location: [base.country || 'Chile'], employee_ranges: sizeBands(base.size), per_page: 25 });
      const known = new Set(companies.map(item => item.key));
      const domains = new Set(companies.map(item => item.domain).filter(Boolean));
      const candidates = found.organizations
        .filter((org: any) => org?.id && org?.name && !known.has(companyKey(org.name)) && !(org.primary_domain && domains.has(String(org.primary_domain).toLowerCase())))
        .slice(0, 25)
        .map((org: any) => ({ id: String(org.id).slice(0, 80), name: String(org.name).slice(0, 160), industry: org.industry ? String(org.industry).slice(0, 120) : null,
          size: Number(org.estimated_num_employees) > 0 ? Math.round(Number(org.estimated_num_employees)) : null, city: org.city ? String(org.city).slice(0, 80) : null,
          country: org.country ? String(org.country).slice(0, 80) : null, description: org.short_description ? String(org.short_description).slice(0, 400) : null,
          domain: org.primary_domain ? String(org.primary_domain) : null }));
      if (!candidates.length) {
        setSimilar(current => ({ ...current, [base.key]: { status: 'ready', items: [], note: 'No encontramos otras empresas del mismo rubro y tamaño que no tengas ya.' } }));
        return;
      }
      const response = await authenticatedApiFetch('/api/crm/companies/similar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ base: { name: base.name, industry: base.industry, size: base.size, country: base.country, won: base.won, roles: base.people.slice(0, 12).map(person => person.title || '').filter(Boolean) },
          candidates: candidates.map(({ domain: _domain, ...candidate }) => candidate) }),
      });
      const body = await response.json().catch(() => null);
      const domainOf = new Map(candidates.map(candidate => [candidate.id, candidate.domain]));
      if (!response.ok || !Array.isArray(body?.companies)) {
        // The search worked: without the AI's choice, the same rubro and size is still a good list.
        setSimilar(current => ({ ...current, [base.key]: { status: 'ready', items: candidates.slice(0, 8), note: 'La IA no pudo elegir las más parecidas: son empresas del mismo rubro y tamaño.' } }));
        return;
      }
      // When the AI finds none clearly alike, what the search returned stays one tap away instead of a dead end.
      setSimilar(current => ({ ...current, [base.key]: { status: 'ready', items: body.companies.map((item: Similar) => ({ ...item, domain: domainOf.get(item.id) ?? null })),
        ...(body.companies.length ? {} : { note: `La IA no encontró empresas claramente parecidas entre las ${candidates.length} que trajo la búsqueda.`, found: candidates.slice(0, 12) }) } }));
    } catch (error) {
      setSimilar(current => ({ ...current, [base.key]: { status: 'error', text: similarSearchError(error) } }));
    }
  };

  if (!companies.length) {
    return <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
      <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">Aún no hay empresas</p>
      <p className="text-sm text-muted-foreground">Cuando tus contactos tengan empresa, aquí verás a quién conoces en cada una y a quién te falta conocer.</p>
    </div>;
  }

  // In a new company you start with whoever decides and whoever uses it.
  const startTitles = (item: Company) => [...new Set(item.committee.filter(slot => slot.role !== 'paga').flatMap(slot => slot.titles))].slice(0, 6);
  const state = company ? similar[company.key] : undefined;

  return <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5 sm:px-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">Empresas</h2>
        <p className="text-sm text-muted-foreground">
          A quién conoces en cada empresa. Una venta suele necesitar a quien <span className="font-medium text-foreground">decide</span>, a quien lo <span className="font-medium text-foreground">usa</span> y a quien <span className="font-medium text-foreground">paga</span>; con ✓ ya conoces a alguien en ese rol.
          {missing ? ` En ${missing} ${missing === 1 ? 'negocio abierto falta' : 'negocios abiertos falta'} alguien.` : ''}
        </p>
      </div>
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar empresa" aria-label="Buscar empresa" className="pl-9" />
      </div>
    </div>

    {visible.length ? <ul className="divide-y rounded-2xl border">
      {visible.map(item => <li key={item.key}>
        <button type="button" onClick={() => setSelected(item.key)}
          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <CompanyLogo name={item.name} domain={item.domain} />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{item.name}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{stageLabel(item.stage)}</span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">{[industryLabel(item.industry), peopleText(item.people.length), sizeText(item.size), item.country, item.domain].filter(Boolean).join(' · ')}</span>
            <CommitteeMarks company={item} />
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </li>)}
    </ul> : <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Ninguna empresa coincide con «{query}».</p>}

    <Sheet open={Boolean(company)} onOpenChange={open => { if (!open) setSelected(null); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {company ? <>
          <SheetHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3.5 pr-6">
              <CompanyLogo name={company.name} domain={company.domain} size="lg" />
              <div className="min-w-0">
                <SheetTitle className="break-words">{company.name}</SheetTitle>
                <SheetDescription>{[industryLabel(company.industry), sizeText(company.size), company.country].filter(Boolean).join(' · ') || peopleText(company.people.length)}</SheetDescription>
              </div>
            </div>
            {companyAbout?.status === 'loading' ? <span className="block space-y-2" aria-hidden="true"><span className="block h-3 w-11/12 rounded-full bg-muted motion-safe:animate-pulse" /><span className="block h-3 w-2/3 rounded-full bg-muted motion-safe:animate-pulse" /></span>
              : companyAbout?.status === 'ready' && companyAbout.text ? <p className="text-sm leading-6">{companyAbout.text}</p> : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-2 py-0.5">{stageLabel(company.stage)}</span>
              <span>{peopleText(company.people.length)}</span>
              {company.domain ? <a href={companyAbout?.status === 'ready' ? companyAbout.website : `https://${company.domain}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {company.domain}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(abre su sitio en otra pestaña)</span></a> : null}
            </div>
          </SheetHeader>
          <div className="mt-6 space-y-7">
            <section aria-labelledby="company-committee" className="space-y-3">
              <SectionTitle id="company-committee" title="Para esta venta" hint="Las tres personas que suele necesitar una venta: quien decide la compra, quien usará lo que vendes y quien aprueba el pago. Si falta alguien, «Buscar» abre Buscar prospectos con los cargos que conviene encontrar aquí." />
              <ul className="space-y-2">
                {company.committee.map(slot => <li key={slot.role} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{slot.label}</span>
                    <span className="block text-xs text-muted-foreground">{slot.people.length ? slot.people.map(person => person.name).join(', ') : `${SLOT_HINT[slot.role]}: ${slot.titles.slice(0, 3).join(', ')}`}</span>
                  </span>
                  {slot.people.length ? <Check role="img" className="h-4 w-4 text-primary" aria-label="Cubierto" />
                    : <Button asChild size="sm" variant="outline"><Link href={companySearchHref({ company: company.name, domain: company.domain, titles: slot.titles })}>Buscar</Link></Button>}
                </li>)}
              </ul>
              {main ? null : <p className="text-xs leading-5 text-muted-foreground">Completa «Cargos que buscas» en «Perfil» para saber quién usa lo que vendes.</p>}
            </section>

            <section aria-labelledby="company-coverage" className="space-y-3">
              <SectionTitle id="company-coverage" title="Dónde conoces gente" hint="Cada fila es un área de la empresa y cada columna, el nivel del cargo. Un nombre es alguien que ya tienes; «—», un lugar donde aún no conoces a nadie." />
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full table-fixed text-xs">
                  <thead><tr className="border-b bg-muted/40 text-muted-foreground">
                    <th scope="col" className="w-[30%] px-3 py-2 text-left font-medium">Área</th>
                    {LEVELS.map(level => <th key={level.id} scope="col" className="truncate px-1.5 py-2 text-left font-medium"><span title={level.label}>{level.short}</span></th>)}
                  </tr></thead>
                  <tbody>
                    {coverageGrid(company, main).map(row => <tr key={row.area} className="border-b last:border-0">
                      <th scope="row" className="break-words px-3 py-2 text-left font-normal">{row.label}</th>
                      {row.cells.map((people, index) => <td key={LEVELS[index].id} className="min-w-0 px-1.5 py-2 align-top">
                        {people.length ? <span className="flex min-w-0 flex-col gap-0.5">
                          {people.slice(0, 2).map(person => <span key={person.key} className="truncate font-medium" title={`${person.name}${person.title ? ` · ${person.title}` : ''}`}>{person.name.split(/\s+/)[0]}</span>)}
                          {people.length > 2 ? <span className="text-muted-foreground">+{people.length - 2}</span> : null}
                        </span> : <span className="text-muted-foreground/60" aria-label="Nadie">—</span>}
                      </td>)}
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="company-people" className="space-y-3">
              <SectionTitle id="company-people" title="Personas" hint="Tus contactos en esta empresa, del cargo más alto al más bajo, con la etapa de cada uno. Toca uno para abrir su ficha." />
              <ul className="space-y-1.5">
                {company.people.map(person => <li key={person.key}>
                  <button type="button" onClick={() => { setSelected(null); onOpenPerson(person.gid); }}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <InitialsAvatar name={person.name} email={person.email} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{person.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[person.title, `${areaLabel(person.area)} · ${levelLabel(person.level)}`].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{stageLabel(person.stage)}</span>
                  </button>
                </li>)}
              </ul>
            </section>

            <section aria-labelledby="company-similar" className="space-y-3 border-t pt-5">
              <div>
                <h3 id="company-similar" className="text-sm font-medium">Empresas parecidas</h3>
                <p className="text-xs leading-5 text-muted-foreground">
                  {company.industry ? `Del mismo rubro${company.size ? ' y tamaño' : ''}, que aún no están en tu CRM. La IA elige las más parecidas con lo que informa el proveedor y lo que sabe de empresas conocidas, y dice por qué. Usa una búsqueda de tu cupo diario.`
                    : 'Esta empresa no tiene rubro guardado: búscala en «Buscar prospectos» para completarlo.'}
                </p>
              </div>
              {company.industry && state?.status !== 'loading' && state?.status !== 'ready'
                ? <Button variant="outline" size="sm" onClick={() => void findSimilar(company)}><Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />Buscar empresas parecidas</Button> : null}
              {state?.status === 'loading' ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Buscando empresas parecidas…</p> : null}
              {state?.status === 'error' ? <p role="alert" className="text-sm text-destructive">{state.text}</p> : null}
              {state?.status === 'ready' ? <div className="space-y-2">
                {state.note ? <p className="text-xs leading-5 text-muted-foreground">{state.note}</p> : null}
                {state.found?.length ? <Button variant="ghost" size="sm" className="h-8 px-2 text-xs"
                  onClick={() => setSimilar(current => ({ ...current, [company.key]: { status: 'ready', items: state.found!, note: 'Comparten rubro y tamaño según el proveedor; revísalas antes de buscar personas.' } }))}>
                  Ver las que trajo la búsqueda</Button> : null}
                <ul className="space-y-2">
                  {state.items.map(item => <li key={item.id} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-3">
                        <CompanyLogo name={item.name} domain={item.domain} />
                        <div className="min-w-0">
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{[industryLabel(item.industry), sizeText(item.size), item.city].filter(Boolean).join(' · ')}</p>
                        </div>
                      </div>
                      <Button asChild size="sm" variant="ghost"><Link href={companySearchHref({ company: item.name, domain: item.domain, titles: startTitles(company) })}>Ver personas</Link></Button>
                    </div>
                    {item.why ? <p className="mt-1.5 text-sm leading-6">{item.why}</p> : null}
                  </li>)}
                </ul>
              </div> : null}
            </section>
          </div>
        </> : null}
      </SheetContent>
    </Sheet>
  </div>;
}
