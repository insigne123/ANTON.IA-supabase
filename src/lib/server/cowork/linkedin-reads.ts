import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  LINKEDIN_FOLLOWUP_COOLDOWN_DAYS, LINKEDIN_JOB_EXPIRY_DAYS, LINKEDIN_WEEKLY_INVITE_LIMIT,
  classifyInviteQuota, followupEligible, jobExpired,
} from '@/lib/cowork/linkedin-bridge';

type Scope = { userId: string; organizationId: string };

async function sweepState(client: SupabaseClient, scope: Scope, kind: 'network' | 'inbox') {
  const { data, error } = await client.from('cowork_linkedin_sweep_state')
    .select('last_completed_at,cursor,has_more,observed_count,updated_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('kind', kind).maybeSingle();
  if (error) throw new Error('No se pudo leer el estado del barrido.');
  return (data as { last_completed_at: string | null; cursor: string | null; has_more: boolean;
    observed_count: number; updated_at: string } | null)
    || { last_completed_at: null, cursor: null, has_more: false, observed_count: 0, updated_at: new Date().toISOString() };
}

/** 5.1: red observada con punto de corte durable. Sin barrido completo no hay
 * lista de "contactos nuevos": solo lo registrado con su cobertura. */
export async function readCoworkLinkedinNetwork(client: SupabaseClient, scope: Scope) {
  const [peers, sweep] = await Promise.all([
    client.from('cowork_linkedin_peers').select('canonical_url,display_name,first_seen,last_seen')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
      .order('first_seen', { ascending: false }).limit(50),
    sweepState(client, scope, 'network'),
  ]);
  if (peers.error) throw new Error('No se pudo leer la red observada.');
  const rows = (peers.data || []) as Array<{ canonical_url: string; display_name: string; first_seen: string; last_seen: string }>;
  return { scope: 'own_linkedin_network',
    peers: rows, returned: rows.length, truncated: rows.length >= 50,
    coverage: { lastCompletedAt: sweep.last_completed_at, hasMore: sweep.has_more,
      observedCount: sweep.observed_count, complete: sweep.last_completed_at !== null && !sweep.has_more },
    limitation: 'Solo conexiones reportadas por tu extensión. Sin barrido completo no se afirma quién es nuevo.',
  };
}

const threadInputSchema = z.string().uuid().optional();

/** 5.2: auditoría de bandeja con paginación declarada. Los conteos de
 * pendientes solo valen con barrido completo; a medias se informa, no se concluye. */
export async function readCoworkLinkedinInbox(client: SupabaseClient, scope: Scope, value: string) {
  if (value) threadInputSchema.parse(value);
  const [threads, sweep] = await Promise.all([
    client.from('cowork_linkedin_threads')
      .select('thread_key,canonical_url,display_name,last_direction,last_at,snippet,reply_needed,resolved_at,updated_at')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
      .order('reply_needed', { ascending: false }).order('last_at', { ascending: false, nullsFirst: false }).limit(30),
    sweepState(client, scope, 'inbox'),
  ]);
  if (threads.error) throw new Error('No se pudo leer la bandeja observada.');
  const rows = (threads.data || []) as Array<{ thread_key: string; canonical_url: string | null;
    display_name: string; last_direction: string; last_at: string | null; snippet: string | null;
    reply_needed: boolean; resolved_at: string | null; updated_at: string }>;
  const complete = sweep.last_completed_at !== null && !sweep.has_more;
  return { scope: 'own_linkedin_inbox', threads: rows, returned: rows.length, truncated: rows.length >= 30,
    sweepComplete: complete,
    pendingCounts: complete ? { replyNeeded: rows.filter(row => row.reply_needed && !row.resolved_at).length } : null,
    coverage: { lastCompletedAt: sweep.last_completed_at, hasMore: sweep.has_more, observedCount: sweep.observed_count },
    limitation: complete ? 'Barrido completo: los pendientes son los hilos observados.'
      : 'Barrido incompleto o ausente: hay páginas sin revisar; no se afirma quién está pendiente.',
  };
}

/** 5.6: cupo de invitaciones contando pendientes. Ventana móvil de 7 días. */
export async function readCoworkLinkedinQuota(client: SupabaseClient, scope: Scope) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [pending, sent] = await Promise.all([
    client.from('cowork_linkedin_jobs').select('id', { count: 'exact', head: true })
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
      .eq('kind', 'invite').in('status', ['queued', 'claimed']),
    client.from('cowork_linkedin_jobs').select('id', { count: 'exact', head: true })
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
      .eq('kind', 'invite').eq('status', 'confirmed').gte('created_at', since),
  ]);
  if (pending.error || sent.error) throw new Error('No se pudo comprobar el cupo.');
  const quota = classifyInviteQuota(Number(pending.count || 0), Number(sent.count || 0), LINKEDIN_WEEKLY_INVITE_LIMIT);
  return { scope: 'own_linkedin_quota', ...quota, windowDays: 7,
    limitation: 'Límite operativo observado en cuentas gratuitas, no oficial de LinkedIn.' };
}

/** Estado de trabajos: qué espera tu navegador y qué ya se confirmó en destino. */
export async function readCoworkLinkedinJobs(client: SupabaseClient, scope: Scope) {
  const now = Date.now();
  const [queued, recent] = await Promise.all([
    client.from('cowork_linkedin_jobs')
      .select('id,kind,canonical_url,display_name,status,created_at')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
      .in('status', ['queued', 'claimed']).order('created_at', { ascending: true }).limit(20),
    client.from('cowork_linkedin_jobs')
      .select('id,kind,canonical_url,display_name,status,created_at,updated_at,error')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
      .in('status', ['confirmed', 'uncertain', 'failed', 'expired']).order('updated_at', { ascending: false }).limit(20),
  ]);
  if (queued.error || recent.error) throw new Error('No se pudo leer los trabajos.');
  const pending = ((queued.data || []) as Array<{ id: string; kind: string; canonical_url: string;
    display_name: string; status: string; created_at: string }>)
    .map(row => ({ ...row, expired: jobExpired(row.created_at, now),
      expiresInDays: LINKEDIN_JOB_EXPIRY_DAYS }));
  return { scope: 'own_linkedin_jobs', pending,
    recent: recent.data || [],
    executionNote: 'Un trabajo en cola no es un envío: ejecútalo desde la extensión ante el perfil verificado. Lo incierto nunca se reintenta solo.',
  };
}

/** 5.7: candidatos a segundo contacto con historial fiable y exclusiones. */
export async function readCoworkLinkedinFollowups(client: SupabaseClient, scope: Scope) {
  const now = Date.now();
  const [jobs, threads, stages] = await Promise.all([
    client.from('cowork_linkedin_jobs')
      .select('canonical_url,display_name,status,created_at,message')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
      .eq('kind', 'message').in('status', ['confirmed', 'uncertain', 'failed'])
      .order('created_at', { ascending: false }).limit(200),
    client.from('cowork_linkedin_threads').select('canonical_url,last_direction,last_at')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).limit(500),
    client.from('unified_crm_data').select('id,stage').eq('organization_id', scope.organizationId).limit(500),
  ]);
  if (jobs.error || threads.error || stages.error) throw new Error('No se pudo calcular segundos contactos.');
  const inboundByUrl = new Map<string, string>();
  for (const row of ((threads.data || []) as Array<{ canonical_url: string | null; last_direction: string; last_at: string | null }>)) {
    if (row.canonical_url && row.last_direction === 'in' && row.last_at) inboundByUrl.set(row.canonical_url, row.last_at);
  }
  const stageSet = new Set(((stages.data || []) as Array<{ stage?: unknown }>)
    .map(row => row.stage).filter((stage): stage is string => typeof stage === 'string'));
  const byProfile = new Map<string, { display_name: string; lastConfirmedAt: string | null;
    lastMessageHash: string | null; uncertain: boolean; failed: boolean }>();
  for (const row of ((jobs.data || []) as Array<{ canonical_url: string; display_name: string;
      status: string; created_at: string; message: string | null }>)) {
    const current = byProfile.get(row.canonical_url) || { display_name: row.display_name,
      lastConfirmedAt: null, lastMessageHash: null, uncertain: false, failed: false };
    if (row.status === 'confirmed' && (!current.lastConfirmedAt || row.created_at > current.lastConfirmedAt)) {
      current.lastConfirmedAt = row.created_at;
      current.lastMessageHash = row.message ? createHash('sha256').update(row.message).digest('hex') : null;
    }
    if (row.status === 'uncertain') current.uncertain = true;
    if (row.status === 'failed' && !current.lastConfirmedAt) current.failed = true;
    byProfile.set(row.canonical_url, current);
  }
  const items = [...byProfile.entries()]
    .filter(([, profile]) => profile.lastConfirmedAt && !profile.uncertain)
    .map(([canonicalUrl, profile]) => {
      const verdict = followupEligible({ lastConfirmedAt: profile.lastConfirmedAt,
        lastInboundAt: inboundByUrl.get(canonicalUrl) || null,
        crmStages: [...stageSet], lastMessageHash: profile.lastMessageHash,
        newMessageHash: null, now });
      // El contenido nuevo se verifica en la revision del mensaje, no aqui.
      const reasons = verdict.reasons.filter(reason => reason !== 'missing_new_message');
      return { canonicalUrl, displayName: profile.display_name, lastConfirmedAt: profile.lastConfirmedAt,
        daysSince: profile.lastConfirmedAt
          ? Math.floor((now - Date.parse(profile.lastConfirmedAt)) / 86400000) : null,
        eligible: !reasons.length, blockedBy: reasons,
        requiresNewInformation: true,
        cooldownDays: LINKEDIN_FOLLOWUP_COOLDOWN_DAYS };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible)
      || String(a.lastConfirmedAt).localeCompare(String(b.lastConfirmedAt)))
    .slice(0, 20);
  return { scope: 'own_linkedin_followups', items, returned: items.length,
    limitation: 'Elegibilidad base sin el contenido nuevo: el segundo mensaje debe aportar información distinta, verificada en su revisión.',
  };
}
