import { generateStructured } from '@/ai/openai-json';
import { getOpenAiModelsForTier } from '@/ai/model-router';
import {
  EntityResolutionV2Schema,
  type EntityResolutionV2,
} from '@/lib/report-v2-contracts';
import {
  resolveEntityFromExistingContextV2,
  type ExistingProviderContactV2,
  type ParsedWebEvidenceV2,
} from '@/lib/report-v2-extraction';

export const RESOLVE_ENTITY_V2_PROMPT_VERSION = 'report-v2/p1-entity/1';

export const RESOLVE_ENTITY_V2_SYSTEM_PROMPT = `Eres un analista de inteligencia comercial. Tu unica tarea es resolver la identidad y la jurisdiccion
del objetivo antes de que empiece la investigacion. No analices, no interpretes, no propongas nada.`;

export function buildResolveEntityV2Prompt(input: {
  contact: ExistingProviderContactV2;
  domain: string;
  initialEvidence: unknown;
  today: string;
}) {
  return `Entrada:
- Contacto importado (datos de proveedor, no evidencia): ${JSON.stringify(input.contact)}
- Dominio candidato: ${input.domain}
- Evidencia inicial: ${JSON.stringify(input.initialEvidence)}

Determina:
1. El nombre legal o comercial de la empresa y su dominio principal.
2. contactCountry: el pais donde trabaja ESTA PERSONA. Se determina, en este orden de prioridad:
   (a) el TLD de su perfil de LinkedIn (pe.linkedin.com -> PE, cl.linkedin.com -> CL),
   (b) la ubicacion declarada en su perfil,
   (c) la ruta del sitio corporativo donde aparece listada.
   NUNCA lo determines por el dominio raiz de la empresa ni por la sede de la casa matriz.
3. operatingCountries: todos los paises donde la empresa opera.
4. countryScopedPaths: si el sitio corporativo separa contenido por pais mediante rutas o subdominios
   (/chile/, /peru/, /cl/, cl.ejemplo.com), mapea cada pais a su ruta.
5. excludedPaths: las rutas de paises DISTINTOS a contactCountry. La evidencia que provenga de ellas no
   podra respaldar el perfil de este contacto.
6. seniority del contacto, normalizada a: c_suite | vp | director | head | manager | coordinator | ic | unknown.
   "Coordinador" y "Coordinator" son SIEMPRE coordinator, nunca manager.
7. tenureMonths y companyTenureMonths, calculados a la fecha de hoy (${input.today}).
8. ambiguities: homonimos, filiales, nombres comerciales alternativos, o cualquier duda de identidad.

Reglas:
- El contacto importado es una observacion de proveedor, no un hecho investigado. No lo eleves a hecho.
- Si no puedes determinar contactCountry con confianza, devuelve "OTHER" y anotalo en ambiguities.
  Nunca adivines.
- Una empresa con sitios por pais es, para efectos de este reporte, una entidad distinta por pais.`;
}

function evidenceSummary(sources: ParsedWebEvidenceV2[]) {
  return sources.map((source) => ({
    url: source.source.canonicalUrl,
    title: source.source.title,
    jurisdiction: source.source.jurisdiction,
    headings: source.headings,
    links: source.links,
    text: source.text,
  }));
}

export async function resolveEntityV2(input: {
  contact: ExistingProviderContactV2;
  domain: string;
  sources: ParsedWebEvidenceV2[];
  today?: string;
}, dependencies: {
  generate?: typeof generateStructured;
} = {}): Promise<EntityResolutionV2> {
  const today = input.today || new Date().toISOString().slice(0, 10);
  const baseline = resolveEntityFromExistingContextV2(input);
  const generate = dependencies.generate || generateStructured;
  const resolved = await generate({
    provider: 'openai',
    openAiModels: getOpenAiModelsForTier('fast'),
    systemPrompt: RESOLVE_ENTITY_V2_SYSTEM_PROMPT,
    prompt: buildResolveEntityV2Prompt({
      contact: input.contact,
      domain: input.domain,
      initialEvidence: evidenceSummary(input.sources),
      today,
    }),
    schema: EntityResolutionV2Schema,
    temperature: 0,
  });
  const contactCountry = baseline.contactCountry !== 'OTHER' ? baseline.contactCountry : resolved.contactCountry;
  const countryScopedPaths = { ...resolved.countryScopedPaths, ...baseline.countryScopedPaths };
  const contactPaths = new Set(Object.entries(countryScopedPaths)
    .filter(([country]) => country === contactCountry)
    .map(([, path]) => path));
  const excludedPaths = [...new Set([
    ...resolved.excludedPaths,
    ...Object.entries(countryScopedPaths)
      .filter(([country]) => country !== contactCountry)
      .map(([, path]) => path),
  ])].filter((path) => !contactPaths.has(path));

  return EntityResolutionV2Schema.parse({
    ...resolved,
    companyName: resolved.companyName || baseline.companyName,
    companyDomain: resolved.companyDomain || baseline.companyDomain,
    contactCountry,
    operatingCountries: [...new Set([...resolved.operatingCountries, ...baseline.operatingCountries])],
    countryScopedPaths,
    excludedPaths,
    contact: {
      ...resolved.contact,
      fullName: baseline.contact.fullName,
      title: baseline.contact.title,
      seniority: baseline.contact.seniority,
      department: baseline.contact.department,
      linkedinUrl: baseline.contact.linkedinUrl,
    },
    ambiguities: [...new Set([...resolved.ambiguities, ...baseline.ambiguities])],
  });
}
