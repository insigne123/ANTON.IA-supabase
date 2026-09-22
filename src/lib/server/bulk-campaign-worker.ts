import { nextCampaignMessage, type BulkCampaign, type CampaignDelivery } from '@/lib/bulk-campaigns';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCampaignAttempts, sendTrackedCampaignMessage } from '@/lib/server/bulk-campaign-attempts';
import { campaignAttemptAllowsRetry, withSentAttemptsAsDeliveries, type CampaignAttempt } from '@/lib/bulk-campaign-attempts';

export type BulkWorkerDependencies = {
  list: () => Promise<BulkCampaign[]>;
  deliveries: (campaign: BulkCampaign) => Promise<CampaignDelivery[]>;
  send: typeof sendTrackedCampaignMessage;
  attempts: (campaign: BulkCampaign) => Promise<CampaignAttempt[]>;
  touch: (campaign: BulkCampaign) => Promise<void>;
  now: () => number;
  /** 4.1: espaciado minimo entre envios del mismo lote Cowork, en minutos.
   * Ausente en dependencias heredadas: sin fila de lote no hay espaciado. */
  batchSpacing?: (campaign: BulkCampaign) => Promise<number>;
};
function dependencies(): BulkWorkerDependencies {
  const admin = getSupabaseAdminClient();
  return {
    now: Date.now, send: sendTrackedCampaignMessage,
    attempts: campaign => getCampaignAttempts(admin, campaign),
    async list() {
      // Touching attempted batches rotates the queue so one failing campaign cannot starve others.
      const { data, error } = await admin.from('bulk_campaigns').select('*').eq('status', 'approved').order('updated_at').order('id').limit(20);
      if (error) throw error;
      return data || [];
    },
    async deliveries(campaign) {
      const ids = campaign.recipients.flatMap(person => person.messages.map(message => message.draftId));
      const { data, error } = await admin.from('outbound_dispatches').select('draft_id,status,completed_at,error_message')
        .eq('organization_id', campaign.organization_id).eq('user_id', campaign.user_id).in('draft_id', ids).limit(1000);
      if (error) throw error;
      return data || [];
    },
    async touch(campaign) {
      const { error } = await admin.from('bulk_campaigns').update({ updated_at: new Date().toISOString() }).eq('id', campaign.id).eq('status', 'approved');
      if (error) throw error;
    },
    async batchSpacing(campaign) {
      const { data, error } = await admin.from('cowork_send_batches')
        .select('spacing_minutes').eq('organization_id', campaign.organization_id).eq('campaign_id', campaign.id).maybeSingle();
      if (error) throw error;
      if (!data) return 0;
      const minutes = Number((data as { spacing_minutes?: unknown }).spacing_minutes || 0);
      return Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 24 * 60) : 0;
    },
  };
}

export async function runBulkCampaignWorker(deps: BulkWorkerDependencies = dependencies(), budgetMs = 45000) {
  const started = deps.now();
  const summary = { attempted: 0, sent: 0, deferred: 0, attention: 0, campaigns: 0 };
  for (const campaign of await deps.list()) {
    if (deps.now() - started >= budgetMs || summary.attempted >= 20) break;
    if (campaign.status !== 'approved' || !campaign.approved_at) continue;
    summary.campaigns++;
    try {
      const attempts = await deps.attempts(campaign);
      const deliveries = withSentAttemptsAsDeliveries(await deps.deliveries(campaign), attempts);
      const spacingMinutes = deps.batchSpacing ? await deps.batchSpacing(campaign) : 0;
      {
        if (spacingMinutes > 0) {
          const lastSent = deliveries
            .filter(delivery => delivery.status === 'sent' && delivery.completed_at)
            .map(delivery => Date.parse(String(delivery.completed_at)))
            .filter(timestamp => Number.isFinite(timestamp));
          if (lastSent.length && deps.now() - Math.max(...lastSent) < spacingMinutes * 60000) continue;
        }
      }
      for (const person of campaign.recipients) {
        if (deps.now() - started >= budgetMs || summary.attempted >= 20) break;
        const next = nextCampaignMessage(person, deliveries, campaign.approved_at, deps.now());
        if (!next || next.state !== 'ready') continue;
        if (!campaignAttemptAllowsRetry(attempts.find(value => value.draft_id === next.message.draftId), deps.now())) continue;
        summary.attempted++;
        try {
          const result = await deps.send(campaign, next.message);
          if (result.status === 'sent') {
            summary.sent++;
            if (spacingMinutes > 0) break;
          }
          else if (result.status === 'deferred') { summary.deferred++; break; }
          else { summary.attention++; if (spacingMinutes > 0) break; }
        } catch { summary.attention++; if (spacingMinutes > 0) break; }
      }
    } catch { summary.attention++; }
    finally {
      try { await deps.touch(campaign); } catch { summary.attention++; }
    }
  }
  return summary;
}
