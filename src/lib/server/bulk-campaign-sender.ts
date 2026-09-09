import type { BulkCampaign, CampaignRecipient } from '@/lib/bulk-campaigns';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCurrentMessagingDraftVersionV1 } from '@/lib/server/messaging-drafts';
import { createMessagingSendMetadataV1, resolveApprovedEmailSendV1 } from '@/lib/messaging-contracts';
import { dispatchOutboundMessage, OutboundPreProviderDeferredError } from '@/lib/server/outbound-dispatch';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { encryptStoredToken } from '@/lib/server/token-crypto';
import { getEffectiveDailyQuotaLimits, reserveOutboundContactQuota } from '@/lib/server/daily-quota-store';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';

/** Only trusted server callers supply the persisted campaign. SQL enforces its frozen review on every claim. */
export async function sendBulkCampaignMessage(campaign: BulkCampaign, message: CampaignRecipient['messages'][number]) {
  if (process.env.BULK_CAMPAIGNS_ENABLED !== 'true') throw new Error('BULK_CAMPAIGNS_DISABLED');
  const scope = { organizationId: campaign.organization_id, userId: campaign.user_id };
  const current = await getCurrentMessagingDraftVersionV1({ ...scope, draftId: message.draftId });
  if (!current || current.versionId !== message.versionId) throw new Error('BULK_CAMPAIGN_REVIEW_CHANGED');
  const canonical = resolveApprovedEmailSendV1(current);
  if (canonical.subject !== message.subject || canonical.text !== message.body) throw new Error('BULK_CAMPAIGN_REVIEW_CHANGED');
  const unsubscribeUrl = generateUnsubscribeLink(canonical.to, scope.userId, scope.organizationId);
  const prepared = prepareOutboundEmail({ text: canonical.text || undefined, html: canonical.html || undefined, unsubscribeUrl });
  const check = validateOutboundEmail({ to: canonical.to, subject: canonical.subject, ...prepared, requireUnsubscribe: true, unsubscribeUrl });
  if (!check.ok) throw new Error(check.errors.join(' '));
  const provider = campaign.definition.provider;
  const metadata = createMessagingSendMetadataV1(current, {
    idempotencyKey: `bulk:${campaign.id}:${message.draftId}`,
    provider: provider === 'google' ? 'gmail' : 'outlook', requestedAt: new Date().toISOString(),
  });
  return dispatchOutboundMessage({ draft: current, metadata, provider: {
    async send({ dispatchId }) {
      const admin = getSupabaseAdminClient();
      // This callback runs only for a durable claim; replays cannot refresh tokens or contact a provider.
      const { data: latest, error } = await admin.from('bulk_campaigns').select('status,review_hash').eq('id', campaign.id).single();
      if (error) throw new OutboundPreProviderDeferredError('No se pudo verificar la campaña.', { code: 'campaign_read_unavailable' });
      if (latest.status !== 'approved' || latest.review_hash !== campaign.review_hash) return { outcome: 'deferred', code: 'campaign_paused', message: 'La campaña está en pausa o cambió.' };
      let suppressed;
      try { suppressed = await isEmailSuppressedForScope(canonical.to, scope); }
      catch (cause) { throw new OutboundPreProviderDeferredError('No se pudo verificar el estado del contacto.', { code: 'recipient_check_unavailable', cause }); }
      if (suppressed) return { outcome: 'rejected', code: 'recipient_suppressed', message: 'El contacto se dio de baja.' };
      let accessToken: string;
      try {
        const token = await tokenService.getToken(admin, scope.userId, provider);
        if (!token) throw new Error('PROVIDER_NOT_CONNECTED');
        if (provider === 'google') {
          const refreshed = await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
          accessToken = refreshed.access_token;
        } else {
          const refreshed = await refreshMicrosoftToken(token.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
          accessToken = refreshed.access_token;
          if (refreshed.refresh_token) {
            const saved = await admin.from('provider_tokens').update({ refresh_token: encryptStoredToken(refreshed.refresh_token), updated_at: new Date().toISOString() }).eq('user_id', scope.userId).eq('provider', provider);
            if (saved.error) throw saved.error;
          }
        }
      } catch (cause) {
        throw new OutboundPreProviderDeferredError('Reconecta tu cuenta de correo para continuar.', { code: 'provider_connection_unavailable', cause, retryAfterMs: 3600000 });
      }
      let quota;
      try {
        const limits = await getEffectiveDailyQuotaLimits(scope);
        quota = await reserveOutboundContactQuota({ ...scope, dispatchId, limit: limits.contact });
      } catch (cause) { throw new OutboundPreProviderDeferredError('No se pudo reservar la cuota.', { code: 'quota_reservation_unavailable', cause }); }
      if (!quota.allowed) return { outcome: 'deferred', code: 'daily_quota_exceeded', message: 'Se alcanzó el límite diario de contactos.', retryAfterMs: 3600000 };
      const receipt = provider === 'google'
        ? await sendGmail(accessToken, canonical.to, canonical.subject, prepared.html, { textBody: prepared.text, unsubscribeUrl, idempotencyKey: metadata.idempotencyKey })
        : await sendOutlook(accessToken, canonical.to, canonical.subject, prepared.html, { textBody: prepared.text, unsubscribeUrl, idempotencyKey: metadata.idempotencyKey });
      const response = (receipt || {}) as Record<string, unknown>;
      return { outcome: 'accepted', providerMessageId: String(response.id || response.messageId || response.internetMessageId || ''), response };
    },
  } });
}
