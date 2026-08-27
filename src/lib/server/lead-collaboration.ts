import type { AuthContext } from '@/lib/server/auth-utils';

export async function requireOrganizationCollaborationEnabled(auth: AuthContext, organizationId: string) {
  const { data, error } = await auth.supabase
    .from('organizations')
    .select('collaboration_v1_enabled')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.collaboration_v1_enabled) {
    const disabled = new Error('Organization collaboration is not enabled');
    disabled.name = 'OrganizationCollaborationDisabledError';
    throw disabled;
  }
}

export function leadCollaborationPermissions(input: {
  role: 'owner' | 'admin' | 'member';
  userId: string;
  collaboration: any;
  contactThread: any;
}) {
  const { role, userId, collaboration, contactThread } = input;
  const managesTeam = role === 'owner' || role === 'admin';
  const claimExpiresAt = collaboration?.claim_expires_at
    ? new Date(collaboration.claim_expires_at).getTime()
    : 0;
  const activeClaim = Boolean(collaboration?.claimed_by_user_id && claimExpiresAt > Date.now());
  const assignedElsewhere = role === 'member'
    && collaboration?.assigned_to_user_id
    && collaboration.assigned_to_user_id !== userId;
  const lastContactedAt = contactThread?.last_contacted_at
    ? new Date(contactThread.last_contacted_at).getTime()
    : 0;
  const canReopenByAge = lastContactedAt > 0
    && lastContactedAt <= Date.now() - (90 * 24 * 60 * 60 * 1000);

  return {
    canAssign: managesTeam,
    canClaim: Boolean(collaboration && !assignedElsewhere && (!activeClaim || collaboration.claimed_by_user_id === userId)),
    canReleaseClaim: Boolean(collaboration?.claimed_by_user_id
      && (managesTeam || collaboration.claimed_by_user_id === userId)),
    canReopen: Boolean(managesTeam && contactThread && !contactThread.reserved_dispatch_id && canReopenByAge),
  };
}
