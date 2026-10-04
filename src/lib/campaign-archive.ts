import type { CampaignRunStatus, CampaignType } from '@/lib/campaign-settings';
import type { Campaign } from '@/lib/services/campaigns-service';
import type { ContactedLead } from '@/lib/types';

export type CampaignArchiveMetrics = { sent: number; opened: number; replied: number; clicked: number };

/** What each archived campaign achieved: the leads it reached (sentRecords) crossed with their contact history. */
export function campaignArchiveMetrics(campaigns: Pick<Campaign, 'id' | 'sentRecords'>[], contacted: Partial<ContactedLead>[]) {
  const byLead = new Map(contacted.map((lead) => [String(lead.leadId || lead.id || ''), lead]));
  const out: Record<string, CampaignArchiveMetrics> = {};
  for (const campaign of campaigns) {
    const reached = Object.keys(campaign.sentRecords || {});
    const metrics: CampaignArchiveMetrics = { sent: reached.length, opened: 0, replied: 0, clicked: 0 };
    for (const id of reached) {
      const lead = byLead.get(String(id));
      if (!lead) continue;
      if (lead.openedAt) metrics.opened++;
      if (lead.repliedAt || lead.status === 'replied') metrics.replied++;
      if (lead.clickedAt) metrics.clicked++;
    }
    out[campaign.id] = metrics;
  }
  return out;
}

export function campaignArchiveTypeLabel(type: CampaignType) {
  return type === 'reconnection' ? 'Reconexión' : 'Seguimiento';
}

/** The last automatic eligibility check, in words (these campaigns no longer send). */
export function campaignRunLabel(status?: CampaignRunStatus | null) {
  switch (status) {
    case 'success': return 'Revisada sin problemas';
    case 'partial': return 'Revisada en parte';
    case 'failed': return 'Revisión con fallos';
    case 'skipped': return 'Sin revisar';
    case 'idle': return 'Sin destinatarios elegibles';
    default: return 'Sin revisiones';
  }
}
