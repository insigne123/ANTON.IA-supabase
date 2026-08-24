/* =====================================================================
   suplia-skills-faltantes.ts — Fase 4: las 4 skills que faltaban
   - research.brand_mentions     (brand-monitor)   [BRANDDEV_API_KEY, créditos]
   - email.subject_variants      (email-subject-lines)  [GLM]
   - marketing.demand_gen_plan   (demand-gen)            [GLM]
   - research.competitor_analysis(competitor-analysis)   [orquesta similarweb+serpapi]
   Todo en GLM (via generateStructuredWithTelemetry). Las que consumen créditos
   se gatean por aprobación (patrón lead.enrich_batch).
   Va en: src/lib/server/  (o integra en suplia-tools.ts y registra en SUPLIA_TOOLS)
   ===================================================================== */
import { z } from 'genkit';

import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { getOpenAiModelsForTier } from '@/ai/model-router';
import type { SupliaToolContext } from '@/lib/server/suplia-tool-runner';
import { researchSerpCompetitors, researchSimilarweb } from '@/lib/server/suplia-research-tools';

function asText(v: unknown): string { return String(v ?? '').trim(); }
function needEnv(name: string): string { const v = String(process.env[name] || '').trim(); if (!v) throw new Error(`Falta ${name}`); return v; }

/* ---------- brand-monitor: menciones (Brand.dev) ---------- */
export async function researchBrandMentions(input: Record<string, unknown>, _c: SupliaToolContext) {
  const key = needEnv('BRANDDEV_API_KEY');
  const query = asText(input.query || (input as any).brand || (input as any).company);
  if (!query) throw new Error('Falta "query" (marca) para research.brand_mentions');
  const res = await fetch(`https://api.brand.dev/v1/brand/search?query=${encodeURIComponent(query)}&limit=15&sort=date`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Brand.dev HTTP ${res.status}`);
  const d: any = await res.json();
  const items = (d.results || d.mentions || []).map((m: any) => `${asText(m.title || m.text)} — ${asText(m.source || m.domain)}`).filter(Boolean);
  return {
    artifactType: 'report',
    title: `Menciones: ${query}`,
    data: { title: `Menciones de marca — ${query}`, subtitle: 'Brand.dev', sections: [{ heading: 'Últimas menciones', type: 'list', items: items.slice(0, 15) }] },
  };
}

/* ---------- email-subject-lines: variantes + score (GLM) ---------- */
export async function emailSubjectVariants(input: Record<string, unknown>, _c: SupliaToolContext) {
  const offer = asText(input.offerSummary || (input as any).offer);
  const audience = asText(input.audience || (input as any).targetAudience) || 'la audiencia';
  const signal = asText((input as any).signal);
  const n = Math.min(8, Math.max(3, Number(input.count) || 5));
  const prompt = `
Eres copywriter B2B senior. Genera ${n} ASUNTOS de correo en frio en espanol de Chile.
Reglas: 4-7 palabras, especificos, sin clickbait ni mayusculas gritonas, angulos distintos entre si.
Para cada uno entrega: linea (el asunto), tipo (Beneficio | Pregunta | Senal | Curiosidad | Especifico), apertura (estimacion 0-100 de tasa de apertura).
Oferta: ${offer || 'no especificada'}
Audiencia: ${audience}
Senal disponible: ${signal || 'ninguna'}
Devuelve JSON: { "items": [{ "linea": string, "tipo": string, "apertura": number }] }`.trim();
  const { data } = await generateStructuredWithTelemetry({
    prompt,
    schema: z.object({ items: z.array(z.object({ linea: z.string(), tipo: z.string(), apertura: z.number() })) }),
    temperature: 0.7,
    openAiModels: getOpenAiModelsForTier('balanced'),
  });
  const rows = (data.items || []).map((x) => [x.linea, x.tipo, `${Math.round(x.apertura)}%`]);
  return {
    artifactType: 'report',
    title: 'Asuntos de correo',
    data: { title: `Asuntos — ${audience}`, subtitle: 'Variantes para A/B', sections: [{ heading: 'Variantes', type: 'table', headers: ['Asunto', 'Tipo', 'Apertura est.'], rows }] },
    items: data.items,
  };
}

/* ---------- demand-gen: plan multicanal (GLM) ---------- */
export async function demandGenPlan(input: Record<string, unknown>, _c: SupliaToolContext) {
  const goal = asText(input.goal || (input as any).objetivo) || 'Generar pipeline';
  const offer = asText(input.offerSummary || (input as any).offer);
  const prompt = `
Eres estratega de demand generation B2B. Disena un plan multicanal accionable y realista (no generico).
Objetivo: ${goal}
Oferta: ${offer || 'no especificada'}
Entrega JSON con:
- "resumen": 1-2 frases.
- "segmentos": string[] (a quien apuntar y por que).
- "canales": [{ "canal": string, "tactica": string }] (3-5 canales con tactica concreta).
- "mensaje": string[] (angulos de valor).
- "metricas": string[] (que medir).
Espanol de Chile, conservador con supuestos.`.trim();
  const { data } = await generateStructuredWithTelemetry({
    prompt,
    schema: z.object({
      resumen: z.string(),
      segmentos: z.array(z.string()),
      canales: z.array(z.object({ canal: z.string(), tactica: z.string() })),
      mensaje: z.array(z.string()),
      metricas: z.array(z.string()),
    }),
    temperature: 0.5,
    openAiModels: getOpenAiModelsForTier('reasoning'),
  });
  return {
    artifactType: 'report',
    title: 'Plan demand-gen',
    data: {
      title: 'Plan de demand generation', subtitle: goal,
      sections: [
        { heading: 'Resumen', type: 'text', text: data.resumen },
        { heading: 'Segmentos', type: 'list', items: data.segmentos },
        { heading: 'Canales y táctica', type: 'table', headers: ['Canal', 'Táctica'], rows: (data.canales || []).map((c) => [c.canal, c.tactica]) },
        { heading: 'Ángulos de mensaje', type: 'list', items: data.mensaje },
        { heading: 'Métricas', type: 'list', items: data.metricas },
      ],
    },
  };
}

/* ---------- competitor-analysis: orquesta señales (similarweb + serpapi) ---------- */
export async function competitorAnalysis(input: Record<string, unknown>, context: SupliaToolContext) {
  const domain = asText(input.domain || (input as any).url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  if (!domain) throw new Error('Falta "domain" para research.competitor_analysis');
  const sections: any[] = [];
  let sw: any = null;
  try { sw = await researchSimilarweb({ domain }, context); } catch { /* sin datos */ }
  if (sw) {
    sections.push({ heading: 'Tráfico (SimilarWeb)', type: 'kpis', items: [
      { label: 'Visitas/mes', value: sw.visitsMonthly != null ? Number(sw.visitsMonthly).toLocaleString('es-CL') : 'n/a' },
      { label: 'Rank global', value: sw.globalRank ? '#' + Number(sw.globalRank).toLocaleString('es-CL') : 'n/a' },
      { label: 'Categoría', value: sw.category || 'n/a' },
    ] });
    const ts = sw.trafficSources || {};
    const bars = [['Directo', ts.direct], ['Búsqueda', ts.searchOrganic], ['Social', ts.social], ['Referido', ts.referrals]]
      .filter(([, v]) => v != null).map(([label, v]) => ({ label, value: Math.round((v as number) * 100), valueLabel: ((v as number) * 100).toFixed(0) + '%' }));
    if (bars.length) sections.push({ heading: 'Fuentes de tráfico', type: 'bars', items: bars });
  }
  try {
    const serp: any = await researchSerpCompetitors({ domain }, context);
    const items = (serp.items || []).map((item: any) => `${asText(item.title)} — ${asText(item.source || item.link)}`).filter(Boolean);
    if (items.length) sections.push({ heading: 'Competidores y alternativas', type: 'list', items: items.slice(0, 10) });
  } catch { /* opcional */ }
  if (!sections.length) sections.push({ heading: 'Sin datos', type: 'text', text: `No se obtuvieron señales públicas para ${domain}.` });
  return { artifactType: 'report', title: `Competencia: ${domain}`, data: { title: `Análisis de competencia — ${domain}`, subtitle: 'SimilarWeb + SerpAPI', sections } };
}

/* ---------------------------------------------------------------------
   REGISTRO en SUPLIA_TOOLS:
  'research.brand_mentions':     { name:'research.brand_mentions',     description:'Menciones de marca (Brand.dev). Consume creditos.', inputSchema:'{ "query": string }',  handler: researchBrandMentions },
  'email.subject_variants':      { name:'email.subject_variants',      description:'Genera y puntua asuntos de correo (GLM).',          inputSchema:'{ "offerSummary"?: string, "audience"?: string, "signal"?: string, "count"?: number }', handler: emailSubjectVariants },
  'marketing.demand_gen_plan':   { name:'marketing.demand_gen_plan',   description:'Plan de demand generation multicanal (GLM).',       inputSchema:'{ "goal": string, "offerSummary"?: string }', handler: demandGenPlan },
  'research.competitor_analysis':{ name:'research.competitor_analysis',description:'Analisis de competencia (trafico + SERP).',          inputSchema:'{ "domain": string }', handler: competitorAnalysis },

   research.brand_mentions consume creditos → gatear por aprobacion.
   --------------------------------------------------------------------- */
