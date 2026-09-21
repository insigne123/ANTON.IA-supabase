import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { coworkMissionControlSchema, hashCoworkMissionProposal } from '@/lib/cowork/team-proposals';

/** Fase 4: mission pause/resume with human review. Only the owner's own
 * missions observed via missions.list. Execution re-checks state and
 * version; pausing completes pending prospecting/contact tasks and logs the
 * manual pause, mirroring the app's own transition exactly. */

type Client = ReturnType<typeof getSupabaseAdminClient>;
type Scope = { userId: string; organizationId: string };

const PAUSE_TASK_TYPES = ['GENERATE_CAMPAIGN', 'SEARCH', 'ENRICH', 'INVESTIGATE', 'CONTACT', 'CONTACT_INITIAL', 'CONTACT_CAMPAIGN'];

export function parseCoworkMissionTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'mission' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de misión no es válida.');
  }
  return { hash: parts[1] };
}

async function readOwnMission(client: Client, scope: Scope, missionId: string) {
  const row = await client.from('antonia_missions').select('id,title,status,updated_at')
    .eq('id', missionId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (row.error) throw new Error('No se pudo leer la misión.');
  if (!row.data) throw new Error('Esa misión no es tuya o ya no está disponible.');
  return row.data as { id: string; title: string | null; status: string; updated_at: string };
}

export async function stageCoworkMissionControl(scope: Scope, runId: string, input: unknown) {
  const parsed = coworkMissionControlSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const current = await readOwnMission(client, scope, parsed.missionId);
  if (current.status === parsed.targetStatus) {
    throw new Error(`Esa misión ya está ${parsed.targetStatus === 'paused' ? 'pausada' : 'activa'}.`);
  }
  if (!['active', 'paused'].includes(current.status)) {
    throw new Error('Esa misión está en un estado que no se puede cambiar desde aquí.');
  }
  const hash = hashCoworkMissionProposal({
    missionId: current.id, targetStatus: parsed.targetStatus,
    baseStatus: current.status, base: current.updated_at,
  });
  const inserted = await client.from('cowork_mission_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      mission_id: current.id, target_status: parsed.targetStatus,
      base_status: current.status, base_updated_at: current.updated_at, proposal_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (inserted.error) throw new Error('No se pudo preparar la propuesta.');
  if (!inserted.data) {
    const existing = await client.from('cowork_mission_proposals').select('proposal_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.proposal_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de misión.');
    }
  }
  return { hash };
}

export async function executeCoworkMissionControl(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkMissionTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const staged = await client.from('cowork_mission_proposals')
    .select('mission_id,target_status,base_status,base_updated_at,proposal_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (staged.error || !staged.data || staged.data.proposal_hash !== target.hash) {
    throw new Error('La propuesta aprobada ya no está disponible. Pide una nueva revisión.');
  }
  const missionId = (staged.data as { mission_id: string }).mission_id;
  const current = await readOwnMission(client, scope, missionId);
  if (current.status !== (staged.data as { base_status: string }).base_status
    || current.updated_at !== (staged.data as { base_updated_at: string }).base_updated_at) {
    throw new Error('La misión cambió desde tu revisión. Revísala de nuevo.');
  }
  const appliedAt = new Date().toISOString();
  const updated = await client.from('antonia_missions').update({
    status: (staged.data as { target_status: string }).target_status, updated_at: appliedAt,
  }).eq('id', current.id).eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .eq('status', (staged.data as { base_status: string }).base_status)
    .eq('updated_at', (staged.data as { base_updated_at: string }).base_updated_at)
    .select('id,organization_id').maybeSingle();
  if (updated.error || !updated.data) {
    throw new Error('La misión cambió durante la aprobación. Revísala de nuevo.');
  }
  if ((staged.data as { target_status: string }).target_status === 'paused') {
    await client.from('antonia_tasks').update({
      status: 'completed',
      result: { skipped: true, reason: 'mission_paused', source: 'manual_pause' },
      error_message: null, updated_at: appliedAt,
    }).eq('mission_id', current.id).eq('status', 'pending').in('type', PAUSE_TASK_TYPES);
    await client.from('antonia_logs').insert({
      mission_id: current.id, organization_id: scope.organizationId, level: 'warning',
      message: 'Misión pausada manualmente. Se omitieron tareas pendientes de prospección y contacto.',
      details: { source: 'manual_pause' }, created_at: appliedAt,
    });
  }
  return {
    reply: (staged.data as { target_status: string }).target_status === 'paused'
      ? 'Misión pausada. Las tareas pendientes de prospección y contacto quedaron omitidas.'
      : 'Misión reactivada. Volverá a operar en su próximo ciclo.',
    result: { missionId: current.id, status: (staged.data as { target_status: string }).target_status },
  };
}
