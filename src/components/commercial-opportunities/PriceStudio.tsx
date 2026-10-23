'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Copy, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { RATES_REFERENCE, laborCost } from '@/lib/commercial-opportunities/labor-cost';
import { matchup, ourPriceMoves, scenarioGrid, scoreSetupProblem, thresholdSentence } from '@/lib/commercial-opportunities/price-scenarios';
import { typed, costSummary, defaultDraft, laborInputs, newExpense, newLoad, newProfile, newSite, parseDraft, scoreInputs, siteKept, type StudioDraft, type StudioProfile, type StudioSite } from '@/lib/commercial-opportunities/price-studio';

const number = (value: number, digits = 0) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: digits }).format(value);
const money = (value: number) => `$${number(Math.round(value))}`;
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value), 2)}`;
const stepWord = (step: number) => (step === 0 ? 'Igual que tú' : `${number(Math.abs(step) * 100)} % ${step < 0 ? 'más barato' : 'más caro'}`);

/**
 * «Precio»: the two calculations a price decision needs. What an hour of work costs and should be quoted at (cost of each profile, margin,
 * overhead, VAT), and what the price is worth in points against a rival (how far a rival can go and still beat the offer). What is typed
 * stays in this browser, for this person and this opportunity: it is the company's costs, so it is not shared until it has a home in the
 * ficha. Closed by default: the page has one main action and this is the one for whoever sets the prices.
 */
export function PriceStudio({ storageKey, initialDraft }: { storageKey: string; /** A draft to start from instead of the empty one (what the browser kept replaces it once read). */ initialDraft?: StudioDraft }) {
  const uid = useId();
  const [draft, setDraft] = useState<StudioDraft>(() => initialDraft ?? defaultDraft());
  const [tab, setTab] = useState<'cost' | 'score'>('cost');
  const [copied, setCopied] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    try { const raw = window.localStorage.getItem(storageKey); if (raw) setDraft(parseDraft(raw)); } catch { /* private mode: it lives until the page closes */ }
    loaded.current = true;
  }, [storageKey]);
  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => { try { window.localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* not kept */ } }, 400);
    return () => clearTimeout(timer);
  }, [draft, storageKey]);

  const inputs = useMemo(() => laborInputs(draft), [draft]);
  const cost = useMemo(() => laborCost(inputs.profiles, inputs.params), [inputs]);
  const setup = useMemo(() => scoreInputs(draft), [draft]);
  const problem = scoreSetupProblem(setup);
  const profile = (profileId: string, patch: Partial<StudioProfile>) => setDraft(current => ({ ...current, profiles: current.profiles.map(item => (item.id === profileId ? { ...item, ...patch } : item)) }));
  const param = (key: keyof StudioDraft['params'], value: string) => setDraft(current => ({ ...current, params: { ...current.params, [key]: value } }));
  const site = (siteId: string, patch: Partial<StudioSite>) => setDraft(current => ({ ...current, sites: current.sites.map(item => (item.id === siteId ? { ...item, ...patch } : item)) }));
  const score = (key: keyof StudioDraft['score'], value: string) => setDraft(current => ({ ...current, score: { ...current.score, [key]: value } }));
  const copy = async () => {
    const summary = costSummary(draft);
    if (!summary) return;
    try { await navigator.clipboard.writeText(summary); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the browser said no */ }
  };
  const field = (key: string, label: string, value: string, onChange: (value: string) => void, props: { hint?: string; width?: string } = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`${uid}-${key}`} className="text-xs">{label}</Label>
      <Input id={`${uid}-${key}`} inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} className={cn('h-9 tabular-nums', props.width)} />
      {props.hint ? <p className="text-xs leading-5 text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
  const result = 'problem' in cost ? null : cost;
  const onCost = draft.params.profitOn === 'cost';
  const postProfile = result?.profiles.find(item => item.post) ?? null;
  const siteTotals = result?.sites ? { monthly: result.sites.monthly, withVat: result.sites.monthly * (1 + inputs.params.vatPct / 100), contract: result.sites.monthly * inputs.params.months } : null;
  // The rows of the site table, by site: a row that says nothing was left out of the calculation, so the rows are matched in order.
  const siteRows = useMemo(() => {
    const rows = new Map<string, NonNullable<NonNullable<typeof result>['sites']>['rows'][number]>();
    const kept = draft.sites.filter(siteKept);
    result?.sites?.rows.forEach((row, index) => { if (kept[index]) rows.set(kept[index].id, row); });
    return rows;
  }, [draft.sites, result]);

  return <details className="group rounded-2xl border bg-background">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <span><span className="text-sm font-semibold">Calcular el precio</span><span className="ml-2 text-xs text-muted-foreground">valor hora y puntaje frente a un rival</span></span>
      <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span>
    </summary>
    <div className="space-y-5 border-t px-4 py-4">
      <div role="group" aria-label="Qué calcular" className="inline-flex rounded-xl bg-muted p-1">
        {([['cost', 'Costo y valor hora'], ['score', 'Puntaje por precio']] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}
            className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === key ? 'bg-background shadow-sm' : 'text-foreground/70 hover:text-foreground')}>{label}</button>))}
      </div>

      {tab === 'cost' && <div className="space-y-5">
        <p className="text-sm leading-6 text-muted-foreground">Escribe lo que cuesta cada perfil al mes. Las cargas del empleador y la jornada vienen con valores de {RATES_REFERENCE}: <strong className="font-medium text-foreground">confírmalos con tu contador antes de ofertar</strong>. Si el servicio es por puestos con turnos (guardias 4x4), define el puesto de cada perfil más abajo.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              {['Perfil', 'Personas', 'Sueldo base', 'Bonos fijos', 'Colación y movilización', 'Uniforme y EPP', 'Otros'].map(label => <th key={label} scope="col" className="py-2 pr-2 font-medium">{label}</th>)}
              <th scope="col" className="w-8"><span className="sr-only">Quitar</span></th>
            </tr></thead>
            <tbody>
              {draft.profiles.map((item, index) => <tr key={item.id} className="border-b last:border-0">
                {([['name', 'Perfil', 'w-40'], ['headcount', 'Personas', 'w-16'], ['base', 'Sueldo base', 'w-28'], ['bonus', 'Bonos fijos', 'w-24'], ['nonTaxable', 'Colación y movilización', 'w-28'], ['equipment', 'Uniforme y EPP', 'w-24'], ['other', 'Otros', 'w-24']] as const).map(([key, label, width]) => (
                  <td key={key} className="py-1.5 pr-2">
                    <Label htmlFor={`${uid}-p${index}-${key}`} className="sr-only">{label} del perfil {index + 1}</Label>
                    <Input id={`${uid}-p${index}-${key}`} inputMode={key === 'name' ? 'text' : 'decimal'} value={item[key]} onChange={event => profile(item.id, { [key]: event.target.value })}
                      placeholder={key === 'name' ? 'Ej.: Guardia' : '0'} className={cn('h-9', width, key !== 'name' && 'tabular-nums')} />
                  </td>))}
                <td className="py-1.5">{draft.profiles.length > 1 ? <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Quitar el perfil ${index + 1}`}
                  onClick={() => setDraft(current => ({ ...current, profiles: current.profiles.filter(other => other.id !== item.id) }))}><X className="h-4 w-4" aria-hidden="true" /></Button> : null}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={draft.profiles.length >= 12} onClick={() => setDraft(current => ({ ...current, profiles: [...current.profiles, newProfile()] }))}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Agregar perfil</Button>

        <div className="space-y-2">
          {draft.profiles.map((item, index) => {
            const name = item.name.trim() || `Perfil ${index + 1}`;
            const inPost = Number(typed(item.postHours)) > 0;
            return <details key={item.id} className="rounded-xl border px-4 py-3" open={inPost || undefined}>
              <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Turno, festivos y costos sin utilidad de «{name}»
                {inPost ? <span className="ml-2 text-xs font-normal text-muted-foreground">puesto de {item.postPeople || '?'} {Number(typed(item.postPeople)) === 1 ? 'persona' : 'personas'}</span> : null}</summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {field(`p${index}-postPeople`, 'Personas por puesto', item.postPeople, value => profile(item.id, { postPeople: value }), { hint: 'Para un puesto cubierto todo el mes por turnos: 4x4 son 2.' })}
                {field(`p${index}-postHours`, 'Horas del puesto al mes', item.postHours, value => profile(item.id, { postHours: value }), { hint: 'Las que cubre el puesto, no una persona. Ej.: 11 horas al día son 334,58.' })}
                {field(`p${index}-annualBonus`, 'Aguinaldos y bonos al año (por persona)', item.annualBonus, value => profile(item.id, { annualBonus: value }), { hint: 'Se reparte en 12 meses.' })}
                {field(`p${index}-holidays`, 'Festivos trabajados al año', item.holidays, value => profile(item.id, { holidays: value }))}
                {field(`p${index}-holidayHours`, 'Horas de cada festivo', item.holidayHours, value => profile(item.id, { holidayHours: value }), { hint: 'Se pagan como horas extra, con 50 % más.' })}
                {field(`p${index}-exempt`, 'Costos sin utilidad al mes (por persona)', item.exempt, value => profile(item.id, { exempt: value }), { hint: 'Bono de asistencia, boleta de garantía, seguros: se suman después de la utilidad.' })}
              </div>
            </details>;
          })}
        </div>

        <details className="rounded-xl border px-4 py-3" open={draft.sites.length > 0 || undefined}>
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Precio por sitio o tienda<span className="ml-2 text-xs font-normal text-muted-foreground">para portales que piden un precio por cada uno</span></summary>
          <div className="mt-4 space-y-4">
            {!postProfile ? <p className="text-sm leading-6 text-muted-foreground">Para cotizar sitio por sitio, define el puesto de un perfil (personas por puesto y horas del puesto al mes, en «Turno, festivos y costos sin utilidad»). Cada sitio cuesta lo que sus puestos, sea cual sea el sitio.</p>
              : <p className="text-sm leading-6 text-muted-foreground">Un puesto de «{postProfile.name || 'Perfil'}» cuesta {money(postProfile.post!.pricePerPost)} al mes (neto), con sus {postProfile.post!.people} {postProfile.post!.people === 1 ? 'persona' : 'personas'}. Escribe cuántos puestos tiene cada sitio. Si el cliente fija las horas al mes del sitio, escríbelas; si sus puestos cubren otras horas, escríbelas en «Horas del puesto».</p>}
            {draft.sites.length > 0 ? <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  {['Sitio', 'Puestos', 'Horas del puesto', 'Horas al mes'].map(label => <th key={label} scope="col" className="py-2 pr-2 font-medium">{label}</th>)}
                  {['Valor hora', 'Precio al mes', 'Precio al año'].map(label => <th key={label} scope="col" className="py-2 pr-3 text-right font-medium">{label}</th>)}
                  <th scope="col" className="w-8"><span className="sr-only">Quitar</span></th>
                </tr></thead>
                <tbody>{draft.sites.map((item, index) => {
                  const row = siteRows.get(item.id);
                  return <tr key={item.id} className="border-b last:border-0">
                    {([['name', 'Sitio', 'w-44', 'Ej.: Tienda Centro'], ['posts', 'Puestos', 'w-16', '1'], ['postHours', 'Horas del puesto', 'w-28', 'del perfil'], ['hoursMonth', 'Horas al mes', 'w-28', 'puestos × horas']] as const).map(([key, label, width, placeholder]) => (
                      <td key={key} className="py-1.5 pr-2">
                        <Label htmlFor={`${uid}-s${index}-${key}`} className="sr-only">{label} del sitio {index + 1}</Label>
                        <Input id={`${uid}-s${index}-${key}`} inputMode={key === 'name' ? 'text' : 'decimal'} value={item[key]} onChange={event => site(item.id, { [key]: event.target.value })} placeholder={placeholder} className={cn('h-9', width, key !== 'name' && 'tabular-nums')} />
                      </td>))}
                    <td className="py-1.5 pr-3 text-right tabular-nums">{row ? money(row.pricePerHour) : '—'}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{row ? money(row.priceMonthly) : '—'}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{row ? money(row.priceAnnual) : '—'}</td>
                    <td className="py-1.5"><Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Quitar el sitio ${index + 1}`} onClick={() => setDraft(current => ({ ...current, sites: current.sites.filter(other => other.id !== item.id) }))}><X className="h-4 w-4" aria-hidden="true" /></Button></td>
                  </tr>;
                })}</tbody>
                {result?.sites ? <tfoot><tr className="border-t font-medium">
                  <th scope="row" colSpan={4} className="py-2.5 pr-2 text-left">Total de los sitios</th><td />
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(result.sites.monthly)}</td><td className="py-2.5 pr-3 text-right tabular-nums">{money(result.sites.annual)}</td><td />
                </tr></tfoot> : null}
              </table>
            </div> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={draft.sites.length >= 40} onClick={() => setDraft(current => ({ ...current, sites: [...current.sites, newSite()] }))}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Agregar sitio</Button>
              {result?.sites && inputs.params.guaranteePct ? <p className="text-sm text-muted-foreground">Garantía de fiel cumplimiento ({number(inputs.params.guaranteePct ?? 0, 2)} % del monto anual): <span className="font-semibold text-foreground tabular-nums">{money(result.sites.guarantee)}</span></p> : null}
            </div>
          </div>
        </details>

        <details className="rounded-xl border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Supuestos y tasas</summary>
          <div className="mt-4 space-y-5">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium">La utilidad se calcula sobre</legend>
              <div role="group" aria-label="Base de la utilidad" className="inline-flex rounded-xl bg-muted p-1">
                {([['price', 'El precio (margen)'], ['cost', 'El costo (utilidad del formulario)']] as const).map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={onCost === (key === 'cost')} onClick={() => param('profitOn', key)}
                    className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', onCost === (key === 'cost') ? 'bg-background shadow-sm' : 'text-foreground/70 hover:text-foreground')}>{label}</button>))}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{onCost ? 'La utilidad y los gastos generales son un recargo sobre el costo total (10 % de utilidad = costo × 1,10), como lo piden los formularios de algunos clientes. Lo que no lleva utilidad se suma después.' : 'El margen y los gastos generales son una parte del precio (10 % de margen = costo ÷ 0,90), como en el escenario financiero. Lo que no lleva utilidad se suma después.'}</p>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {field('gratification', 'Gratificación (% del sueldo base)', draft.params.gratification, value => param('gratification', value))}
              {field('minimumWage', 'Ingreso mínimo mensual', draft.params.minimumWage, value => param('minimumWage', value), { hint: 'Con él, el tope de la gratificación sale solo: 4,75 ingresos mínimos al año.' })}
              {field('cap', 'Tope mensual de la gratificación', draft.params.cap, value => param('cap', value), { hint: 'Déjalo vacío para usar el del ingreso mínimo, o sin tope.' })}
              {field('hours', 'Horas pagadas al mes', draft.params.paidHours, value => param('paidHours', value), { hint: '42 horas semanales ≈ 182 al mes. Un perfil con puesto usa las horas del puesto.' })}
              {field('weeklyHours', 'Jornada semanal (horas)', draft.params.weeklyHours, value => param('weeklyHours', value), { hint: 'De ella sale el valor de una hora extra, para los festivos.' })}
              {field('absenteeism', 'Ausentismo y reemplazos (%)', draft.params.absenteeism, value => param('absenteeism', value), { hint: 'Vacaciones y licencias que debes cubrir.' })}
              {field('overhead', `Gastos generales (% del ${onCost ? 'costo' : 'precio'})`, draft.params.overhead, value => param('overhead', value), { hint: 'Supervisión, administración, oficina.' })}
              {field('margin', onCost ? 'Utilidad (% del costo)' : 'Margen (% del precio)', draft.params.margin, value => param('margin', value), onCost ? { hint: 'Escríbelo como porcentaje: 10, no 0,1.' } : {})}
              {field('vat', 'IVA (%)', draft.params.vat, value => param('vat', value))}
              {field('months', 'Plazo del contrato (meses)', draft.params.months, value => param('months', value))}
              {field('workerDeductions', 'Descuentos del trabajador (%)', draft.params.workerDeductions, value => param('workerDeductions', value), { hint: 'AFP, salud y cesantía: cerca de 19 %. Con él se estima el sueldo líquido.' })}
              {field('minNet', 'Líquido mínimo que piden las bases', draft.params.minNet, value => param('minNet', value), { hint: 'Avisa si el sueldo líquido estimado queda debajo.' })}
              {field('guarantee', 'Garantía de fiel cumplimiento (% del monto anual)', draft.params.guarantee, value => param('guarantee', value), { hint: 'Se calcula sobre el total de los sitios.' })}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium">Cargas del empleador (% de lo que cotiza)</legend>
              {draft.loads.map((load, index) => <div key={load.id} className="flex items-center gap-2">
                <Label htmlFor={`${uid}-l${index}-label`} className="sr-only">Nombre de la carga {index + 1}</Label>
                <Input id={`${uid}-l${index}-label`} value={load.label} onChange={event => setDraft(current => ({ ...current, loads: current.loads.map(item => (item.id === load.id ? { ...item, label: event.target.value } : item)) }))} className="h-9 min-w-0 flex-1" />
                <Label htmlFor={`${uid}-l${index}-pct`} className="sr-only">Porcentaje de la carga {index + 1}</Label>
                <Input id={`${uid}-l${index}-pct`} inputMode="decimal" value={load.pct} onChange={event => setDraft(current => ({ ...current, loads: current.loads.map(item => (item.id === load.id ? { ...item, pct: event.target.value } : item)) }))} className="h-9 w-20 tabular-nums" placeholder="0" />
                <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Quitar la carga ${index + 1}`} onClick={() => setDraft(current => ({ ...current, loads: current.loads.filter(item => item.id !== load.id) }))}><X className="h-4 w-4" aria-hidden="true" /></Button>
              </div>)}
              <p className="text-xs leading-5 text-muted-foreground">Las provisiones de vacaciones y de indemnización empiezan vacías: si ya cubres las vacaciones con el ausentismo, no las repitas. Confirma las tasas con tu contador.</p>
              <Button type="button" size="sm" variant="ghost" disabled={draft.loads.length >= 14} onClick={() => setDraft(current => ({ ...current, loads: [...current.loads, newLoad()] }))}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Agregar carga</Button>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium">Gastos por persona al mes</legend>
              <p className="text-xs leading-5 text-muted-foreground">Lo que cada persona carga además del sueldo: uniformes, curso, supervisor y prevencionista repartidos, radio, transporte. Se suman al costo de cada persona de todos los perfiles.</p>
              {draft.expenses.map((expense, index) => <div key={expense.id} className="flex items-center gap-2">
                <Label htmlFor={`${uid}-e${index}-label`} className="sr-only">Nombre del gasto {index + 1}</Label>
                <Input id={`${uid}-e${index}-label`} value={expense.label} placeholder="Ej.: Supervisor repartido" onChange={event => setDraft(current => ({ ...current, expenses: current.expenses.map(item => (item.id === expense.id ? { ...item, label: event.target.value } : item)) }))} className="h-9 min-w-0 flex-1" />
                <Label htmlFor={`${uid}-e${index}-amount`} className="sr-only">Monto del gasto {index + 1}</Label>
                <Input id={`${uid}-e${index}-amount`} inputMode="decimal" value={expense.amount} placeholder="0" onChange={event => setDraft(current => ({ ...current, expenses: current.expenses.map(item => (item.id === expense.id ? { ...item, amount: event.target.value } : item)) }))} className="h-9 w-28 tabular-nums" />
                <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Quitar el gasto ${index + 1}`} onClick={() => setDraft(current => ({ ...current, expenses: current.expenses.filter(item => item.id !== expense.id) }))}><X className="h-4 w-4" aria-hidden="true" /></Button>
              </div>)}
              <Button type="button" size="sm" variant="ghost" disabled={draft.expenses.length >= 14} onClick={() => setDraft(current => ({ ...current, expenses: [...current.expenses, newExpense()] }))}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Agregar gasto</Button>
            </fieldset>
            <div className="flex gap-2 pt-1"><Button type="button" size="sm" variant="ghost" onClick={() => setDraft(defaultDraft())}>Volver a los valores de partida</Button></div>
          </div>
        </details>

        <div aria-live="polite" className="space-y-4">
          {!result && 'problem' in cost ? <p role="alert" className="rounded-xl bg-cw-warning-soft px-4 py-3 text-sm">{cost.problem}</p> : null}
          {result ? <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Perfil</th><th scope="col" className="py-2 pr-3 text-right font-medium">Costo por persona al mes</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Costo por hora</th><th scope="col" className="py-2 pr-3 text-right font-medium">Valor hora (neto)</th><th scope="col" className="py-2 text-right font-medium">Precio al mes</th>
                </tr></thead>
                <tbody>{result.profiles.map((item, index) => <tr key={draft.profiles[index].id} className="border-b last:border-0 align-top">
                  <td className="py-2.5 pr-3">{item.name || `Perfil ${index + 1}`}<span className="ml-1 text-xs text-muted-foreground">× {item.headcount}</span>
                    {item.post ? <span className="block text-xs text-muted-foreground">Puesto de {item.post.people} {item.post.people === 1 ? 'persona' : 'personas'}: {money(item.post.pricePerPost)} al mes por puesto</span> : null}
                    {item.net !== null ? <span className="block text-xs text-muted-foreground">Líquido estimado por persona: {money(item.net)}</span> : null}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(item.monthly.total)}</td><td className="py-2.5 pr-3 text-right tabular-nums">{money(item.costPerHour)}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{money(item.pricePerHour)}</td><td className="py-2.5 text-right tabular-nums">{money(item.priceMonthly)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {siteTotals ? <p className="text-xs text-muted-foreground">Totales de los sitios (los puestos de «{result.sites!.profile || 'Perfil'}»), como los de la tabla de arriba.</p> : null}
            <dl className="grid gap-3 rounded-2xl bg-muted/40 p-4 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Precio al mes (neto)</dt><dd className="font-semibold tabular-nums">{money(siteTotals?.monthly ?? result.totals.priceMonthly)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Con IVA</dt><dd className="font-semibold tabular-nums">{money(siteTotals?.withVat ?? result.totals.totalMonthly)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Contrato de {number(inputs.params.months)} meses (neto)</dt><dd className="font-semibold tabular-nums">{money(siteTotals?.contract ?? result.totals.contractNet)}</dd></div>
              {siteTotals && result.sites!.guarantee > 0 ? <div><dt className="text-xs text-muted-foreground">Garantía de fiel cumplimiento</dt><dd className="font-semibold tabular-nums">{money(result.sites!.guarantee)}</dd></div>
                : <div><dt className="text-xs text-muted-foreground">Valor hora promedio</dt><dd className="font-semibold tabular-nums">{money(result.totals.averagePricePerHour)}</dd></div>}
            </dl>
            {result.notes.length ? <ul className="space-y-1 rounded-xl border px-4 py-3 text-sm leading-6">{result.notes.map(note => <li key={note}>{note}</li>)}</ul> : null}
            {result.warnings.length ? <ul className="space-y-1 rounded-xl bg-cw-warning-soft px-4 py-3 text-sm leading-6">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>{copied ? <Check className="mr-2 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-2 h-4 w-4" aria-hidden="true" />}{copied ? 'Copiado' : 'Copiar el cálculo'}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { score('price', String(Math.round(result.sites?.annual ?? result.totals.contractNet))); setTab('score'); }}>{result.sites ? 'Usar el total anual de los sitios (neto) en el puntaje' : 'Usar el total (neto) en el puntaje'}</Button>
            </div>
          </> : null}
          <p className="text-xs leading-5 text-muted-foreground">{onCost ? 'Margen y gastos generales se miden sobre el costo, como en un formulario de utilidad.' : 'Margen y gastos generales se miden sobre el precio, como en el escenario financiero.'} Esto vive en tu navegador: no se comparte con el equipo.</p>
        </div>
      </div>}

      {tab === 'score' && <div className="space-y-5">
        <p className="text-sm leading-6 text-muted-foreground">Cuánto más caro o barato puede ser un rival antes de pasarte. Supone que el precio más bajo se lleva todos los puntos del criterio y los demás reciben <em>precio más bajo ÷ su precio × puntos</em>: confirma que esa es la fórmula de estas bases.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field('weight', 'Puntos que vale el precio', draft.score.weight, value => score('weight', value), { hint: 'Está en los criterios de evaluación.' })}
          {field('ours', 'Tus puntos en todo lo demás', draft.score.ours, value => score('ours', value), { hint: 'Técnico, plazo, sellos, experiencia.' })}
          {field('rival', 'Puntos del rival en lo demás', draft.score.rival, value => score('rival', value), { hint: 'Si dudas, el máximo posible.' })}
          {field('price', 'Tu precio total', draft.score.price, value => score('price', value), { hint: 'Neto o con IVA, como lo compare el portal.' })}
        </div>
        <div aria-live="polite" className="space-y-5">
          {problem && (draft.score.weight || draft.score.price) ? <p role="alert" className="rounded-xl bg-cw-warning-soft px-4 py-3 text-sm">{problem}</p> : null}
          {!problem ? <>
            <p className="rounded-2xl bg-muted/40 p-4 text-sm font-medium leading-6">{thresholdSentence(setup, value => number(value, 1))}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <caption className="pb-2 text-left text-xs text-muted-foreground">Si un rival cobra…</caption>
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Precio del rival</th><th scope="col" className="py-2 pr-3 text-right font-medium">Tus puntos</th><th scope="col" className="py-2 pr-3 text-right font-medium">Sus puntos</th><th scope="col" className="py-2 text-right font-medium">Gana</th>
                </tr></thead>
                <tbody>{scenarioGrid(setup).map(row => <tr key={row.step} className="border-b last:border-0">
                  <td className="py-2.5 pr-3">{money(row.rivalPrice)}<span className="ml-2 text-xs text-muted-foreground">{stepWord(row.step)}</span></td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{number(row.ourTotal, 2)}</td><td className="py-2.5 pr-3 text-right tabular-nums">{number(row.rivalTotal, 2)}</td>
                  <td className={cn('py-2.5 text-right font-medium', row.winner === 'us' ? 'text-cw-success' : row.winner === 'rival' ? 'text-destructive' : 'text-muted-foreground')}>{row.winner === 'us' ? 'Tú' : row.winner === 'rival' ? 'El rival' : 'Empate'}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <caption className="pb-2 text-left text-xs text-muted-foreground">Si cambias tu precio, frente a un rival que cobra lo mismo que tú hoy…</caption>
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Tu precio</th><th scope="col" className="py-2 pr-3 text-right font-medium">Tus puntos</th><th scope="col" className="py-2 text-right font-medium">Cambio</th></tr></thead>
                <tbody>{ourPriceMoves(setup, setup.ourPrice).map(move => <tr key={move.step} className="border-b last:border-0">
                  <td className="py-2.5 pr-3">{money(move.price)}<span className="ml-2 text-xs text-muted-foreground">{move.step < 0 ? `${number(Math.abs(move.step) * 100)} % menos` : `${number(move.step * 100)} % más`}</span></td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{number(move.ourTotal, 2)}</td><td className="py-2.5 text-right tabular-nums">{signed(move.change)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Con un precio igual al del rival, tienes {number(matchup(setup, setup.ourPrice).ourTotal, 2)} puntos y él {number(matchup(setup, setup.ourPrice).rivalTotal, 2)}. Los empates los resuelven las bases.</p>
          </> : null}
        </div>
      </div>}
    </div>
  </details>;
}

