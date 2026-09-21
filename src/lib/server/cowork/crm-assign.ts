import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { leadCollaborationPermissions, requireOrganizationCollaborationEnabled } from '@/lib/server/lead-collaboration';
import { coworkCrmAssignSchema, hashCoworkCrmAssignProposal } from '@/lib/cowork/team-proposals';

/** Fase 4: collaboration assignment with human review. The proposal pins the
 * lead, operation, target member and the row version; execution calls the
 * service_role wrapper that re-validates the whole v1 matrix atomically.
 * Member restrictions are pre-checked with the same pure permission function
 * the UI uses; the database re-checks at execution. */

type Client = ReturnType<typeof getSupabaseAdminClient>;
type Scope = { userId: string; organizationId: string };

export function parseCoworkCrmAssignTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'crmassign' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de asignación no es válida.');
  }
  return { hash: parts[1] };
}

async function readMembershipRole(client: Client, scope: Scope) {
  const member = await client.from('organization_members').select('role')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (member.error || !member.data) throw new Error('No se pudo verificar tu rol en el equipo.');
  const role = (member.data as { role: string }).role;
  if (role !== 'owner' && role !== 'admin' && role !== 'member') throw new Error('Tu rol no permite colaborar.');
  return role as 'owner' | 'admin' | 'member';
}

async function readCollaboration(client: Client, scope: Scope, leadId: string) {
  const lead = await client.from('leads').select('id')
    .eq('id', leadId).eq('organization_id', scope.organizationId).maybeSingle();
  if (lead.error) throw new Error('No se pudo leer el contacto.');
  if (!lead.data) throw new Error('Ese contacto no está en tu organización.');
  const row = await client.from('organization_lead_collaboration').select('*')
    .eq('lead_id', leadId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error) throw new Error('No se pudo leer la colaboración del contacto.');
  if (!row.data) throw new Error('Ese contacto aún no tiene ficha de colaboración.');
  return row.data as Record<string, unknown> & { updated_at: string };
}

export async function stageCoworkCrmAssign(scope: Scope, runId: string, input: unknown) {
  const parsed = coworkCrmAssignSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  await requireOrganizationCollaborationEnabled({ user: { id: scope.userId }, organizationId: scope.organizationId, supabase: client } as never, scope.organizationId);
  const role = await readMembershipRole(client, scope);
  const collaboration = await readCollaboration(client, scope, parsed.leadId);
  if (parsed.op === 'assign' && parsed.assignedToUserId) {
    const member = await client.from('organization_members').select('user_id')
      .eq('organization_id', scope.organizationId).eq('user_id', parsed.assignedToUserId).maybeSingle();
    if (member.error || !member.data) throw new Error('El destino no es miembro de tu organización.');
  }
  const permissions = leadCollaborationPermissions({ role, userId: scope.userId, collaboration, contactThread: null });
  if (parsed.op === 'assign' && !permissions.canAssign && parsed.assignedToUserId !== scope.userId) {
    throw new Error('Tu rol no permite asignar a otros miembros. Puedes reservarlo para ti si está libre.');
  }
  if (parsed.op === 'claim' && !permissions.canClaim) {
    throw new Error('Ese contacto no se puede reservar ahora (asignado a otro o con reserva activa).');
  }
  if (parsed.op === 'release' && !permissions.canReleaseClaim) {
    throw new Error('Esa reserva no es tuya y tu rol no permite liberarla.');
  }
  const hash = hashCoworkCrmAssignProposal(parsed.op, {
    leadId: parsed.leadId, assignedToUserId: parsed.assignedToUserId ?? null,
    minutes: parsed.op === 'claim' ? parsed.minutes : null, base: collaboration.updated_at,
  });
  const inserted = await client.from('cowork_crm_assign_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      lead_id: parsed.leadId, op: parsed.op, assigned_to_user_id: parsed.assignedToUserId ?? null,
      minutes: parsed.op === 'claim' ? parsed.minutes : null,
      base_updated_at: collaboration.updated_at, proposal_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (inserted.error) throw new Error('No se pudo preparar la propuesta.');
  if (!inserted.data) {
    const existing = await client.from('cowork_crm_assign_proposals').select('proposal_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.proposal_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de asignación.');
    }
  }
  return { hash };
}

async function readStaged(client: Client, scope: Scope, runId: string, auth: AuthContext) {
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const row = await client.from('cowork_crm_assign_proposals')
    .select('lead_id,op,assigned_to_user_id,minutes,base_updated_at,proposal_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('La propuesta aprobada ya no está disponible.');
  return row.data as { lead_id: string; op: 'assign' | 'claim' | 'release';
    assigned_to_user_id: string | null; minutes: number | null; base_updated_at: string; proposal_hash: string };
}

export async function executeCoworkCrmAssign(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkCrmAssignTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const staged = await readStaged(client, scope, runId, auth);
  if (staged.proposal_hash !== target.hash) {
    throw new Error('La asignación cambió desde tu revisión. Pide una nueva revisión.');
  }
  const current = await client.from('organization_lead_collaboration').select('updated_at')
    .eq('lead_id', staged.lead_id).eq('organization_id', scope.organizationId).maybeSingle();
  if (current.error || !current.data
    || (current.data as { updated_at: string }).updated_at !== staged.base_updated_at) {
    throw new Error('La colaboración cambió desde tu revisión. Revísala de nuevo.');
  }
  const { data, error } = await client.rpc('cowork_lead_collaboration_op', {
    p_lead_id: staged.lead_id, p_actor_user_id: scope.userId, p_op: staged.op,
    p_assigned_to_user_id: staged.assigned_to_user_id, p_minutes: staged.minutes ?? 15,
  });
  if (error) throw new Error('No se pudo aplicar la asignación. Otro miembro pudo haber actuado primero.');
  const outcome = data as { assigned_to_user_id?: string | null; claimed_by_user_id?: string | null } | null;
  const detail = staged.op === 'assign' ? `Asignado a ${staged.assigned_to_user_id}.`
    : staged.op === 'claim' ? 'Reservado a tu nombre.' : 'Reserva liberada.';
  void outcome;
  return { reply: `Colaboración actualizada. ${detail}`, result: { leadId: staged.lead_id, op: staged.op } };
}
