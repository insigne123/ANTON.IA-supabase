import { z } from 'zod';

import { generateStructured } from '@/ai/openai-json';
import { reportGenerationOptions } from '@/ai/report-models';
import type { EntityResolutionV2 } from '@/lib/report-v2-contracts';
import { serializeReportV2Context } from './write-report-v2-section';
import { capQueriesForDepth, getResearchDepthBudget, type ResearchDepth } from '@/lib/research-depth-budgets';

export const PLAN_REPORT_V2_PROMPT_VERSION = 'report-v2/p2-plan/3';
export const REQUIRED_REPORT_V2_QUERY_FAMILIES = [
  'scale',
  'press',
  'spokesperson',
  'people',
  'hiring',
  'industry',
  'registry',
] as const;
export const ResearchQueryFamilyV2Schema = z.enum([
  'scale',
  'operations',
  'press',
  'spokesperson',
  'people',
  'hiring',
  'industry',
  'registry',
  'awards',
  'tech',
  'financials',
  'litigation',
  'expansion',
]);

export const ResearchQueryV2Schema = z.object({
  family: ResearchQueryFamilyV2Schema,
  query: z.string().trim().min(3).max(500),
  targetField: z.string().trim().min(1).max(200),
  ownDomain: z.boolean(),
  recencyDays: z.number().int().positive().max(3_650).nullable(),
}).strict();

export const ResearchPlanV2Schema = z.object({
  queries: z.array(ResearchQueryV2Schema).min(4).max(12),
}).strict();

export type ResearchQueryV2 = z.infer<typeof ResearchQueryV2Schema>;
export type ResearchPlanV2 = z.infer<typeof ResearchPlanV2Schema>;

export const PLAN_REPORT_V2_SYSTEM_PROMPT = `Eres un investigador comercial que planifica una busqueda. Tu tarea es decidir QUE buscar. No busques,
no respondas preguntas, no analices: solo emite el plan de consultas.`;

export function buildPlanReportV2Prompt(input: {
  entity: EntityResolutionV2;
  sellerProfile: unknown;
  existingClaimsSummary: unknown;
  targetTitles?: string[];
  industry?: string | null;
  currentYear?: number;
}) {
  return `Objetivo: ${serializeReportV2Context(input.entity)}
Producto que se quiere vender: ${serializeReportV2Context(input.sellerProfile)}
Contexto ya recolectado: ${serializeReportV2Context(input.existingClaimsSummary)}
Cargos relevantes para la compra: ${JSON.stringify(input.targetTitles || [])}
Sector: ${input.industry || 'usa solo el contexto disponible'}
Ano de referencia: ${input.currentYear || new Date().getUTCFullYear()}

Emite entre 4 y 6 consultas enfocadas en vacios utiles del reporte, no un checklist de familias.
Prioriza identidad y rol del contacto, escala real de la empresa, operaciones locales en el pais del contacto,
prensa reciente y personas en cargos relevantes para la compra. No repitas lo que ya esta respaldado.
Usa el sitio corporativo para escala, servicios y operaciones cuando sea util y se conozca el dominio.
Las familias son etiquetas opcionales para clasificar cada consulta: scale, operations, press, people,
spokesperson, hiring, industry, registry, awards, tech, financials, litigation, expansion.
No es obligatorio cubrirlas todas ni agregar contratacion, reguladores o cifras sectoriales sin una necesidad concreta.

Reglas criticas:
- Una consulta debe resolver una sola pregunta. Usa el nombre de la empresa, un tema preciso y, si aporta, pais o cargo; no apiles diez palabras clave ni conectores AND.
- No hay cuota minima ni maxima de consultas al sitio corporativo. Usa site: solo con un dominio conocido y ownDomain acorde. Nunca inventes un dominio; si no se conoce, busca por nombre.
- Una ruta local ayuda a encontrar operaciones, pero no convierte cifras del grupo en cifras del pais.
- Para prensa reciente usa recencyDays: 365 y el ano actual. No impongas recencia a escala o servicios evergreen.
- Un catalogo, una pagina corporativa o un contador de LinkedIn no constituyen una senal por si solos. Busca cambios concretos, fechados y relevantes.
- Las consultas de tipo people deben nombrar cargos concretos y realistas para el pais y el sector, no genericos como "gerente".
- Escribe las consultas en el idioma del pais del objetivo.
- Para cada consulta declara que campo del reporte esperas llenar con ella. Si no puedes nombrar el campo, la consulta sobra: eliminala.`;
}

function fallbackQueries(input: {
  entity: EntityResolutionV2;
  targetTitles?: string[];
  currentYear?: number;
}): ResearchQueryV2[] {
  const quote = (value: string) => `"${value.replace(/"/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)}"`;
  const company = quote(input.entity.companyName);
  const country = { CL: 'Chile', PE: 'Peru', CO: 'Colombia', OTHER: '' }[input.entity.contactCountry];
  const targetTitle = input.targetTitles?.find((title) => title.trim()) || input.entity.contact.title;
  let domain = '';
  try {
    const url = new URL(`https://${input.entity.companyDomain.replace(/^https?:\/\//i, '')}`);
    if (url.hostname.includes('.')) domain = url.hostname.replace(/^www\./, '');
  } catch {
    // A missing or unresolved corporate domain must not prevent name-based research.
  }
  const countryPath = input.entity.countryScopedPaths[input.entity.contactCountry] || '';
  const localDomain = countryPath.startsWith('/') ? `${domain}${countryPath}`
    : /^(?:cl|pe|co)\.$/.test(countryPath) && !domain.startsWith(countryPath) ? `${countryPath}${domain}` : domain;
  const site = domain ? `site:${domain} ` : '';
  const localSite = domain ? `site:${localDomain} ` : '';
  const queries: ResearchQueryV2[] = [
    { family: 'scale', query: `${site}${company} colaboradores`, targetField: 'snapshot.company_scale', ownDomain: Boolean(domain), recencyDays: null },
    { family: 'operations', query: `${localSite}${company} ${country} operaciones`, targetField: 'company.local_operations', ownDomain: Boolean(domain), recencyDays: null },
    { family: 'press', query: `${company} ${country} noticias ${input.currentYear || new Date().getUTCFullYear()}`, targetField: 'signals.recent_press', ownDomain: false, recencyDays: 365 },
    { family: 'people', query: `${company} ${targetTitle && !/^unknown\b/i.test(targetTitle) ? quote(targetTitle) : 'directorio'} ${country}`, targetField: 'committee.target_roles', ownDomain: false, recencyDays: null },
  ];
  if (input.entity.contact.fullName && !/^unknown\b/i.test(input.entity.contact.fullName)) {
    queries.push({ family: 'people', query: `${quote(input.entity.contact.fullName)} ${company}`, targetField: 'contact.role', ownDomain: false, recencyDays: null });
  }
  return queries.map((query) => ({ ...query, query: query.query.replace(/\s+/g, ' ').trim() }));
}

/**
 * Per-family fallback for the depth-aware path. Applies the same
 * no-fabrication rules as the focused fallback: country codes map to names,
 * unknown contact names/titles fall back to neutral terms, and fallbacks
 * never target the company's own domain.
 */
function fallbackQuery(family: typeof REQUIRED_REPORT_V2_QUERY_FAMILIES[number], input: {
  entity: EntityResolutionV2;
  targetTitles: string[];
  industry: string | null;
  currentYear: number;
}): ResearchQueryV2 {
  const company = `"${input.entity.companyName}"`;
  const country = { CL: 'Chile', PE: 'Peru', CO: 'Colombia', OTHER: '' }[input.entity.contactCountry] || '';
  const candidateTitle = input.targetTitles.find((title) => title.trim()) || input.entity.contact.title;
  const targetTitle = candidateTitle && !/^unknown\b/i.test(candidateTitle) ? candidateTitle : 'directorio';
  if (family === 'scale') return { family, query: `${company} quienes somos colaboradores clientes anos sedes`, targetField: 'snapshot.company_scale', ownDomain: false, recencyDays: null };
  if (family === 'press') return { family, query: `${company} ${input.industry || 'empresa'} ${input.currentYear}`, targetField: 'signals.recent_press', ownDomain: false, recencyDays: 365 };
  if (family === 'spokesperson') return { family, query: `${company} director declaro sostuvo entrevista`, targetField: 'committee.named_executives', ownDomain: false, recencyDays: 730 };
  if (family === 'people') return { family, query: `${company} "${targetTitle}" LinkedIn ${country}`.replace(/\s+/g, ' ').trim(), targetField: 'committee.target_roles', ownDomain: false, recencyDays: null };
  if (family === 'hiring') return { family, query: `${company} ofertas empleo vacantes ${country}`.replace(/\s+/g, ' ').trim(), targetField: 'signals.hiring', ownDomain: false, recencyDays: 365 };
  if (family === 'industry') return { family, query: `industria ${input.industry || 'servicios'} ${country} cifras ${input.currentYear}`.replace(/\s+/g, ' ').trim(), targetField: 'regulatory.industry_context', ownDomain: false, recencyDays: 365 };
  return { family, query: `${company} registro regulador ${country}`.replace(/\s+/g, ' ').trim(), targetField: 'regulatory.registry', ownDomain: false, recencyDays: null };
}

export function normalizeResearchPlanV2(value: unknown, input: {
  entity: EntityResolutionV2;
  targetTitles?: string[];
  industry?: string | null;
  currentYear?: number;
  depth?: ResearchDepth;
  maxQueries?: number;
}) {
  const envelope = z.object({ queries: z.array(z.unknown()) }).safeParse(value);
  const rawQueries = envelope.success ? envelope.data.queries : [];
  const validQueries: ResearchQueryV2[] = rawQueries.flatMap((query: unknown) => {
    const parsed = ResearchQueryV2Schema.safeParse(query);
    if (!parsed.success) return [];
    const terms = parsed.data.query.match(/"[^"]*"|\S+/g) || [];
    if (terms.length > 8 || terms.filter((term) => term.toUpperCase() === 'AND').length > 1) return [];
    return [{ ...parsed.data, query: parsed.data.query.replace(/\s+/g, ' ').trim() }];
  });
  const queries = [...new Map(validQueries.map((query) => [query.query.toLowerCase(), query])).values()].slice(0, 6);
  if (input.depth == null && input.maxQueries == null) {
    if (queries.length >= 4) return ResearchPlanV2Schema.parse({ queries });
    const defaults = fallbackQueries(input);
    if (queries.length === 0) return ResearchPlanV2Schema.parse({ queries: defaults });
    for (const query of defaults) {
      if (queries.length >= 4) break;
      if (!queries.some((existing) => existing.query.toLowerCase() === query.query.toLowerCase())) queries.push(query);
    }
    return ResearchPlanV2Schema.parse({ queries });
  }
  const depth = input.depth || 'deep';
  const budget = getResearchDepthBudget(depth);
  const boundedOwnDomain: ResearchQueryV2[] = [];
  let ownDomainCount = 0;
  queries.forEach((query) => {
    if (query.ownDomain && ownDomainCount >= budget.maxOwnDomain) return;
    if (query.ownDomain) ownDomainCount += 1;
    boundedOwnDomain.push(query);
  });
  const present = new Set(boundedOwnDomain.map((query) => query.family));
  const fallbackInput = {
    entity: input.entity,
    targetTitles: input.targetTitles || [],
    industry: input.industry || null,
    currentYear: input.currentYear || new Date().getUTCFullYear(),
  };
  REQUIRED_REPORT_V2_QUERY_FAMILIES.forEach((family) => {
    if (!present.has(family)) boundedOwnDomain.push(fallbackQuery(family, fallbackInput));
  });
  const capped = capQueriesForDepth(boundedOwnDomain, depth, {
    maxQueries: input.maxQueries,
    requiredFamilies: [...REQUIRED_REPORT_V2_QUERY_FAMILIES],
  });
  return ResearchPlanV2Schema.parse({ queries: capped.slice(0, 12) });
}

export async function planReportV2Research(input: {
  entity: EntityResolutionV2;
  sellerProfile: unknown;
  existingClaimsSummary: unknown;
  targetTitles?: string[];
  industry?: string | null;
  currentYear?: number;
  depth?: ResearchDepth;
  maxQueries?: number;
}, dependencies: {
  generate?: typeof generateStructured;
} = {}): Promise<ResearchPlanV2> {
  const generate = dependencies.generate || generateStructured;
  let generated: unknown = null;
  try {
    generated = await generate({
      ...reportGenerationOptions('fast'),
      systemPrompt: PLAN_REPORT_V2_SYSTEM_PROMPT,
      prompt: buildPlanReportV2Prompt(input),
      schema: ResearchPlanV2Schema,
      temperature: 0.1,
    });
  } catch {
    generated = null;
  }
  return normalizeResearchPlanV2(generated, input);
}
