import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { coworkCrmRecordPatchSchema, hashCoworkCrmRecordProposal, type CoworkCrmRecordPatch } from '@/lib/cowork/crm-record-proposal';

/** Fase 4: sheet-level CRM record change with human review. The proposal pins
 * the gid, exact field values and the row version; execution refuses drift.
 * Only stage, owner name, notes, next action and meeting link. Never
 * collaboration assignment, autopilot state or other rows. */

type Client = ReturnType<typeof getSupabaseAdminClient>;
type Scope = { userId: string; organizationId: string };

const DB_FIELDS = {
  stage: 'stage', owner: 'owner', notes: 'notes', nextAction: 'next_action',
  nextActionType: 'next_action_type', nextActionDueAt: 'next_action_due_at', meetingLink: 'meeting_link',
} as const;

export function parseCoworkCrmRecordTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'crmrecord' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de ficha comercial no es válida.');
  }
  return { hash: parts[1] };
}

async function stageProposal(client: Client, scope: Scope, runId: string, staged: {
  gid: string; patch: Record<string, unknown>; base_updated_at: string | null; proposal_hash: string;
}) {
  const inserted = await client.from('cowork_crm_record_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId, ...staged },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (inserted.error) throw new Error('No se pudo preparar la propuesta.');
  if (!inserted.data) {
    const existing = await client.from('cowork_crm_record_proposals').select('proposal_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.proposal_hash !== staged.proposal_hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de ficha.');
    }
  }
}

export async function stageCoworkCrmRecordUpdate(scope: Scope, runId: string, input: unknown) {
  const parsed = coworkCrmRecordPatchSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const current = await client.from('unified_crm_data')
    .select('id,stage,owner,notes,next_action,next_action_type,next_action_due_at,meeting_link,updated_at')
    .eq('id', parsed.gid).eq('organization_id', scope.organizationId).maybeSingle();
  if (current.error) throw new Error('No se pudo leer la ficha comercial.');
  const base = current.data as null | { updated_at: string; [key: string]: unknown };
  const patch: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const [field, column] of Object.entries(DB_FIELDS)) {
    const value = parsed[field as keyof CoworkCrmRecordPatch];
    if (value === undefined) continue;
    const currentValue = base ? base[column] : null;
    const normalized = field === 'nextActionDueAt' && typeof value === 'string' ? new Date(value).toISOString() : value;
    if (JSON.stringify(currentValue ?? null) === JSON.stringify(normalized ?? null)) continue;
    patch[column] = normalized;
    changed.push(field);
  }
  if (changed.length === 0) throw new Error('La propuesta no cambia la ficha actual.');
  const hash = hashCoworkCrmRecordProposal(parsed);
  await stageProposal(client, scope, runId, {
    gid: parsed.gid, patch, base_updated_at: base ? base.updated_at : null, proposal_hash: hash,
  });
  return { hash, changed };
}

async function readStaged(client: Client, scope: Scope, runId: string, auth: AuthContext) {
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const row = await client.from('cowork_crm_record_proposals')
    .select('gid,patch,base_updated_at,proposal_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('La propuesta aprobada ya no está disponible.');
  return row.data as { gid: string; patch: Record<string, unknown>; base_updated_at: string | null; proposal_hash: string };
}

export async function executeCoworkCrmRecordUpdate(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkCrmRecordTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const staged = await readStaged(client, scope, runId, auth);
  if (staged.proposal_hash !== target.hash) {
    throw new Error('La ficha cambió desde tu revisión. Pide una nueva revisión.');
  }
  const current = await client.from('unified_crm_data').select('updated_at')
    .eq('id', staged.gid).eq('organization_id', scope.organizationId).maybeSingle();
  if (current.error) throw new Error('No se pudo verificar la ficha comercial.');
  const baseUpdatedAt = current.data ? (current.data as { updated_at: string }).updated_at : null;
  if (baseUpdatedAt !== staged.base_updated_at) {
    throw new Error('La ficha cambió desde tu revisión. Revísala de nuevo.');
  }
  const appliedAt = new Date().toISOString();
  if (staged.base_updated_at === null) {
    const inserted = await client.from('unified_crm_data').insert({
      id: staged.gid, organization_id: scope.organizationId, ...staged.patch, updated_at: appliedAt,
    }).select('id').maybeSingle();
    if (inserted.error || !inserted.data) {
      throw new Error('La ficha cambió durante la aprobación. Revísala de nuevo.');
    }
  } else {
    const updated = await client.from('unified_crm_data').update({ ...staged.patch, updated_at: appliedAt })
      .eq('id', staged.gid).eq('organization_id', scope.organizationId)
      .eq('updated_at', staged.base_updated_at).select('id').maybeSingle();
    if (updated.error || !updated.data) {
      throw new Error('La ficha cambió durante la aprobación. Revísala de nuevo.');
    }
  }
  return {
    reply: 'La ficha comercial quedó actualizada con los valores aprobados.',
    result: { gid: staged.gid, updatedAt: appliedAt },
  };
}
