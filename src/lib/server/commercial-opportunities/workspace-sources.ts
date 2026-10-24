import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import { canonicalLinkedInPost } from '@/lib/commercial-opportunities/workspace';
import { linkedinRunCap, linkedinWindow, opportunitySourceItemLimit } from '@/lib/commercial-opportunities/source-budget';
import { groupHiring, jobAdFromFantastic } from '@/lib/commercial-opportunities/hiring';
import { tenderUrl, type Tender } from '@/lib/commercial-opportunities/tenders';
import { listOpenLicitaciones } from './mercado-publico';
import { resolveTicketForOrganization } from './tickets';
import { CompraAgilError, searchCompraAgil, compraAgilQuery } from './compra-agil';
import { opportunityDb } from './workspace-store';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { EXCLUSION_MOTIVES, RULE_MOTIVE, tenderWordsOfTheDay } from '@/lib/commercial-opportunities/workspace-radar';
import { TENDER_PROFILE_RULE, tenderProfileForModel } from '@/lib/commercial-opportunities/tender-profile';
import { loadTenderProfile } from './tender-profile-read';
import { readSearchSettings, sourceOn, tenderPreferences, tenderRuledOut, unspscMatch } from '@/lib/commercial-opportunities/search-settings';

export const criteriaSchema = z.object({ roles: z.array(z.string().max(80)).max(30), keywords: z.array(z.string().max(120)).max(30),
  postQueries: z.array(z.string().max(400)).min(1).max(12), decisionMakerTitles: z.array(z.string().max(80)).max(12) });
const verdictSchema = z.object({ evaluations: z.array(z.object({ id: z.string().uuid(), verdict: z.enum(['recommended', 'review', 'excluded']),
  reason: z.string().max(1000), service: z.string().max(500), score: z.number().int().min(0).max(100),
  motive: z.enum(EXCLUSION_MOTIVES).nullable().optional() })).max(40) });
type Candidate = { kind: string; key: string; title: string; company?: string | null; domain?: string | null; description: string;
  deadline?: string | null; amount?: number | null; currency?: string | null; url?: string | null; raw?: Record<string, unknown> };
export const candidateFingerprint = (candidate: Candidate) => createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
export function postCandidates(items: Record<string, any>[]): Candidate[] {
  return items.filter(item => item.type === 'post' || item.content && item.linkedinUrl).flatMap(item => {
    const link = canonicalLinkedInPost(String(item.linkedinUrl || ''));
    const content = String(item.content || '').trim();
    if (!link || !content) return [];
    return [{ kind: 'linkedin_post', key: `post:${link.id}`, title: content.replace(/\s+/g, ' ').slice(0, 300), company: String(item.author?.name || '').slice(0, 300) || null,
      description: content.slice(0, 6000), url: link.url, raw: { authorUrl: item.author?.linkedinUrl || null,
        authorType: item.author?.type || null, postedAt: item.postedAt?.date || null, truncated: content.length > 6000,
        signalType: item.repostedPost ? 'repost' : 'post', authorshipVerified: false } }];
  });
}
export async function persistOpportunityCandidates(client: SupabaseClient, job: OpportunityJob, candidates: Candidate[], revision: number) {
  let changed = 0;
  const cursor = Number(job.payload.cursor || 0);
  for (let offset = cursor; offset < Math.min(cursor + 400, candidates.length); offset += 100) {
    const batch = [...new Map(candidates.slice(offset, offset + 100).map(c => [c.key,c])).values()];
    const toEvaluate = opportunityDb(await client.rpc('opportunity_persist_candidates',{p_job:job.id,p_lease:job.lease_token,p_revision:revision,
      p_rows:batch.map(c=>({...c,hash:candidateFingerprint(c)}))})) as string[] || [];
    changed+=toEvaluate.length;
    for (let i = 0; i < toEvaluate.length; i += 40) {
      const ids = toEvaluate.slice(i, i + 40);
      opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: job.organization_id, requested_by: job.requested_by, kind: 'evaluate',
        dedupe_key: `evaluate:${job.id}:${offset}:${i}:${revision}`, payload: { ids, revision } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }));
    }
    job.payload.cursor = offset + 100;
    const checkpoint = opportunityDb(await client.from('opportunity_jobs').update({payload:job.payload}).eq('id',job.id).eq('lease_token',job.lease_token).select('id').maybeSingle());
    if (!checkpoint) throw new AuthError('El trabajo se retomó en otro proceso.',409);
  }
  return {changed, waiting:Number(job.payload.cursor || 0)<candidates.length};
}
const tenderCandidate = (t: Tender): Candidate => ({ kind: t.source === 'compra_agil' ? 'compra_agil' : 'tender', key: `${t.source}:${t.code}`, title: t.name,
  company: t.buyer, description: t.description || t.name, deadline: t.closesAt, amount: t.amount, currency: t.currency, url: tenderUrl(t), raw: { code: t.code, status: t.status, items: t.items, region: t.region } });

/**
 * A busy or failing Compra Ágil is tried again further apart each time (1, 2, 4, 8, 15 and 15 minutes: about 45 minutes in all) instead
 * of six times in five minutes: in two weeks 12 searches failed with «504», and Mercado Público is often back within the hour. The
 * claim takes a waiting job again every 45 s and stops after 100 claims, which leaves room for it.
 */
const COMPRA_AGIL_RETRY_MINUTES = [1, 2, 4, 8, 15, 15];
export async function captureOpportunityTenders(client: SupabaseClient, job: OpportunityJob, context: any) {
  const snapshot = opportunityDb(await client.from('opportunity_source_snapshots').select('candidates').eq('job_id',job.id).eq('organization_id',job.organization_id).maybeSingle());
  if (snapshot) return persistOpportunityCandidates(client,job,snapshot.candidates as Candidate[],context.revision);
  const ticket = await resolveTicketForOrganization(client, { organizationId: job.organization_id, creatorId: job.requested_by });
  if (!ticket) throw new AuthError('Conecta el ticket de Mercado Público desde la cuenta administradora.', 409);
  // One ticket cannot run concurrent MP calls. Listing first; each Compra Ágil query gets its own checkpointed job.
  if (job.payload.keyword) {
    // Not yet time for the next try: the claim took it early, so it waits without calling.
    const retry = job.result?.retry as { tries: number; nextAt: string } | undefined;
    if (retry && Date.parse(retry.nextAt) > Date.now()) return { waiting: true as const, retry };
    let response: Awaited<ReturnType<typeof searchCompraAgil>>;
    try {
      response = await searchCompraAgil({ keyword: compraAgilQuery(job.payload.keyword), publishedFrom: new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10), pages: 4 }, { fetch: globalThis.fetch, ticket: ticket.ticket, canWait: () => false });
    } catch (error) {
      // The ticket takes a limited number of calls at a time: a 429 or a 5xx waits for a later try instead of failing the search.
      const tries = (retry?.tries ?? 0) + 1;
      if (error instanceof CompraAgilError && error.retryable && tries <= COMPRA_AGIL_RETRY_MINUTES.length)
        return { waiting: true as const, retry: { tries, nextAt: new Date(Date.now() + COMPRA_AGIL_RETRY_MINUTES[tries - 1] * 60_000).toISOString() } };
      throw error instanceof CompraAgilError ? new AuthError(error.message, 503) : error;
    }
    const candidates=response.tenders.map(tenderCandidate);
    opportunityDb(await client.from('opportunity_source_snapshots').insert({job_id:job.id,organization_id:job.organization_id,candidates}));
    return { ...await persistOpportunityCandidates(client, job, candidates, context.revision), coverage: response.error ? 'partial' : 'up_to_four_pages' };
  }
  // The sources the administrator chose in «Qué buscamos» (search-settings.ts): the listing of tenders, Compra Ágil, or both.
  const settings = readSearchSettings(context.search);
  const tenders = sourceOn(settings, 'tenders') ? await listOpenLicitaciones({ fetch: globalThis.fetch, ticket: ticket.ticket }) : [];
  const candidates=tenders.map(tenderCandidate);
  opportunityDb(await client.from('opportunity_source_snapshots').insert({job_id:job.id,organization_id:job.organization_id,candidates}));
  if (sourceOn(settings, 'compraAgil')) for (const keyword of tenderWordsOfTheDay(context.criteria?.keywords || [], Date.now() / 86_400_000)) opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: job.organization_id, requested_by: job.requested_by,
    kind: 'tenders', dedupe_key: `${job.dedupe_key}:agil:${createHash('sha256').update(keyword).digest('hex')}`, payload: { keyword, revision: context.revision } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }));
  return { ...await persistOpportunityCandidates(client, job, candidates, context.revision), listed: tenders.length, coverage: sourceOn(settings, 'tenders') ? 'active_listing' : 'compra_agil_only' };
}

/** External paid starts have a reservation/receipt checkpoint BEFORE POST; never replay an ambiguous start. */
async function apifyOpportunityItems(client: SupabaseClient, job: OpportunityJob, actor: string, body: Record<string, unknown>, cap: number) {
  if (!process.env.APIFY_TOKEN) throw new AuthError('LinkedIn no está conectado.', 503);
  const admission = opportunityDb(await client.rpc('opportunity_budget_reserve', { p_org: job.organization_id, p_job: job.id, p_step: 'provider', p_category: 'sources', p_micro: Math.ceil(cap * 1e6), p_lease:job.lease_token }));
  if (!admission?.admitted) throw new AuthError('Se alcanzó el presupuesto de búsqueda de este mes.', 402);
  const saved = opportunityDb(await client.from('opportunity_ai_results').select('data').eq('organization_id', job.organization_id).eq('reservation_id', admission.id).maybeSingle());
  if (saved) return { waiting: false as const, items: saved.data.items as Record<string, any>[] };
  const headers = { authorization: `Bearer ${process.env.APIFY_TOKEN}`, 'content-type': 'application/json' };
  let receipt = opportunityDb(await client.from('opportunity_budget_reservations').select('receipt').eq('organization_id', job.organization_id).eq('id', admission.id).single())?.receipt;
  if (admission.fresh) {
    opportunityDb(await client.rpc('opportunity_budget_settle', { p_id: admission.id, p_cost: null, p_receipt: { stage: 'submitting', actor }, p_data: null }));
    const response = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?${new URLSearchParams({ maxTotalChargeUsd: String(cap), timeout: '180', memory: '1024', restartOnError: 'false' })}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new AuthError('La fuente no pudo iniciar la consulta. La reserva queda pendiente de comprobación.', 503);
    const payload = await response.json();
    if (!payload.data?.id) throw new AuthError('No se recibió el comprobante de la consulta.', 503);
    receipt = { actor, runId: payload.data.id };
    opportunityDb(await client.rpc('opportunity_budget_settle', { p_id: admission.id, p_cost: null, p_receipt: receipt, p_data: null }));
  }
  if (!receipt?.runId) throw new AuthError('La consulta anterior no tiene comprobante; evitamos iniciar otra.', 409);
  const runResponse = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(receipt.runId)}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!runResponse.ok) throw new AuthError('No se pudo comprobar el estado de la fuente.', 503);
  const run = (await runResponse.json()).data;
  if (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run?.status)) return { waiting: true as const, items: [] };
  const cost = typeof run.usageTotalUsd === 'number' && run.usageTotalUsd >= 0 ? Math.ceil(run.usageTotalUsd * 1e6) : null;
  if (run.status !== 'SUCCEEDED') {
    opportunityDb(await client.rpc('opportunity_budget_settle', { p_id: admission.id, p_cost: cost, p_receipt: { ...receipt, status: run.status }, p_data: null }));
    throw new AuthError('La consulta de la fuente terminó sin resultados confirmados.', 503);
  }
  const response = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?format=json&limit=300`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new AuthError('La fuente terminó; falta recuperar sus resultados.', 503);
  const items = await response.json();
  if (!Array.isArray(items)) throw new AuthError('Los resultados de la fuente no se pudieron leer.', 503);
  opportunityDb(await client.rpc('opportunity_budget_settle', { p_id: admission.id, p_cost: cost, p_receipt: { ...receipt, status: run.status, fetched: items.length, cap }, p_data: { items } }));
  return { waiting: false as const, items };
}
/** When this source last finished a search for the workspace, to know how far back the next one has to look. */
async function lastLinkedInRun(client: SupabaseClient, job: OpportunityJob) {
  const last = opportunityDb(await client.from('opportunity_jobs').select('updated_at').eq('organization_id', job.organization_id).eq('kind', job.kind)
    .eq('state', 'ready').neq('id', job.id).order('updated_at', { ascending: false }).limit(1).maybeSingle());
  return (last?.updated_at as string | undefined) || null;
}
export async function captureOpportunityLinkedIn(client: SupabaseClient, job: OpportunityJob, context: any) {
  const kind = job.kind === 'posts' ? 'posts' : 'hiring';
  const cap = linkedinRunCap(context.priority, kind);
  const lookback = linkedinWindow(kind, await lastLinkedInRun(client, job));
  if (job.kind === 'posts') {
    const price = Number(process.env.OPPORTUNITIES_POST_USD_PER_ITEM);
    const start = Number(process.env.OPPORTUNITIES_POST_START_USD);
    const emptyQuery = Number(process.env.OPPORTUNITIES_POST_EMPTY_QUERY_USD);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(start) || start < 0 || !Number.isFinite(emptyQuery) || emptyQuery < 0)
      throw new AuthError('Falta confirmar la tarifa del conector de publicaciones.', 503);
    const queries = (context.criteria?.postQueries || []).slice(0, 5);
    if (!queries.length) throw new AuthError('Los criterios de publicaciones se están preparando.', 409);
    const perQuery = opportunitySourceItemLimit({ cap, price, start, emptyQuery, queries: queries.length, max: 30 });
    if (perQuery < 1) throw new AuthError('El saldo por corrida no alcanza para consultar publicaciones.', 402);
    const data = await apifyOpportunityItems(client, job, 'harvestapi~linkedin-post-search', { searchQueries: queries, maxPosts: perQuery,
      postedLimit: lookback, sortBy: 'date', profileScraperMode: 'short', scrapeReactions: false, scrapeComments: false }, cap);
    return data.waiting ? { waiting: true as const } : { ...await persistOpportunityCandidates(client, job, postCandidates(data.items), context.revision), coverage: 'bounded_queries' };
  }
  const price = Number(process.env.APIFY_FANTASTIC_USD_PER_JOB || .005);
  const start = Number(process.env.APIFY_FANTASTIC_START_USD || .01);
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(start)||start<0)throw new AuthError('La tarifa de avisos laborales no está configurada correctamente.',503);
  const limit = opportunitySourceItemLimit({ cap, price, start, max: 100 });
  const roles = context.criteria?.roles || [];
  if (limit < 10 || !roles.length) throw new AuthError('Faltan criterios o presupuesto para consultar avisos laborales.', 409);
  const data = await apifyOpportunityItems(client, job, 'fantastic-jobs~advanced-linkedin-job-search-api', { titleSearch: roles.slice(0, 20), locationSearch: context.territories.length ? context.territories : ['Chile'],
    timeRange: lookback, limit, removeAgency: false, descriptionType: 'text', recruiterOnly: false }, cap);
  if (data.waiting) return { waiting: true as const };
  const ads = data.items.flatMap(item => { const ad = jobAdFromFantastic(item); return ad ? [ad] : []; });
  const grouped = groupHiring(ads, { roles, regions: [], minAds: 1, clients: [], contactsCompanies: [], excludeAgencies: false }, { now: new Date().toISOString(), windowDays: 30 });
  const candidates = grouped.opportunities.map(c => ({ kind: 'hiring', key: `hiring:${c.key}`, title: `Actividad de contratación: ${c.company}`, company: c.company,
    domain: c.domain, description: c.signals.map(s => `${s.title} · ${s.location || ''} · ${s.url || ''}`).join('\n').slice(0, 6000), url: c.signals[0]?.url || null, raw: { ads: c.ads } }));
  return { ...await persistOpportunityCandidates(client, job, candidates, context.revision), coverage: 'bounded_daily_ads' };
}
/**
 * What the team put aside lately («No es para nosotros», workspace-discards.ts): the title and the reason of the last ones, so the next
 * evaluations learn what does not serve this company. A failed read leaves them out; the evaluation never waits for it.
 */
export async function recentDiscards(client: SupabaseClient, organizationId: string, limit = 20) {
  const lines = await client.from('opportunity_activity').select('opportunity_id,data').eq('organization_id', organizationId).eq('kind', 'discarded')
    .order('created_at', { ascending: false }).limit(limit);
  if (lines.error || !lines.data?.length) return [];
  const ids = [...new Set(lines.data.map((row: any) => String(row.opportunity_id)))];
  const items = await client.from('commercial_opportunities').select('id,title,buyer_name').eq('organization_id', organizationId).in('id', ids);
  if (items.error) return [];
  const byId = new Map((items.data || []).map((row: any) => [String(row.id), row]));
  return lines.data.flatMap((row: any) => {
    const item = byId.get(String(row.opportunity_id));
    if (!item) return [];
    const reason = [String(row.data?.label || row.data?.reason || ''), String(row.data?.note || '')].filter(Boolean).join(': ');
    return [{ titulo: String(item.title || '').slice(0, 160), comprador: String(item.buyer_name || '').slice(0, 80) || undefined, motivo: reason.slice(0, 200) }];
  });
}
export async function evaluateOpportunityBatch(client: SupabaseClient, job: OpportunityJob, context: any) {
  const all = opportunityDb(await client.from('commercial_opportunities').select('id,kind,title,company_name,data,deadline_at,amount,currency').eq('organization_id', job.organization_id).in('id', job.payload.ids || [])) || [];
  // The administrator's own rules in «Qué buscamos» (search-settings.ts) leave a tender out before the AI reads it: no cost, and the
  // reason the list shows. An amount the tender does not say is never a reason.
  const settings = readSearchSettings(context.search);
  const ruledOut = new Set<string>();
  for (const row of all) {
    const reason = ['tender', 'compra_agil'].includes(row.kind) ? tenderRuledOut(settings, { amount: row.amount, currency: row.currency, company: row.company_name }) : null;
    if (!reason || row.data?.profileRevision !== context.revision) continue;
    opportunityDb(await client.from('opportunity_evaluations').upsert({ organization_id: job.organization_id, opportunity_id: row.id, profile_revision: context.revision,
      content_hash: row.data.contentHash, verdict: 'excluded', reason, service: '', model: 'rule', evidence: [{ source: row.data.source, description: row.data.description }] }, { onConflict: 'opportunity_id,profile_revision,content_hash' }));
    opportunityDb(await client.from('commercial_opportunities').update({ score: 0, reasons: [reason], data: { ...row.data, evaluation: 'excluded', matchedService: null, excludedMotive: RULE_MOTIVE } })
      .eq('organization_id', job.organization_id).eq('id', row.id).eq('data->>contentHash', row.data.contentHash).eq('data->>profileRevision', String(context.revision)));
    ruledOut.add(row.id);
  }
  const rows = all.filter(row => !ruledOut.has(row.id))
    .map((row: any) => (unspscMatch(settings.tenders.unspsc, row.data?.observed?.items || []) ? { ...row, calzaUnspsc: true } : row));
  if (!rows.length) return { evaluated: ruledOut.size, pending: 0 };
  const preferences = tenderPreferences(settings);
  // The «Ficha para licitaciones»: a requirement or a scale is a reason to discard only when the profile disproves it.
  const [profile, discards] = await Promise.all([loadTenderProfile(client, job.organization_id), recentDiscards(client, job.organization_id).catch(() => [])]);
  const evaluated = await opportunityGenerate(client, job, { step: 'evaluate', category: 'evaluation', role: 'screen', schema: verdictSchema, output: 5000,
    prompt: `Evalúa TODOS los candidatos contra la oferta de la empresa, no solo palabras. Devuelve exactamente un veredicto por id: recommended, review o excluded, razón breve, servicio al que encaja y score de prioridad (no probabilidad).\n` +
      `Si es excluded, motive dice por qué: otro_producto (piden otra cosa aunque compartan palabras), parte_menor (lo que ofrece es una parte menor), requisito (exigen algo que la oferta no tiene: productos o licencias de un fabricante, una certificación, presencia), escala (volumen, dotación o plazo fuera de proporción) o sin_compra (no muestra una compra: candidatos, proveedores, contratación interna); en los demás veredictos motive es null.\n` +
      `Ante ambigüedad o información incompleta usa review. Contrataciones no prueban compra externa. Distingue publicaciones de proveedores, candidatos y compradores. Un repost no prueba necesidad de quien comparte. Considera exclusiones de ESTA oferta; no descartes todas las agencias. La elegibilidad de licitaciones no está certificada leyendo su nombre.\n` +
      (profile ? `Para requisito y escala usa la ficha: ${TENDER_PROFILE_RULE} En ese caso usa review y di en la razón qué dato falta.\n` : 'Sin ficha de la empresa, requisito y escala solo descartan cuando la oferta o sus exclusiones lo dicen; si no, review.\n') +
      (discards.length ? 'descartadasPorElEquipo son oportunidades que el equipo dejó de lado y por qué: un candidato del mismo tipo y con el mismo motivo baja a review o excluded; uno solo parecido en palabras no.\n' : '') +
      (Object.keys(preferences).length ? 'preferenciasDeLicitaciones son organismos que el equipo sigue, regiones y códigos UNSPSC que prefiere (calzaUnspsc marca a quien pide uno): súbele el score a la licitación que calce, sin excluir a una solo por no calzar.\n' : '') +
      JSON.stringify({ offer: context.offer, services: context.services, exclusions: context.exclusions, priority: context.priority, ...(profile ? { ficha: tenderProfileForModel(profile) } : {}),
        ...(discards.length ? { descartadasPorElEquipo: discards } : {}), ...(Object.keys(preferences).length ? { preferenciasDeLicitaciones: preferences } : {}), candidates: rows }) });
  let count = 0;
  for (const row of rows) {
    const answer = evaluated.evaluations.find(v => v.id === row.id);
    if (!answer || row.data?.profileRevision !== context.revision) continue;
    opportunityDb(await client.from('opportunity_evaluations').upsert({ organization_id: job.organization_id, opportunity_id: row.id, profile_revision: context.revision,
      content_hash: row.data.contentHash, verdict: answer.verdict, reason: answer.reason, service: answer.service, model: 'opportunity/screen', evidence: [{ source: row.data.source, description: row.data.description }] }, { onConflict: 'opportunity_id,profile_revision,content_hash' }));
    opportunityDb(await client.from('commercial_opportunities').update({ score: answer.verdict === 'excluded' ? Math.min(10, answer.score) : answer.score, reasons: [answer.reason], data: { ...row.data, evaluation: answer.verdict, matchedService: answer.service,
      excludedMotive: answer.verdict === 'excluded' ? answer.motive ?? null : null } })
      .eq('organization_id', job.organization_id).eq('id', row.id).eq('data->>contentHash', row.data.contentHash).eq('data->>profileRevision', String(context.revision)));
    count++;
  }
  return { evaluated: count + ruledOut.size, pending: rows.length - count };
}
