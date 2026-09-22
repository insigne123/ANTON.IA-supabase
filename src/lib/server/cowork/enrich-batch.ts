import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import { requireCoworkWorkerAccess } from './access';
import { getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { hasUserEnrichmentSearchCreditAccess } from '@/lib/server/enrichment-search-access';
import { enrichCoworkContact } from './enrich-contact';

const batchIdsSchema = z.array(z.string().uuid()).min(1).max(5);
type Scope = { userId: string; organizationId: string };

export function hashCoworkEnrichBatch(runId: string, leadIds: string[]) {
  return createHash('sha256')
    .update(`cowork|enrich-batch|${runId}|${[...leadIds].sort().join(',')}`).digest('hex');
}

export function parseCoworkEnrichBatchTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'enrichbatch' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de lote no es válida.');
  }
  return { hash: parts[1] };
}

function observedIds(events: Array<{ kind: string; payload: unknown }>): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'tool.completed' || !event.payload || typeof event.payload !== 'object') continue;
    const payload = event.payload as Record<string, unknown>;
    if (payload.action === 'lists.review_batch' || payload.action === 'lists.review_contact') {
      const result = payload.result as { items?: Array<{ leadId?: string }> } | null;
      for (const item of result?.items || []) if (typeof item.leadId === 'string') ids.add(item.leadId);
    }
    for (const row of collectCoworkLeadRows([payload])) ids.add(row.id);
  }
  return ids;
}

/** Stage a bounded batch: every id must be an observed own saved lead.
 * Quota and provider access are checked now for an honest estimate; each
 * item re-checks them at execution. Nothing is submitted here. */
export async function stageCoworkEnrichBatch(scope: Scope, runId: string, leadIds: string[]) {
  const ids = batchIdsSchema.parse(leadIds);
  if (new Set(ids).size !== ids.length) throw new Error('Hay contactos duplicados en el lote.');
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const state = await client.from('cowork_runs').select('status').eq('id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (state.error || !state.data || (state.data.status !== 'running' && state.data.status !== 'waiting_approval')) {
    throw new Error('El trabajo ya no admite propuestas.');
  }
  const events = await client.from('cowork_run_events').select('kind,payload').eq('run_id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId);
  if (events.error) throw new Error('No se pudo comprobar lo observado en este trabajo.');
  const seen = observedIds((events.data || []) as Array<{ kind: string; payload: unknown }>);
  const missing = ids.filter(id => !seen.has(id));
  if (missing.length) throw new Error('Todos los contactos del lote deben haberse observado primero en esta conversación.');
  const rows = await client.from('leads').select('id').eq('organization_id', scope.organizationId)
    .eq('user_id', scope.userId).in('id', ids);
  if (rows.error || (rows.data || []).length !== ids.length) {
    throw new Error('Todos los contactos del lote deben ser guardados propios.');
  }
  if (!await hasUserEnrichmentSearchCreditAccess(scope.userId)) {
    throw new Error('Tu cuenta no tiene acceso a créditos de enriquecimiento.');
  }
  const limits = await getEffectiveDailyQuotaLimits(scope);
  const hash = hashCoworkEnrichBatch(runId, ids);
  const staged = await client.from('cowork_enrich_batch_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      lead_ids: [...ids].sort(), cost_estimate: ids.length, patch_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar la propuesta de lote.');
  if (!staged.data) {
    const existing = await client.from('cowork_enrich_batch_proposals').select('patch_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.patch_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de lote.');
    }
  }
  return { hash, costEstimate: ids.length, dailyLimit: limits.enrich };
}

export type CoworkBatchItemResult = { leadId: string; status: 'enriched' | 'reused' | 'already_requested' | 'failed' | 'skipped';
  email?: string | null; emailStatus?: string | null; verifiedForList?: boolean; message?: string };

/** Execute approved batch: per-item results, quota enforced per item by the
 * shared single-enrich path. Idempotent operation ids make re-proposal safe:
 * completed items reuse, in-flight items report without double charge. */
export async function executeCoworkEnrichBatch(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkEnrichBatchTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const row = await client.from('cowork_enrich_batch_proposals').select('lead_ids,patch_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('La propuesta aprobada ya no está disponible.');
  if (row.data.patch_hash !== target.hash) throw new Error('El lote cambió desde tu revisión. Pide una nueva revisión.');
  if (hashCoworkEnrichBatch(runId, row.data.lead_ids) !== target.hash) {
    throw new Error('El lote cambió desde tu revisión. Pide una nueva revisión.');
  }
  const items: CoworkBatchItemResult[] = [];
  for (const leadId of row.data.lead_ids as string[]) {
    try {
      const result = await enrichCoworkContact(auth, runId, leadId);
      items.push(result.reused
        ? { leadId, status: 'reused', email: result.email, emailStatus: result.emailStatus, verifiedForList: result.verifiedForList }
        : result.found
          ? { leadId, status: 'enriched', email: result.email, emailStatus: result.emailStatus, verifiedForList: result.verifiedForList }
          : { leadId, status: 'failed', message: 'El proveedor no devolvió correo.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      if (/Ya existe una solicitud/.test(message)) {
        items.push({ leadId, status: 'already_requested', message: 'Ya hay una solicitud en curso; se concilia sin duplicar.' });
        continue;
      }
      items.push({ leadId, status: /cupo diario/i.test(message) ? 'skipped' : 'failed', message: message.slice(0, 200) });
      if (/cupo diario/i.test(message)) {
        // Remaining items would hit the same quota wall: report, don't burn calls.
        for (const rest of (row.data.lead_ids as string[]).slice(items.length)) {
          items.push({ leadId: rest, status: 'skipped', message: 'Cupo diario alcanzado en este lote.' });
        }
        break;
      }
    }
  }
  const enriched = items.filter(item => item.status === 'enriched' || item.status === 'reused').length;
  return { reply: `Lote completado: ${enriched} de ${items.length} con correo; el resto quedó con su estado individual.`,
    result: { items } };
}
