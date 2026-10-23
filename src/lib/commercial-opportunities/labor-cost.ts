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
  /** Yearly bonuses paid once (Christmas, national holidays), CLP per person per year: a twelfth goes in each month. */
  annualBonus?: number;
  /** Holidays the person works in a year and the hours of each: paid as overtime, with the 50 % surcharge. */
  holidaysWorked?: number;
  holidayHours?: number;
  /** Costs that carry no margin (attendance bonus, performance bond, insurance), CLP per person per month: they are added after it. */
  exempt?: number;
  /** A post covered every day of the month by people in shifts (4x4 takes 2): how many people it takes and the hours the post covers in a month. */
  postPeople?: number;
  postHours?: number;
};
/** An expense that every person carries each month (supervisor and safety officer shared out, radio, course), CLP. */
export type Expense = { label: string; amount: number };
/**
 * A site (a store, a building) and how many posts it has. Its posts may cover other hours than the profile's, and the client may fix the hours
 * of the site's month itself (its form says «1.003,75», not 3 posts × 334,58): then those are the hours the price is multiplied by.
 */
export type Site = { name: string; posts: number; postHours?: number | null; hoursMonth?: number | null };
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
  /**
   * What overhead and margin are a share of: the PRICE (the default, as in the financial scenario) or the COST, the way the forms of some
   * clients define «utilidad» (a markup over the total cost, with what carries no margin added after it).
   */
  profitOn?: 'price' | 'cost';
  /** The legal minimum wage: when there is one and no cap was set, the bonus is capped at 4,75 of them a year (art. 50 of the labor code), a twelfth each month. */
  minimumWage?: number | null;
  /** Legal weekly hours: the value of an overtime hour comes from them. */
  weeklyHours?: number;
  /** What the worker pays out of the taxable salary (pension, health, unemployment) and the net pay the bases ask for at least. */
  workerDeductionsPct?: number;
  minNet?: number | null;
  expenses?: Expense[];
  /** Performance bond, as a share of the year's net price. */
  guaranteePct?: number;
  sites?: Site[];
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
  profitOn: 'price', minimumWage: null, weeklyHours: 42, workerDeductionsPct: 0, minNet: null, expenses: [], guaranteePct: 0, sites: [],
};
/** Art. 50: the legal bonus is capped at 4,75 monthly minimum wages a year. */
export const GRATIFICATION_CAP_WAGES = 4.75;
/** Art. 32: an overtime hour is paid with 50 % more. */
export const OVERTIME_FACTOR = 1.5;
export const EMPTY_PROFILE: LaborProfile = { name: '', headcount: 1, baseSalary: 0, bonus: 0, nonTaxable: 0, equipment: 0, other: 0 };

export type ProfileCost = {
  name: string; headcount: number;
  /** What one person costs the company in a month, by concept. */
  monthly: { base: number; gratification: number; bonus: number; loads: number; nonTaxable: number; equipment: number; other: number;
    annualBonus: number; holidays: number; expenses: number; total: number };
  /** Net pay estimated from the taxable salary, when the worker's deductions were given. */
  net: number | null;
  exempt: number;
  /** Hours each person covers in a month (a post's hours shared among its people), before absences. */
  hoursPerPerson: number;
  /** For a post covered in shifts: the people it takes, the hours it covers and the month's price of one post. */
  post: { people: number; hours: number; pricePerPost: number } | null;
  productiveHours: number;
  costPerHour: number;
  pricePerPersonMonth: number;
  pricePerHour: number;
  /** The month's price for all the people of the profile. */
  priceMonthly: number;
};
export type SiteRow = { name: string; posts: number; postHours: number; hoursMonth: number; pricePerHour: number; priceMonthly: number; priceAnnual: number };
export type LaborCostResult = {
  profiles: ProfileCost[];
  totals: { directMonthly: number; overheadMonthly: number; marginMonthly: number; exemptMonthly: number; priceMonthly: number; vatMonthly: number; totalMonthly: number; contractNet: number;
    contractWithVat: number; hoursMonthly: number; averagePricePerHour: number };
  /** The price site by site, for the profile that has posts (the first one), with the performance bond. */
  sites: { profile: string; rows: SiteRow[]; monthly: number; annual: number; guarantee: number } | null;
  /** What the person should look at before trusting the number. */
  warnings: string[];
  /** What to know about how the number is made, not something wrong with it. */
  notes: string[];
};

const clp = (value: number) => `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(value))}`;

/** Why the inputs cannot be computed, in words for the person; null when they can. */
export function laborProblem(profiles: readonly LaborProfile[], params: LaborParams): string | null {
  const expenses = params.expenses ?? [], sites = params.sites ?? [];
  const numbers = [params.gratificationPct, params.paidHours, params.absenteeismPct, params.overheadPct, params.marginPct, params.vatPct, params.months, ...(params.gratificationCap === null ? [] : [params.gratificationCap]),
    params.minimumWage ?? 0, params.weeklyHours ?? 42, params.workerDeductionsPct ?? 0, params.minNet ?? 0, params.guaranteePct ?? 0,
    ...params.loads.map(load => load.pct), ...expenses.map(expense => expense.amount), ...sites.flatMap(site => [site.posts, site.postHours ?? 0, site.hoursMonth ?? 0]),
    ...profiles.flatMap(p => [p.headcount, p.baseSalary, p.bonus, p.nonTaxable, p.equipment, p.other, p.annualBonus ?? 0, p.holidaysWorked ?? 0, p.holidayHours ?? 0, p.exempt ?? 0, p.postPeople ?? 0, p.postHours ?? 0])];
  if (!numbers.every(Number.isFinite) || numbers.some(value => value < 0)) return 'Revisa los números: alguno no es válido o es negativo.';
  if (!profiles.length) return 'Agrega al menos un perfil.';
  if (params.paidHours < 1 || params.paidHours > 744) return 'Las horas pagadas al mes deben estar entre 1 y 744.';
  if (params.absenteeismPct >= 90) return 'El ausentismo no puede ser tan alto: el precio no se puede calcular.';
  if (params.profitOn !== 'cost' && params.overheadPct + params.marginPct >= 100) return 'Los gastos generales y el margen suman 100 % o más del precio: no se puede calcular.';
  if (params.months < 1 || params.months > 120) return 'El plazo debe estar entre 1 y 120 meses.';
  if ((params.weeklyHours ?? 42) < 1 || (params.weeklyHours ?? 42) > 60) return 'La jornada semanal debe estar entre 1 y 60 horas.';
  if ((params.workerDeductionsPct ?? 0) >= 100) return 'Los descuentos del trabajador no pueden llegar al 100 %.';
  if ((params.guaranteePct ?? 0) > 100) return 'La garantía no puede pasar del 100 % del monto anual.';
  for (const profile of profiles) {
    const name = profile.name.trim() || 'Perfil sin nombre';
    if ((profile.holidayHours ?? 0) > 24) return `Las horas de un festivo de «${name}» no pueden pasar de 24.`;
    if ((profile.postHours ?? 0) > 744) return `Las horas del puesto de «${name}» no pueden pasar de 744 al mes.`;
    if ((profile.postHours ?? 0) > 0 && (profile.postPeople ?? 0) < 1) return `Indica cuántas personas cubren el puesto de «${name}» (4x4 son 2).`;
  }
  if (sites.some(site => (site.postHours ?? 0) > 744)) return 'Las horas de un puesto no pueden pasar de 744 al mes.';
  return null;
}

export function laborCost(profiles: readonly LaborProfile[], params: LaborParams): LaborCostResult | { problem: string } {
  const problem = laborProblem(profiles, params);
  if (problem) return { problem };
  const loadsPct = params.loads.reduce((sum, load) => sum + load.pct, 0);
  const share = (params.overheadPct + params.marginPct) / 100;
  const onCost = params.profitOn === 'cost';
  const weeklyHours = params.weeklyHours ?? 42;
  const wage = params.minimumWage ?? 0;
  const cap = params.gratificationCap ?? (wage > 0 ? GRATIFICATION_CAP_WAGES * wage / 12 : Infinity);
  const expensesMonthly = (params.expenses ?? []).reduce((sum, expense) => sum + expense.amount, 0);
  const deductions = params.workerDeductionsPct ?? 0;
  const minNet = params.minNet ?? 0;
  const warnings: string[] = [], notes: string[] = [];
  // What the price adds to the cost of a person, kept per profile so the totals can say how much of the price is each thing.
  const parts: Array<{ overhead: number; margin: number }> = [];
  const costs: ProfileCost[] = profiles.map(profile => {
    const name = profile.name.trim();
    const gratification = Math.min(profile.baseSalary * params.gratificationPct / 100, cap);
    const taxable = profile.baseSalary + gratification + profile.bonus;
    const loads = taxable * loadsPct / 100;
    const annualBonus = (profile.annualBonus ?? 0) / 12;
    // An hour of overtime is the monthly salary over the hours of the month the way the law counts them (28 of 30 days, 4 weeks), plus 50 %.
    const holidays = (profile.holidaysWorked ?? 0) * (profile.holidayHours ?? 0) * (profile.baseSalary / 30 * 28 / (weeklyHours * 4) * OVERTIME_FACTOR) / 12;
    const total = taxable + loads + profile.nonTaxable + profile.equipment + profile.other + annualBonus + holidays + expensesMonthly;
    const exempt = profile.exempt ?? 0;
    const withProfit = onCost ? total * (1 + share) : total / (1 - share);
    const pricePerPersonMonth = withProfit + exempt;
    const base = onCost ? total : withProfit;
    parts.push({ overhead: base * params.overheadPct / 100, margin: base * params.marginPct / 100 });
    const inPost = (profile.postHours ?? 0) > 0 && (profile.postPeople ?? 0) >= 1;
    const hoursPerPerson = inPost ? profile.postHours! / profile.postPeople! : params.paidHours;
    const productiveHours = hoursPerPerson * (1 - params.absenteeismPct / 100);
    const pricePerHour = pricePerPersonMonth / productiveHours;
    const net = deductions > 0 ? taxable * (1 - deductions / 100) + profile.nonTaxable : null;
    if (net !== null && minNet > 0 && net < minNet) warnings.push(`El líquido estimado de «${name || 'Perfil sin nombre'}» (${clp(net)}) queda bajo el mínimo que piden las bases (${clp(minNet)}).`);
    if ((profile.holidaysWorked ?? 0) > 0 && !(profile.holidayHours ?? 0)) warnings.push(`«${name || 'Perfil sin nombre'}» trabaja festivos pero no dice cuántas horas: no suman costo.`);
    if (inPost && profile.postPeople! > 1) notes.push(`«${name || 'Perfil sin nombre'}»: un puesto cubre ${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(profile.postHours!)} horas al mes con ${profile.postPeople} personas en turno. El precio del puesto suma a las ${profile.postPeople}; si el formulario del cliente pide el monto de una persona y divide por las horas del puesto, el valor hora queda en ${profile.postPeople === 2 ? 'la mitad' : `1/${profile.postPeople}`}. Llena el total por puesto.`);
    return { name, headcount: profile.headcount,
      monthly: { base: profile.baseSalary, gratification, bonus: profile.bonus, loads, nonTaxable: profile.nonTaxable, equipment: profile.equipment, other: profile.other, annualBonus, holidays, expenses: expensesMonthly, total },
      net, exempt, hoursPerPerson, post: inPost ? { people: profile.postPeople!, hours: profile.postHours!, pricePerPost: pricePerHour * profile.postHours! } : null,
      productiveHours, costPerHour: total / productiveHours, pricePerPersonMonth, pricePerHour, priceMonthly: pricePerPersonMonth * profile.headcount };
  });
  const directMonthly = costs.reduce((sum, c) => sum + c.monthly.total * c.headcount, 0);
  const priceMonthly = costs.reduce((sum, c) => sum + c.priceMonthly, 0);
  const exemptMonthly = costs.reduce((sum, c) => sum + c.exempt * c.headcount, 0);
  const hoursMonthly = costs.reduce((sum, c) => sum + c.productiveHours * c.headcount, 0);
  const vatMonthly = priceMonthly * params.vatPct / 100;
  if (!loadsPct) warnings.push('No hay cargas del empleador: el costo de cada persona queda corto.');
  if (!params.absenteeismPct) warnings.push('No incluiste reemplazos por vacaciones y licencias: cada hora que cobras sale de una hora pagada, y las que no se trabajan las pagas tú.');
  if (!params.overheadPct) warnings.push('No incluiste gastos generales (supervisión, administración, oficina).');
  if (!params.marginPct) warnings.push(onCost ? 'La utilidad es 0: el precio solo cubre los costos.' : 'El margen es 0: el precio solo cubre los costos.');
  for (const profile of profiles) if (profile.headcount > 0 && profile.baseSalary <= 0) warnings.push(`«${profile.name.trim() || 'Perfil sin nombre'}» no tiene sueldo base.`);

  // The price site by site, for the first profile that has posts: the same cost of a post wherever it is, over the hours that site's posts cover.
  const postProfile = costs.find(c => c.post);
  const siteList = params.sites ?? [];
  let sites: LaborCostResult['sites'] = null;
  if (postProfile?.post && siteList.length) {
    const rows: SiteRow[] = siteList.map(site => {
      const postHours = (site.postHours ?? 0) > 0 ? site.postHours! : postProfile.post!.hours;
      const pricePerHour = postProfile.post!.pricePerPost / postHours;
      const hoursMonth = (site.hoursMonth ?? 0) > 0 ? site.hoursMonth! : site.posts * postHours;
      const monthly = Math.round(hoursMonth * pricePerHour);
      return { name: site.name.trim(), posts: site.posts, postHours, hoursMonth, pricePerHour, priceMonthly: monthly, priceAnnual: monthly * 12 };
    });
    const annual = rows.reduce((sum, row) => sum + row.priceAnnual, 0);
    sites = { profile: postProfile.name, rows, monthly: rows.reduce((sum, row) => sum + row.priceMonthly, 0), annual, guarantee: annual * (params.guaranteePct ?? 0) / 100 };
    if (costs.filter(c => c.post).length > 1) warnings.push(`La tabla por sitio usa el puesto de «${postProfile.name || 'Perfil sin nombre'}»; los otros perfiles con puesto no entran en ella.`);
  } else if (siteList.length) warnings.push('Definiste sitios, pero ningún perfil tiene puesto (personas por puesto y horas del puesto): la tabla por sitio no se calcula.');

  return { profiles: costs, warnings, notes, sites, totals: { directMonthly, overheadMonthly: costs.reduce((sum, c, index) => sum + parts[index].overhead * c.headcount, 0),
    marginMonthly: costs.reduce((sum, c, index) => sum + parts[index].margin * c.headcount, 0), exemptMonthly, priceMonthly, vatMonthly,
    totalMonthly: priceMonthly + vatMonthly, contractNet: priceMonthly * params.months, contractWithVat: (priceMonthly + vatMonthly) * params.months, hoursMonthly,
    averagePricePerHour: hoursMonthly > 0 ? priceMonthly / hoursMonthly : 0 } };
}
