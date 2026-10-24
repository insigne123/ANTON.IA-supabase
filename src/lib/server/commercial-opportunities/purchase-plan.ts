import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { PLAN_SCREEN_BATCH, PlanCandidates, planKeywords, planOpportunityDraft, planScreenPrompt, planScreenSchema, purchasePlanLine, purchasePlanReader, purchasePlanUrl,
  type PurchasePlanLine, type PurchasePlanMatch } from '@/lib/commercial-opportunities/purchase-plan';
import { OPPORTUNITY_BUCKET, opportunityLocalClock, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { assertOpportunityAdmin } from './workspace-access';
import { createPrivateOpportunity, opportunityDb } from './workspace-store';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { STEPS_AT_ONCE } from '@/lib/commercial-opportunities/model-policy';

const TABLE = 'opportunity_purchase_plan';
const MAX_ZIP_BYTES = 60 * 1024 * 1024;

type Fetch = typeof fetch;
/** A copy of a year's plan, as the texts of its parts in order, or null when there is none. */
export type PlanMirror = (year: number) => Promise<AsyncIterable<string> | null>;

/** Where the copy of a year's plan lives: CSV parts under 15 MB (the bucket takes CSV up to 20 MB), header in the first. */
export const planMirrorFolder = (year: number) => `public-data/purchase-plan/${year}`;
const MIRROR_PART = /^part-\d{3}\.csv$/;

/**
 * The copy in Storage, for when ChileCompra does not let the server download the file: its CloudFront blocks Google Cloud
 * networks, where App Hosting runs («Request blocked», 18 Oct 2026). `scripts/mirror-purchase-plan.mjs` refreshes it.
 */
export function storagePlanMirror(client: SupabaseClient): PlanMirror {
  return async year => {
    const bucket = client.storage.from(OPPORTUNITY_BUCKET);
    const { data, error } = await bucket.list(planMirrorFolder(year), { limit: 100, sortBy: { column: 'name', order: 'asc' } });
    const names = error ? [] : (data || []).map(file => file.name).filter(name => MIRROR_PART.test(name)).sort();
    if (!names.length) return null;
    return (async function* parts() {
      for (const name of names) {
        const { data: blob, error: failed } = await bucket.download(`${planMirrorFolder(year)}/${name}`);
        if (failed || !blob) throw new AuthError('No pudimos leer la copia del Plan Anual de Compras. Lo intentaremos de nuevo.', 503);
        yield await blob.text();
      }
    })();
  };
}

/** ChileCompra does not let the server download the file, and there is no copy of that year. */
export class PlanBlockedError extends AuthError {
  constructor(year: number) { super(`ChileCompra no deja descargar el Plan Anual de Compras ${year} desde nuestro servidor y aún no tenemos una copia. Lo estamos resolviendo.`, 503); }
}

/**
 * Reads a year's plan as a stream, keeping only the candidates: the whole file never sits in memory as text. From
 * ChileCompra (a ZIP of about 7 MB with one CSV of about 40 MB) or, when ChileCompra blocks the download or fails, from the
 * copy. Null when the year is not published yet: S3 answers «AccessDenied» for a file that does not exist, while a
 * blocked network gets CloudFront's «Request blocked».
 */
export async function readPurchasePlanCandidates(year: number, keywords: string[], dependencies: { fetch?: Fetch; mirror?: PlanMirror } = {}) {
  const candidates = new PlanCandidates(keywords);
  const seen = new Map<string, number>();
  let read = 0; let empty = 0;
  const parser = purchasePlanReader(row => {
    const line = purchasePlanLine(row, seen);
    if (!line) { empty++; return; }
    read++; candidates.offer(line);
  });
  const response = await (dependencies.fetch ?? fetch)(purchasePlanUrl(year), { signal: AbortSignal.timeout(90_000) });
  let source: 'chilecompra' | 'copia' = 'chilecompra';
  if (response.ok) {
    const size = Number(response.headers.get('content-length') || 0);
    if (size > MAX_ZIP_BYTES) throw new AuthError('El archivo del Plan Anual de Compras es más grande de lo esperado.', 422);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ZIP_BYTES) throw new AuthError('El archivo del Plan Anual de Compras es más grande de lo esperado.', 422);
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const file = Object.values(zip.files).find(entry => !entry.dir && /\.csv$/i.test(entry.name));
    if (!file) throw new AuthError('El archivo de ChileCompra no trae el plan en CSV.', 422);
    const stream = file.nodeStream('nodebuffer') as unknown as Readable;
    stream.setEncoding('utf8');
    // JSZip's stream is an older Readable without async iteration; setEncoding keeps a character split across chunks whole.
    await new Promise<void>((resolve, reject) => {
      stream.on('data', chunk => parser.write(String(chunk)));
      stream.on('end', () => resolve()); stream.on('error', reject);
    });
  } else {
    const body = await response.text().catch(() => '');
    const blocked = /request blocked/i.test(body) || (response.status === 403 && /cloudfront/i.test(response.headers.get('server') || ''));
    if (!blocked && (response.status === 404 || response.status === 403)) return null;
    const copy = await (dependencies.mirror ?? (async () => null))(year);
    if (!copy) {
      if (blocked) throw new PlanBlockedError(year);
      throw new AuthError('No pudimos descargar el Plan Anual de Compras de ChileCompra. Lo intentaremos de nuevo.', 503);
    }
    source = 'copia';
    for await (const text of copy) parser.write(text);
  }
  parser.end();
  if (!parser.known || !read) throw new AuthError('El archivo del Plan Anual de Compras cambió de formato: no pudimos leer sus líneas.', 422);
  return { year, source, read, skipped: parser.skipped + empty, candidates: candidates.list().map(item => item.line) };
}

/**
 * The month's reading, queued with the daily search once the workspace has its words. Once a month (its key carries the
 * month); one that stopped blocked (ChileCompra blocking with no copy yet, no budget left) tries again with the search, at
 * most every 6 hours.
 */
export async function enqueueMonthlyDemand(client: SupabaseClient, scope: WorkScope, context: { revision: number; criteria?: any; services?: string[] | null }, day: string) {
  if (!planKeywords({ keywords: context.criteria?.keywords, services: context.services }).length) return;
  const key = `demand:${day.slice(0, 7)}:${context.revision}`;
  const queued = await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'demand',
    dedupe_key: key, payload: { revision: context.revision } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true });
  // A database without the «demand» kind yet (its migration comes first) leaves the search of the day as it was.
  if (queued.error?.code === '23514') return;
  opportunityDb(queued);
  // At most every 6 hours: the search is asked every minute, and a blocked ChileCompra should not be asked every minute.
  const blocked = opportunityDb(await client.from('opportunity_jobs').select('id,updated_at').eq('organization_id', scope.organizationId)
    .eq('dedupe_key', key).eq('state', 'blocked').maybeSingle());
  if (blocked && !(Date.parse(blocked.updated_at) > Date.now() - 6 * 3600_000))
    opportunityDb(await client.from('opportunity_jobs').update({ state: 'queued', error: null }).eq('id', blocked.id).eq('state', 'blocked'));
}

/** The year to read: this year, or the last one published (early in the year the new plan may not be out). */
export function planYear(now = new Date()) { return Number(opportunityLocalClock(now).day.slice(0, 4)); }

/**
 * Queues a reading. Once a month on its own (with the daily search), and when an admin asks («Actualizar»). Asked again the
 * same day, a reading under way is the same one; one that stopped for a reason that may have passed (ChileCompra blocked,
 * no budget left) runs again, and a finished one gives way to a new one, as a report does (workspace-research.ts).
 */
export async function enqueueOpportunityDemand(client: SupabaseClient, scope: WorkScope, manual: boolean) {
  assertOpportunityAdmin(scope);
  const context = opportunityDb(await client.from('opportunity_company_context').select('revision,criteria,services').eq('organization_id', scope.organizationId).maybeSingle());
  if (!context) throw new AuthError('Confirma primero la oferta de tu empresa.', 409);
  if (!planKeywords({ keywords: context.criteria?.keywords, services: context.services }).length)
    throw new AuthError('Faltan las palabras para compras públicas: revísalas en «Qué buscamos».', 409);
  const day = opportunityLocalClock().day;
  const key = manual ? `demand:manual:${day}:${context.revision}` : `demand:${day.slice(0, 7)}:${context.revision}`;
  const payload = { revision: context.revision };
  const row = opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'demand',
    dedupe_key: key, payload }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }).select('id').maybeSingle());
  if (row?.id || !manual) return row?.id ?? null;
  const found = opportunityDb(await client.from('opportunity_jobs').select('id,state').eq('organization_id', scope.organizationId).eq('dedupe_key', key).maybeSingle());
  if (!found || ['queued', 'running', 'waiting'].includes(found.state)) return found?.id ?? null;
  if (found.state === 'blocked') {
    opportunityDb(await client.from('opportunity_jobs').update({ state: 'queued', error: null }).eq('id', found.id).eq('organization_id', scope.organizationId).eq('state', 'blocked'));
    return found.id;
  }
  // A failed job keeps its uncertain paid step reserved, and a finished one its result: the new reading is a job of its own.
  // An active one is reused, so a double click does not read twice.
  const active = opportunityDb(await client.from('opportunity_jobs').select('id').eq('organization_id', scope.organizationId).eq('kind', 'demand')
    .like('dedupe_key', `${key}:retry:%`).in('state', ['queued', 'running', 'waiting']).limit(1).maybeSingle());
  if (active?.id) return active.id as string;
  const retry = opportunityDb(await client.from('opportunity_jobs').insert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'demand',
    dedupe_key: `${key}:retry:${randomUUID()}`, payload }).select('id').single());
  if (!retry) throw new AuthError('No se pudo recuperar el trabajo.', 503);
  return retry.id as string;
}

/**
 * The reading: the candidates of the file (kept in a snapshot, so a job that resumes does not download again), the model's
 * screening in batches (each batch is a paid step that comes back on a retry) and the lines kept, replacing the last
 * reading of that year. Resumes in the next tick when its time runs out.
 */
export async function runOpportunityDemand(client: SupabaseClient, job: OpportunityJob, context: any, started: number,
  dependencies: { fetch?: Fetch; mirror?: PlanMirror } = {}) {
  const keywords = planKeywords({ keywords: context.criteria?.keywords, services: context.services });
  if (!keywords.length) throw new AuthError('Faltan las palabras para compras públicas: revísalas en «Qué buscamos».', 409);
  type Snapshot = { year: number; source?: 'chilecompra' | 'copia'; read: number; skipped: number; lines: PurchasePlanLine[] };
  let snapshot = opportunityDb(await client.from('opportunity_source_snapshots').select('candidates').eq('job_id', job.id).eq('organization_id', job.organization_id).maybeSingle())?.candidates as Snapshot | undefined;
  if (!snapshot) {
    const year = planYear();
    const reading = { fetch: dependencies.fetch, mirror: dependencies.mirror ?? storagePlanMirror(client) };
    // This year's plan, or last year's while the new one is not out (or is blocked with no copy yet).
    let blocked: PlanBlockedError | null = null;
    const read = async (from: number) => {
      try { return await readPurchasePlanCandidates(from, keywords, reading); }
      catch (failure) { if (failure instanceof PlanBlockedError) { blocked ??= failure; return null; } throw failure; }
    };
    const found = await read(year) ?? await read(year - 1);
    if (!found) throw blocked ?? new AuthError('ChileCompra aún no publica el Plan Anual de Compras.', 409);
    snapshot = { year: found.year, source: found.source, read: found.read, skipped: found.skipped, lines: found.candidates };
    opportunityDb(await client.from('opportunity_source_snapshots').insert({ job_id: job.id, organization_id: job.organization_id, candidates: snapshot }));
    // Downloading and reading took its share of the tick: the screening starts with a fresh one.
    if (Date.now() - started > 60_000) return { waiting: true as const };
  }
  const kept = new Map<string, { fit: 'alta' | 'media'; reason: string }>();
  const offer = { offer: String(context.offer || ''), services: context.services || [], exclusions: context.exclusions || [] };
  // Four batches at a time: one by one, a whole plan took hours. A group starts while its slowest call still ends inside the route.
  const lines = snapshot.lines, year = snapshot.year;
  for (let offset = 0; offset < lines.length; offset += PLAN_SCREEN_BATCH * STEPS_AT_ONCE) {
    if (Date.now() - started > 150_000) return { waiting: true as const };
    const batches = Array.from({ length: Math.min(STEPS_AT_ONCE, Math.ceil((lines.length - offset) / PLAN_SCREEN_BATCH)) },
      (_, index) => lines.slice(offset + index * PLAN_SCREEN_BATCH, offset + (index + 1) * PLAN_SCREEN_BATCH));
    const outcomes = await Promise.allSettled(batches.map(batch => opportunityGenerate(client, job, {
      step: `plan:${year}:${createHash('sha256').update(batch.map(line => line.lineId).join('|')).digest('hex').slice(0, 32)}`,
      category: 'evaluation', role: 'screen', schema: planScreenSchema, output: 8000, prompt: planScreenPrompt(offer, batch) })));
    // Every call ends before the job does; the first failure, in the plan's order, is the job's.
    const failed = outcomes.find(outcome => outcome.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    outcomes.forEach((outcome, index) => {
      if (outcome.status !== 'fulfilled') return;
      const ids = new Set(batches[index].map(line => line.lineId));
      for (const match of outcome.value.matches)
        if (ids.has(match.id.trim())) kept.set(match.id.trim(), { fit: match.fit, reason: match.reason.replace(/\s+/g, ' ').trim().slice(0, 300) });
    });
  }
  const rows = snapshot.lines.filter(line => kept.has(line.lineId)).map(line => ({ organization_id: job.organization_id, year: snapshot!.year, line_id: line.lineId, run_id: job.id,
    institution: line.institution, institution_code: line.institutionCode, product_code: line.productCode, description: line.description, quantity: line.quantity,
    unit_amount: line.unitAmount, amount: line.amount, month: line.month, quarter: line.quarter, fit: kept.get(line.lineId)!.fit, reason: kept.get(line.lineId)!.reason }));
  for (let offset = 0; offset < rows.length; offset += 500)
    opportunityDb(await client.from(TABLE).upsert(rows.slice(offset, offset + 500), { onConflict: 'organization_id,year,line_id' }));
  // The lines of the previous reading that this one did not keep go away; the kept ones were rewritten with this run.
  opportunityDb(await client.from(TABLE).delete().eq('organization_id', job.organization_id).eq('year', snapshot.year).neq('run_id', job.id));
  return { waiting: false as const, year: snapshot.year, source: snapshot.source ?? 'chilecompra', read: snapshot.read, candidates: snapshot.lines.length, kept: rows.length };
}

type PlanRow = { line_id: string; institution: string; institution_code: string | null; product_code: string | null; description: string; quantity: number | null;
  unit_amount: number | null; amount: number | null; month: number | null; quarter: number | null; fit: 'alta' | 'media'; reason: string; created_at: string; year: number };
const toMatch = (row: PlanRow): PurchasePlanMatch => ({ lineId: row.line_id, institution: row.institution, institutionCode: row.institution_code, productCode: row.product_code,
  description: row.description, quantity: row.quantity === null ? null : Number(row.quantity), unitAmount: row.unit_amount === null ? null : Number(row.unit_amount),
  amount: row.amount === null ? null : Number(row.amount), month: row.month, quarter: row.quarter, fit: row.fit, reason: row.reason });

/** What «Demanda futura» shows: the lines of the latest year read, the reading in course and its error, if any. */
export async function readOpportunityDemand(client: SupabaseClient, scope: WorkScope) {
  assertOpportunityAdmin(scope);
  const [lines, jobs, context] = await Promise.all([
    client.from(TABLE).select('*').eq('organization_id', scope.organizationId).order('year', { ascending: false }).order('amount', { ascending: false, nullsFirst: false }).limit(800),
    client.from('opportunity_jobs').select('id,state,error,created_at,updated_at,result').eq('organization_id', scope.organizationId).eq('kind', 'demand').order('updated_at', { ascending: false }).limit(5),
    client.from('opportunity_company_context').select('criteria,services').eq('organization_id', scope.organizationId).maybeSingle(),
  ]);
  // Before the migration the table is missing: the page says the feature is not ready instead of failing.
  if (lines.error) return { available: false, year: null, updatedAt: null, matches: [], job: null, keywords: [] };
  const rows = (lines.data || []) as PlanRow[];
  const year = rows[0]?.year ?? null;
  const ofYear = rows.filter(row => row.year === year);
  // The reading under way, or else the one that moved last: the month's reading, blocked this morning, does not hide an
  // admin's reading that is running or done.
  const recent = (opportunityDb(jobs) || []) as Array<{ id: string; state: string; error: string | null; created_at: string; updated_at: string; result: any }>;
  const job = recent.find(row => ['queued', 'running', 'waiting'].includes(row.state)) ?? recent[0] ?? null;
  const ctx = opportunityDb(context);
  return { available: true, year, updatedAt: ofYear.reduce<string | null>((latest, row) => (!latest || row.created_at > latest ? row.created_at : latest), null),
    matches: ofYear.map(toMatch), keywords: planKeywords({ keywords: ctx?.criteria?.keywords, services: ctx?.services }),
    job: job ? { id: job.id, state: job.state, error: job.error, createdAt: job.created_at, updatedAt: job.updated_at, result: job.result ?? null } : null };
}

/** A uuid from a text, the same each time: following the same line twice opens the same opportunity. */
const stableUuid = (text: string) => {
  const hex = createHash('sha256').update(text).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
/** «Seguir»: the plan line becomes an opportunity of the pipeline, with what the plan says and why it fits. */
export async function followPlanLine(client: SupabaseClient, scope: WorkScope, input: { year: number; lineId: string }) {
  assertOpportunityAdmin(scope);
  const row = opportunityDb(await client.from(TABLE).select('*').eq('organization_id', scope.organizationId).eq('year', input.year).eq('line_id', input.lineId).maybeSingle()) as PlanRow | null;
  if (!row) throw new AuthError('Esa línea ya no está en la demanda futura. Actualiza la vista.', 404);
  const draft = planOpportunityDraft(toMatch(row), row.year);
  return createPrivateOpportunity(client, scope, { ...draft, requestId: stableUuid(`plan:${scope.organizationId}:${row.year}:${row.line_id}`), url: null, deadline: null },
    { reason: `En el Plan Anual de Compras ${row.year} de ${row.institution}`, origin: 'purchase_plan', documentName: 'Plan Anual de Compras.txt',
      // One opportunity per line in the workspace, whichever admin follows it first.
      dedupeKey: `plan:${row.year}:${row.line_id}`, activity: 'Oportunidad agregada desde el Plan Anual de Compras' });
}
