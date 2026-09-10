import { createMessagingSendMetadataV1, resolveApprovedEmailSendV1 } from '@/lib/messaging-contracts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCurrentMessagingDraftVersionV1 } from '@/lib/server/messaging-drafts';
import {
  dispatchOutboundMessage,
  OutboundDispatchConflictError,
  OutboundPreProviderDeferredError,
} from '@/lib/server/outbound-dispatch';
import { getEffectiveDailyQuotaLimits, reserveOutboundContactQuota } from '@/lib/server/daily-quota-store';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { resolveCampaignReplyTarget, ReplyTargetError } from '@/lib/server/reply-target';
import { tokenService } from '@/lib/services/token-service';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

export type AutoSendClaimedStep = {
  step_id: string;
  organization_id: string;
  user_id: string;
  campaign_id: string;
  enrollment_id: string;
  step_index: number;
  recipient_email: string;
  native_draft_id: string;
  native_version_id: string;
  due_at: string;
};

export type AutoSendOutcome = 'sent' | 'deferred' | 'blocked' | 'skipped' | 'failed';

export type AutoSendResult = {
  checked: number;
  sent: number;
  deferred: number;
  blocked: number;
  skipped: number;
  failed: number;
  businessDay: boolean;
};

export type AutoSendDependencies = {
  client?: SupabaseClientLike;
  now?: () => Date;
  claimSteps?: (client: SupabaseClientLike, limit: number) => Promise<AutoSendClaimedStep[]>;
  noteStepError?: (client: SupabaseClientLike, stepId: string, code: string) => Promise<void>;
  blockEnrollment?: (client: SupabaseClientLike, step: AutoSendClaimedStep, code: string) => Promise<void>;
  sendStep?: (client: SupabaseClientLike, step: AutoSendClaimedStep, now: Date) => Promise<AutoSendOutcome>;
};

const AUTO_SEND_TIME_ZONE = 'America/Santiago';

export function isAutoSendBusinessDay(now: Date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: AUTO_SEND_TIME_ZONE,
    weekday: 'short',
  }).format(now);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

async function defaultClaimSteps(client: SupabaseClientLike, limit: number) {
  const { data, error } = await client.rpc('claim_due_campaign_v2_auto_steps_v2', { p_limit: limit });
  if (error) throw error;
  return (data || []) as AutoSendClaimedStep[];
}

async function defaultNoteStepError(client: SupabaseClientLike, stepId: string, code: string) {
  await client
    .from('campaign_recipient_steps')
    .update({ last_error: code, updated_at: new Date().toISOString() })
    .eq('id', stepId)
    .eq('state', 'approved');
}

async function defaultBlockEnrollment(client: SupabaseClientLike, step: AutoSendClaimedStep, code: string) {
  await client
    .from('campaign_recipient_steps')
    .update({ state: 'blocked', last_error: code, updated_at: new Date().toISOString() })
    .eq('enrollment_id', step.enrollment_id)
    .not('state', 'in', '(sent,skipped,blocked)');
  await client
    .from('campaign_enrollments')
    .update({ status: 'blocked', updated_at: new Date().toISOString() })
    .eq('id', step.enrollment_id);
  await client
    .from('campaigns')
    .update({ v2_status: 'blocked', updated_at: new Date().toISOString() })
    .eq('id', step.campaign_id);
}

async function resolveAutoSendProvider(client: SupabaseClientLike, step: AutoSendClaimedStep) {
  // Follow-ups leave from the same account as the confirmed initial send.
  const initial = await client
    .from('campaign_recipient_steps')
    .select('outbound_dispatch_id')
    .eq('enrollment_id', step.enrollment_id)
    .eq('step_index', 0)
    .maybeSingle();
  if (initial.error) throw initial.error;
  if (initial.data?.outbound_dispatch_id) {
    const dispatch = await client
      .from('outbound_dispatches')
      .select('provider')
      .eq('id', initial.data.outbound_dispatch_id)
      .maybeSingle();
    if (dispatch.error) throw dispatch.error;
    if (dispatch.data?.provider === 'gmail' || dispatch.data?.provider === 'outlook') {
      return dispatch.data.provider as 'gmail' | 'outlook';
    }
  }
  const [google, outlook] = await Promise.all([
    tokenService.getToken(client as any, step.user_id, 'google'),
    tokenService.getToken(client as any, step.user_id, 'outlook'),
  ]);
  if (google && !outlook) return 'gmail' as const;
  if (outlook && !google) return 'outlook' as const;
  return null;
}

async function defaultSendStep(client: SupabaseClientLike, step: AutoSendClaimedStep, now: Date): Promise<AutoSendOutcome> {
  const scope = { organizationId: step.organization_id, userId: step.user_id };
  const current = await getCurrentMessagingDraftVersionV1({
    ...scope,
    draftId: step.native_draft_id,
  });
  if (!current || current.versionId !== step.native_version_id) return 'skipped';
  let canonical;
  try {
    canonical = resolveApprovedEmailSendV1(current);
  } catch {
    return 'skipped';
  }
  if (canonical.to.trim().toLowerCase() !== step.recipient_email.trim().toLowerCase()) return 'skipped';

  let suppressed = false;
  try {
    suppressed = await isEmailSuppressedForScope(canonical.to, scope);
  } catch {
    await defaultNoteStepError(client, step.step_id, 'recipient_check_unavailable');
    return 'deferred';
  }
  if (suppressed) {
    await defaultBlockEnrollment(client, step, 'recipient_suppressed');
    return 'blocked';
  }

  const provider = await resolveAutoSendProvider(client, step);
  if (!provider) {
    await defaultNoteStepError(client, step.step_id, 'provider_not_connected');
    return 'deferred';
  }

  const unsubscribeUrl = generateUnsubscribeLink(canonical.to, step.user_id, step.organization_id);
  const prepared = prepareOutboundEmail({
    text: canonical.text || undefined,
    html: canonical.html || undefined,
    unsubscribeUrl,
  });
  const check = validateOutboundEmail({
    to: canonical.to,
    subject: canonical.subject,
    ...prepared,
    requireUnsubscribe: true,
    unsubscribeUrl,
  });
  if (!check.ok) {
    await defaultNoteStepError(client, step.step_id, 'content_invalid');
    return 'failed';
  }

  const metadata = createMessagingSendMetadataV1(canonical.draft, {
    idempotencyKey: `campaign-v2:auto:${step.step_id}:${step.native_version_id}`,
    provider,
    requestedAt: now.toISOString(),
  });

  try {
    const result = await dispatchOutboundMessage({
      draft: canonical.draft,
      metadata,
      provider: {
        async send({ dispatchId }) {
          // First follow-up answers the initial thread on Gmail; later steps
          // open a new thread, matching the outreach playbook.
          let replyTarget = null;
          if (step.step_index === 1) {
            try {
              replyTarget = await resolveCampaignReplyTarget(client, canonical.draft, provider, 'reply_first');
            } catch (error) {
              if (!(error instanceof ReplyTargetError)) {
                throw new OutboundPreProviderDeferredError('Reply history could not be verified.', {
                  code: 'reply_history_unavailable',
                  cause: error,
                });
              }
            }
          }
          let accessToken: string;
          try {
            const token = await tokenService.getToken(client as any, step.user_id, provider === 'gmail' ? 'google' : 'outlook');
            if (!token) throw new Error('PROVIDER_NOT_CONNECTED');
            if (provider === 'gmail') {
              const refreshed = await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
              accessToken = refreshed.access_token;
            } else {
              const refreshed = await refreshMicrosoftToken(token.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
              accessToken = refreshed.access_token;
            }
          } catch (cause) {
            throw new OutboundPreProviderDeferredError('Reconecta tu cuenta de correo para continuar.', {
              code: 'provider_connection_unavailable',
              cause,
              retryAfterMs: 3600000,
            });
          }
          let quota;
          try {
            const limits = await getEffectiveDailyQuotaLimits(scope);
            quota = await reserveOutboundContactQuota({ ...scope, dispatchId, limit: limits.contact });
          } catch (cause) {
            throw new OutboundPreProviderDeferredError('No se pudo reservar la cuota.', {
              code: 'quota_reservation_unavailable',
              cause,
            });
          }
          if (!quota.allowed) {
            return { outcome: 'deferred' as const, code: 'daily_quota_exceeded', message: 'Se alcanzó el límite diario.', retryAfterMs: 3600000 };
          }
          const receipt = provider === 'gmail'
            ? await sendGmail(accessToken, canonical.to, canonical.subject, prepared.html, {
              textBody: prepared.text, unsubscribeUrl, idempotencyKey: metadata.idempotencyKey,
              ...(replyTarget ? { replyTarget } : {}),
            })
            : await sendOutlook(accessToken, canonical.to, canonical.subject, prepared.html, {
              textBody: prepared.text, unsubscribeUrl, idempotencyKey: metadata.idempotencyKey,
            });
          const response = (receipt || {}) as Record<string, unknown>;
          return {
            outcome: 'accepted' as const,
            providerMessageId: String(response.id || response.messageId || response.internetMessageId || ''),
            response: receipt,
          };
        },
      },
    });
    if (result.status === 'sent') return 'sent';
    if (result.status === 'deferred') {
      await defaultNoteStepError(client, step.step_id, result.dispatch?.errorCode || 'send_deferred');
      return 'deferred';
    }
    await defaultNoteStepError(client, step.step_id, result.dispatch?.errorCode || 'send_failed');
    return 'failed';
  } catch (error) {
    if (error instanceof OutboundDispatchConflictError) return 'skipped';
    if (error instanceof OutboundPreProviderDeferredError) {
      await defaultNoteStepError(client, step.step_id, 'send_deferred');
      return 'deferred';
    }
    await defaultNoteStepError(client, step.step_id, 'send_failed');
    return 'failed';
  }
}

export async function runCampaignV2AutoSend(input: {
  limit?: number;
  client?: SupabaseClientLike;
  now?: () => Date;
  claimSteps?: AutoSendDependencies['claimSteps'];
  noteStepError?: AutoSendDependencies['noteStepError'];
  blockEnrollment?: AutoSendDependencies['blockEnrollment'];
  sendStep?: AutoSendDependencies['sendStep'];
} = {}): Promise<AutoSendResult> {
  const now = (input.now ?? (() => new Date()))();
  // The admin client is only required when a default database-backed
  // dependency runs. Injected fakes (unit tests) never touch the network.
  const usesDefaults = !input.claimSteps || !input.sendStep;
  const client = input.client ?? (usesDefaults ? getSupabaseAdminClient() : ({} as SupabaseClientLike));
  const result: AutoSendResult = {
    checked: 0, sent: 0, deferred: 0, blocked: 0, skipped: 0, failed: 0,
    businessDay: isAutoSendBusinessDay(now),
  };
  // No weekend sends: due steps wait for Monday, preserving the cadence intent.
  if (!result.businessDay) return result;
  const claimSteps = input.claimSteps ?? defaultClaimSteps;
  const sendStep = input.sendStep ?? defaultSendStep;
  const steps = await claimSteps(client, input.limit ?? 25);
  result.checked = steps.length;
  for (const step of steps) {
    const outcome = await sendStep(client, step, now);
    result[outcome] += 1;
  }
  return result;
}
