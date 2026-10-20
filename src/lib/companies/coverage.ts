import { FLOW_STAGES, flowStage } from '@/lib/pipeline-flow';
import type { PipelineStage } from '@/lib/crm-types';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import { normalizeCompanyWebsite, websiteFromWorkEmail } from '@/lib/profile/profile-mappings';

/**
 * «Empresas» in the Pipeline (propuesta 5): the people of the CRM by company, where each one sits (area and level) and the
 * three roles a sale usually needs: who decides, who uses what you sell and who pays. All of it is read from the rows the
 * Pipeline already has: the cargo, and Apollo's seniority and departments when the contact was enriched.
 */

export const AREAS = [
  { id: 'general', label: 'Gerencia general' },
  { id: 'personas', label: 'Personas' },
  { id: 'operaciones', label: 'Operaciones' },
  { id: 'comercial', label: 'Comercial' },
  { id: 'finanzas', label: 'Finanzas' },
  { id: 'compras', label: 'Compras' },
  { id: 'ti', label: 'Tecnología' },
  { id: 'prevencion', label: 'Prevención y seguridad' },
  { id: 'legal', label: 'Legal' },
  { id: 'otra', label: 'Otras áreas' },
] as const;
export type Area = typeof AREAS[number]['id'];

export const LEVELS = [
  { id: 'alta', label: 'Alta dirección', short: 'Alta dir.' },
  { id: 'gerencia', label: 'Gerencia', short: 'Gerencia' },
  { id: 'jefatura', label: 'Jefatura', short: 'Jefatura' },
  { id: 'equipo', label: 'Equipo', short: 'Equipo' },
] as const;
export type Level = typeof LEVELS[number]['id'];

export const areaLabel = (area: Area) => AREAS.find(item => item.id === area)!.label;
export const levelLabel = (level: Level) => LEVELS.find(item => item.id === level)!.label;

/** Lowercase, without accents or punctuation: «Jefa de RR.HH.» → «jefa de rrhh». */
export function fold(text: string | null | undefined) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\./g, '').replace(/[^a-z0-9ñ&/+ -]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const has = (text: string, pattern: RegExp) => pattern.test(` ${text} `);

// The top of the company: it decides, and in a small company it also pays.
const TOP = /[ /,(-](ceo|cfo|coo|cto|cio|cmo|chro|cco|founder|cofounder|co-founder|fundador|fundadora|cofundador|cofundadora|dueno|duena|propietario|propietaria|presidente|presidenta|socio|socia|managing partner|gerente general|director general|directora general|director ejecutivo|directora ejecutiva|managing director|general manager|country manager|vicepresidente ejecutivo)[ /,)-]/;
const MANAGER = /[ /,(-](gerente|gerenta|subgerente|subgerenta|director|directora|head|vp|vicepresidente|vicepresidenta|vice president)[ /,)-]/;
const LEAD = /[ /,(-](jefe|jefa|jefatura|encargado|encargada|coordinador|coordinadora|supervisor|supervisora|lider|lead|manager|responsable|administrador|administradora)[ /,)-]/;

const AREA_RULES: Array<[Area, RegExp]> = [
  ['personas', /[ /,(-](personas|personal|people|rrhh|rr hh|recursos humanos|human resources|hr|talento|talent|seleccion|reclutamiento|recruiting|recruiter|remuneraciones|nomina|capital humano|desarrollo organizacional|bienestar|relaciones laborales|chro)[ /,)-]/],
  // Before «prevención»: «Seguridad de la Información» is technology, not the safety of the people at work.
  ['ti', /[ /,(-](ti|tic|it|tecnologia|tecnologias|sistemas|informatica|digital|software|datos|data|cto|cio|ciberseguridad|seguridad de la informacion|seguridad informatica|transformacion digital)[ /,)-]/],
  ['prevencion', /[ /,(-](prevencion|prevencionista|riesgos|hse|sso|sst|ssoma|seguridad y salud|salud ocupacional|medio ambiente|seguridad industrial|seguridad|vigilancia)[ /,)-]/],
  ['finanzas', /[ /,(-](finanzas|financiero|financiera|administracion|contabilidad|contador|contadora|contralor|contralora|contraloria|tesoreria|tesorero|tesorera|cfo|control de gestion|auditoria|auditor|auditora)[ /,)-]/],
  ['compras', /[ /,(-](compras|comprador|compradora|abastecimiento|adquisiciones|procurement|purchasing|sourcing)[ /,)-]/],
  ['comercial', /[ /,(-](comercial|ventas|venta|sales|marketing|negocios|business development|clientes|key account|kam|cuentas clave|cmo|growth)[ /,)-]/],
  ['operaciones', /[ /,(-](operaciones|operacion|operations|logistica|logistics|produccion|planta|mantencion|mantenimiento|supply chain|cadena de suministro|calidad|servicios generales|facility|facilities|obras|construccion|proyectos|flota|transporte|bodega|bodegas|despacho|distribucion|coo)[ /,)-]/],
  ['legal', /[ /,(-](legal|fiscal|fiscalia|abogado|abogada|cumplimiento|compliance|juridico|juridica)[ /,)-]/],
];

const DEPARTMENTS: Record<string, Area> = {
  master_human_resources: 'personas', master_sales: 'comercial', master_marketing: 'comercial', master_operations: 'operaciones',
  master_finance: 'finanzas', master_information_technology: 'ti', master_engineering_technical: 'ti', master_legal: 'legal',
  c_suite: 'general',
};
const SENIORITIES: Record<string, Level> = {
  owner: 'alta', founder: 'alta', c_suite: 'alta', partner: 'alta', vp: 'gerencia', head: 'gerencia', director: 'gerencia',
  manager: 'jefatura', senior: 'equipo', entry: 'equipo', intern: 'equipo',
};

/** Where a person sits, from their cargo first (Spanish titles say it better), then from Apollo's tags. */
export function classifyRole(input: { title?: string | null; seniority?: string | null; departments?: string[] | null }): { area: Area; level: Level } {
  const title = fold(input.title);
  const top = has(title, TOP);
  const level: Level = top ? 'alta' : has(title, MANAGER) ? 'gerencia' : has(title, LEAD) ? 'jefatura'
    : title ? (SENIORITIES[String(input.seniority || '')] === 'alta' ? 'alta' : 'equipo') : SENIORITIES[String(input.seniority || '')] ?? 'equipo';
  const byTitle = AREA_RULES.find(([, pattern]) => has(title, pattern))?.[0];
  // «Gerente General de Operaciones» works in operations; a bare «Gerente General» or «Dueño» runs the whole company.
  const area: Area = byTitle ?? (top ? 'general'
    : (input.departments || []).map(department => DEPARTMENTS[department]).find(Boolean) ?? 'otra');
  return { area, level };
}

const LEGAL_SUFFIX = /\b(s ?a|spa|s ?p ?a|ltda|limitada|sociedad anonima|eirl|e ?i ?r ?l|sac|s ?a ?c|inc|llc|corp|cia|y cia)\b/g;
/** One company however it was written: «Retail Sur S.A.», «RETAIL SUR SA» and «Retail Sur» are the same. */
export function companyKey(name: string | null | undefined) {
  return fold(name).replace(/[&/+-]/g, ' ').replace(LEGAL_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}

const personKey = (row: UnifiedRow) => {
  const email = String(row.email || '').trim().toLowerCase();
  if (email) return `e:${email}`;
  const linkedin = String(row.linkedinUrl || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  if (linkedin) return `l:${linkedin}`;
  return `n:${fold(row.name)}|${companyKey(row.company)}`;
};

export type CompanyPerson = {
  key: string; gid: string; name: string; title: string | null; email: string | null; linkedinUrl: string | null;
  area: Area; level: Level; stage: PipelineStage;
};
export type CommitteeRole = 'decide' | 'usa' | 'paga';
export type CommitteeSlot = { role: CommitteeRole; label: string; people: CompanyPerson[]; titles: string[] };
export type Company = {
  key: string; name: string; industry: string | null; domain: string | null; size: number | null; country: string | null;
  people: CompanyPerson[]; stage: PipelineStage; open: boolean; won: boolean; lost: boolean;
  committee: CommitteeSlot[]; covered: number;
};

const ORDER = FLOW_STAGES; // inbox … closed_won
const OPEN: PipelineStage[] = ['contacted', 'engaged', 'meeting', 'negotiation'];
const rank = (stage: PipelineStage) => stage === 'closed_lost' ? -1 : ORDER.indexOf(stage);
const LEVEL_RANK: Record<Level, number> = { alta: 0, gerencia: 1, jefatura: 2, equipo: 3 };

const AREA_TITLES: Partial<Record<Area, { gerencia: string[]; jefatura: string[] }>> = {
  personas: { gerencia: ['Gerente de Personas', 'Gerente de Recursos Humanos'], jefatura: ['Jefe de Personas', 'Jefe de Selección', 'Jefe de Recursos Humanos'] },
  operaciones: { gerencia: ['Gerente de Operaciones'], jefatura: ['Jefe de Operaciones', 'Jefe de Logística'] },
  comercial: { gerencia: ['Gerente Comercial', 'Gerente de Ventas'], jefatura: ['Jefe Comercial', 'Jefe de Ventas'] },
  finanzas: { gerencia: ['Gerente de Finanzas', 'Gerente de Administración y Finanzas'], jefatura: ['Jefe de Finanzas', 'Contralor'] },
  compras: { gerencia: ['Gerente de Abastecimiento'], jefatura: ['Jefe de Compras', 'Jefe de Abastecimiento'] },
  ti: { gerencia: ['Gerente de TI', 'Gerente de Tecnología'], jefatura: ['Jefe de TI', 'Jefe de Sistemas'] },
  prevencion: { gerencia: ['Gerente de Prevención de Riesgos', 'Gerente de Seguridad'], jefatura: ['Jefe de Prevención de Riesgos', 'Jefe de Seguridad'] },
  legal: { gerencia: ['Gerente Legal', 'Fiscal'], jefatura: ['Abogado Jefe', 'Jefe de Cumplimiento'] },
};

/**
 * The area of the people you sell to: from the «Cargos que buscas» of the profile, else from the people already in the
 * CRM. null when neither says it.
 */
export function mainArea(targetRoles: string[], people: Array<{ area: Area }>): Area | null {
  const count = (areas: Area[]) => {
    const counts = new Map<Area, number>();
    for (const area of areas) if (area !== 'general' && area !== 'otra') counts.set(area, (counts.get(area) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || AREAS.findIndex(item => item.id === a[0]) - AREAS.findIndex(item => item.id === b[0]))[0]?.[0] ?? null;
  };
  return count(targetRoles.map(role => classifyRole({ title: role }).area)) ?? count(people.map(person => person.area));
}

/**
 * Who decides, who uses and who pays in one company. Deciding takes the top of the company or a manager of your area;
 * paying takes finance or purchasing, and in a company under 200 people also its owner or general manager.
 */
export function committeeFor(people: CompanyPerson[], main: Area | null, size: number | null): CommitteeSlot[] {
  const area = main ? AREA_TITLES[main] : undefined;
  const small = size !== null && size < 200;
  const decide = people.filter(person => person.level === 'alta' || (person.level === 'gerencia' && (person.area === main || person.area === 'general')));
  const pays = people.filter(person => person.area === 'finanzas' || person.area === 'compras' || (small && person.area === 'general' && person.level === 'alta'));
  const slots: CommitteeSlot[] = [
    { role: 'decide', label: 'Decide', people: decide, titles: [...(area?.gerencia || []), 'Gerente General'] },
  ];
  // Who uses it works with it every day: a lead or someone of the team of your area, not the manager who decides.
  if (main) slots.push({ role: 'usa', label: 'Usa', people: people.filter(person => person.area === main && (person.level === 'jefatura' || person.level === 'equipo')), titles: area?.jefatura || [] });
  slots.push({ role: 'paga', label: 'Paga', people: pays, titles: [...AREA_TITLES.finanzas!.gerencia, ...AREA_TITLES.compras!.jefatura] });
  return slots;
}

/**
 * The company's web domain: the one the enrichment found, else the one most of its people write from (ana@retailsur.cl →
 * retailsur.cl), never a free mailbox. It draws the logo and opens the website.
 */
export function companyDomainOf(rows: Array<Pick<UnifiedRow, 'companyDomain' | 'email'>>) {
  const known = rows.map(row => normalizeCompanyWebsite(row.companyDomain).domain).find(Boolean);
  if (known) return known;
  const counts = new Map<string, number>();
  for (const row of rows) { const domain = websiteFromWorkEmail(row.email); if (domain) counts.set(domain, (counts.get(domain) || 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** The companies of the CRM, one per company and one person per person, the deals that moved furthest first. */
export function buildCompanies(rows: UnifiedRow[], options: { targetRoles?: string[] } = {}): { companies: Company[]; main: Area | null } {
  const groups = new Map<string, { names: Map<string, number>; rows: UnifiedRow[] }>();
  for (const row of rows) {
    if (row.kind === 'opportunity') continue; // an opportunity is a company signal, not a person
    const key = companyKey(row.company);
    if (!key) continue;
    const group = groups.get(key) || { names: new Map<string, number>(), rows: [] as UnifiedRow[] };
    const name = String(row.company).replace(/\s+/g, ' ').trim();
    group.names.set(name, (group.names.get(name) || 0) + 1);
    group.rows.push(row);
    groups.set(key, group);
  }
  // The name the company is written with most often; between equals, the shorter («Logística Norte», not «… SpA»).
  const nameOf = (names: Map<string, number>) => [...names].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
  const peopleOf = (group: { rows: UnifiedRow[] }) => {
    const byPerson = new Map<string, CompanyPerson>();
    for (const row of group.rows) {
      const key = personKey(row);
      const stage = flowStage(row);
      const place = classifyRole({ title: row.title, seniority: row.seniority, departments: row.departments });
      const known = byPerson.get(key);
      // The same person saved, enriched and written to is one person, at the furthest stage it reached.
      if (!known || rank(stage) > rank(known.stage)) {
        byPerson.set(key, { key, gid: row.gid, name: String(row.name || row.email || 'Sin nombre').trim(), title: row.title || known?.title || null,
          email: row.email || known?.email || null, linkedinUrl: row.linkedinUrl || known?.linkedinUrl || null, ...place, stage });
      }
    }
    return [...byPerson.values()].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.name.localeCompare(b.name, 'es'));
  };
  const grouped = [...groups].map(([key, group]) => ({ key, group, people: peopleOf(group) }));
  const main = mainArea(options.targetRoles || [], grouped.flatMap(item => item.people));
  const companies = grouped.map(({ key, group, people }) => {
    const first = (pick: (row: UnifiedRow) => unknown) => group.rows.map(pick).find(value => value !== null && value !== undefined && value !== '') ?? null;
    const size = Number(first(row => row.companySize)) || null;
    const stages = people.map(person => person.stage);
    const best = stages.reduce<PipelineStage>((top, stage) => rank(stage) > rank(top) ? stage : top, stages[0] ?? 'inbox');
    const committee = committeeFor(people, main, size);
    return {
      key, name: nameOf(group.names), industry: (first(row => row.industry) as string | null), domain: companyDomainOf(group.rows),
      size, country: (first(row => row.country) as string | null), people, stage: best,
      open: stages.some(stage => OPEN.includes(stage)),
      won: stages.includes('closed_won'), lost: stages.length > 0 && stages.every(stage => stage === 'closed_lost'),
      committee, covered: committee.filter(slot => slot.people.length).length,
    };
  });
  // The deals in play first, the furthest along on top; then the won ones, then the rest.
  const weight = (company: Company) => company.open ? 100 + rank(company.stage) : company.won ? 50 : rank(company.stage);
  companies.sort((a, b) => weight(b) - weight(a) || b.people.length - a.people.length || a.name.localeCompare(b.name, 'es'));
  return { companies, main };
}

/** The people of a company placed by area and level, for its coverage grid: only the areas with someone or that matter. */
export function coverageGrid(company: Company, main: Area | null) {
  const wanted = new Set<Area>(['general', ...(main ? [main] : []), 'finanzas', 'compras']);
  const areas = AREAS.map(item => item.id).filter(area => wanted.has(area) || company.people.some(person => person.area === area));
  return areas.map(area => ({
    area, label: areaLabel(area),
    cells: LEVELS.map(level => company.people.filter(person => person.area === area && person.level === level.id)),
  }));
}

const INDUSTRIES: Record<string, string> = {
  retail: 'Retail', 'logistics & supply chain': 'Logística', 'hospital & health care': 'Salud', construction: 'Construcción',
  'mining & metals': 'Minería', 'staffing & recruiting': 'Reclutamiento y personal', 'human resources': 'Recursos humanos',
  'information technology & services': 'Tecnología', 'computer software': 'Software', 'financial services': 'Servicios financieros',
  banking: 'Banca', 'food & beverages': 'Alimentos y bebidas', 'food production': 'Alimentos', 'transportation/trucking/railroad': 'Transporte',
  'security & investigations': 'Seguridad', 'facilities services': 'Servicios generales', 'real estate': 'Inmobiliaria',
  'education management': 'Educación', 'higher education': 'Educación superior', 'government administration': 'Sector público',
  'oil & energy': 'Energía', utilities: 'Servicios básicos', telecommunications: 'Telecomunicaciones', automotive: 'Automotriz',
  hospitality: 'Hotelería', 'consumer goods': 'Consumo masivo', insurance: 'Seguros', pharmaceuticals: 'Farmacéutica',
  machinery: 'Maquinaria', farming: 'Agricultura', 'wine & spirits': 'Vinos y licores', 'environmental services': 'Medio ambiente',
  'management consulting': 'Consultoría', 'marketing & advertising': 'Marketing y publicidad', 'legal services': 'Servicios legales',
};
/** The rubro as people in Chile say it: Apollo's industries are English («logistics & supply chain» → «Logística»). */
export function industryLabel(industry: string | null | undefined) {
  const text = String(industry || '').replace(/\s+/g, ' ').trim();
  // A dash is how some imports write «no rubro»: it says nothing.
  if (!text || /^[-–—.\s]+$/.test(text)) return null;
  return INDUSTRIES[text.toLowerCase()] ?? text.charAt(0).toLocaleUpperCase('es-CL') + text.slice(1);
}

/** Employee bands around a size, as Búsqueda's filters say them, for companies like this one. */
export function sizeBands(size: number | null) {
  if (!size) return [];
  const bands = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+'];
  const index = size <= 10 ? 0 : size <= 50 ? 1 : size <= 200 ? 2 : size <= 500 ? 3 : size <= 1000 ? 4 : size <= 5000 ? 5 : 6;
  return bands.slice(Math.max(0, index - 1), index + 2);
}

// Words that are not the name: «Ministerio de Obras Públicas» is «MO», not «MD».
const LINKING = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'of', 'the', 'and', '&']);

/** The two letters of a company («Grupo Siglo Outsourcing» → «GS»), drawn when it has no logo. */
export function companyInitials(name: string) {
  const all = name.replace(/[^\p{L}\p{N}\s&]/gu, ' ').split(/\s+/).filter(Boolean);
  const words = all.filter(word => !LINKING.has(word.toLowerCase())).length ? all.filter(word => !LINKING.has(word.toLowerCase())) : all;
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`).toLocaleUpperCase('es-CL');
}
