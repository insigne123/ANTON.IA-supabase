import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NEGOTIATION_HOLD_STAGES, companyKeysFor,
} from '@/lib/cowork/send-cadence';
import { evaluateFrequency, type FrequencyHold } from '@/lib/compliance';

type Scope = { userId: string; organizationId: string };

export type CompanyReplyStop = {
  stopped: boolean; email: string | null; company: string | null;
  repliedAt: string | null; replyIntent: string | null; checked: number; truncated: boolean;
};

function rowKeys(email: unknown, company: unknown): string[] {
  return companyKeysFor(String(email || ''), company).keys;
}

/** 4.7: freno por respuesta DE LA EMPRESA, no de la direccion exacta. Una
 * respuesta de cualquier persona de la cuenta detiene los seguimientos: el
 * caso real que motivo esto fue despedir a empresas que estaban negociando. */
export async function findCompanyReply(
  client: SupabaseClient, scope: Scope, email: string, company: unknown,
): Promise<CompanyReplyStop> {
  const keys = new Set(rowKeys(email, company));
  const { data, error } = await client.from('contacted_leads')
    .select('email,company,replied_at,reply_intent')
    .eq('organization_id', scope.organizationId).not('replied_at', 'is', null)
    .order('replied_at', { ascending: false }).limit(200);
  if (error) throw new Error('No se pudo comprobar respuestas de la empresa.');
  const rows = (data || []) as Array<{ email?: string | null; company?: string | null; replied_at?: string | null; reply_intent?: string | null }>;
  for (const row of rows) {
    const candidate = rowKeys(row.email, row.company);
    if (candidate.some(key => keys.has(key))) {
      return { stopped: true, email: row.email || null, company: row.company || null,
        repliedAt: row.replied_at || null, replyIntent: row.reply_intent || null,
        checked: rows.length, truncated: rows.length >= 200 };
    }
  }
  if (rows.length >= 200) throw new Error('Historial de respuestas incompleto; no se autoriza el envío.');
  return { stopped: false, email: null, company: null, repliedAt: null, replyIntent: null,
    checked: rows.length, truncated: rows.length >= 200 };
}

export type NegotiationHold = {
  held: boolean; stages: string[]; leadIds: string[]; checked: number;
};

/** 4.8: retiene cuentas en conversacion activa (negotiation/meeting en CRM).
 * Se difiere, no se descarta: la negociacion puede cerrarse y retomarse. */
export async function findNegotiationHold(
  client: SupabaseClient, scope: Scope, email: string, company: unknown,
): Promise<NegotiationHold> {
  const keys = new Set(rowKeys(email, company));
  const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
  const domainKey = [...keys].find(key => key.startsWith('domain:'));
  const queries = [client.from('leads').select('id,email,company').eq('organization_id', scope.organizationId)
    .ilike('email', domainKey ? `%@${escapeLike(domainKey.slice(7))}` : escapeLike(email.trim())).limit(100)];
  if (String(company || '').trim()) queries.push(client.from('leads').select('id,email,company')
    .eq('organization_id', scope.organizationId).ilike('company', escapeLike(String(company).trim())).limit(100));
  const results = await Promise.all(queries);
  if (results.some(result => result.error || (result.data || []).length >= 100)) {
    throw new Error('No se pudo comprobar toda la etapa comercial.');
  }
  const ids = [...new Set((results.flatMap(result => result.data || []) as Array<{ id: string; email?: string; company?: string }>)
    .filter(row => rowKeys(row.email, row.company).some(key => keys.has(key)))
    .map(row => row.id))];
  if (!ids.length) return { held: false, stages: [], leadIds: [], checked: 0 };
  const gids = ids.flatMap(id => [`lead_saved|${id}`, `lead_enriched|${id}`]);
  const { data: records, error: recordsError } = await client.from('unified_crm_data')
    .select('id,stage').eq('organization_id', scope.organizationId).in('id', gids).limit(500);
  if (recordsError) throw new Error('No se pudo comprobar la etapa comercial.');
  if ((records || []).length >= 500) throw new Error('Etapas comerciales incompletas.');
  const stages = [...new Set(((records || []) as Array<{ stage?: unknown }>)
    .map(row => row.stage).filter((stage): stage is string => typeof stage === 'string'))];
  const held = stages.some(stage => (NEGOTIATION_HOLD_STAGES as readonly string[]).includes(stage));
  return { held, stages, leadIds: ids, checked: (records || []).length };
}

export type CompanyDayCollision = {
  collided: boolean; email: string | null; sentAt: string | null; source: 'contacted_leads' | 'outbound_dispatches' | null;
};

/** 4.3 (garantia en tiempo de envio): ningun correo a la misma empresa el
 * mismo dia. La planificacion reserva dias; esto cubre la carrera entre que
 * se aprueba el lote y que sale cada toque. */
export async function findCompanySendToday(
  client: SupabaseClient, scope: Scope, email: string, company: unknown, dayStart: string,
): Promise<CompanyDayCollision> {
  const keys = new Set(rowKeys(email, company));
  const { data: contacted, error: contactedError } = await client.from('contacted_leads')
    .select('email,company,sent_at').eq('organization_id', scope.organizationId)
    .gte('sent_at', dayStart).limit(500);
  if (contactedError) throw new Error('No se pudo comprobar envios del dia.');
  if ((contacted || []).length >= 500) throw new Error('Historial de envíos incompleto.');
  for (const row of ((contacted || []) as Array<{ email?: string | null; company?: string | null; sent_at?: string | null }>)) {
    if (rowKeys(row.email, row.company).some(key => keys.has(key))) {
      return { collided: true, email: row.email || null, sentAt: row.sent_at || null, source: 'contacted_leads' };
    }
  }
  const { data: dispatches, error: dispatchError } = await client.from('outbound_dispatches')
    .select('metadata,completed_at').eq('organization_id', scope.organizationId)
    .eq('status', 'sent').gte('completed_at', dayStart).limit(500);
  if (dispatchError) throw new Error('No se pudo comprobar envios del dia.');
  if ((dispatches || []).length >= 500) throw new Error('Historial de despachos incompleto.');
  for (const row of ((dispatches || []) as Array<{ metadata?: { recipient?: { email?: string } } | null; completed_at?: string | null }>)) {
    const sentEmail = String(row.metadata?.recipient?.email || '').trim().toLowerCase();
    if (!sentEmail) continue;
    // Dispatches carry no company: match by shared domain key only.
    if (rowKeys(sentEmail, null).some(key => keys.has(key))) {
      return { collided: true, email: sentEmail, sentAt: row.completed_at || null, source: 'outbound_dispatches' };
    }
  }
  return { collided: false, email: null, sentAt: null, source: null };
}

export type PersonFrequencyHold = FrequencyHold & { email: string; checked: number };

/** 9.3: tope transversal por persona (1/día, 3/7 días, 8/40 días). La cadencia
 * canónica nunca lo activa sola; dos motores sobre la misma persona, sí.
 * Falla cerrado ante historial incompleto. */
export async function findPersonFrequencyHold(
  client: SupabaseClient, scope: Scope, email: string, now = Date.now(),
): Promise<PersonFrequencyHold> {
  const normalized = String(email || '').trim().toLowerCase();
  const { data, error } = await client.from('contacted_leads')
    .select('sent_at').eq('organization_id', scope.organizationId)
    .ilike('email', normalized.replace(/[\\%_]/g, '\\$&'))
    .not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(100);
  if (error) throw new Error('No se pudo comprobar la frecuencia por persona.');
  const rows = (data || []) as Array<{ sent_at?: string | null }>;
  if (rows.length >= 100) throw new Error('Historial de envíos incompleto; no se autoriza el envío.');
  const hold = evaluateFrequency(rows.map((row) => row.sent_at), now);
  return { ...hold, email: normalized, checked: rows.length };
}

/** 2.4/9.3: dominios bloqueados por la organización, compartidos por todos
 * los motores de envío. Comparación normalizada exacta, sin subdominios
 * implícitos: bloquear example.com no bloquea sub.example.com. */
export async function findExcludedDomain(
  client: SupabaseClient, scope: Scope, email: string,
): Promise<{ blocked: boolean; domain: string | null }> {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  if (!domain) return { blocked: false, domain: null };
  const { data, error } = await client.from('excluded_domains')
    .select('domain').eq('organization_id', scope.organizationId).limit(200);
  if (error) throw new Error('No se pudo verificar la política de dominios.');
  if ((data || []).length >= 200) throw new Error('Lista de dominios incompleta; no se autoriza el envío.');
  const blocked = ((data || []) as Array<{ domain?: string | null }>)
    .some((row) => String(row.domain || '').trim().toLowerCase().replace(/^@/, '') === domain);
  return { blocked, domain };
}

export type BatchRow = {
  campaign_id: string; spacing_minutes: number; company_stagger: boolean; guards_enabled: boolean;
};

export async function coworkBatchForCampaign(
  client: SupabaseClient, scope: Scope, campaignId: string,
): Promise<BatchRow | null> {
  const { data, error } = await client.from('cowork_send_batches')
    .select('campaign_id,spacing_minutes,company_stagger,guards_enabled')
    .eq('organization_id', scope.organizationId).eq('campaign_id', campaignId).maybeSingle();
  if (error) throw error;
  return (data as BatchRow | null) || null;
}

/** Reserva concurrente por cuenta y dia: la clave unica impide que dos lotes
 * reserven la misma empresa el mismo dia aunque se programen a la vez. */
export async function reserveCompanySendDays(
  client: SupabaseClient, scope: Scope,
  assignments: Array<{ email: string; companyKey: string; sendDay: string }>,
  batch: { campaignId: string; runId: string },
): Promise<void> {
  if (!assignments.length) throw new Error('No hay destinatarios para reservar.');
  const { error } = await client.from('cowork_company_send_days').insert(
    assignments.map(item => ({ organization_id: scope.organizationId, user_id: scope.userId,
      company_key: item.companyKey, send_day: item.sendDay, campaign_id: batch.campaignId,
      recipient_email: item.email, batch_run_id: batch.runId })),
  );
  if (error) {
    if (String((error as { code?: string }).code) === '23505') {
      throw new Error('Otra programacion ya reservo esa empresa para ese dia. Revisa el plan de empresa y vuelve a programar.');
    }
    throw error;
  }
}
