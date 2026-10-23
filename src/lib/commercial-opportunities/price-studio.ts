// The state of the price tool of «Cómo postular»: what the person types (as text, so a half-typed number is not lost), how it becomes the
// numbers of labor-cost.ts and price-scenarios.ts, how it is kept in the browser and the summary that can be copied. Pure.
import { DEFAULT_PARAMS, EMPTY_PROFILE, RATES_REFERENCE, laborCost, type LaborParams, type LaborProfile } from './labor-cost';
import { offerPrice } from './offer-draft';
import type { ScoreSetup } from './price-scenarios';

export type StudioProfile = { id: string; name: string; headcount: string; base: string; bonus: string; nonTaxable: string; equipment: string; other: string;
  annualBonus: string; holidays: string; holidayHours: string; exempt: string; postPeople: string; postHours: string };
export type StudioLoad = { id: string; label: string; pct: string };
export type StudioExpense = { id: string; label: string; amount: string };
export type StudioSite = { id: string; name: string; posts: string; postHours: string; hoursMonth: string };
export type StudioDraft = {
  profiles: StudioProfile[]; loads: StudioLoad[]; expenses: StudioExpense[]; sites: StudioSite[];
  params: { gratification: string; cap: string; paidHours: string; absenteeism: string; overhead: string; margin: string; vat: string; months: string;
    /** «price» or «cost»: what overhead and margin are a share of. */ profitOn: string; minimumWage: string; weeklyHours: string; workerDeductions: string; minNet: string; guarantee: string };
  score: { weight: string; ours: string; rival: string; price: string };
};
/** The provisions some bases ask to be shown; they start empty because the accountant decides them (and the absenteeism may already cover the vacations). */
export const PROVISION_LABELS = ['Vacaciones (provisión)', 'Indemnización por años de servicio (provisión)'] as const;

const id = () => Math.random().toString(36).slice(2, 9);
const text = (value: number) => (value ? String(value) : '');
export const newProfile = (): StudioProfile => ({ id: id(), name: '', headcount: String(EMPTY_PROFILE.headcount), base: '', bonus: '', nonTaxable: '', equipment: '', other: '',
  annualBonus: '', holidays: '', holidayHours: '', exempt: '', postPeople: '', postHours: '' });
export const newLoad = (): StudioLoad => ({ id: id(), label: '', pct: '' });
export const newExpense = (): StudioExpense => ({ id: id(), label: '', amount: '' });
/** A site row that says nothing is left out of the calculation (a new row starts with one post, so it counts). */
export const siteKept = (site: StudioSite) => Boolean(site.name.trim() || site.posts.trim() || site.hoursMonth.trim());
export const newSite = (): StudioSite => ({ id: id(), name: '', posts: '1', postHours: '', hoursMonth: '' });

export function defaultDraft(): StudioDraft {
  return {
    profiles: [newProfile()],
    loads: [...DEFAULT_PARAMS.loads.map(load => ({ id: id(), label: load.label, pct: String(load.pct).replace('.', ',') })), ...PROVISION_LABELS.map(label => ({ id: id(), label, pct: '' }))],
    expenses: [], sites: [],
    params: { gratification: String(DEFAULT_PARAMS.gratificationPct), cap: '', paidHours: String(DEFAULT_PARAMS.paidHours), absenteeism: text(DEFAULT_PARAMS.absenteeismPct),
      overhead: text(DEFAULT_PARAMS.overheadPct), margin: text(DEFAULT_PARAMS.marginPct), vat: String(DEFAULT_PARAMS.vatPct), months: String(DEFAULT_PARAMS.months),
      profitOn: 'price', minimumWage: '', weeklyHours: String(DEFAULT_PARAMS.weeklyHours), workerDeductions: '', minNet: '', guarantee: '' },
    score: { weight: '', ours: '', rival: '', price: '' },
  };
}

/** A typed number: empty is 0, «3,5» and «1.500.000» read the way they are written in Chile, and nonsense is NaN so it gets caught. */
export function typed(value: string): number {
  if (!value.trim()) return 0;
  const parsed = offerPrice(value);
  return parsed === null ? NaN : parsed;
}

export function laborInputs(draft: StudioDraft): { profiles: LaborProfile[]; params: LaborParams } {
  const p = draft.params;
  const blank = (value: string) => (value.trim() ? typed(value) : null);
  return {
    profiles: draft.profiles.map(profile => ({ name: profile.name, headcount: typed(profile.headcount), baseSalary: typed(profile.base), bonus: typed(profile.bonus),
      nonTaxable: typed(profile.nonTaxable), equipment: typed(profile.equipment), other: typed(profile.other), annualBonus: typed(profile.annualBonus), holidaysWorked: typed(profile.holidays),
      holidayHours: typed(profile.holidayHours), exempt: typed(profile.exempt), postPeople: typed(profile.postPeople), postHours: typed(profile.postHours) })),
    params: { gratificationPct: typed(p.gratification), gratificationCap: blank(p.cap), loads: draft.loads.filter(load => load.pct.trim() || load.label.trim()).map(load => ({ label: load.label.trim(), pct: typed(load.pct) })),
      paidHours: typed(p.paidHours), absenteeismPct: typed(p.absenteeism), overheadPct: typed(p.overhead), marginPct: typed(p.margin), vatPct: typed(p.vat), months: typed(p.months),
      profitOn: p.profitOn === 'cost' ? 'cost' : 'price', minimumWage: blank(p.minimumWage), weeklyHours: p.weeklyHours.trim() ? typed(p.weeklyHours) : 42, workerDeductionsPct: typed(p.workerDeductions),
      minNet: blank(p.minNet), guaranteePct: typed(p.guarantee),
      expenses: draft.expenses.filter(expense => expense.amount.trim() || expense.label.trim()).map(expense => ({ label: expense.label.trim(), amount: typed(expense.amount) })),
      sites: draft.sites.filter(siteKept).map(site => ({ name: site.name, posts: typed(site.posts), postHours: blank(site.postHours), hoursMonth: blank(site.hoursMonth) })) },
  };
}
export const scoreInputs = (draft: StudioDraft): ScoreSetup => ({ priceWeight: typed(draft.score.weight), ourOthers: typed(draft.score.ours), rivalOthers: typed(draft.score.rival), ourPrice: typed(draft.score.price) });

/** What was kept in the browser, back as a draft; anything that does not fit the shape is dropped for the starting draft. */
export function parseDraft(raw: string | null | undefined): StudioDraft {
  const fallback = defaultDraft();
  try {
    const value = JSON.parse(String(raw)) as Partial<StudioDraft>;
    const str = (x: unknown) => (typeof x === 'string' ? x : '');
    const profiles = Array.isArray(value.profiles) ? value.profiles.slice(0, 12).map((p: any) => ({ id: str(p?.id) || id(), name: str(p?.name), headcount: str(p?.headcount) || '1', base: str(p?.base), bonus: str(p?.bonus),
      nonTaxable: str(p?.nonTaxable), equipment: str(p?.equipment), other: str(p?.other), annualBonus: str(p?.annualBonus), holidays: str(p?.holidays), holidayHours: str(p?.holidayHours),
      exempt: str(p?.exempt), postPeople: str(p?.postPeople), postHours: str(p?.postHours) })) : [];
    const loads = Array.isArray(value.loads) ? value.loads.slice(0, 14).map((l: any) => ({ id: str(l?.id) || id(), label: str(l?.label), pct: str(l?.pct) })) : null;
    const expenses = Array.isArray(value.expenses) ? value.expenses.slice(0, 14).map((e: any) => ({ id: str(e?.id) || id(), label: str(e?.label), amount: str(e?.amount) })) : [];
    const sites = Array.isArray(value.sites) ? value.sites.slice(0, 40).map((x: any) => ({ id: str(x?.id) || id(), name: str(x?.name), posts: str(x?.posts), postHours: str(x?.postHours), hoursMonth: str(x?.hoursMonth) })) : [];
    const params = value.params && typeof value.params === 'object' ? value.params : {};
    const score = value.score && typeof value.score === 'object' ? value.score : {};
    const merged = Object.fromEntries(Object.entries(fallback.params).map(([key, initial]) => [key, typeof (params as any)[key] === 'string' ? (params as any)[key] : initial])) as StudioDraft['params'];
    return {
      profiles: profiles.length ? profiles : fallback.profiles, loads: loads ?? fallback.loads, expenses, sites,
      params: { ...merged, profitOn: merged.profitOn === 'cost' ? 'cost' : 'price' },
      score: Object.fromEntries(Object.entries(fallback.score).map(([key, initial]) => [key, typeof (score as any)[key] === 'string' ? (score as any)[key] : initial])) as StudioDraft['score'],
    };
  } catch {
    return fallback;
  }
}

export const studioKey = (userId: string | null | undefined, opportunityId: string) => `anton:price-studio:v1:${userId || 'anon'}:${opportunityId}`;

const money = (value: number) => `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(value))}`;
const percent = (value: number) => `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value)} %`;
/** The calculation as plain text to paste in an email or the bases' form: each figure with the assumption behind it. */
export function costSummary(draft: StudioDraft): string | null {
  const { profiles, params } = laborInputs(draft);
  const result = laborCost(profiles, params);
  if ('problem' in result) return null;
  const hours = (value: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value);
  const onCost = params.profitOn === 'cost';
  const lines = [
    `Valor hora hombre · cálculo interno (tasas de referencia a ${RATES_REFERENCE}, por confirmar con contabilidad)`, '',
    ...result.profiles.flatMap(p => [
      `${p.name || 'Perfil'} × ${p.headcount}: costo por persona al mes ${money(p.monthly.total)} · costo por hora ${money(p.costPerHour)} · precio por hora neto ${money(p.pricePerHour)} · precio mensual neto ${money(p.priceMonthly)}`,
      ...(p.post ? [`  Puesto de ${p.post.people} ${p.post.people === 1 ? 'persona' : 'personas'} que cubre ${hours(p.post.hours)} horas al mes: precio del puesto ${money(p.post.pricePerPost)} neto por mes (el total de las ${p.post.people}, no de una)`] : []),
      ...(p.net !== null ? [`  Líquido estimado por persona: ${money(p.net)}`] : []),
    ]),
    '', `Precio mensual neto: ${money(result.totals.priceMonthly)} · IVA ${percent(params.vatPct)}: ${money(result.totals.vatMonthly)} · total mensual: ${money(result.totals.totalMonthly)}`,
    `Contrato de ${params.months} meses: ${money(result.totals.contractNet)} neto · ${money(result.totals.contractWithVat)} con IVA`,
    `Valor hora promedio ponderado: ${money(result.totals.averagePricePerHour)} neto`,
    ...(result.sites ? ['', `Por sitio (puesto de «${result.sites.profile || 'Perfil'}»):`,
      ...result.sites.rows.map(row => `- ${row.name || 'Sitio'}: ${hours(row.hoursMonth)} horas al mes × ${money(row.pricePerHour)} = ${money(row.priceMonthly)} neto al mes · ${money(row.priceAnnual)} al año`),
      `Total de los sitios: ${money(result.sites.monthly)} al mes · ${money(result.sites.annual)} al año${params.guaranteePct ? ` · garantía de fiel cumplimiento (${percent(params.guaranteePct ?? 0)} del monto anual): ${money(result.sites.guarantee)}` : ''}`] : []),
    '',
    `Supuestos: gratificación ${percent(params.gratificationPct)}${params.gratificationCap !== null ? ` con tope de ${money(params.gratificationCap)}` : params.minimumWage ? ` con tope de 4,75 ingresos mínimos al año (${money(4.75 * params.minimumWage / 12)} al mes)` : ''}; cargas del empleador ${params.loads.filter(l => l.pct > 0).map(l => `${l.label || 'otra'} ${percent(l.pct)}`).join(', ') || 'ninguna'};`,
    ...((params.expenses ?? []).length ? [`gastos por persona al mes: ${(params.expenses ?? []).map(e => `${e.label || 'otro'} ${money(e.amount)}`).join(', ')};`] : []),
    `${params.paidHours} horas pagadas al mes; ausentismo ${percent(params.absenteeismPct)}; gastos generales ${percent(params.overheadPct)} y ${onCost ? 'utilidad' : 'margen'} ${percent(params.marginPct)} ${onCost ? 'del costo' : 'del precio'}${result.totals.exemptMonthly ? '; los costos sin utilidad (asistencia, boleta, seguros) se suman después' : ''}.`,
    ...(result.notes.length ? ['', 'Ojo con la planilla del cliente:', ...result.notes.map(note => `- ${note}`)] : []),
    ...(result.warnings.length ? ['', 'Ojo:', ...result.warnings.map(w => `- ${w}`)] : []),
  ];
  return lines.join('\n');
}
