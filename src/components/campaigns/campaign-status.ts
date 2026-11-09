import type { BadgeProps } from '@/components/ui/badge';
import type { BulkCampaign } from '@/lib/bulk-campaigns';
import type { RecipientTone } from '@/lib/bulk-campaign-progress';

type Variant = NonNullable<BadgeProps['variant']>;

/**
 * The state of a campaign in one word, the same in the list and inside it. A campaign is the author's own, so «rechazada»
 * («Cambios solicitados») is a draft being edited; an approved one whose every sequence ended reads «Terminada».
 */
export function campaignStatusBadge(status: BulkCampaign['status'], finished = false): { label: string; variant: Variant } {
  if (status === 'approved') return finished ? { label: 'Terminada', variant: 'neutral' } : { label: 'Activa', variant: 'success' };
  if (status === 'paused') return { label: 'En pausa', variant: 'warning' };
  return { label: 'Borrador', variant: 'info' };
}

export const RECIPIENT_TONE_VARIANT: Record<RecipientTone, Variant> = {
  replied: 'success',
  done: 'neutral',
  scheduled: 'neutral',
  ready: 'info',
  sending: 'info',
  confirming: 'info',
  retrying: 'warning',
  attention: 'warning',
  failed: 'danger',
};

/** «tu Gmail» / «tu Outlook»: the mailbox the campaign writes from. */
export const providerName = (provider: 'google' | 'outlook') => (provider === 'outlook' ? 'Outlook' : 'Gmail');
