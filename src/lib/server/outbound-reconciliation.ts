import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { tokenService } from '@/lib/services/token-service';
import {
  reconcileUnknownOutboundDispatch,
  type OutboundDispatch,
  type OutboundDispatchReconciliationEvidence,
} from '@/lib/server/outbound-dispatch';
import { repairReconciledSentDispatchHistory } from '@/lib/server/outbound-reconciliation-history';

type RepairableOutboundDispatch = OutboundDispatch & {
  historyRepairStatus: 'pending' | 'complete' | 'failed';
  historyRepairAttemptCount: number;
  lastHistoryRepairAt: string | null;
  historyRepairError: string | null;
};

function normalize(value: unknown) {
  return String(value || '').trim();
}

function mapRow(row: any): RepairableOutboundDispatch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    draftId: row.draft_id,
    versionId: row.version_id,
    idempotencyKey: row.idempotency_key,
    contentHash: row.content_hash,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    metadata: row.metadata,
    providerMessageId: row.provider_message_id ?? null,
    providerResponse: row.provider_response ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    reconciliationAttemptCount: Number(row.reconciliation_attempt_count || 0),
    lastReconciliationAt: row.last_reconciliation_at ?? null,
    reconciliationClaimedAt: row.reconciliation_claimed_at ?? null,
    reconciledAt: row.reconciled_at ?? null,
    reconciliationDetails: row.reconciliation_details ?? null,
    historyRepairStatus: row.history_repair_status || 'pending',
    historyRepairAttemptCount: Number(row.history_repair_attempt_count || 0),
    lastHistoryRepairAt: row.last_history_repair_at ?? null,
    historyRepairError: row.history_repair_error ?? null,
  };
}

function requestedWindow(dispatch: OutboundDispatch) {
  const requestedAt = Date.parse(dispatch.metadata.requestedAt || dispatch.createdAt);
  const base = Number.isFinite(requestedAt) ? requestedAt : Date.parse(dispatch.createdAt);
  return {
    fromMs: base - 5 * 60 * 1000,
    toMs: base + 30 * 60 * 1000,
  };
}

function headerValue(headers: any[], name: string) {
  return normalize(headers.find((header) => normalize(header?.name).toLowerCase() === name.toLowerCase())?.value);
}

async function reconcileGmail(
  token: string,
  dispatch: OutboundDispatch,
  subject: string,
): Promise<OutboundDispatchReconciliationEvidence> {
  const recipient = normalize(dispatch.metadata.recipient.email).toLowerCase();
  const window = requestedWindow(dispatch);
  const afterSeconds = Math.floor(window.fromMs / 1000);
  const query = new URLSearchParams({
    labelIds: 'SENT',
    maxResults: '100',
    q: `to:${recipient} after:${afterSeconds} before:${Math.ceil(window.toMs / 1000)}`,
  });
  const candidates: any[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page += 1) {
    if (pageToken) query.set('pageToken', pageToken);
    const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!listResponse.ok) {
      return { outcome: 'unresolved', details: { provider: 'gmail', httpStatus: listResponse.status } };
    }
    const list = await listResponse.json();
    candidates.push(...(Array.isArray(list?.messages) ? list.messages : []));
    pageToken = normalize(list?.nextPageToken);
    if (!pageToken) break;
  }
  const matches: any[] = [];
  for (const candidate of candidates) {
    const messageResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(candidate.id)}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=X-ANTON-Dispatch`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    );
    if (!messageResponse.ok) continue;
    const message = await messageResponse.json();
    const sentAt = Number(message?.internalDate || 0);
    const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
    const to = headerValue(headers, 'To').toLowerCase();
    const foundSubject = headerValue(headers, 'Subject');
    const dispatchKey = headerValue(headers, 'X-ANTON-Dispatch');
    if (dispatchKey === dispatch.idempotencyKey && to.includes(recipient) && foundSubject === subject && sentAt >= window.fromMs && sentAt <= window.toMs) {
      matches.push(message);
    }
  }

  if (matches.length !== 1) {
    return { outcome: 'unresolved', details: { provider: 'gmail', matchingSentMessages: matches.length } };
  }
  return {
    outcome: 'sent',
    providerMessageId: matches[0].id,
    providerResponse: { id: matches[0].id, threadId: matches[0].threadId || null },
    details: {
      provider: 'gmail',
      source: 'sent_mailbox_exact_match',
      sentAt: new Date(Number(matches[0].internalDate)).toISOString(),
    },
  };
}

async function reconcileOutlook(
  token: string,
  dispatch: OutboundDispatch,
  subject: string,
): Promise<OutboundDispatchReconciliationEvidence> {
  const recipient = normalize(dispatch.metadata.recipient.email).toLowerCase();
  const window = requestedWindow(dispatch);
  const query = new URLSearchParams({
    '$select': 'id,subject,conversationId,internetMessageId,internetMessageHeaders,toRecipients,sentDateTime',
    '$orderby': 'sentDateTime desc',
    '$top': '100',
    '$filter': `sentDateTime ge ${new Date(window.fromMs).toISOString()} and sentDateTime le ${new Date(window.toMs).toISOString()}`,
  });
  const messages: any[] = [];
  let nextUrl = `https://graph.microsoft.com/v1.0/me/mailFolders('SentItems')/messages?${query}`;
  for (let page = 0; page < 5 && nextUrl; page += 1) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
      cache: 'no-store',
    });
    if (!response.ok) {
      return { outcome: 'unresolved', details: { provider: 'outlook', httpStatus: response.status } };
    }
    const body = await response.json();
    messages.push(...(Array.isArray(body?.value) ? body.value : []));
    nextUrl = normalize(body?.['@odata.nextLink']);
  }
  const matches = messages.filter((message: any) => (
    normalize(message?.subject) === subject
    && (message?.toRecipients || []).some((item: any) => normalize(item?.emailAddress?.address).toLowerCase() === recipient)
    && (message?.internetMessageHeaders || []).some((header: any) => (
      normalize(header?.name).toLowerCase() === 'x-anton-dispatch'
      && normalize(header?.value) === dispatch.idempotencyKey
    ))
  ));
  if (matches.length !== 1) {
    return { outcome: 'unresolved', details: { provider: 'outlook', matchingSentMessages: matches.length } };
  }
  return {
    outcome: 'sent',
    providerMessageId: matches[0].id,
    providerResponse: {
      id: matches[0].id,
      messageId: matches[0].id,
      conversationId: matches[0].conversationId || null,
      internetMessageId: matches[0].internetMessageId || null,
    },
    details: {
      provider: 'outlook',
      source: 'sent_mailbox_exact_match',
      sentAt: normalize(matches[0].sentDateTime) || null,
    },
  };
}

async function reconcileProvider(dispatch: OutboundDispatch, subject: string) {
  const admin = getSupabaseAdminClient();
  if (dispatch.provider === 'gmail') {
    const token = await tokenService.getToken(admin, dispatch.userId, 'google');
    if (!token) return { outcome: 'unresolved' as const, details: { provider: 'gmail', reason: 'token_missing' } };
    try {
      const refreshed = await refreshGoogleToken(
        token.refresh_token,
        process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        process.env.GOOGLE_CLIENT_SECRET!,
      );
      return reconcileGmail(refreshed.access_token, dispatch, subject);
    } catch (error) {
      return { outcome: 'unresolved' as const, details: { provider: 'gmail', reason: error instanceof Error ? error.message : 'token_refresh_failed' } };
    }
  }
  if (dispatch.provider === 'outlook') {
    const token = await tokenService.getToken(admin, dispatch.userId, 'outlook');
    if (!token) return { outcome: 'unresolved' as const, details: { provider: 'outlook', reason: 'token_missing' } };
    try {
      const refreshed = await refreshMicrosoftToken(
        token.refresh_token,
        process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!,
        process.env.AZURE_AD_CLIENT_SECRET!,
        process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!,
      );
      return reconcileOutlook(refreshed.access_token, dispatch, subject);
    } catch (error) {
      return { outcome: 'unresolved' as const, details: { provider: 'outlook', reason: error instanceof Error ? error.message : 'token_refresh_failed' } };
    }
  }
  return { outcome: 'unresolved' as const, details: { provider: dispatch.provider, reason: 'unsupported_provider' } };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function recordHistoryRepairAttempt(
  admin: any,
  dispatch: RepairableOutboundDispatch,
  input: { status: 'complete' | 'failed'; attemptedAt: string; error?: string | null },
) {
  const { data, error } = await admin
    .from('outbound_dispatches')
    .update({
      history_repair_status: input.status,
      history_repair_attempt_count: dispatch.historyRepairAttemptCount + 1,
      last_history_repair_at: input.attemptedAt,
      history_repair_error: input.status === 'failed' ? textForDatabase(input.error) : null,
    })
    .eq('id', dispatch.id)
    .eq('status', 'sent')
    .eq('history_repair_attempt_count', dispatch.historyRepairAttemptCount)
    .select('id,history_repair_status')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(`History repair bookkeeping CAS failed for dispatch ${dispatch.id}.`);
  }
}

function textForDatabase(value: unknown) {
  return normalize(value || 'history_repair_failed').slice(0, 2_000);
}

export async function repairReconciledOutboundDispatchHistories(input?: {
  limit?: number;
  client?: any;
  now?: () => string;
  repair?: typeof repairReconciledSentDispatchHistory;
}) {
  const admin = input?.client ?? getSupabaseAdminClient();
  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200);
  const repair = input?.repair ?? repairReconciledSentDispatchHistory;
  const now = input?.now ?? (() => new Date().toISOString());
  const { data, error } = await admin
    .from('outbound_dispatches')
    .select('*')
    .eq('status', 'sent')
    .eq('channel', 'email')
    .in('history_repair_status', ['pending', 'failed'])
    .order('last_history_repair_at', { ascending: true, nullsFirst: true })
    .order('reconciled_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results: Array<{ id: string; repaired: boolean; skipped?: boolean; reason?: string; error?: string }> = [];
  for (const row of data || []) {
    const dispatch = mapRow(row);
      const attemptedAt = now();
      try {
        const repairResult = await repair({ admin, dispatch, draftVersion: {} });
        if (repairResult.finalized !== true) {
          throw new Error(`History repair did not finalize: ${repairResult.reason || 'unknown_reason'}`);
        }
        results.push({
        id: dispatch.id,
        repaired: repairResult.repaired,
        skipped: !repairResult.repaired,
        reason: repairResult.reason,
      });
    } catch (repairError) {
      const message = errorMessage(repairError);
      try {
        await recordHistoryRepairAttempt(admin, dispatch, { status: 'failed', attemptedAt, error: message });
      } catch (bookkeepingError) {
        console.error('[outbound-reconciliation] failed to record history repair error', {
          dispatchId: dispatch.id,
          error: bookkeepingError,
        });
        throw new Error(
          `${message}; additionally failed to record history repair bookkeeping: ${errorMessage(bookkeepingError)}`,
        );
      }
      console.error('[outbound-reconciliation] sent dispatch history repair failed', {
        dispatchId: dispatch.id,
        error: repairError,
      });
      results.push({ id: dispatch.id, repaired: false, error: message });
    }
  }

  return {
    processed: results.length,
    repaired: results.filter((result) => result.repaired).length,
    skipped: results.filter((result) => result.skipped).length,
    failed: results.filter((result) => result.error).length,
    results,
  };
}

export async function reconcileUnknownOutboundDispatches(input?: { limit?: number; staleSendingMinutes?: number; historyLimit?: number }) {
  const admin = getSupabaseAdminClient();
  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 200);
  const staleCutoff = new Date(Date.now() - Math.max(Number(input?.staleSendingMinutes || 15), 5) * 60 * 1000).toISOString();
  const staleClaimCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('outbound_dispatches')
    .select('*')
    .or(`and(status.eq.unknown,reconciliation_claimed_at.is.null),and(status.eq.unknown,reconciliation_claimed_at.lt.${staleClaimCutoff}),and(status.eq.sending,updated_at.lt.${staleCutoff})`)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results: Array<{ id: string; status: string; reconciled: boolean; error?: string }> = [];
  for (const row of data || []) {
    const candidate = mapRow(row);
    const claimedAt = new Date().toISOString();
    try {
      const { data: claimedRow, error: claimError } = await admin.rpc('claim_outbound_dispatch_reconciliation_v1', {
        p_dispatch_id: candidate.id,
        p_expected_status: candidate.status,
        p_expected_attempt_count: candidate.reconciliationAttemptCount || 0,
        p_stale_sending_before: staleCutoff,
        p_stale_claim_before: staleClaimCutoff,
        p_claimed_at: claimedAt,
      });
      if (claimError) throw claimError;
      if (!claimedRow) continue;

      const dispatch = mapRow(claimedRow);
      if (dispatch.providerMessageId) {
        const result = await reconcileUnknownOutboundDispatch(dispatch, {
          async reconcile() { return { outcome: 'unresolved' }; },
        }, { client: admin });
        results.push({ id: dispatch.id, status: result.dispatch.status, reconciled: result.reconciled });
        continue;
      }
      const { data: version, error: versionError } = await admin
        .from('messaging_draft_versions')
        .select('content')
        .eq('organization_id', dispatch.organizationId)
        .eq('user_id', dispatch.userId)
        .eq('draft_id', dispatch.draftId)
        .eq('id', dispatch.versionId)
        .maybeSingle();
      if (versionError) throw versionError;
      const subject = normalize(version?.content?.subject);
      const result = await reconcileUnknownOutboundDispatch(dispatch, {
        reconcile: () => subject
          ? reconcileProvider(dispatch, subject)
          : Promise.resolve({ outcome: 'unresolved', details: { reason: 'draft_subject_missing' } }),
      }, { client: admin });
      results.push({ id: dispatch.id, status: result.dispatch.status, reconciled: result.reconciled });
    } catch (error) {
      const { error: abandonError } = await admin.rpc('abandon_outbound_dispatch_reconciliation_v1', {
        p_dispatch_id: candidate.id,
        p_expected_attempt_count: candidate.reconciliationAttemptCount || 0,
        p_claimed_at: claimedAt,
      });
      if (abandonError) {
        console.error('[outbound-reconciliation] failed to abandon reconciliation claim', {
          dispatchId: candidate.id,
          error: abandonError,
        });
      }
      console.error('[outbound-reconciliation] dispatch reconciliation failed', { dispatchId: candidate.id, error });
      results.push({
        id: candidate.id,
        status: candidate.status,
        reconciled: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const historyRepair = await repairReconciledOutboundDispatchHistories({
    client: admin,
    limit: input?.historyLimit ?? limit,
  });

  return {
    processed: results.length,
    reconciled: results.filter((result) => result.reconciled).length,
    unresolved: results.filter((result) => !result.reconciled).length,
    results,
    historyRepair,
  };
}
