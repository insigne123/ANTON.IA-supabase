export async function claimPendingSupliaAction(input: {
  admin: any;
  actionId: string;
  organizationId: string;
  approvedBy: string;
  approvedAt: string;
}) {
  const { data: action, error } = await input.admin
    .from('suplia_pending_actions')
    .update({
      status: 'approved',
      approved_by: input.approvedBy,
      approved_at: input.approvedAt,
      error_message: null,
      updated_at: input.approvedAt,
    })
    .eq('id', input.actionId)
    .eq('organization_id', input.organizationId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (action) return { claimed: true as const, action };

  const { data: current, error: currentError } = await input.admin
    .from('suplia_pending_actions')
    .select('*')
    .eq('id', input.actionId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (currentError) throw currentError;
  return { claimed: false as const, action: current || null };
}
