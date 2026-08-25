import type {
  CampaignV2DraftGeneration,
  CampaignV2DraftSummary,
  CampaignV2RecipientStepSendContextResponse,
  CampaignV2StepDispatch,
  CampaignV2StepState,
} from '@/lib/campaigns-v2/contracts';
import type { DurableSendReceipt } from '@/lib/outbound-send-receipt';

export type FirstContactFollowUpStep = {
  id: string;
  name: string;
  kind: 'follow_up';
  offsetDays: number;
  state: CampaignV2StepState;
  dueAt: string | null;
  nativeDraftId: string | null;
  draft: CampaignV2DraftSummary | null;
  draftGeneration: CampaignV2DraftGeneration;
};

export type FirstContactFollowUpPlan = {
  campaignId: string;
  campaignName: string;
  lifecycleState: string;
  enrollmentId: string;
  enrollmentState: string;
  nextDueAt: string | null;
  steps: FirstContactFollowUpStep[];
};

export type FirstContactPlanResponse = {
  enabled: boolean;
  plan: FirstContactFollowUpPlan | null;
};

export type FirstContactFollowUpInput = {
  name: string;
  offsetDays: number;
  instruction: string;
};

export type StoppedFirstContactFollowUp = {
  id: string;
  campaignId: string;
  status: 'stopped';
  stoppedAt: string;
  recipientName: string | null;
  recipientEmail: string;
};

export type CampaignV2SendAvailability =
  | { kind: 'new_send' }
  | { kind: 'safe_retry'; idempotencyKey: string; provider: 'outlook' | 'gmail' }
  | { kind: 'blocked' };

const campaignV2StepStates = new Set([
  'pending_initial_send', 'not_due', 'ready_to_prepare', 'drafting',
  'review_required', 'approved', 'dispatch_pending', 'sending', 'sent',
  'deferred', 'failed', 'unknown', 'skipped', 'blocked',
]);
const campaignV2DispatchStatuses = new Set(['pending', 'sending', 'sent', 'failed', 'deferred', 'unknown']);
const defaultCampaignV2SequenceInstruction =
  'Haz avanzar la conversación de forma breve y útil, sin repetir los correos anteriores.';

function apiMessage(payload: any, fallback: string) {
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
  return fallback;
}

function isCampaignV2SendContext(payload: any, stepId: string): payload is CampaignV2RecipientStepSendContextResponse {
  if (!payload || payload.stepId !== stepId || typeof payload.organizationId !== 'string' || !payload.organizationId.trim()
    || !campaignV2StepStates.has(payload.state)) return false;
  const hasDraft = typeof payload.nativeDraftId === 'string' && Boolean(payload.nativeDraftId);
  const hasVersion = typeof payload.nativeVersionId === 'string' && Boolean(payload.nativeVersionId);
  if (hasDraft !== hasVersion) return false;
  if (payload.nativeDraftId !== null && !hasDraft) return false;
  if (payload.nativeVersionId !== null && !hasVersion) return false;
  if (payload.dispatch === null) return true;
  const dispatch = payload.dispatch;
  if (!dispatch || typeof dispatch.id !== 'string' || !campaignV2DispatchStatuses.has(dispatch.status)) return false;
  if (typeof dispatch.idempotencyKey !== 'string' || !dispatch.idempotencyKey.trim()) return false;
  if (typeof dispatch.provider !== 'string' || !dispatch.provider.trim()) return false;
  return dispatch.retry === null || dispatch.retry?.retryable === true;
}

export async function loadCampaignV2RecipientStepSendContext(
  stepId: string,
  signal?: AbortSignal,
): Promise<CampaignV2RecipientStepSendContextResponse> {
  const response = await fetch(
    `/api/campaigns/v2/recipient-steps/${encodeURIComponent(stepId)}/send-context`,
    { cache: 'no-store', signal },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !isCampaignV2SendContext(payload, stepId)) {
    throw new Error(apiMessage(payload, 'No pudimos confirmar el estado de este envío.'));
  }
  return payload;
}

export function campaignV2SendAvailability(
  context: CampaignV2RecipientStepSendContextResponse,
): CampaignV2SendAvailability {
  const dispatch = context.dispatch;
  if (!dispatch) {
    return context.state === 'pending_initial_send' || context.state === 'approved'
      ? { kind: 'new_send' }
      : { kind: 'blocked' };
  }

  const provider = dispatch.provider === 'gmail' || dispatch.provider === 'outlook'
    ? dispatch.provider
    : null;
  if (dispatch.status === 'pending' && context.state === 'dispatch_pending' && provider) {
    return {
      kind: 'safe_retry',
      idempotencyKey: dispatch.idempotencyKey,
      provider,
    };
  }
  if (
    dispatch.status === 'deferred'
    && context.state === 'deferred'
    && dispatch.retry?.retryable === true
    && provider
  ) {
    return {
      kind: 'safe_retry',
      idempotencyKey: dispatch.idempotencyKey,
      provider,
    };
  }
  return { kind: 'blocked' };
}

export function resolveCampaignV2SendKey(
  context: CampaignV2RecipientStepSendContextResponse,
  createNewKey: () => string,
) {
  const availability = campaignV2SendAvailability(context);
  if (availability.kind === 'safe_retry') return availability.idempotencyKey;
  if (availability.kind === 'new_send') return createNewKey();
  return null;
}

export function campaignV2DispatchReceipt(dispatch: CampaignV2StepDispatch): DurableSendReceipt {
  const hasError = Boolean(dispatch.errorCode || dispatch.errorMessage);
  return {
    dispatchId: dispatch.id,
    status: dispatch.status,
    replayed: true,
    providerMessageId: dispatch.providerMessageId,
    ...(dispatch.retry ? { retry: dispatch.retry } : {}),
    ...(hasError ? {
      error: {
        code: dispatch.errorCode,
        message: dispatch.errorMessage,
      },
    } : {}),
  };
}

export async function loadFirstContactFollowUpPlan(draftId: string, signal?: AbortSignal): Promise<FirstContactPlanResponse> {
  const response = await fetch(`/api/campaigns/v2/first-contact-plans?draftId=${encodeURIComponent(draftId)}`, {
    cache: 'no-store',
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.enabled !== 'boolean') {
    throw new Error(apiMessage(payload, 'No pudimos cargar el seguimiento.'));
  }
  return {
    enabled: payload.enabled,
    plan: payload.plan || null,
  };
}

export async function saveFirstContactFollowUpPlan(input: {
  draftId: string;
  versionId: string;
  styleProfileId?: string | null;
  sequenceInstruction?: string;
  steps: FirstContactFollowUpInput[];
}): Promise<FirstContactPlanResponse> {
  const response = await fetch('/api/campaigns/v2/first-contact-plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      sequenceInstruction: input.sequenceInstruction || defaultCampaignV2SequenceInstruction,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.enabled !== true || !payload?.plan) {
    throw new Error(apiMessage(payload, 'No pudimos guardar el seguimiento.'));
  }
  return { enabled: true, plan: payload.plan };
}

export async function retryFirstContactFollowUpDraft(input: {
  draftId: string;
  stepId: string;
}): Promise<FirstContactPlanResponse> {
  const response = await fetch('/api/campaigns/v2/first-contact-plans', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.enabled !== true || !payload?.plan) {
    throw new Error(apiMessage(payload, 'No pudimos regenerar este seguimiento.'));
  }
  return { enabled: true, plan: payload.plan };
}

export async function stopFirstContactFollowUpPlan(input: {
  campaignId: string;
  enrollmentId: string;
}): Promise<StoppedFirstContactFollowUp> {
  const response = await fetch(
    `/api/campaigns/v2/${encodeURIComponent(input.campaignId)}/enrollments/${encodeURIComponent(input.enrollmentId)}/stop`,
    { method: 'POST' },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== 'stopped') {
    throw new Error(apiMessage(payload, 'No pudimos detener el seguimiento.'));
  }
  return payload as StoppedFirstContactFollowUp;
}
