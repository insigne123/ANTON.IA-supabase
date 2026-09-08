import { z } from 'zod';

import { generateStructured } from '@/ai/openai-json';
import { getOpenAiModelsForTier } from '@/ai/model-router';
import type { EntityResolutionV2 } from '@/lib/report-v2-contracts';

export const PLAN_REPORT_V2_PROMPT_VERSION = 'report-v2/p2-plan/1';
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
  ...REQUIRED_REPORT_V2_QUERY_FAMILIES,
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
  queries: z.array(ResearchQueryV2Schema).min(6).max(12),
}).strict();

export type ResearchQueryV2 = z.infer<typeof ResearchQueryV2Schema>;
export type ResearchPlanV2 = z.infer<typeof ResearchPlanV2Schema>;

export const PLAN_REPORT_V2_SYSTEM_PROMPT = `Eres un investigador comercial que planifica una busqueda. Tu tarea es decidir QUE buscar. No busques,
no respondas preguntas, no analices: solo emite el plan de consultas.`;

export function buildPlanReportV2Prompt(input: {
  entity: EntityResolutionV2;
  sellerProfile: unknown;
  existingClaimsSummary: unknown;
}) {
  return `Objetivo: ${JSON.stringify(input.entity)}
Producto que se quiere vender: ${JSON.stringify(input.sellerProfile)}
Contexto ya recolectado: ${JSON.stringify(input.existingClaimsSummary)}

Emite entre 6 y 12 consultas de busqueda. DEBES incluir al menos una de cada familia obligatoria:

- scale        : cifras de tamano de la empresa (colaboradores, clientes, anos, sedes)
- press        : menciones en prensa del ultimo ano, en medios del sector
- spokesperson : declaraciones de ejecutivos, para obtener NOMBRE Y CARGO de personas con autoridad
- people       : personas en cargos con poder de decision sobre la compra
- hiring       : actividad de contratacion, vacantes activas
- industry     : cifras del sector y del pais, para dar contexto de mercado
- registry     : registros publicos o fichas ante reguladores del pais del contacto

Familias opcionales, usalas si el contexto lo amerita: awards, tech, financials, litigation, expansion.

Reglas criticas:
- El sitio corporativo de la empresa contiene catalogo, NO senales. Como maximo 2 de tus consultas pueden estar dirigidas a su propio dominio.
- Las consultas de tipo press e industry deben incluir un filtro temporal del ultimo ano.
- Las consultas de tipo people deben nombrar cargos concretos y realistas para el pais y el sector, no genericos como "gerente".
- Escribe las consultas en el idioma del pais del objetivo.
- Para cada consulta declara que campo del reporte esperas llenar con ella. Si no puedes nombrar el campo, la consulta sobra: eliminala.`;
}

function fallbackQuery(family: typeof REQUIRED_REPORT_V2_QUERY_FAMILIES[number], input: {
  entity: EntityResolutionV2;
  targetTitles: string[];
  industry: string | null;
  currentYear: number;
}): ResearchQueryV2 {
  const company = `"${input.entity.companyName}"`;
  const country = input.entity.contactCountry;
  const targetTitle = input.targetTitles[0] || `Director de ${input.entity.contact.department}`;
  if (family === 'scale') return { family, query: `${company} quienes somos colaboradores clientes anos sedes`, targetField: 'snapshot.company_scale', ownDomain: false, recencyDays: null };
  if (family === 'press') return { family, query: `${company} ${input.industry || 'empresa'} ${input.currentYear}`, targetField: 'signals.recent_press', ownDomain: false, recencyDays: 365 };
  if (family === 'spokesperson') return { family, query: `${company} director declaro sostuvo entrevista`, targetField: 'committee.named_executives', ownDomain: false, recencyDays: 730 };
  if (family === 'people') return { family, query: `${company} "${targetTitle}" LinkedIn ${country}`, targetField: 'committee.target_roles', ownDomain: false, recencyDays: null };
  if (family === 'hiring') return { family, query: `${company} ofertas empleo vacantes ${country}`, targetField: 'signals.hiring', ownDomain: false, recencyDays: 365 };
  if (family === 'industry') return { family, query: `industria ${input.industry || 'servicios'} ${country} cifras ${input.currentYear}`, targetField: 'regulatory.industry_context', ownDomain: false, recencyDays: 365 };
  return { family, query: `${company} registro regulador ${country}`, targetField: 'regulatory.registry', ownDomain: false, recencyDays: null };
}

export function normalizeResearchPlanV2(value: unknown, input: {
  entity: EntityResolutionV2;
  targetTitles?: string[];
  industry?: string | null;
  currentYear?: number;
}) {
  const rawQueries = Array.isArray((value as any)?.queries) ? (value as any).queries : [];
  const validQueries: ResearchQueryV2[] = rawQueries.flatMap((query: unknown) => {
    const parsed = ResearchQueryV2Schema.safeParse(query);
    return parsed.success ? [parsed.data] : [];
  });
  const deduplicated: ResearchQueryV2[] = [...new Map<string, ResearchQueryV2>(
    validQueries.map((query) => [`${query.family}:${query.query.toLowerCase()}`, query]),
  ).values()];
  const boundedOwnDomain: ResearchQueryV2[] = [];
  let ownDomainCount = 0;
  deduplicated.forEach((query) => {
    if (query.ownDomain && ownDomainCount >= 2) return;
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
  return ResearchPlanV2Schema.parse({ queries: boundedOwnDomain.slice(0, 12) });
}

export async function planReportV2Research(input: {
  entity: EntityResolutionV2;
  sellerProfile: unknown;
  existingClaimsSummary: unknown;
  targetTitles?: string[];
  industry?: string | null;
  currentYear?: number;
}, dependencies: {
  generate?: typeof generateStructured;
} = {}): Promise<ResearchPlanV2> {
  const generate = dependencies.generate || generateStructured;
  let generated: unknown = null;
  try {
    generated = await generate({
      provider: 'openai',
      openAiModels: getOpenAiModelsForTier('fast'),
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
