import type { LeadSearchInput } from '@/lib/server/apollo-provider/validation';
import { LEADS_FINDER_ENUMS as ENUMS } from './actor-enums';

/**
 * Apify «Leads Finder» (code_crafter/leads-finder, Plan 11, PR 6a): the same filters of «Buscar prospectos», translated to
 * the actor's input. The allowed values are the actor's published input schema (actor-enums.ts, a snapshot of its
 * select options): a value outside them would make Apify reject the run, so a location, size or industry that does not
 * map is either moved to the free-text filters or reported as not applied, never sent as is.
 */
export const LEADS_FINDER_ACTOR = 'code_crafter~leads-finder';
/** One page of results, as in Apollo: the person asks for more with «Traer más». */
export const LEADS_FINDER_MAX_PER_RUN = 100;

export type LeadsFinderActorInput = {
  fetch_count: number;
  file_name: string;
  contact_job_title?: string[];
  seniority_level?: string[];
  functional_level?: string[];
  contact_location?: string[];
  contact_city?: string[];
  email_status?: string[];
  company_domain?: string[];
  size?: string[];
  company_industry?: string[];
  company_keywords?: string[];
};

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const allowed = (list: readonly string[]) => new Map(list.map(value => [fold(value), value]));
const SENIORITIES = allowed(ENUMS.seniority_level);
const INDUSTRIES = allowed(ENUMS.company_industry);
const LOCATIONS = allowed(ENUMS.contact_location_sample);

/** Apollo's seniority names that the actor spells differently. */
const SENIORITY_ALIASES: Record<string, string> = { intern: 'trainee', 'c-suite': 'c_suite', 'c-level': 'c_suite', owner: 'owner', founder: 'founder' };

/** Country names as people write them in Spanish, to the actor's (English) location. */
const COUNTRY_ALIASES: Record<string, string> = {
  chile: 'chile', peru: 'peru', mexico: 'mexico', colombia: 'colombia', argentina: 'argentina', espana: 'spain', brasil: 'brazil',
  ecuador: 'ecuador', uruguay: 'uruguay', paraguay: 'paraguay', bolivia: 'bolivia', venezuela: 'venezuela', 'costa rica': 'costa rica',
  panama: 'panama', guatemala: 'guatemala', 'republica dominicana': 'dominican republic', 'el salvador': 'el salvador',
  honduras: 'honduras', nicaragua: 'nicaragua', 'estados unidos': 'united states', eeuu: 'united states', usa: 'united states',
  canada: 'canada',
};

/** The Chilean regions the actor knows (its schema has seven); any other region goes as its capital city. */
const CHILE_REGIONS: Array<[RegExp, string]> = [
  [/^(region )?metropolitana( de santiago)?$|^rm$|^santiago metropolitan/, 'santiago metropolitan region, chile'],
  [/^(region de )?valparaiso$|^v region$/, 'valparaiso region, chile'],
  [/^(region del )?bio ?bio$|^biobio$|^viii region$/, 'bío bío region, chile'],
  [/^(region de )?antofagasta$|^ii region$/, 'antofagasta region, chile'],
  [/^(region de )?coquimbo$|^iv region$/, 'coquimbo region, chile'],
  [/^(region de )?los rios$|^xiv region$/, 'los ríos region, chile'],
  [/^(region de )?los lagos$|^x region$/, 'los lagos region, chile'],
  [/^(region de )?magallanes/, 'magallanes y la antártica chilena region, chile'],
];
const CHILE_REGION_CAPITALS: Array<[RegExp, string]> = [
  [/^(region de )?arica( y parinacota)?$/, 'arica'], [/^(region de )?tarapaca$/, 'iquique'], [/^(region de )?atacama$/, 'copiapó'],
  [/^(region del )?libertador|o.?higgins$/, 'rancagua'], [/^(region del )?maule$/, 'talca'], [/^(region de )?nuble$/, 'chillán'],
  [/^(region de )?(la )?araucania$/, 'temuco'], [/^(region de )?aysen/, 'coyhaique'],
];

function mapLocation(raw: string, out: { locations: Set<string>; cities: Set<string>; skipped: string[] }) {
  const parts = raw.split(',').map(part => fold(part)).filter(Boolean);
  if (!parts.length) return;
  const last = parts[parts.length - 1];
  const country = COUNTRY_ALIASES[last] || (LOCATIONS.has(last) ? LOCATIONS.get(last)! : null);
  const place = parts.length > 1 ? parts[0] : country ? null : parts[0];
  if (!place) {
    if (country) out.locations.add(country);
    return;
  }
  const region = CHILE_REGIONS.find(([pattern]) => pattern.test(place));
  if (region) { out.locations.add(region[1]); return; }
  const capital = CHILE_REGION_CAPITALS.find(([pattern]) => pattern.test(place));
  if (capital) { out.cities.add(capital[1]); if (country) out.locations.add(country); else out.locations.add('chile'); return; }
  if (LOCATIONS.has(place)) { out.locations.add(LOCATIONS.get(place)!); return; }
  // A city: the actor matches it as free text; the country, when given, narrows it.
  out.cities.add(place);
  if (country) out.locations.add(country);
}

/** The actor's company-size brackets that overlap a «min,max» range of employees. */
const SIZE_BRACKETS = ENUMS.size.map(label => {
  const [min, max] = label.endsWith('+') ? [Number(label.slice(0, -1)), Number.POSITIVE_INFINITY] : label.split('-').map(Number);
  return { label, min, max };
});
export function sizeBrackets(range: string) {
  const [min, max] = range.split(',').map(Number);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  return SIZE_BRACKETS.filter(bracket => bracket.min <= max && bracket.max >= Math.max(1, min)).map(bracket => bracket.label);
}

/** Industries as the app and its people write them (Spanish or Apollo's names), to the actor's list. */
const INDUSTRY_ALIASES: Record<string, string> = {
  'recursos humanos': 'human resources', rrhh: 'human resources', reclutamiento: 'staffing & recruiting', seleccion: 'staffing & recruiting',
  staffing: 'staffing & recruiting', outsourcing: 'outsourcing/offshoring', tecnologia: 'information technology & services',
  technology: 'information technology & services', software: 'computer software', salud: 'hospital & health care',
  healthcare: 'hospital & health care', finanzas: 'financial services', finance: 'financial services', banca: 'banking',
  construccion: 'construction', mineria: 'mining & metals', mining: 'mining & metals', educacion: 'education management',
  education: 'education management', comercio: 'retail', logistica: 'logistics & supply chain', transporte: 'transportation/trucking/railroad',
  seguridad: 'security & investigations', inmobiliaria: 'real estate', inmobiliario: 'real estate', energia: 'oil & energy',
  'energias renovables': 'renewables & environment', agricultura: 'farming', alimentos: 'food production', seguros: 'insurance',
  telecomunicaciones: 'telecommunications', consultoria: 'management consulting', legal: 'legal services', abogados: 'law practice',
  hoteleria: 'hospitality', turismo: 'leisure, travel & tourism', retail: 'retail', manufactura: 'machinery', manufacturing: 'machinery',
  fabricacion: 'machinery', 'gobierno': 'government administration', aseo: 'facilities services', 'servicios generales': 'facilities services',
};

const clean = (values: string[], max = 20) => [...new Set(values.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, max);

/**
 * The actor's input for one search, plus what could not be applied (shown to the person, never hidden). Only the
 * filter search (`batch`) maps: a search by company name needs the company's website.
 */
export function leadsFinderInput(input: LeadSearchInput, options: { fetchCount?: number } = {}) {
  const notApplied: string[] = [];
  const seniorities = new Set<string>();
  for (const value of input.seniorities) {
    const key = fold(value);
    const mapped = SENIORITY_ALIASES[key] || SENIORITIES.get(key);
    if (mapped && SENIORITIES.has(fold(mapped))) seniorities.add(SENIORITIES.get(fold(mapped))!);
    else notApplied.push(`seniority «${value}»`);
  }
  const places = { locations: new Set<string>(), cities: new Set<string>(), skipped: [] as string[] };
  for (const value of input.personLocations) mapLocation(value, places);
  // The actor filters people by where they are; the company's location is the closest it has.
  if (input.companyLocations.length) {
    for (const value of input.companyLocations) mapLocation(value, places);
    notApplied.push('la ubicación de la empresa se usa como la de la persona');
  }
  const sizes = new Set<string>();
  for (const range of input.employeeRanges) for (const bracket of sizeBrackets(range)) sizes.add(bracket);
  const industries = new Set<string>();
  const keywords = new Set<string>(clean(input.companyKeywords));
  for (const value of input.industryKeywords) {
    const key = fold(value);
    const mapped = INDUSTRY_ALIASES[key] || (INDUSTRIES.has(key) ? INDUSTRIES.get(key) : undefined);
    if (mapped) industries.add(mapped);
    else keywords.add(value.trim());
  }
  const domains = clean([...input.organizationDomains, ...(input.selectedOrganizationDomain ? [input.selectedOrganizationDomain] : [])]);
  if (input.searchMode !== 'batch' && !domains.length) {
    return { ok: false as const, error: 'Leads Finder busca por filtros: para una empresa en particular, escribe su sitio web.' };
  }

  const actorInput: LeadsFinderActorInput = {
    fetch_count: Math.max(1, Math.min(LEADS_FINDER_MAX_PER_RUN, options.fetchCount ?? input.maxResults ?? 25)),
    file_name: 'ANTON.IA',
    // Outreach needs an email that was checked: the same promise as an Apollo «verificado».
    email_status: ['validated'],
  };
  const set = <K extends keyof LeadsFinderActorInput>(key: K, values: string[]) => { if (values.length) (actorInput[key] as string[]) = values; };
  set('contact_job_title', clean(input.titles));
  set('seniority_level', [...seniorities]);
  set('contact_location', clean([...places.locations]));
  set('contact_city', clean([...places.cities]));
  set('company_domain', domains);
  set('size', [...sizes]);
  set('company_industry', [...industries].slice(0, 20));
  set('company_keywords', clean([...keywords]));
  if (!actorInput.contact_job_title && !actorInput.company_domain && !actorInput.company_industry && !actorInput.company_keywords) {
    return { ok: false as const, error: 'Agrega al menos un cargo, una industria, una palabra clave o un sitio web para buscar.' };
  }
  return { ok: true as const, input: actorInput, notApplied };
}
