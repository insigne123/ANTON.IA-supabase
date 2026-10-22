// The state of the price tool of «Cómo postular»: what the person types (as text, so a half-typed number is not lost), how it becomes the
// numbers of labor-cost.ts and price-scenarios.ts, how it is kept in the browser and the summary that can be copied. Pure.
import { DEFAULT_PARAMS, EMPTY_PROFILE, RATES_REFERENCE, laborCost, type LaborParams, type LaborProfile } from './labor-cost';
import { offerPrice } from './offer-draft';
import type { ScoreSetup } from './price-scenarios';

export type StudioProfile = { id: string; name: string; headcount: string; base: string; bonus: string; nonTaxable: string; equipment: string; other: string };
export type StudioLoad = { id: string; label: string; pct: string };
export type StudioDraft = {
  profiles: StudioProfile[]; loads: StudioLoad[];
  params: { gratification: string; cap: string; paidHours: string; absenteeism: string; overhead: string; margin: string; vat: string; months: string };
  score: { weight: string; ours: string; rival: string; price: string };
};

const id = () => Math.random().toString(36).slice(2, 9);
const text = (value: number) => (value ? String(value) : '');
export const newProfile = (): StudioProfile => ({ id: id(), name: '', headcount: String(EMPTY_PROFILE.headcount), base: '', bonus: '', nonTaxable: '', equipment: '', other: '' });
export const newLoad = (): StudioLoad => ({ id: id(), label: '', pct: '' });

export function defaultDraft(): StudioDraft {
  return {
    profiles: [newProfile()],
    loads: DEFAULT_PARAMS.loads.map(load => ({ id: id(), label: load.label, pct: String(load.pct).replace('.', ',') })),
    params: { gratification: String(DEFAULT_PARAMS.gratificationPct), cap: '', paidHours: String(DEFAULT_PARAMS.paidHours), absenteeism: text(DEFAULT_PARAMS.absenteeismPct),
      overhead: text(DEFAULT_PARAMS.overheadPct), margin: text(DEFAULT_PARAMS.marginPct), vat: String(DEFAULT_PARAMS.vatPct), months: String(DEFAULT_PARAMS.months) },
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
  return {
    profiles: draft.profiles.map(profile => ({ name: profile.name, headcount: typed(profile.headcount), baseSalary: typed(profile.base), bonus: typed(profile.bonus),
      nonTaxable: typed(profile.nonTaxable), equipment: typed(profile.equipment), other: typed(profile.other) })),
    params: { gratificationPct: typed(p.gratification), gratificationCap: p.cap.trim() ? typed(p.cap) : null, loads: draft.loads.filter(load => load.pct.trim() || load.label.trim()).map(load => ({ label: load.label.trim(), pct: typed(load.pct) })),
      paidHours: typed(p.paidHours), absenteeismPct: typed(p.absenteeism), overheadPct: typed(p.overhead), marginPct: typed(p.margin), vatPct: typed(p.vat), months: typed(p.months) },
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
      nonTaxable: str(p?.nonTaxable), equipment: str(p?.equipment), other: str(p?.other) })) : [];
    const loads = Array.isArray(value.loads) ? value.loads.slice(0, 12).map((l: any) => ({ id: str(l?.id) || id(), label: str(l?.label), pct: str(l?.pct) })) : null;
    const params = value.params && typeof value.params === 'object' ? value.params : {};
    const score = value.score && typeof value.score === 'object' ? value.score : {};
    return {
      profiles: profiles.length ? profiles : fallback.profiles, loads: loads ?? fallback.loads,
      params: Object.fromEntries(Object.entries(fallback.params).map(([key, initial]) => [key, typeof (params as any)[key] === 'string' ? (params as any)[key] : initial])) as StudioDraft['params'],
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
  const lines = [
    `Valor hora hombre · cálculo interno (tasas de referencia a ${RATES_REFERENCE}, por confirmar con contabilidad)`, '',
    ...result.profiles.map(p => `${p.name || 'Perfil'} × ${p.headcount}: costo por persona al mes ${money(p.monthly.total)} · costo por hora ${money(p.costPerHour)} · precio por hora neto ${money(p.pricePerHour)} · precio mensual neto ${money(p.priceMonthly)}`),
    '', `Precio mensual neto: ${money(result.totals.priceMonthly)} · IVA ${percent(params.vatPct)}: ${money(result.totals.vatMonthly)} · total mensual: ${money(result.totals.totalMonthly)}`,
    `Contrato de ${params.months} meses: ${money(result.totals.contractNet)} neto · ${money(result.totals.contractWithVat)} con IVA`,
    `Valor hora promedio ponderado: ${money(result.totals.averagePricePerHour)} neto`, '',
    `Supuestos: gratificación ${percent(params.gratificationPct)}${params.gratificationCap !== null ? ` con tope de ${money(params.gratificationCap)}` : ''}; cargas del empleador ${params.loads.map(l => `${l.label || 'otra'} ${percent(l.pct)}`).join(', ') || 'ninguna'};`,
    `${params.paidHours} horas pagadas al mes; ausentismo ${percent(params.absenteeismPct)}; gastos generales ${percent(params.overheadPct)} y margen ${percent(params.marginPct)} del precio.`,
    ...(result.warnings.length ? ['', 'Ojo:', ...result.warnings.map(w => `- ${w}`)] : []),
  ];
  return lines.join('\n');
}
