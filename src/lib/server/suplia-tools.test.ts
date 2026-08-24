import assert from 'node:assert/strict';
import test from 'node:test';

import { getSupliaTool } from './suplia-tools';

type Row = Record<string, any>;

test('email.bulk_send prepares review drafts without creating an outbound dispatch', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalUnsubscribeSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  const originalMaxBatchSize = process.env.SUPLIA_BULK_SEND_MAX_BATCH_SIZE;
  const requests: Array<{ method: string; path: string }> = [];
  const persistedDrafts: Row[] = [];
  const reviewItems: Row[] = [];

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://suplia-tools.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.UNSUBSCRIBE_TOKEN_SECRET = 'test-unsubscribe-secret';
  process.env.SUPLIA_BULK_SEND_MAX_BATCH_SIZE = '10';
  (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    requests.push({ method: request.method, path: url.pathname });
    const response = (payload: unknown) => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    if (url.pathname.endsWith('/rest/v1/unsubscribed_emails')) return response([]);
    if (url.pathname.endsWith('/rest/v1/excluded_domains')) return response([]);
    if (url.pathname.endsWith('/rest/v1/contacted_leads')) return response([]);
    if (url.pathname.endsWith('/rest/v1/messaging_drafts')) return response([]);
    if (url.pathname.endsWith('/rest/v1/messaging_draft_versions')) return response([]);
    if (url.pathname.endsWith('/rest/v1/rpc/create_messaging_draft_v1')) {
      const body = JSON.parse(await request.text()) as { p_payload: Row };
      persistedDrafts.push(body.p_payload);
      return response([{ payload: body.p_payload }]);
    }
    if (url.pathname.endsWith('/rest/v1/suplia_review_items')) {
      if (request.method === 'GET') return response([]);
      if (request.method === 'POST') {
        const rawPayload = JSON.parse(await request.text()) as Row | Row[];
        const payload = Array.isArray(rawPayload) ? rawPayload[0] : rawPayload;
        const item = {
          ...payload,
          id: '30000000-0000-4000-8000-000000000004',
          created_at: '2026-08-23T12:00:00.000Z',
          updated_at: '2026-08-23T12:00:00.000Z',
          reviewed_by_user_id: null,
          reviewed_at: null,
          resolution_note: null,
        };
        reviewItems.push(item);
        return response(item);
      }
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const tool = getSupliaTool('email.bulk_send');
    assert.ok(tool);
    const result = await tool.handler({
      dryRun: false,
      messages: [{
        to: 'ada@example.com',
        recipientName: 'Ada Lovelace',
        company: 'Analytical Engines',
        subject: 'Una idea para Analytical Engines',
        textBody: 'Hola Ada, vimos el trabajo de Analytical Engines y preparamos una idea concreta para mejorar el seguimiento comercial sin sumar trabajo manual al equipo.',
      }],
    }, {
      auth: {
        user: { id: '30000000-0000-4000-8000-000000000002' },
        organizationId: '30000000-0000-4000-8000-000000000001',
        organizationIds: ['30000000-0000-4000-8000-000000000001'],
        supabase: {},
      },
      conversationId: '30000000-0000-4000-8000-000000000003',
      pendingActionId: '30000000-0000-4000-8000-000000000005',
    });

    assert.equal(result.dryRun, false);
    assert.equal(result.reviewRequired, true);
    assert.equal((result.preflight as any).status, 'pass');
    assert.deepEqual(result.summary, {
      requested: 1,
      processed: 1,
      truncated: false,
      duplicatesRemoved: 0,
      maxBatchSize: 10,
      preparedForReview: 1,
      sent: 0,
      failed: 0,
    });
    assert.equal((result.prepared as Row[]).length, 1);
    assert.deepEqual(result.recipientFailures, []);
    assert.equal(persistedDrafts.length, 1);
    assert.equal(persistedDrafts[0].lifecycle, 'draft');
    assert.equal(persistedDrafts[0].approval.status, 'pending');
    assert.equal(reviewItems.length, 1);
    assert.equal(reviewItems[0].item_type, 'outbound_email');
    assert.equal(reviewItems[0].messaging_draft_id, persistedDrafts[0].draftId);
    assert.equal(requests.some((request) => request.path.endsWith('/rest/v1/outbound_dispatches')), false);
    assert.equal(requests.some((request) => request.path.endsWith('/rest/v1/email_events')), false);
    assert.equal(requests.some((request) => request.path.endsWith('/rest/v1/contacted_leads') && request.method !== 'GET'), false);
  } finally {
    (globalThis as any).fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    if (originalUnsubscribeSecret === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    else process.env.UNSUBSCRIBE_TOKEN_SECRET = originalUnsubscribeSecret;
    if (originalMaxBatchSize === undefined) delete process.env.SUPLIA_BULK_SEND_MAX_BATCH_SIZE;
    else process.env.SUPLIA_BULK_SEND_MAX_BATCH_SIZE = originalMaxBatchSize;
  }
});
