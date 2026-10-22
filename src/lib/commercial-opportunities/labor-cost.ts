// The price of an hour of work for a service sold by the hour or by post (guards, cleaning, back office): from what one person costs
// the company a month to what the hour is quoted at, with the margin and the overhead in the same way as the financial scenario
// (opportunityFinancialScenario): both are a share of the PRICE. Every rate is a parameter the person confirms; the ones that
// come with the tool are a starting point for the date they say, not an answer. Pure: the page and the tests share it.

export type Load = { label: string; pct: number };
export type LaborProfile = {
  name: string;
  /** People in this profile that the service needs. */
  headcount: number;
  /** Monthly base salary, CLP. */
  baseSalary: number;
  /** Fixed monthly bonuses that count for contributions, CLP. */
  bonus: number;
  /** Lunch and transport allowances: they do not count for contributions, CLP per month. */
  nonTaxable: number;
  /** Uniform and protective equipment, CLP per person per month. */
  equipment: number;
  /** Anything else per person per month (exams, training, phone…), CLP. */
  other: number;
};
export type LaborParams = {
  /** Legal bonus (gratificación) as a share of the base salary, and its monthly cap when the person sets one. */
  gratificationPct: number;
  gratificationCap: number | null;
  /** The employer's contributions, each a share of the salary that counts for contributions. */
  loads: Load[];
  /** Hours paid per person per month. */
  paidHours: number;
  /** Share of the paid hours that are not worked (holidays, sick leave) and that the price must cover. */
  absenteeismPct: number;
  /** Administration and general expenses, and margin: shares of the price. */
  overheadPct: number;
  marginPct: number;
  vatPct: number;
  months: number;
};

/** Starting rates, as the sources the tool was made from gave them in October 2026. The company's accountant confirms them. */
export const RATES_REFERENCE = 'octubre de 2026';
export const DEFAULT_LOADS: readonly Load[] = [
  { label: 'Seguro de invalidez y sobrevivencia (SIS)', pct: 1.5 },
  { label: 'Cotización adicional del empleador (Ley 21.735)', pct: 3.5 },
  { label: 'Seguro de cesantía, contrato indefinido', pct: 2.4 },
  { label: 'Mutual: cotización básica', pct: 0.93 },
];
/** 42 hours a week since 26 April 2026: 42 × 52 ÷ 12. */
export const DEFAULT_PAID_HOURS = 182;
export const DEFAULT_PARAMS: LaborParams = {
  gratificationPct: 25, gratificationCap: null, loads: DEFAULT_LOADS.map(load => ({ ...load })), paidHours: DEFAULT_PAID_HOURS,
  absenteeismPct: 0, overheadPct: 0, marginPct: 0, vatPct: 19, months: 12,
};
export const EMPTY_PROFILE: LaborProfile = { name: '', headcount: 1, baseSalary: 0, bonus: 0, nonTaxable: 0, equipment: 0, other: 0 };

export type ProfileCost = {
  name: string; headcount: number;
  /** What one person costs the company in a month, by concept. */
  monthly: { base: number; gratification: number; bonus: number; loads: number; nonTaxable: number; equipment: number; other: number; total: number };
  productiveHours: number;
  costPerHour: number;
  pricePerPersonMonth: number;
  pricePerHour: number;
  /** The month's price for all the people of the profile. */
  priceMonthly: number;
};
export type LaborCostResult = {
  profiles: ProfileCost[];
  totals: { directMonthly: number; overheadMonthly: number; marginMonthly: number; priceMonthly: number; vatMonthly: number; totalMonthly: number; contractNet: number; contractWithVat: number;
    hoursMonthly: number; averagePricePerHour: number };
  /** What the person should look at before trusting the number. */
  warnings: string[];
};

/** Why the inputs cannot be computed, in words for the person; null when they can. */
export function laborProblem(profiles: readonly LaborProfile[], params: LaborParams): string | null {
  const numbers = [params.gratificationPct, params.paidHours, params.absenteeismPct, params.overheadPct, params.marginPct, params.vatPct, params.months, ...(params.gratificationCap === null ? [] : [params.gratificationCap]),
    ...params.loads.map(load => load.pct), ...profiles.flatMap(p => [p.headcount, p.baseSalary, p.bonus, p.nonTaxable, p.equipment, p.other])];
  if (!numbers.every(Number.isFinite) || numbers.some(value => value < 0)) return 'Revisa los números: alguno no es válido o es negativo.';
  if (!profiles.length) return 'Agrega al menos un perfil.';
  if (params.paidHours < 1 || params.paidHours > 744) return 'Las horas pagadas al mes deben estar entre 1 y 744.';
  if (params.absenteeismPct >= 90) return 'El ausentismo no puede ser tan alto: el precio no se puede calcular.';
  if (params.overheadPct + params.marginPct >= 100) return 'Los gastos generales y el margen suman 100 % o más del precio: no se puede calcular.';
  if (params.months < 1 || params.months > 120) return 'El plazo debe estar entre 1 y 120 meses.';
  return null;
}

export function laborCost(profiles: readonly LaborProfile[], params: LaborParams): LaborCostResult | { problem: string } {
  const problem = laborProblem(profiles, params);
  if (problem) return { problem };
  const loadsPct = params.loads.reduce((sum, load) => sum + load.pct, 0);
  const shareOfPrice = (params.overheadPct + params.marginPct) / 100;
  const productiveHours = params.paidHours * (1 - params.absenteeismPct / 100);
  const costs: ProfileCost[] = profiles.map(profile => {
    const gratification = Math.min(profile.baseSalary * params.gratificationPct / 100, params.gratificationCap ?? Infinity);
    const taxable = profile.baseSalary + gratification + profile.bonus;
    const loads = taxable * loadsPct / 100;
    const total = taxable + loads + profile.nonTaxable + profile.equipment + profile.other;
    const pricePerPersonMonth = total / (1 - shareOfPrice);
    return { name: profile.name.trim(), headcount: profile.headcount,
      monthly: { base: profile.baseSalary, gratification, bonus: profile.bonus, loads, nonTaxable: profile.nonTaxable, equipment: profile.equipment, other: profile.other, total },
      productiveHours, costPerHour: total / productiveHours, pricePerPersonMonth, pricePerHour: pricePerPersonMonth / productiveHours, priceMonthly: pricePerPersonMonth * profile.headcount };
  });
  const directMonthly = costs.reduce((sum, c) => sum + c.monthly.total * c.headcount, 0);
  const priceMonthly = costs.reduce((sum, c) => sum + c.priceMonthly, 0);
  const hoursMonthly = costs.reduce((sum, c) => sum + c.productiveHours * c.headcount, 0);
  const vatMonthly = priceMonthly * params.vatPct / 100;
  const warnings: string[] = [];
  if (!loadsPct) warnings.push('No hay cargas del empleador: el costo de cada persona queda corto.');
  if (!params.absenteeismPct) warnings.push('No incluiste reemplazos por vacaciones y licencias: cada hora que cobras sale de una hora pagada, y las que no se trabajan las pagas tú.');
  if (!params.overheadPct) warnings.push('No incluiste gastos generales (supervisión, administración, oficina).');
  if (!params.marginPct) warnings.push('El margen es 0: el precio solo cubre los costos.');
  for (const profile of profiles) if (profile.headcount > 0 && profile.baseSalary <= 0) warnings.push(`«${profile.name.trim() || 'Perfil sin nombre'}» no tiene sueldo base.`);
  return { profiles: costs, warnings, totals: { directMonthly, overheadMonthly: priceMonthly * params.overheadPct / 100, marginMonthly: priceMonthly * params.marginPct / 100, priceMonthly, vatMonthly,
    totalMonthly: priceMonthly + vatMonthly, contractNet: priceMonthly * params.months, contractWithVat: (priceMonthly + vatMonthly) * params.months, hoursMonthly,
    averagePricePerHour: hoursMonthly > 0 ? priceMonthly / hoursMonthly : 0 } };
}
