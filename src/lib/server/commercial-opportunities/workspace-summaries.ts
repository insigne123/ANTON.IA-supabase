import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { opportunityModel } from '@/lib/commercial-opportunities/model-policy';
import { SUMMARY_BATCH, cleanSummary, needsTenderDetail, opportunitySummary, summaryAnswerSchema, summaryBasis, summaryCase, summaryPrompt,
  type OpportunitySummary } from '@/lib/commercial-opportunities/summaries';
import type { Tender } from '@/lib/commercial-opportunities/tenders';
import { getLicitacion, isMercadoPublicoBusy } from './mercado-publico';
import { resolveTicketForOrganization } from './tickets';
import { opportunityDb } from './workspace-store';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';

// A short reading each time: the worker's tick also runs the searches and the reports of the workspace.
const ITEMS_PER_RUN = 24;
const RUN_MS = 50_000;
const COLUMNS = 'id,kind,title,company_name,buyer_name,amount,currency,deadline_at,data,updated_at';
type Row = { id: string; kind: string; title: string; company_name: string | null; buyer_name: string | null; amount: number | null; currency: string | null;
  deadline_at: string | null; data: Record<string, any> | null; updated_at: string };

/**
 * The pipeline shows opportunities without their summary: one reading for the workspace is queued, unless one is under
 * way. It never stops the pipeline from loading; the count says how many cards are still waiting for theirs.
 */
export async function enqueueOpportunitySummaries(client: SupabaseClient, scope: WorkScope, items: Array<{ data?: unknown }>) {
  const missing = items.filter(item => !opportunitySummary(item.data) && !(item.data as any)?.summary).length;
  if (!missing) return 0;
  const active = await client.from('opportunity_jobs').select('id').eq('organization_id', scope.organizationId).eq('kind', 'evaluate')
    .in('state', ['queued', 'running', 'waiting']).eq('payload->>summaries', 'true').limit(1).maybeSingle();
  if (active.error || active.data) return missing;
  // At most one new reading every ten minutes, whoever opens the pipeline.
  await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'evaluate',
    dedupe_key: `summaries:${new Date().toISOString().slice(0, 15)}`, payload: { summaries: true } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true });
  return missing;
}

/** What the pipeline shows first: opportunities in play, then recommended and to review by score, open ones only. */
async function summaryCandidates(client: SupabaseClient, org: string) {
  const worked = (opportunityDb(await client.from('opportunity_work').select('opportunity_id').eq('organization_id', org).neq('state', 'unassigned').limit(1000)) || []) as Array<{ opportunity_id: string }>;
  const missing = () => client.from('commercial_opportunities').select(COLUMNS).eq('organization_id', org).is('data->summary', null);
  const inPlay = worked.length ? ((opportunityDb(await missing().in('id', worked.map(w => w.opportunity_id).slice(0, 300)).limit(ITEMS_PER_RUN)) || []) as Row[]) : [];
  if (inPlay.length >= ITEMS_PER_RUN) return inPlay;
  const open = (opportunityDb(await missing().in('data->>evaluation', ['recommended', 'review']).or(`deadline_at.is.null,deadline_at.gt.${new Date().toISOString()}`)
    .order('score', { ascending: false }).limit(ITEMS_PER_RUN)) || []) as Row[];
  const seen = new Set(inPlay.map(row => row.id));
  return [...inPlay, ...open.filter(row => !seen.has(row.id))].slice(0, ITEMS_PER_RUN);
}

/** The official file of a tender listed by name only: its buyer, description, region, amount and lines. */
function withDetail(row: Row, detail: Tender): Row {
  const data = row.data || {};
  return {
    ...row, buyer_name: row.buyer_name || detail.buyer, amount: row.amount ?? detail.amount, currency: row.currency || detail.currency,
    data: { ...data, description: detail.description || data.description, buyerUnit: data.buyerUnit || detail.buyerUnit,
      observed: { ...(data.observed || {}), region: data.observed?.region || detail.region, items: data.observed?.items?.length ? data.observed.items : detail.items },
      detail: { at: new Date().toISOString() } },
  };
}

/** Saved only if nobody changed the opportunity meanwhile (its row as saved, or null); otherwise the next reading takes it again. */
async function save(client: SupabaseClient, org: string, before: Row, after: Row): Promise<Row | null> {
  const saved = await client.from('commercial_opportunities').update({ buyer_name: after.buyer_name, amount: after.amount, currency: after.currency, data: after.data })
    .eq('organization_id', org).eq('id', before.id).eq('updated_at', before.updated_at).select('updated_at').maybeSingle();
  return !saved.error && saved.data ? { ...after, updated_at: (saved.data as { updated_at?: string }).updated_at || before.updated_at } : null;
}

/**
 * The reading: the official file of the tenders known by name only (with the workspace's Mercado Público ticket), then
 * the summary of each opportunity, a batch per model call. Stops after a short while and continues on the next tick.
 */
export async function runOpportunitySummaries(client: SupabaseClient, job: OpportunityJob, started = Date.now(), dependencies = { getLicitacion, resolveTicket: resolveTicketForOrganization }) {
  const org = job.organization_id;
  const candidates = await summaryCandidates(client, org);
  if (!candidates.length) return { waiting: false as const, summarized: 0, detailed: 0 };
  let ticket: string | null | undefined;
  let detailed = 0;
  const ready: Row[] = [];
  for (const row of candidates) {
    if (!needsTenderDetail(row)) { ready.push(row); continue; }
    if (Date.now() - started > RUN_MS / 2) break;
    if (ticket === undefined) ticket = (await dependencies.resolveTicket(client, { organizationId: org, creatorId: job.requested_by }).catch(() => null))?.ticket ?? null;
    if (!ticket) { ready.push(row); continue; }
    let detail: Tender | null = null;
    try {
      detail = await dependencies.getLicitacion(row.data!.observed.code, { fetch: globalThis.fetch, ticket });
    } catch (error) {
      // The ticket is busy with the daily search: this one waits for the next reading. Any other failure: the name is enough.
      if (isMercadoPublicoBusy(error)) continue;
      ticket = null;
    }
    if (!detail) { ready.push(row); continue; }
    const saved = await save(client, org, row, withDetail(row, detail));
    if (saved) { detailed++; ready.push(saved); }
  }
  const model = opportunityModel('screen');
  let summarized = 0;
  for (let offset = 0; offset < ready.length; offset += SUMMARY_BATCH) {
    if (Date.now() - started > RUN_MS) break;
    const batch = ready.slice(offset, offset + SUMMARY_BATCH);
    const cases = batch.map(summaryCase);
    const answer = await opportunityGenerate(client, job, { step: `summaries:${createHash('sha256').update(JSON.stringify(cases)).digest('hex').slice(0, 32)}`,
      category: 'evaluation', role: 'screen', schema: summaryAnswerSchema, output: 1500, prompt: summaryPrompt(cases) });
    const texts = new Map(answer.summaries.map(item => [item.id.trim(), cleanSummary(item.summary)]));
    for (const row of batch) {
      // One the model left out keeps an empty summary: the card shows no line, and it is not read again every tick.
      const summary: OpportunitySummary = { text: texts.get(row.id) || '', model, basis: summaryBasis(row), at: new Date().toISOString() };
      if (await save(client, org, row, { ...row, data: { ...(row.data || {}), summary } })) summarized++;
    }
  }
  return { waiting: candidates.length >= ITEMS_PER_RUN || ready.length < candidates.length || summarized < ready.length, summarized, detailed };
}
