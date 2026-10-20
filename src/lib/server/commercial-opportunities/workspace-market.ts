import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { planKeywords } from '@/lib/commercial-opportunities/purchase-plan';
import { opportunityLocalClock, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { contractEndsOn, likePatterns, normalizeRut, tenderUrl } from '@/lib/public-procurement/market';
import { contractOpportunityDraft, contractsWindow, humanDay, type ExpiringContract } from '@/lib/public-procurement/contracts';
import { CONTRACTS_SCREEN_BATCH, contractsScreenPrompt, contractsScreenSchema, resolveWinPlan, winPlanPrompt, winPlanSchema, type WinPlan } from '@/lib/public-procurement/win-plan';
import { readAgencyHistory, readMarketCoverage, readSupplierProfile, searchSuppliers, suggestCompetitors, type AgencyHistory } from '@/lib/server/public-procurement/market';
import { assertOpportunityAdmin, assertOpportunityRead } from './workspace-access';
import { addOpportunityActivity, createPrivateOpportunity, opportunityDb } from './workspace-store';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { loadCompanyForModel, loadTenderProfile } from './tender-profile-read';

/** The kinds with a public buyer whose history ChileCompra keeps. */
export const MARKET_KINDS = ['tender', 'compra_agil'];
const ACTIVE = ['queued', 'running', 'waiting'];
const BLOCKED_RETRY_MS = 6 * 3600_000;
type JobRow = { id: string; state: string; error: string | null; created_at: string; updated_at: string; result: any };

// ─── «Cómo ganar» (propuesta 9) ────────────────────────────────────────────────────────────────────────────────────

/** What the report says about how the offer is scored and what it needs, for the strategy. */
export function reportForWinPlan(report: OpportunityReport | null | undefined) {
  if (!report) return null;
  const scoring = (report.sections || []).filter(section => /evalu|puntaje|ganar/i.test(`${section.id} ${section.title}`))
    .flatMap(section => section.paragraphs).map(text => text.replace(/\s+/g, ' ').trim().slice(0, 500)).filter(Boolean).slice(0, 6);
  return {
    criteria: scoring,
    requirements: (report.requirements || []).map(item => item.title.replace(/\s+/g, ' ').trim().slice(0, 200)).slice(0, 12),
    risks: (report.risks || []).map(item => item.title.replace(/\s+/g, ' ').trim().slice(0, 200)).slice(0, 6),
  };
}

/** «Este organismo» and «Cómo ganar» of one opportunity: the buyer's history, the latest strategy and the one in course. */
export async function readOpportunityMarket(client: SupabaseClient, scope: WorkScope, id: string) {
  await assertOpportunityRead(client, scope, id);
  const item = opportunityDb(await client.from('commercial_opportunities').select('kind,title,buyer_name,company_name')
    .eq('organization_id', scope.organizationId).eq('id', id).single());
  if (!item || !MARKET_KINDS.includes(item.kind)) return { applicable: false as const };
  const [history, jobs] = await Promise.all([
    readAgencyHistory(client, { title: item.title, buyerName: item.buyer_name || item.company_name }),
    client.from('opportunity_jobs').select('id,state,error,created_at,updated_at,result').eq('organization_id', scope.organizationId)
      .eq('opportunity_id', id).eq('kind', 'winplan').order('created_at', { ascending: false }).limit(5),
  ]);
  // Before the migration that brings the «winplan» kind, there is simply no strategy yet.
  const rows = (jobs.error ? [] : jobs.data || []) as JobRow[];
  const ready = rows.find(row => row.state === 'ready' && row.result?.plan);
  const latest = rows[0] ?? null;
  return {
    applicable: true as const, history,
    plan: ready ? { jobId: ready.id, createdAt: ready.updated_at, plan: ready.result.plan as WinPlan, basis: ready.result.basis ?? null } : null,
    job: latest ? { id: latest.id, state: latest.state, error: latest.error, createdAt: latest.created_at } : null,
  };
}

/** Queues the strategy; `requestId` comes from the click, so a double click asks once and «Preparar de nuevo» asks again. */
export async function enqueueWinPlan(client: SupabaseClient, scope: WorkScope, id: string, input: { requestId: string }) {
  await assertOpportunityRead(client, scope, id);
  const item = opportunityDb(await client.from('commercial_opportunities').select('kind').eq('organization_id', scope.organizationId).eq('id', id).single());
  if (!MARKET_KINDS.includes(item?.kind)) throw new AuthError('«Cómo ganar» es para licitaciones y Compra Ágil.', 400);
  if (!(await readMarketCoverage(client)).available) throw new AuthError('Aún no cargamos el historial de ChileCompra. Vuelve a intentarlo más tarde.', 409);
  const key = `winplan:${id}:${input.requestId}`;
  const row = opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, opportunity_id: id, requested_by: scope.userId,
    kind: 'winplan', dedupe_key: key, payload: {} }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }).select('id').maybeSingle());
  if (row?.id) return row.id as string;
  const found = opportunityDb(await client.from('opportunity_jobs').select('id').eq('organization_id', scope.organizationId).eq('dedupe_key', key).single());
  if (!found) throw new AuthError('No se pudo recuperar el trabajo.', 503);
  return found.id as string;
}

/** The history the strategy rested on, kept with it: the data changes every month, the plan says what it read. */
function historyBasis(history: AgencyHistory) {
  return {
    agency: history.agency?.name ?? null, similar: history.similar.length, market: history.market?.similar.length ?? 0,
    deserted: history.agencyStats?.deserted ?? 0, medianBidders: history.agencyStats?.medianBidders ?? history.market?.stats.medianBidders ?? null,
    coverage: { from: history.coverage.from, to: history.coverage.to },
  };
}

export async function runWinPlan(client: SupabaseClient, job: OpportunityJob) {
  const scope: WorkScope = { organizationId: job.organization_id, userId: job.requested_by };
  const id = job.opportunity_id!;
  await assertOpportunityRead(client, scope, id);
  const [itemRow, contextRow, reportRow] = await Promise.all([
    client.from('commercial_opportunities').select('kind,title,buyer_name,company_name,deadline_at,amount,currency,data').eq('organization_id', job.organization_id).eq('id', id).single(),
    client.from('opportunity_company_context').select('offer,services').eq('organization_id', job.organization_id).maybeSingle(),
    client.from('opportunity_reports').select('report').eq('organization_id', job.organization_id).eq('opportunity_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const item = opportunityDb(itemRow); const context = opportunityDb(contextRow); const saved = opportunityDb(reportRow);
  if (!item) throw new AuthError('No encontramos esa oportunidad.', 404);
  const history = await readAgencyHistory(client, { title: item.title, buyerName: item.buyer_name || item.company_name });
  if (!history.available) throw new AuthError('Aún no cargamos el historial de ChileCompra. Vuelve a intentarlo más tarde.', 409);
  if (!history.similar.length && !history.market?.similar.length)
    throw new AuthError('No encontramos licitaciones parecidas en el historial de ChileCompra para comparar. La estrategia necesita al menos una.', 422);
  const ficha = await loadCompanyForModel(client, job.organization_id);
  const description = String(item.data?.observed?.description || item.data?.description || '');
  const estimate = item.amount && (!item.currency || item.currency === 'CLP') ? Number(item.amount) : null;
  const prompt = winPlanPrompt({
    tender: { title: item.title, buyer: item.buyer_name || item.company_name, amount: item.amount, currency: item.currency, deadline: item.deadline_at, description },
    report: reportForWinPlan(saved?.report as OpportunityReport | undefined),
    history,
    company: { offer: String(context?.offer || ''), ficha },
  });
  const answer = await opportunityGenerate(client, job, { step: `winplan:${createHash('sha256').update(prompt).digest('hex').slice(0, 40)}`, category: 'research', role: 'report',
    schema: winPlanSchema, output: 5000, prompt });
  const plan = resolveWinPlan(answer, history, estimate);
  await addOpportunityActivity(client, scope, id, 'winplan', 'Estrategia «Cómo ganar» preparada con el historial de ChileCompra', { jobId: job.id }, `winplan:${job.id}`).catch(() => undefined);
  return { plan, basis: historyBasis(history) };
}

// ─── «Contratos por vencer» (propuesta 11) ─────────────────────────────────────────────────────────────────────────

/** Once a month with the daily search, once the history is loaded and the workspace has its words. */
export async function enqueueMonthlyContracts(client: SupabaseClient, scope: WorkScope, context: { revision: number; criteria?: any; services?: string[] | null }, day: string) {
  if (!planKeywords({ keywords: context.criteria?.keywords, services: context.services }).length) return;
  if (!(await readMarketCoverage(client)).available) return;
  const key = `contracts:${day.slice(0, 7)}:${context.revision}`;
  const queued = await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'contracts',
    dedupe_key: key, payload: { revision: context.revision } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true });
  // A database without the «contracts» kind yet leaves the search of the day as it was.
  if (queued.error?.code === '23514') return;
  opportunityDb(queued);
  // The month's reading that stopped blocked (the history did not answer) tries again, as «Demanda futura»: at most every 6
  // hours, because the search is asked every minute and a history that keeps failing should not be read every minute.
  const blocked = opportunityDb(await client.from('opportunity_jobs').select('id,updated_at').eq('organization_id', scope.organizationId)
    .eq('dedupe_key', key).eq('state', 'blocked').maybeSingle());
  if (blocked && !(Date.parse(blocked.updated_at) > Date.now() - BLOCKED_RETRY_MS))
    opportunityDb(await client.from('opportunity_jobs').update({ state: 'queued', error: null }).eq('id', blocked.id).eq('state', 'blocked'));
}

/** «Actualizar»: a reading of its own each time it is asked, unless one is under way. */
export async function enqueueMarketContracts(client: SupabaseClient, scope: WorkScope) {
  assertOpportunityAdmin(scope);
  const context = opportunityDb(await client.from('opportunity_company_context').select('revision,criteria,services').eq('organization_id', scope.organizationId).maybeSingle());
  if (!context) throw new AuthError('Confirma primero la oferta del workspace.', 409);
  if (!planKeywords({ keywords: context.criteria?.keywords, services: context.services }).length)
    throw new AuthError('Faltan las palabras para compras públicas: revísalas en «Qué buscamos».', 409);
  if (!(await readMarketCoverage(client)).available) throw new AuthError('Aún no cargamos el historial de ChileCompra. Vuelve a intentarlo más tarde.', 409);
  const active = opportunityDb(await client.from('opportunity_jobs').select('id').eq('organization_id', scope.organizationId).eq('kind', 'contracts')
    .in('state', ACTIVE).limit(1).maybeSingle());
  if (active?.id) return active.id as string;
  const row = opportunityDb(await client.from('opportunity_jobs').insert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'contracts',
    dedupe_key: `contracts:manual:${opportunityLocalClock().day}:${randomUUID()}`, payload: { revision: context.revision } }).select('id').single());
  if (!row) throw new AuthError('No se pudo recuperar el trabajo.', 503);
  return row.id as string;
}

type ExpiringRow = { tender_id: number; code: string; name: string; agency: string | null; region: string | null; category: string | null; awarded_on: string | null;
  duration_months: number | string | null; ends_on: string | null; amount: number | null; currency: string | null; winner_rut: string | null; winner_name: string | null; winners: number };

/** The reading: contracts in force that end in the window and say the workspace's words, screened by the model in batches. */
export async function runMarketContracts(client: SupabaseClient, job: OpportunityJob, context: any, started: number) {
  const keywords = planKeywords({ keywords: context.criteria?.keywords, services: context.services });
  const patterns = likePatterns(keywords, 25);
  if (!patterns.length) throw new AuthError('Faltan las palabras para compras públicas: revísalas en «Qué buscamos».', 409);
  const window = contractsWindow();
  const { data, error } = await client.rpc('public_procurement_expiring', { p_from: window.from, p_to: window.to, p_patterns: patterns, p_limit: 600 });
  // Without the function the history was never set up; anything else (a timeout) passes. Either way the job stops blocked,
  // and the next daily search runs it again (enqueueMonthlyContracts).
  if (error) throw new AuthError(['PGRST202', '42883', '42P01'].includes(String(error.code))
    ? 'Aún no cargamos el historial de ChileCompra. Vuelve a intentarlo más tarde.'
    : 'No pudimos leer el historial de ChileCompra ahora. Vuelve a intentarlo en unos minutos.', 409);
  const rows = (data || []) as ExpiringRow[];
  const offer = { offer: String(context.offer || ''), services: context.services || [], exclusions: context.exclusions || [], territories: context.territories || [] };
  const kept = new Map<string, { fit: 'alta' | 'media'; reason: string }>();
  for (let offset = 0; offset < rows.length; offset += CONTRACTS_SCREEN_BATCH) {
    if (Date.now() - started > 200_000) return { waiting: true as const };
    const batch = rows.slice(offset, offset + CONTRACTS_SCREEN_BATCH);
    const ids = new Set(batch.map(row => String(row.tender_id)));
    const step = `contracts:${createHash('sha256').update(batch.map(row => row.tender_id).join('|')).digest('hex').slice(0, 32)}`;
    const answer = await opportunityGenerate(client, job, { step, category: 'evaluation', role: 'screen', schema: contractsScreenSchema, output: 6000,
      prompt: contractsScreenPrompt(offer, batch.map(row => ({ id: String(row.tender_id), name: row.name, agency: row.agency, category: row.category, region: row.region }))) });
    for (const match of answer.matches) if (ids.has(match.id.trim())) kept.set(match.id.trim(), { fit: match.fit, reason: match.reason.replace(/\s+/g, ' ').trim().slice(0, 300) });
  }
  const contracts: ExpiringContract[] = rows.filter(row => kept.has(String(row.tender_id))).map(row => ({
    tenderId: Number(row.tender_id), code: row.code, name: row.name, agency: row.agency, region: row.region, category: row.category, awardedOn: row.awarded_on,
    durationMonths: row.duration_months === null ? null : Number(row.duration_months), endsOn: row.ends_on ?? contractEndsOn(row.awarded_on, Number(row.duration_months)),
    amount: row.amount === null ? null : Number(row.amount), currency: row.currency, winnerRut: row.winner_rut, winnerName: row.winner_name, winners: Number(row.winners || 0),
    ...kept.get(String(row.tender_id))!,
  }));
  return { waiting: false as const, window, read: rows.length, contracts };
}

/** What «Contratos por vencer» shows: the latest reading that finished, and the one under way or that stopped, if any. */
export async function readMarketContracts(client: SupabaseClient, scope: WorkScope) {
  assertOpportunityAdmin(scope);
  const [coverage, jobs] = await Promise.all([
    readMarketCoverage(client),
    client.from('opportunity_jobs').select('id,state,error,created_at,updated_at,result').eq('organization_id', scope.organizationId).eq('kind', 'contracts')
      .order('created_at', { ascending: false }).limit(6),
  ]);
  const rows = (jobs.error ? [] : jobs.data || []) as JobRow[];
  const ready = rows.find(row => row.state === 'ready' && Array.isArray(row.result?.contracts));
  const job = rows.find(row => ACTIVE.includes(row.state)) ?? rows[0] ?? null;
  return {
    available: coverage.available && !jobs.error, coverage,
    updatedAt: ready?.updated_at ?? null, read: ready?.result?.read ?? 0, window: ready?.result?.window ?? null,
    contracts: (ready?.result?.contracts || []) as ExpiringContract[],
    job: job ? { id: job.id, state: job.state, error: job.error, createdAt: job.created_at, updatedAt: job.updated_at } : null,
  };
}

const stableUuid = (text: string) => {
  const hex = createHash('sha256').update(text).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** «Seguir»: the contract that ends becomes an opportunity of the pipeline, once per workspace. */
export async function followExpiringContract(client: SupabaseClient, scope: WorkScope, tenderId: number) {
  assertOpportunityAdmin(scope);
  const view = await readMarketContracts(client, scope);
  const contract = view.contracts.find(item => item.tenderId === tenderId);
  if (!contract) throw new AuthError('Ese contrato ya no está en la lista. Actualiza la vista.', 404);
  const draft = contractOpportunityDraft(contract);
  return createPrivateOpportunity(client, scope, { ...draft, requestId: stableUuid(`contract:${scope.organizationId}:${contract.code}`), url: tenderUrl(contract.code), deadline: null },
    { reason: `Contrato de ${contract.agency || 'un organismo público'} que vence${contract.endsOn ? ` cerca del ${humanDay(contract.endsOn)}` : ''}`, origin: 'expiring_contract',
      documentName: 'Contrato por vencer.txt', dedupeKey: `contract:${contract.code}`, activity: 'Oportunidad agregada desde «Contratos por vencer»' });
}

// ─── Radar de competidores (propuesta 10) ──────────────────────────────────────────────────────────────────────────

const monthsAgo = (now: Date, months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)).toISOString().slice(0, 10);

type RecentBid = { supplierId: number; code: string; name: string; agency: string | null; publishedOn: string | null; status: string; won: boolean; amount: number | null; currency: string | null };

/** What the followed competitors did in the last 12 months: bids, wins, pesos won and their latest moves. */
async function competitorActivity(client: SupabaseClient, supplierIds: number[], now: Date) {
  if (!supplierIds.length) return new Map<number, { bids: number; wins: number; awarded: number; recent: RecentBid[] }>();
  const since = monthsAgo(now, 12);
  const { data, error } = await client.from('public_procurement_bids')
    .select('supplier_id,selected,offered_amount,awarded_amount,tender:public_procurement_tenders!inner(code,name,status,currency,published_on,agency:public_procurement_agencies(name))')
    .in('supplier_id', supplierIds).gte('tender.published_on', since).limit(5000);
  if (error) throw error;
  const out = new Map<number, { bids: number; wins: number; awarded: number; recent: RecentBid[] }>();
  for (const row of (data || []) as any[]) {
    const entry = out.get(row.supplier_id) || { bids: 0, wins: 0, awarded: 0, recent: [] };
    entry.bids++;
    if (row.selected) { entry.wins++; if (row.tender.currency === 'CLP') entry.awarded += Number(row.awarded_amount || 0); }
    entry.recent.push({ supplierId: row.supplier_id, code: row.tender.code, name: row.tender.name, agency: row.tender.agency?.name ?? null, publishedOn: row.tender.published_on,
      status: row.tender.status, won: Boolean(row.selected), amount: row.selected ? row.awarded_amount ?? null : row.offered_amount ?? null, currency: row.tender.currency });
    out.set(row.supplier_id, entry);
  }
  for (const entry of out.values()) entry.recent = entry.recent.sort((a, b) => String(b.publishedOn || '').localeCompare(String(a.publishedOn || ''))).slice(0, 5);
  return out;
}

/** The radar: the competitors the workspace follows with what they did, the company itself, and who else to watch. */
export async function readCompetitorRadar(client: SupabaseClient, scope: WorkScope, now = new Date()) {
  assertOpportunityAdmin(scope);
  const [coverage, followedRows, context, profile] = await Promise.all([
    readMarketCoverage(client),
    client.from('opportunity_competitors').select('supplier_id,created_at,supplier:public_procurement_suppliers(id,rut,name)').eq('organization_id', scope.organizationId)
      .order('created_at', { ascending: true }),
    client.from('opportunity_company_context').select('criteria,services').eq('organization_id', scope.organizationId).maybeSingle(),
    loadTenderProfile(client, scope.organizationId).catch(() => null),
  ]);
  if (!coverage.available || followedRows.error) return { available: false as const, coverage };
  const followed = ((followedRows.data || []) as any[]).filter(row => row.supplier).map(row => ({ id: Number(row.supplier.id), rut: String(row.supplier.rut), name: String(row.supplier.name) }));
  const ownRut = profile?.rut ? normalizeRut(profile.rut) : null;
  const words = planKeywords({ keywords: opportunityDb(context)?.criteria?.keywords, services: opportunityDb(context)?.services });
  const suggestion = await suggestCompetitors(client, { ownRut, words }, now);
  const ids = [...new Set([...followed.map(row => row.id), ...(suggestion.own ? [suggestion.own.id] : [])])];
  const activity = await competitorActivity(client, ids, now);
  const followedIds = new Set(followed.map(row => row.id));
  return {
    available: true as const, coverage,
    own: suggestion.own ? { ...suggestion.own, ...(activity.get(suggestion.own.id) || { bids: 0, wins: 0, awarded: 0, recent: [] }) } : null,
    ownRutMissing: !ownRut,
    followed: followed.map(row => ({ ...row, ...(activity.get(row.id) || { bids: 0, wins: 0, awarded: 0, recent: [] }) })),
    suggestions: { basis: suggestion.basis, items: suggestion.items.filter(item => !followedIds.has(item.id) && item.id !== suggestion.own?.id).slice(0, 8),
      ...('unavailable' in suggestion ? { unavailable: true } : {}) },
  };
}

export async function searchCompetitors(client: SupabaseClient, scope: WorkScope, query: string) {
  assertOpportunityAdmin(scope);
  return searchSuppliers(client, query);
}

export async function readCompetitor(client: SupabaseClient, scope: WorkScope, supplierId: number) {
  assertOpportunityAdmin(scope);
  const profile = await readSupplierProfile(client, supplierId);
  if (!profile) throw new AuthError('No encontramos a ese proveedor en el historial de ChileCompra.', 404);
  return profile;
}

export async function followCompetitor(client: SupabaseClient, scope: WorkScope, supplierId: number, follow: boolean) {
  assertOpportunityAdmin(scope);
  if (!follow) {
    opportunityDb(await client.from('opportunity_competitors').delete().eq('organization_id', scope.organizationId).eq('supplier_id', supplierId));
    return { following: false };
  }
  const { count, error } = await client.from('opportunity_competitors').select('supplier_id', { count: 'exact', head: true }).eq('organization_id', scope.organizationId);
  if (error) opportunityDb({ data: null, error });
  if ((count ?? 0) >= 30) throw new AuthError('Puedes seguir hasta 30 competidores. Deja de seguir alguno para agregar otro.', 409);
  const saved = await client.from('opportunity_competitors').upsert({ organization_id: scope.organizationId, supplier_id: supplierId, added_by: scope.userId },
    { onConflict: 'organization_id,supplier_id', ignoreDuplicates: true });
  if (saved.error?.code === '23503') throw new AuthError('No encontramos a ese proveedor en el historial de ChileCompra.', 404);
  opportunityDb(saved);
  return { following: true };
}
