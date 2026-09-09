import type { BulkCampaign, CampaignRecipient } from '@/lib/bulk-campaigns';
import { campaignAttemptAllowsRetry, describeCampaignFailure, type CampaignAttempt } from '@/lib/bulk-campaign-attempts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { sendBulkCampaignMessage } from '@/lib/server/bulk-campaign-sender';

export async function getCampaignAttempts(client: any, campaign: BulkCampaign): Promise<CampaignAttempt[]> {
  const { data, error } = await client.from('bulk_campaign_attempts').select('draft_id,state,code,message,retry_at,updated_at')
    .eq('campaign_id', campaign.id).eq('organization_id', campaign.organization_id).eq('user_id', campaign.user_id);
  if (error) throw error;
  return data || [];
}

export async function sendTrackedCampaignMessage(campaign: BulkCampaign, message: CampaignRecipient['messages'][number]) {
  const admin = getSupabaseAdminClient();
  const attempts = await getCampaignAttempts(admin, campaign);
  const prior = attempts.find(value => value.draft_id === message.draftId);
  // A confirmed send is terminal even if dispatch retention later removes its row.
  if (prior?.state === 'sent') return { status: 'sent' as const, dispatch: null, replayed: true };
  if (!campaignAttemptAllowsRetry(prior)) return { status: 'deferred' as const, dispatch: null, replayed: false };
  async function record(state: CampaignAttempt['state'], code: string, copy: string, retryAt: string | null) {
    const { error } = await admin.rpc('record_bulk_campaign_attempt_v1', { p_campaign_id: campaign.id,
      p_draft_id: message.draftId, p_state: state, p_code: code, p_message: copy, p_retry_at: retryAt });
    if (error) throw error;
  }
  let result;
  try { result = await sendBulkCampaignMessage(campaign, message); }
  catch (error) {
    const value = error as { code?: string; message?: string };
    const code = value.message?.match(/BULK_CAMPAIGN_[A-Z_]+/)?.[0] || value.code || 'PRE_SEND_CHECK_FAILED';
    const failure = describeCampaignFailure(code);
    await record(failure.retryable ? 'retry_wait' : 'attention', code, failure.message,
      failure.retryable ? new Date(Date.now() + failure.delayMs).toISOString() : null);
    throw error;
  }
  if (result.status === 'sent') await record('sent', 'sent', 'Envío confirmado.', null);
  else if (result.status === 'deferred') {
    const code = result.dispatch?.errorCode || 'deferred';
    const failure = describeCampaignFailure(code);
    await record(failure.retryable ? 'retry_wait' : 'attention', code, failure.message,
      failure.retryable ? new Date(Date.now() + failure.delayMs).toISOString() : null);
  } else {
    await record('attention', result.dispatch?.errorCode || result.status,
      result.status === 'failed' ? 'No se pudo enviar el correo. Revisa el contacto y la cuenta de envío.' : 'El envío está pendiente de confirmación. No se repetirá automáticamente.', null);
  }
  return result;
}
