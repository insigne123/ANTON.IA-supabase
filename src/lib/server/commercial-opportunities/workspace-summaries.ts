import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { opportunityModel } from '@/lib/commercial-opportunities/model-policy';
import { SUMMARY_BATCH, cleanSummary, needsTenderDetail, opportunitySummary, summaryAnswerSchema, summaryBasis, summaryCase, summaryFromNameOnly, summaryPrompt,
  type OpportunitySummary } from '@/lib/commercial-opportunities/summaries';
import type { Tender } from '@/lib/commercial-opportunities/tenders';
import { getLicitacion, isMercadoPublicoBusy } from './mercado-publico';
import { resolveTicketForOrganization } from './tickets';
import { opportunityDb } from './workspace-store';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';

// A short reading each time: the worker's tick also runs the searches and the reports of the workspace.
const ITEMS_PER_RUN = 24;
const RUN_MS = 50_000;
// The cards one pipeline shows (in play, 120 recommended, 60 to review) fit; ids are read 100 at a time.
const MAX_IDS = 400;
const ID_CHUNK = 100;
// A reading that has not moved in this long (its attempts ran out, its worker died) no longer holds back a new one.
const STALE_MS = 15 * 60_000;
const COLUMNS = 'id,kind,title,company_name,buyer_name,amount,currency,deadline_at,data,updated_at';
type Row = { id: string; kind: string; title: string; company_name: string | null; buyer_name: string | null; amount: number | null; currency: string | null;
  deadline_at: string | null; data: Record<string, any> | null; updated_at: string };

/** A card to (re)write: no summary yet, or one from the name alone of a tender whose official file was never read. */
const toWrite = (row: { data?: unknown; kind?: string; title?: string }) => !opportunitySummary(row.data) && !(row.data as any)?.summary
  || summaryFromNameOnly({ id: '', kind: String(row.kind ?? ''), title: String(row.title ?? ''), ...(row as object), data: row.data as Record<string, any> | null });

/**
 * The pipeline shows opportunities without their summary: one reading of those cards, in the order shown, is queued unless
 * one is under way. It never stops the pipeline from loading; the count says how many cards are still waiting for theirs.
 */
export async function enqueueOpportunitySummaries(client: SupabaseClient, scope: WorkScope, items: Array<{ id?: string; kind?: string; title?: string; buyer_name?: string | null;
  deadline_at?: string | null; data?: unknown }>) {
  const missing = items.filter(toWrite);
  if (!missing.length) return 0;
  const active = await client.from('opportunity_jobs').select('id').eq('organization_id', scope.organizationId).eq('kind', 'evaluate')
    .in('state', ['queued', 'running', 'waiting']).eq('payload->>summaries', 'true').gt('updated_at', new Date(Date.now() - STALE_MS).toISOString())
    .limit(1).maybeSingle();
  if (active.error || active.data) return missing.length;
  // At most one new reading every ten minutes, whoever opens the pipeline. The board shows the nearest deadlines first
  // (PipelineBoard.tsx): those cards get theirs first, the ones without a deadline last.
  const closes = (item: { deadline_at?: string | null }) => (item.deadline_at ? Date.parse(item.deadline_at) : NaN) || Infinity;
  const ids = [...missing].sort((a, b) => closes(a) - closes(b)).map(item => item.id).filter((id): id is string => Boolean(id)).slice(0, MAX_IDS);
  await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'evaluate',
    dedupe_key: `summaries:${new Date().toISOString().slice(0, 15)}`, payload: { summaries: true, ids } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true });
  return missing.length;
}

/** The cards the pipeline showed, in its order, that still lack their summary (or have one from the name alone). */
async function shownCandidates(client: SupabaseClient, org: string, ids: string[]) {
  const found: Row[] = [];
  for (let start = 0; start < ids.length && found.length < ITEMS_PER_RUN; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);
    const rows = (opportunityDb(await client.from('commercial_opportunities').select(COLUMNS).eq('organization_id', org).in('id', chunk)) || []) as Row[];
    found.push(...rows.filter(toWrite).sort((a, b) => chunk.indexOf(a.id) - chunk.indexOf(b.id)));
  }
  return found.slice(0, ITEMS_PER_RUN);
}

/** Without the cards shown: opportunities in play, then recommended and to review by score, open ones only. */
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

/** A tender whose official file could not be read (no ticket, not found, refused): asked once, the name is what there is. */
const withoutDetail = (row: Row): Row => ({ ...row, data: { ...(row.data || {}), detail: { at: new Date().toISOString(), found: false } } });

type ResolveTicket = typeof resolveTicketForOrganization;
/**
 * The workspace's Mercado Público ticket: the one of whoever opened the pipeline, else the one the daily search uses, which
 * reads as the admin who confirmed the offer (a shared ticket is given by person, MERCADO_PUBLICO_SHARED_TICKET_EMAILS).
 */
async function workspaceTicket(client: SupabaseClient, job: OpportunityJob, resolve: ResolveTicket) {
  const ask = (creatorId: string) => resolve(client, { organizationId: job.organization_id, creatorId }).then(found => found?.ticket ?? null, () => null);
  const own = await ask(job.requested_by);
  if (own) return own;
  const context = await client.from('opportunity_company_context').select('approved_by').eq('organization_id', job.organization_id).maybeSingle();
  const approver = (context.data as { approved_by?: string | null } | null)?.approved_by;
  return approver && approver !== job.requested_by ? ask(approver) : null;
}

// The screening rewrites these without touching updated_at (workspace-sources.ts): a verdict given meanwhile is not overwritten.
const EVALUATION_FIELDS = ['evaluation', 'matchedService', 'profileRevision'] as const;

/** Saved only if nobody changed the opportunity meanwhile (its row as saved, or null); otherwise the next reading takes it again. */
async function save(client: SupabaseClient, org: string, before: Row, after: Row): Promise<Row | null> {
  let query = client.from('commercial_opportunities').update({ buyer_name: after.buyer_name, amount: after.amount, currency: after.currency, data: after.data })
    .eq('organization_id', org).eq('id', before.id).eq('updated_at', before.updated_at);
  for (const field of EVALUATION_FIELDS) {
    const value = before.data?.[field];
    query = value === undefined || value === null ? query.is(`data->>${field}`, null) : query.eq(`data->>${field}`, String(value));
  }
  const saved = await query.select('updated_at').maybeSingle();
  return !saved.error && saved.data ? { ...after, updated_at: (saved.data as { updated_at?: string }).updated_at || before.updated_at } : null;
}

/**
 * The reading: the official file of the tenders known by name only (with the workspace's Mercado Público ticket), then
 * the summary of each opportunity, a batch per model call. Stops after a short while and continues on the next tick.
 */
export async function runOpportunitySummaries(client: SupabaseClient, job: OpportunityJob, started = Date.now(), dependencies = { getLicitacion, resolveTicket: resolveTicketForOrganization }) {
  const org = job.organization_id;
  const shown = Array.isArray(job.payload.ids) ? (job.payload.ids as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, MAX_IDS) : null;
  const candidates = shown ? await shownCandidates(client, org, shown) : await summaryCandidates(client, org);
  if (!candidates.length) return { waiting: false as const, summarized: 0, detailed: 0 };
  let ticket: string | null | undefined;
  let detailed = 0;
  const ready: Row[] = [];
  for (const row of candidates) {
    if (!needsTenderDetail(row)) { ready.push(row); continue; }
    if (Date.now() - started > RUN_MS / 2) break;
    if (ticket === undefined) ticket = await workspaceTicket(client, job, dependencies.resolveTicket);
    let detail: Tender | null = null;
    if (ticket) {
      try {
        detail = await dependencies.getLicitacion(row.data!.observed.code, { fetch: globalThis.fetch, ticket });
      } catch (error) {
        // The ticket is busy with the daily search: this one waits for the next reading. Any other failure: the name is enough.
        if (isMercadoPublicoBusy(error)) continue;
        ticket = null;
      }
    }
    if (!detail) { ready.push(withoutDetail(row)); continue; }
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
