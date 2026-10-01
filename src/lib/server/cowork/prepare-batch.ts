import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { isApolloCreditBalanceStale, loadLatestApolloCreditBalance } from '@/lib/server/apollo-credit-balance';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import {
  COWORK_PREPARE_BATCH_EFFECT, coworkPrepareBatchLabel, coworkPrepareBatchPeople, coworkPrepareCost, hashCoworkPrepareBatch,
  planCoworkPrepareBatch, type CoworkPrepareCandidate, type CoworkPrepareItem, type CoworkPrepareReady, type CoworkPrepareResult,
  type CoworkPrepareState,
} from '@/lib/cowork/prepare-batch';
import { requireCoworkWorkerAccess } from './access';
import { observedCoworkLeadIds } from './observed-leads';
import { coworkSavedContactId } from './save-contact';

/**
 * «Preparar contactos» with one approval, behind the cowork_prepare_batch migration (docs/cowork-preparar-contactos.md). Staging
 * reads the real state of each person (saved, email looked up, research done or under way) and keeps only what is missing, so
 * nothing is charged twice and someone already done never needs an approval. The list is kept in cowork_batch_proposals, pinned by
 * a hash in the proposal target; the card lets the person take people off before approving. The approved effect runs each person
 * step by step (save, then look up the email, then research) in prepare-batch-run.ts, checking again, and reports person by person.
 * COWORK_PREPARE_BATCH_ENABLED=false turns it off, also for a batch already approved.
 */

export const coworkPrepareBatchEnabled = () => process.env.COWORK_PREPARE_BATCH_ENABLED !== 'false';

const TARGET = /^preparebatch:([a-f0-9]{64})$/;

export function parseCoworkPrepareBatchTarget(targetId: string) {
  const match = TARGET.exec(String(targetId || ''));
  if (!match) throw new Error('La propuesta de lote no es válida.');
  return { hash: match[1] };
}

/** A refusal the person can read as it is: the route answers 409 with its message. Anything else stays generic. */
export class CoworkPrepareRefusal extends Error {}

type Scope = { userId: string; organizationId: string };
type Client = ReturnType<typeof getSupabaseAdminClient>;
type LeadRow = {
  id: string; name: string | null; company: string | null; title: string | null; email: string | null;
  apollo_id: string | null; source_provider_id: string | null;
};
export type Staged = { kind: string; items: CoworkPrepareItem[]; deferred?: CoworkPrepareReady[]; excluded: string[]; patch_hash: string };

const LEAD_FIELDS = 'id,name,company,title,email,apollo_id,source_provider_id';
/** How far back a batch looks for the people the conversation saw: this turn and the ones it continues. */
const THREAD_RUNS = 12;
/** A lookup that is done or under way: the email is not looked up again. A failed one can be tried again. */
const LOOKUP_DONE = new Set(['completed', 'pending']);
/** A research that failed or found too little can be asked again; any other is done or under way. */
const RESEARCH_RETRY = new Set(['failed', 'insufficient_data']);

const apolloKey = (providerId: string) => providerId.slice(7);
const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null);

/** The runs of this conversation, newest first: this one and the ones it continues. */
async function threadRunIds(client: Client, scope: Scope, runId: string) {
  const ids: string[] = [];
  let cursor: string | null = runId;
  while (cursor && ids.length < THREAD_RUNS && !ids.includes(cursor)) {
    ids.push(cursor);
    const row: { data: { parent_run_id?: string | null } | null; error: unknown } = await client.from('cowork_runs').select('parent_run_id').eq('id', cursor)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (row.error) throw new Error('No se pudo leer esta conversación.');
    cursor = row.data?.parent_run_id ?? null;
  }
  return ids;
}

/** Who this conversation saw: the search results and saved contacts its reads returned, and the contacts it saved (by an approved
 * action or from the panel). A batch only takes people from here, so nobody enters one that nobody saw. */
async function threadPeople(client: Client, scope: Scope, runId: string) {
  const runs = await threadRunIds(client, scope, runId);
  const events = await client.from('cowork_run_events').select('kind,payload').in('run_id', runs)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).in('kind', ['tool.completed', 'effect.completed', 'contact.saved']);
  if (events.error) throw new Error('No se pudo comprobar lo consultado en esta conversación.');
  const rows = (events.data || []) as Array<{ kind: string; payload: unknown }>;
  const results = new Map(collectCoworkLeadRows(rows.filter(row => row.kind === 'tool.completed').map(row => row.payload)).map(row => [row.id, row]));
  const saved = observedCoworkLeadIds(rows);
  for (const row of rows) {
    const payload = (row.payload || {}) as { kind?: string; leadId?: unknown; result?: { leadId?: unknown; items?: Array<{ id?: unknown }> } | null };
    if (row.kind === 'contact.saved' && typeof payload.leadId === 'string') saved.add(payload.leadId);
    if (row.kind !== 'effect.completed') continue;
    if (typeof payload.result?.leadId === 'string') saved.add(payload.result.leadId);
    if (payload.kind === COWORK_PREPARE_BATCH_EFFECT) for (const item of payload.result?.items || []) if (typeof item.id === 'string') saved.add(item.id);
  }
  return { results, saved };
}

/** The own saved contacts behind these ids and these search results (by provider id). */
async function loadOwnLeads(client: Client, scope: Scope, leadIds: string[], apolloIds: string[]) {
  const own = () => client.from('leads').select(LEAD_FIELDS).eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  const reads = await Promise.all([
    leadIds.length ? own().in('id', leadIds) : null,
    apolloIds.length ? own().in('apollo_id', apolloIds).order('created_at', { ascending: true }) : null,
    apolloIds.length ? own().in('source_provider_id', apolloIds).order('created_at', { ascending: true }) : null,
  ]);
  if (reads.some(read => read?.error)) throw new Error('No se pudo leer a las personas del lote.');
  const byId = new Map<string, LeadRow>();
  const byProvider = new Map<string, LeadRow>();
  for (const read of reads) for (const lead of (read?.data || []) as LeadRow[]) {
    byId.set(lead.id, lead);
    for (const key of [lead.apollo_id, lead.source_provider_id]) if (key && !byProvider.has(key)) byProvider.set(key, lead);
  }
  return { byId, byProvider };
}

/** What each saved contact already has: an email or a lookup done or under way, and a research done or under way. */
async function loadProgress(client: Client, scope: Scope, leads: LeadRow[]) {
  const ids = leads.map(lead => lead.id);
  const providers = [...new Set(leads.flatMap(lead => [lead.apollo_id, lead.source_provider_id].filter((key): key is string => Boolean(key))))];
  const emailChecked = new Set(leads.filter(lead => text(lead.email)).map(lead => lead.id));
  const researched = new Set<string>();
  if (!ids.length) return { emailChecked, researched };
  const own = (table: string, fields: string) => client.from(table).select(fields).eq('user_id', scope.userId).eq('organization_id', scope.organizationId);
  const [bySaved, byProvider, research] = await Promise.all([
    own('enriched_leads', 'email,enrichment_status,data').filter('data->>sourceSavedLeadId', 'in', `(${ids.join(',')})`),
    providers.length ? own('enriched_leads', 'email,enrichment_status,source_provider_id').in('source_provider_id', providers) : null,
    own('lead_research_jobs', 'lead_id,status').in('lead_id', ids),
  ]);
  if (bySaved.error || byProvider?.error || research.error) throw new Error('No se pudo comprobar qué tiene ya cada persona.');
  const looked = (row: { email?: unknown; enrichment_status?: unknown }) => Boolean(text(row.email)) || LOOKUP_DONE.has(String(row.enrichment_status));
  for (const row of (bySaved.data || []) as Array<{ email?: unknown; enrichment_status?: unknown; data?: { sourceSavedLeadId?: unknown } | null }>) {
    if (looked(row) && typeof row.data?.sourceSavedLeadId === 'string') emailChecked.add(row.data.sourceSavedLeadId);
  }
  for (const row of (byProvider?.data || []) as Array<{ email?: unknown; enrichment_status?: unknown; source_provider_id?: unknown }>) {
    if (!looked(row)) continue;
    for (const lead of leads) if (row.source_provider_id && (lead.apollo_id === row.source_provider_id || lead.source_provider_id === row.source_provider_id)) emailChecked.add(lead.id);
  }
  for (const row of (research.data || []) as Array<{ lead_id?: unknown; status?: unknown }>) {
    if (typeof row.lead_id === 'string' && !RESEARCH_RETRY.has(String(row.status))) researched.add(row.lead_id);
  }
  return { emailChecked, researched };
}

/**
 * Stage the batch to propose: every person must be someone this conversation saw (a search result or a saved contact of the
 * person); what each one already has is read now and skipped, and the list is kept as the card will show it. Nothing runs here.
 * When nobody has anything left to do it says so, and the model moves on without asking for an approval.
 */
export async function stageCoworkPrepareBatch(scope: Scope, runId: string, input: unknown) {
  const { goal, people } = coworkPrepareBatchPeople(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const run = await client.from('cowork_runs').select('status').eq('id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (run.error || !run.data || (run.data.status !== 'running' && run.data.status !== 'waiting_approval')) throw new Error('El trabajo ya no admite propuestas.');
  const seen = await threadPeople(client, scope, runId);
  const unseen = people.filter(person => ('leadId' in person ? !seen.saved.has(person.leadId) : !seen.results.has(person.providerId)));
  if (unseen.length) throw new Error('Todas las personas del lote deben haberse visto antes en esta conversación: usa los ids de una búsqueda o de tus contactos consultados.');
  const leadIds = people.flatMap(person => ('leadId' in person ? [person.leadId] : []));
  const apolloIds = people.flatMap(person => ('providerId' in person ? [apolloKey(person.providerId)] : []));
  const leads = await loadOwnLeads(client, scope, leadIds, apolloIds);
  if (leadIds.some(id => !leads.byId.has(id))) throw new Error('Todas las personas del lote deben ser contactos guardados tuyos.');
  const savedRows = people.flatMap(person => {
    const lead = 'leadId' in person ? leads.byId.get(person.leadId) : leads.byProvider.get(apolloKey(person.providerId));
    return lead ? [lead] : [];
  });
  const progress = await loadProgress(client, scope, savedRows);
  const candidates: CoworkPrepareCandidate[] = [];
  const ids = new Set<string>();
  for (const person of people) {
    const lead = 'leadId' in person ? leads.byId.get(person.leadId)! : leads.byProvider.get(apolloKey(person.providerId));
    const row = 'providerId' in person ? seen.results.get(person.providerId)! : null;
    const id = lead?.id ?? coworkSavedContactId(scope.organizationId, scope.userId, (person as { providerId: string }).providerId);
    // The same person twice (as a search result and as a saved contact) goes once.
    if (ids.has(id)) continue;
    ids.add(id);
    const state: CoworkPrepareState = { saved: Boolean(lead), emailChecked: Boolean(lead && progress.emailChecked.has(lead.id)), researched: Boolean(lead && progress.researched.has(lead.id)) };
    candidates.push({
      id, ...(lead ? {} : { providerId: (person as { providerId: string }).providerId }),
      name: text(lead?.name ?? row?.name), company: text(lead?.company ?? row?.company), title: text(lead?.title ?? row?.title), state,
      ...(row && !lead ? { contact: { industry: text(row.industry), location: text(row.location), linkedinUrl: row.linkedin_url ?? null,
        companyWebsite: row.company_website ?? null, companyLinkedin: row.company_linkedin ?? null } } : {}),
    });
  }
  const plan = planCoworkPrepareBatch(goal, candidates);
  if (!plan.items.length) {
    const who = plan.ready.slice(0, 5).map(person => person.name || 'Sin nombre').join(', ');
    throw new Error(`No queda nada por hacer con ${plan.ready.length === 1 ? 'esa persona' : 'esas personas'} (${who}): ${plan.ready[0]?.reason || ''} `
      + 'No hace falta aprobar nada: sigue con el paso siguiente que pidió el usuario.');
  }
  const hash = hashCoworkPrepareBatch(runId, plan.items);
  const staged = await client.from('cowork_batch_proposals').upsert({
    run_id: runId, user_id: scope.userId, organization_id: scope.organizationId, kind: COWORK_PREPARE_BATCH_EFFECT,
    items: plan.items, deferred: plan.ready, patch_hash: hash,
  }, { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar el lote.');
  if (!staged.data) {
    const existing = await client.from('cowork_batch_proposals').select('patch_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.patch_hash !== hash) throw new Error('Este trabajo ya tiene otro lote propuesto.');
  }
  return { hash, label: coworkPrepareBatchLabel(plan.items), count: plan.items.length, ready: plan.ready.length, cost: coworkPrepareCost(plan.items) };
}

/**
 * The single actions check the same thing before asking for an approval: saving someone already saved, looking up an email
 * already looked up or researching someone already researched says so, and the model moves on instead (null when it is not done).
 */
export async function coworkEffectAlreadyDone(scope: Scope, kind: string, targetId: string): Promise<string | null> {
  if (kind !== 'save_contact' && kind !== 'enrich_contact' && kind !== 'start_research') return null;
  const client = getSupabaseAdminClient();
  const isSearchResult = kind === 'save_contact';
  if (isSearchResult ? !/^apollo:[A-Za-z0-9_-]{1,200}$/.test(targetId) : !z.string().uuid().safeParse(targetId).success) return null;
  const leads = await loadOwnLeads(client, scope, isSearchResult ? [] : [targetId], isSearchResult ? [apolloKey(targetId)] : []);
  const lead = isSearchResult ? leads.byProvider.get(apolloKey(targetId)) : leads.byId.get(targetId);
  if (!lead) return null;
  const name = text(lead.name) || 'Esa persona';
  const moveOn = 'No hace falta aprobar nada: sigue con el paso siguiente que pidió el usuario.';
  if (kind === 'save_contact') return `${name} ya está en tus contactos (leadId ${lead.id}). ${moveOn}`;
  const progress = await loadProgress(client, scope, [lead]);
  if (kind === 'enrich_contact' && progress.emailChecked.has(lead.id)) {
    return `${text(lead.email) ? `${name} ya tiene correo (${text(lead.email)})` : `El correo de ${name} ya se buscó`}: buscarlo de nuevo gasta otro crédito. ${moveOn}`;
  }
  if (kind === 'start_research' && progress.researched.has(lead.id)) {
    return `${name} ya tiene una investigación hecha o en curso: consúltala con research.get_existing en vez de pedir otra. ${moveOn}`;
  }
  return null;
}

/** The staged list of this run, when it is a batch to prepare contacts. */
export async function readStaged(client: Client, scope: Scope, runId: string) {
  const row = await client.from('cowork_batch_proposals').select('kind,items,deferred,excluded,patch_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) return null;
  const staged = row.data as unknown as Staged;
  return staged.kind === COWORK_PREPARE_BATCH_EFFECT ? staged : null;
}

/** What the approval card shows: each person with what will be done, who was already done and why, who was taken off, the cost and
 * what is left of the credits, and once it ran what happened to each person. `matches` is false when the list is not the proposed one. */
export async function readCoworkPrepareBatchPreview(auth: AuthContext, runId: string, targetId: string) {
  const client = getSupabaseAdminClient();
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const staged = await readStaged(client, scope, runId);
  if (!staged) return null;
  const matches = `preparebatch:${staged.patch_hash}` === String(targetId || '') && hashCoworkPrepareBatch(runId, staged.items) === staged.patch_hash;
  const proposal = await client.from('cowork_effect_proposals').select('status,result')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  const cost = coworkPrepareCost(staged.items);
  let balance: { remaining: number; stale: boolean } | null = null;
  if (cost.lookups) {
    try {
      const latest = await loadLatestApolloCreditBalance();
      if (latest) balance = { remaining: latest.remaining, stale: isApolloCreditBalanceStale(latest) };
    } catch { balance = null; }
  }
  const results = (proposal.data?.result as { items?: CoworkPrepareResult[] } | null)?.items;
  return {
    items: staged.items.map(({ contact: _contact, ...item }) => item), ready: staged.deferred || [], excluded: staged.excluded || [], matches,
    // Only a proposal that still awaits the decision lets people be taken off.
    open: proposal.data?.status === 'proposed', cost, balance,
    results: Array.isArray(results) ? results : null,
  };
}

/** The people the person took off the card, recorded before the approval. Only while the proposal awaits the decision (the table
 * refuses it otherwise, and an approval that arrives at the same time waits for this), and never the whole list. */
export async function setCoworkPrepareBatchExclusions(auth: AuthContext, runId: string, excluded: unknown) {
  const ids = z.array(z.string().uuid()).max(50).parse(excluded);
  if (new Set(ids).size !== ids.length) throw new CoworkPrepareRefusal('Hay personas repetidas.');
  const client = getSupabaseAdminClient();
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const staged = await readStaged(client, scope, runId);
  if (!staged) throw new CoworkPrepareRefusal('La propuesta ya no está disponible.');
  const known = new Set(staged.items.map(item => item.id));
  if (ids.some(id => !known.has(id))) throw new CoworkPrepareRefusal('Solo se puede quitar a personas del lote.');
  if (ids.length >= staged.items.length) throw new CoworkPrepareRefusal('Quitaste a todas las personas: descarta la propuesta en vez de aprobarla.');
  const updated = await client.from('cowork_batch_proposals').update({ excluded: ids })
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).select('run_id').maybeSingle();
  if (updated.error) {
    if (String((updated.error as { code?: string }).code) === '23514') throw new CoworkPrepareRefusal('Esta propuesta ya se decidió: no se puede cambiar a quién va.');
    throw new Error('No se pudo guardar a quién quitaste.');
  }
  if (!updated.data) throw new CoworkPrepareRefusal('La propuesta ya no está disponible.');
  return { excluded: ids };
}
