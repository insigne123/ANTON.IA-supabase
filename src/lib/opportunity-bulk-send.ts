import { buildManualEmailOperation } from '@/lib/manual-send-idempotency';

export type OpportunityBulkProvider = 'gmail' | 'outlook';

export type OpportunityComposeDraft = {
  recipientId: string;
  email: string;
  subject: string;
  body: string;
  organizationId?: string | null;
};

export type OpportunitySendRequest = OpportunityComposeDraft & {
  provider: OpportunityBulkProvider;
  htmlBody: string;
  idempotencyKey: string;
};

export type OpportunitySendReceipt = {
  recipientId: string;
  email: string;
  idempotencyKey: string;
  status: 'sent' | 'failed' | 'unknown';
  receipt?: unknown;
  error?: string;
};

export function buildOpportunitySendRequests(input: {
  composeId: string;
  provider: OpportunityBulkProvider;
  drafts: OpportunityComposeDraft[];
  deliveryOptions?: { pixel?: boolean; links?: boolean; readReceipt?: boolean };
}): OpportunitySendRequest[] {
  return input.drafts.map((draft) => {
    const operation = buildManualEmailOperation(input.composeId, {
      scope: 'opportunity-compose',
      recipientId: draft.recipientId,
      email: draft.email,
      subject: draft.subject,
      body: draft.body,
      provider: input.provider,
      deliveryOptions: input.deliveryOptions,
    });
    return {
      ...draft,
      provider: input.provider,
      htmlBody: `<p>${draft.body.replace(/\n/g, '<br/>')}</p>`,
      idempotencyKey: operation.idempotencyKey,
    };
  });
}

export async function sendOpportunityRequestsSequentially(
  requests: OpportunitySendRequest[],
  send: (request: OpportunitySendRequest) => Promise<{ status?: string; receipt?: unknown; error?: string }>,
): Promise<OpportunitySendReceipt[]> {
  const results: OpportunitySendReceipt[] = [];

  for (const request of requests) {
    try {
      const result = await send(request);
      const status = result.status === 'sent' ? 'sent' : result.status === 'failed' ? 'failed' : 'unknown';
      results.push({
        recipientId: request.recipientId,
        email: request.email,
        idempotencyKey: request.idempotencyKey,
        status,
        receipt: result.receipt,
        ...(status !== 'sent' ? { error: result.error || 'El proveedor no confirmó el envío.' } : {}),
      });
    } catch (error) {
      results.push({
        recipientId: request.recipientId,
        email: request.email,
        idempotencyKey: request.idempotencyKey,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function reconcileOpportunitySendResults<T extends OpportunityComposeDraft>(drafts: T[], receipts: OpportunitySendReceipt[]) {
  const sentIds = new Set(receipts.filter((receipt) => receipt.status === 'sent').map((receipt) => receipt.recipientId));
  const failedDrafts = drafts.filter((draft) => !sentIds.has(draft.recipientId));
  return {
    sentCount: sentIds.size,
    failedCount: failedDrafts.length,
    failedDrafts,
  };
}
