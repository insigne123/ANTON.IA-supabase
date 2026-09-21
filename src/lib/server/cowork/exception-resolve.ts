import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { coworkExceptionResolveSchema, hashCoworkExceptionProposal } from '@/lib/cowork/team-proposals';

/** Fase 4: manual exception triage with human review. Only open exceptions
 * observed via exceptions.list may move to resolved or dismissed with a
 * reason. Execution re-checks the open state and version. This records the
 * reviewed outcome; it never invents that the underlying issue was fixed. */

type Client = ReturnType<typeof getSupabaseAdminClient>;
type Scope = { userId: string; organizationId: string };

export function parseCoworkExceptionTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'exception' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de incidencia no es válida.');
  }
  return { hash: parts[1] };
}

async function readOpenException(client: Client, scope: Scope, exceptionId: string) {
  const row = await client.from('antonia_exceptions')
    .select('id,mission_id,lead_id,title,status,payload,updated_at')
    .eq('id', exceptionId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error) throw new Error('No se pudo leer la incidencia.');
  if (!row.data) throw new Error('Esa incidencia no está en tu organización.');
  return row.data as { id: string; mission_id: string | null; lead_id: string | null;
    title: string | null; status: string; payload: Record<string, unknown> | null; updated_at: string };
}

export async function stageCoworkExceptionResolve(scope: Scope, runId: string, input: unknown) {
  const parsed = coworkExceptionResolveSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const current = await readOpenException(client, scope, parsed.exceptionId);
  if (current.status !== 'open') {
    throw new Error('Esa incidencia ya no está abierta.');
  }
  const hash = hashCoworkExceptionProposal({
    exceptionId: current.id, action: parsed.action, reason: parsed.reason, base: current.updated_at,
  });
  const inserted = await client.from('cowork_exception_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      exception_id: current.id, action: parsed.action, reason: parsed.reason,
      base_updated_at: current.updated_at, proposal_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (inserted.error) throw new Error('No se pudo preparar la propuesta.');
  if (!inserted.data) {
    const existing = await client.from('cowork_exception_proposals').select('proposal_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.proposal_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de incidencia.');
    }
  }
  return { hash };
}

export async function executeCoworkExceptionResolve(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkExceptionTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const staged = await client.from('cowork_exception_proposals')
    .select('exception_id,action,reason,base_updated_at,proposal_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (staged.error || !staged.data || staged.data.proposal_hash !== target.hash) {
    throw new Error('La propuesta aprobada ya no está disponible. Pide una nueva revisión.');
  }
  const current = await readOpenException(client, scope, (staged.data as { exception_id: string }).exception_id);
  if (current.status !== 'open' || current.updated_at !== (staged.data as { base_updated_at: string }).base_updated_at) {
    throw new Error('La incidencia cambió desde tu revisión. Revísala de nuevo.');
  }
  const appliedAt = new Date().toISOString();
  const updated = await client.from('antonia_exceptions').update({
    status: (staged.data as { action: string }).action,
    payload: { ...(current.payload || {}), resolution: { action: (staged.data as { action: string }).action,
      reason: (staged.data as { reason: string }).reason, by: scope.userId, at: appliedAt } },
    updated_at: appliedAt,
  }).eq('id', current.id).eq('organization_id', scope.organizationId)
    .eq('status', 'open').eq('updated_at', (staged.data as { base_updated_at: string }).base_updated_at)
    .select('id').maybeSingle();
  if (updated.error || !updated.data) {
    throw new Error('La incidencia cambió durante la aprobación. Revísala de nuevo.');
  }
  return {
    reply: `Incidencia marcada como ${(staged.data as { action: string }).action} con el motivo aprobado.`,
    result: { exceptionId: current.id, action: (staged.data as { action: string }).action },
  };
}
