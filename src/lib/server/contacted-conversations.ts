import type { PlannedTouch } from '@/lib/contacted-conversations';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { readCoworkBatchReport } from '@/lib/server/cowork/batch-reads';

/** Uses the caller's RLS client plus explicit organization scope. */
export async function loadPlannedTouches(client: any, organizationId: string, emails: string[], ownerIds: string[] = []): Promise<{ touches: PlannedTouch[]; complete: boolean }> {
  if (!emails.length) return { touches: [], complete: true };
  const enrollment = await client.from('campaign_enrollments').select('id,recipient_email,user_id,status,campaign_id').eq('organization_id', organizationId).in('recipient_email', emails).limit(500);
  if (enrollment.error) throw enrollment.error;
  const enrollments = enrollment.data || [];
  const [steps, campaignSettings] = enrollments.length ? await Promise.all([
    client.from('campaign_recipient_steps').select('id,enrollment_id,state,due_at,native_draft_id,native_version_id,step_index,last_error').eq('organization_id', organizationId).in('enrollment_id', enrollments.map((e: any) => e.id)).order('step_index').limit(1000),
    client.from('campaigns').select('id,name,settings').eq('organization_id', organizationId).in('id', [...new Set(enrollments.map((e: any) => e.campaign_id))]),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (steps.error || campaignSettings.error) throw steps.error || campaignSettings.error;
  const touches = (steps.data || []).map((step: any): PlannedTouch => {
    const e = enrollments.find((e: any) => e.id === step.enrollment_id);
    const c = campaignSettings.data?.find((c: any) => c.id === e.campaign_id);
    return { id: step.id, email: e.recipient_email, ownerId: e.user_id, campaignId: e.campaign_id, enrollmentId: e.id, kind: 'first_contact', campaignName: c?.name, state: step.state, dueAt: step.due_at, enrollmentState: e.status, draftId: step.native_draft_id, versionId: step.native_version_id, index: step.step_index, error: step.last_error, autoSend: c?.settings?.auto_send === true };
  });
  const admin = getSupabaseAdminClient();
  const owners = [...new Set([...enrollments.map((e: any) => e.user_id), ...ownerIds].filter(Boolean))];
  let bulkComplete = true;
  const bulkTouches: PlannedTouch[] = [];
  // Discover campaigns through the caller's RLS permissions before using the
  // privileged report reader. Organization membership alone is not ownership.
  const campaigns = owners.length ? await client.from('bulk_campaigns').select('id,user_id,status').eq('organization_id', organizationId).in('user_id', owners).in('status', ['approved', 'paused']).limit(101) : { data: [], error: null };
  if (campaigns.error) bulkComplete = false;
  if ((campaigns.data || []).length > 100) bulkComplete = false;
  const boundedCampaigns = (campaigns.data || []).slice(0, 25);
  if ((campaigns.data || []).length > boundedCampaigns.length) bulkComplete = false;
  for (const campaign of boundedCampaigns) {
    const ownerId = campaign.user_id;
      let report;
      try { report = await readCoworkBatchReport(admin, { userId: ownerId, organizationId }, campaign.id); }
      catch { bulkComplete = false; continue; }
      for (const recipient of report.recipients || []) {
        if (!emails.some(email => email.toLowerCase() === String(recipient.email || '').toLowerCase())) continue;
        for (const touch of recipient.touches || []) {
          if (['sent', 'skipped', 'blocked'].includes(touch.status)) continue;
          bulkTouches.push({ id: `${campaign.id}:${touch.draftId}`, email: recipient.email, ownerId, campaignId: campaign.id, enrollmentId: '', kind: 'bulk', campaignName: report.campaign?.name, state: campaign.status === 'paused' ? 'paused' : touch.status, dueAt: touch.dueAt, enrollmentState: 'active', draftId: touch.draftId, versionId: touch.versionId, index: touch.index, error: touch.error, autoSend: false });
        }
      }
  }
  return { touches: [...touches, ...bulkTouches], complete: enrollments.length < 500 && (steps.data || []).length < 1000 && bulkComplete };
}
