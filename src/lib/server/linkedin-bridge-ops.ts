import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { LINKEDIN_JOB_EXPIRY_DAYS, jobExpired } from '@/lib/cowork/linkedin-bridge';

type Scope = { organizationId: string; userId: string };
type Db = ReturnType<typeof getSupabaseAdminClient>;

export const networkEntrySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  name: z.string().trim().max(300).default(''),
}).strict();
export const inboxThreadSchema = z.object({
  key: z.string().trim().min(1).max(500),
  url: z.string().trim().max(2048).default(''),
  name: z.string().trim().max(300).default(''),
  direction: z.enum(['in', 'out']),
  at: z.string().datetime({ offset: true }).nullable().default(null),
  snippet: z.string().trim().max(500).default(''),
  replyNeeded: z.boolean().default(false),
}).strict();

export type LinkedinJobRow = { id: string; kind: string; canonical_url: string; profile_url: string;
  display_name: string; message: string | null; status: string; claim_token: string | null;
  event_id: string | null; thread_url: string | null; error: string | null; created_at: string; updated_at: string };

/** Trabajos en cola del usuario pareado, con vencimiento calculado. Mirar no reclama. */
export async function listPendingLinkedinJobs(scope: Scope, profileUrl: string | null, db: Db = getSupabaseAdminClient()) {
  let query = db.from('cowork_linkedin_jobs').select('id,kind,canonical_url,profile_url,display_name,message,status,created_at,updated_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('status', 'queued')
    .order('created_at', { ascending: true }).limit(20);
  const canonical = profileUrl ? normalizeLinkedinProfileUrl(profileUrl) : '';
  if (canonical) query = query.eq('canonical_url', canonical);
  const { data, error } = await query;
  if (error) throw error;
  const now = Date.now();
  return ((data || []) as LinkedinJobRow[]).map(row => ({ ...row,
    expired: jobExpired(row.created_at, now), expiresInDays: LINKEDIN_JOB_EXPIRY_DAYS }));
}

/** Reclamo atomico: solo un navegador ejecuta cada trabajo. Vencidos se marcan y se rechazan. */
export async function claimLinkedinJob(scope: Scope, jobId: string, db: Db = getSupabaseAdminClient()) {
  z.string().uuid().parse(jobId);
  const current = await db.from('cowork_linkedin_jobs').select('id,status,created_at')
    .eq('id', jobId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (current.error) throw current.error;
  const row = current.data as { id: string; status: string; created_at: string } | null;
  if (!row) throw new Error('El trabajo ya no está disponible.');
  if (row.status !== 'queued') throw new Error(`El trabajo ya está en estado ${row.status}. No se reclama dos veces.`);
  if (jobExpired(row.created_at, Date.now())) {
    await db.from('cowork_linkedin_jobs').update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', jobId).eq('status', 'queued');
    throw new Error('El trabajo venció. Pide una nueva propuesta desde Cowork.');
  }
  const claimToken = randomUUID();
  const claimed = await db.from('cowork_linkedin_jobs').update({ status: 'claimed', claim_token: claimToken, updated_at: new Date().toISOString() })
    .eq('id', jobId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('status', 'queued')
    .select('id,kind,canonical_url,profile_url,display_name,message,status,claim_token,created_at').maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) throw new Error('Otro navegador reclamó este trabajo. Recarga la lista.');
  return claimed.data as LinkedinJobRow;
}

const jobResultSchema = z.object({
  jobId: z.string().uuid(), claimToken: z.string().uuid(),
  status: z.enum(['confirmed', 'uncertain', 'failed']),
  eventId: z.string().trim().min(1).max(1000).optional(),
  threadUrl: z.string().trim().max(2048).optional(),
  error: z.string().trim().max(1000).optional(),
}).strict();

/** Resultado confirmado en destino. Lo incierto o fallido nunca se reintenta solo. */
export async function finishLinkedinJob(scope: Scope, input: unknown, db: Db = getSupabaseAdminClient()) {
  const parsed = jobResultSchema.parse(input);
  if (parsed.threadUrl) {
    try {
      const url = new URL(parsed.threadUrl);
      if (url.origin !== 'https://www.linkedin.com' || !url.pathname.startsWith('/messaging/thread/')) throw new Error();
    } catch { throw new Error('URL de hilo inválida.'); }
  }
  const current = await db.from('cowork_linkedin_jobs').select('id,kind,status,claim_token')
    .eq('id', parsed.jobId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (current.error) throw current.error;
  const row = current.data as { id: string; kind: string; status: string; claim_token: string | null } | null;
  if (!row || row.status !== 'claimed' || row.claim_token !== parsed.claimToken) {
    throw new Error('El reclamo ya no está vigente. Revisa el trabajo antes de informar.');
  }
  if (parsed.status === 'confirmed' && row.kind === 'message' && !parsed.eventId) {
    throw new Error('Un mensaje confirmado requiere su identificador en LinkedIn.');
  }
  const done = await db.from('cowork_linkedin_jobs').update({ status: parsed.status,
    event_id: parsed.eventId || null, thread_url: parsed.threadUrl || null, error: parsed.error || null,
    updated_at: new Date().toISOString() })
    .eq('id', parsed.jobId).eq('status', 'claimed').eq('claim_token', parsed.claimToken)
    .select('id,status').maybeSingle();
  if (done.error) throw done.error;
  if (!done.data) throw new Error('El reclamo cambió mientras se informaba. Revisa el trabajo.');
  return done.data as { id: string; status: string };
}

/** Reporte de red de la extension: pares observados y avance del barrido. */
export async function reportLinkedinNetwork(scope: Scope, input: { entries: Array<{ url: string; name: string }>; cursor?: string | null; hasMore?: boolean },
  db: Db = getSupabaseAdminClient()) {
  const entries = z.array(networkEntrySchema).max(200).parse(input.entries);
  const now = new Date().toISOString();
  let observed = 0;
  for (const entry of entries) {
    const canonical = normalizeLinkedinProfileUrl(entry.url);
    if (!canonical) continue;
    const saved = await db.from('cowork_linkedin_peers').upsert(
      { organization_id: scope.organizationId, user_id: scope.userId, canonical_url: canonical,
        display_name: entry.name.slice(0, 300), last_seen: now },
      { onConflict: 'organization_id,user_id,canonical_url', ignoreDuplicates: false });
    if (saved.error) throw saved.error;
    observed++;
  }
  const hasMore = input.hasMore === true;
  const state = await db.from('cowork_linkedin_sweep_state').upsert(
    { organization_id: scope.organizationId, user_id: scope.userId, kind: 'network',
      last_completed_at: hasMore ? null : now, cursor: hasMore ? (input.cursor || null) : null,
      has_more: hasMore, observed_count: observed, updated_at: now },
    { onConflict: 'organization_id,user_id,kind' }).select('kind').maybeSingle();
  if (state.error) throw state.error;
  return { observed, hasMore };
}

/** Reporte de bandeja: hilos observados por pagina. Nada fuera del reporte se declara. */
export async function reportLinkedinInbox(scope: Scope, input: { threads: Array<{ key: string; url: string; name: string; direction: 'in' | 'out'; at: string | null; snippet: string; replyNeeded: boolean }>; cursor?: string | null; hasMore?: boolean },
  db: Db = getSupabaseAdminClient()) {
  const threads = z.array(inboxThreadSchema).max(50).parse(input.threads);
  const now = new Date().toISOString();
  for (const thread of threads) {
    const canonical = thread.url ? normalizeLinkedinProfileUrl(thread.url) : '';
    const saved = await db.from('cowork_linkedin_threads').upsert(
      { organization_id: scope.organizationId, user_id: scope.userId, thread_key: thread.key,
        canonical_url: canonical || null, display_name: thread.name.slice(0, 300),
        last_direction: thread.direction, last_at: thread.at, snippet: thread.snippet.slice(0, 500) || null,
        reply_needed: thread.replyNeeded, updated_at: now },
      { onConflict: 'organization_id,user_id,thread_key', ignoreDuplicates: false });
    if (saved.error) throw saved.error;
  }
  const hasMore = input.hasMore === true;
  const state = await db.from('cowork_linkedin_sweep_state').upsert(
    { organization_id: scope.organizationId, user_id: scope.userId, kind: 'inbox',
      last_completed_at: hasMore ? null : now, cursor: hasMore ? (input.cursor || null) : null,
      has_more: hasMore, observed_count: threads.length, updated_at: now },
    { onConflict: 'organization_id,user_id,kind' }).select('kind').maybeSingle();
  if (state.error) throw state.error;
  return { observed: threads.length, hasMore };
}
