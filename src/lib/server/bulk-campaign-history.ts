import { z } from 'zod';
import { AuthError, type AuthContext } from '@/lib/server/auth-utils';
import { buildRecipientHistory, type BulkCampaign, type CampaignHistoryEvent } from '@/lib/bulk-campaigns';
import { campaignDeliveries, getBulkCampaign } from '@/lib/server/bulk-campaigns';
import { getCampaignAttempts } from '@/lib/server/bulk-campaign-attempts';

function exactIlike(value: string) {
  return value.replace(/[\\%_*]/g, '\\$&');
}

export async function getBulkRecipientHistory(auth: AuthContext, campaignId: string, email: string): Promise<{ recipient: { email: string; name: string }; events: CampaignHistoryEvent[] }> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!z.string().email().safeParse(normalized).success) throw new AuthError('Correo inválido.', 400);
  const campaign: BulkCampaign = await getBulkCampaign(auth, campaignId);
  const recipient = campaign.recipients.find(person => person.email === normalized);
  if (!recipient) throw new AuthError('El destinatario no pertenece a esta campaña.', 404);
  const [deliveries, attempts, contacted] = await Promise.all([
    campaignDeliveries(auth, campaign),
    getCampaignAttempts(auth.supabase, campaign),
    auth.supabase.from('contacted_leads').select('status,sent_at,replied_at,subject')
      .eq('organization_id', auth.organizationId).ilike('email', exactIlike(normalized))
      .order('sent_at', { ascending: false }).limit(50),
  ]);
  if (contacted.error) throw contacted.error;
  return {
    recipient: { email: recipient.email, name: recipient.name },
    events: buildRecipientHistory({
      recipient,
      deliveries: deliveries.filter(row => recipient.messages.some(message => message.draftId === row.draft_id)),
      attempts: attempts.filter(row => recipient.messages.some(message => message.draftId === row.draft_id)),
      contactedRows: contacted.data || [],
      approvedAt: campaign.approved_at,
    }),
  };
}
