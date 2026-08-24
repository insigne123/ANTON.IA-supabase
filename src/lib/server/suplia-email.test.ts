import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSupliaEmailReviewDraft,
  parseRequestedSupliaProvider,
  persistSupliaSentHistory,
  sendSupliaEmail,
} from './suplia-email';

type Row = Record<string, any>;

class Query {
  private readonly filters: Array<(row: Row) => boolean> = [];

  constructor(private readonly rows: Row[]) {}

  select() { return this; }
  order() { return this; }
  limit() { return this; }

  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value);
    return this;
  }

  contains(key: string, value: Row) {
    this.filters.push((row) => Object.entries(value).every(([entryKey, entryValue]) => row[key]?.[entryKey] === entryValue));
    return this;
  }

  async maybeSingle() {
    return { data: this.rows.find((row) => this.filters.every((filter) => filter(row))) || null, error: null };
  }

  async single() {
    const data = this.rows.find((row) => this.filters.every((filter) => filter(row))) || null;
    return { data, error: data ? null : new Error('row not found') };
  }

  async upsert(payload: Row) {
    if (!this.rows.some((row) => row.id === payload.id)) this.rows.push(structuredClone(payload));
    return { error: null };
  }

  update(payload: Row) {
    for (const row of this.rows) Object.assign(row, structuredClone(payload));
    return this;
  }

  async insert(payload: Row) {
    if (this.rows.some((row) => row.id === payload.id)) return { error: { code: '23505' } };
    this.rows.push(structuredClone(payload));
    return { error: null };
  }
}

function fakeAdmin(contacted: Row[], events: Row[]) {
  return {
    from(table: string) {
      return new Query(table === 'contacted_leads' ? contacted : events);
    },
  };
}

function historyInput(admin: ReturnType<typeof fakeAdmin>, dispatchId: string) {
  return {
    admin,
    dispatchId,
    organizationId: '30000000-0000-4000-8000-000000000001',
    contactedPayload: {
      organization_id: '30000000-0000-4000-8000-000000000001',
      provider: 'gmail',
      email: 'ada@example.com',
      subject: 'Hello',
      sent_at: '2026-08-13T10:00:00.000Z',
      created_at: '2026-08-13T10:00:00.000Z',
      data: { source: 'suplia' },
    },
    eventPayload: {
      organization_id: '30000000-0000-4000-8000-000000000001',
      event_type: 'sent',
      event_source: 'suplia',
      created_at: '2026-08-13T10:00:00.000Z',
      meta: { source: 'suplia' },
    },
  };
}

test('SUPL.IA distinguishes an omitted provider from an unsupported requested provider', () => {
  assert.equal(parseRequestedSupliaProvider(undefined), null);
  assert.equal(parseRequestedSupliaProvider('gmail'), 'google');
  assert.throws(() => parseRequestedSupliaProvider('yahoo'), /no soportado: yahoo/i);
});

test('SUPL.IA email work starts as a deterministic pending-review draft', () => {
  const input = {
    organizationId: '30000000-0000-4000-8000-000000000001',
    userId: '30000000-0000-4000-8000-000000000002',
    idempotencyKey: 'action:review-1',
    requestedAt: '2026-08-23T12:00:00.000Z',
    to: 'ada@example.com',
    subject: 'Seguimiento',
    text: 'Hola Ada',
    html: '<p>Hola Ada</p>',
  };
  const first = createSupliaEmailReviewDraft(input);
  const replay = createSupliaEmailReviewDraft(input);

  assert.equal(first.draftId, replay.draftId);
  assert.equal(first.versionId, replay.versionId);
  assert.equal(first.lifecycle, 'draft');
  assert.equal(first.approval.status, 'pending');
  assert.equal(first.preflight.status, 'pending');
  assert.equal(first.recipient.email, 'ada@example.com');
});

test('SUPL.IA persists a pending review draft without dispatching outbound email', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalUnsubscribeSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  const requestPaths: string[] = [];
  const persistedDrafts: Row[] = [];
  const reviewItems: Row[] = [];
  let currentDraft: Row | null = null;

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://suplia-email.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.UNSUBSCRIBE_TOKEN_SECRET = 'test-unsubscribe-secret';
  (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    requestPaths.push(url.pathname);
    const response = (payload: unknown) => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    if (url.pathname.endsWith('/rest/v1/unsubscribed_emails')) return response([]);
    if (url.pathname.endsWith('/rest/v1/excluded_domains')) return response([]);
    if (url.pathname.endsWith('/rest/v1/messaging_drafts')) {
      return response(currentDraft ? [{ current_version_id: currentDraft.versionId }] : []);
    }
    if (url.pathname.endsWith('/rest/v1/messaging_draft_versions')) {
      return response(currentDraft ? [{ payload: currentDraft }] : []);
    }
    if (url.pathname.endsWith('/rest/v1/rpc/create_messaging_draft_v1')) {
      const body = JSON.parse(await request.text()) as { p_payload: Row };
      persistedDrafts.push(body.p_payload);
      currentDraft = body.p_payload;
      return response([{ payload: body.p_payload }]);
    }
    if (url.pathname.endsWith('/rest/v1/suplia_review_items')) {
      if (request.method === 'GET') return response(reviewItems.length ? [reviewItems[0]] : []);
      if (request.method === 'POST') {
        const rawPayload = JSON.parse(await request.text()) as Row | Row[];
        const payload = Array.isArray(rawPayload) ? rawPayload[0] : rawPayload;
        const item = {
          ...payload,
          id: '30000000-0000-4000-8000-000000000003',
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
    const input = {
      supabase: new Proxy({}, { get: () => { throw new Error('Legacy token access is not allowed.'); } }),
      userId: '30000000-0000-4000-8000-000000000002',
      organizationId: '30000000-0000-4000-8000-000000000001',
      actionId: 'action-review-1',
      payload: {
        to: 'Ada@Example.com',
        subject: 'Seguimiento',
        htmlBody: '<p>Hola Ada</p>',
        provider: 'gmail',
      },
    };
    const result = await sendSupliaEmail(input);

    const expected = createSupliaEmailReviewDraft({
      organizationId: '30000000-0000-4000-8000-000000000001',
      userId: '30000000-0000-4000-8000-000000000002',
      idempotencyKey: 'suplia-review:action-review-1:ada@example.com',
      requestedAt: '2026-08-23T12:00:00.000Z',
      to: 'ada@example.com',
      subject: 'Seguimiento',
      text: 'Hola Ada',
    });

    assert.deepEqual(result, {
      status: 'review_required',
      draftId: expected.draftId,
      versionId: expected.versionId,
      to: 'ada@example.com',
      subject: 'Seguimiento',
      provider: 'gmail',
      note: 'Correo preparado en el inbox de revision de SUPL.IA. Apruebalo ahi antes de enviarlo.',
    });
    assert.equal(persistedDrafts.length, 1);
    assert.equal(persistedDrafts[0].lifecycle, 'draft');
    assert.equal(persistedDrafts[0].approval.status, 'pending');
    assert.equal(persistedDrafts[0].preflight.status, 'pending');
    assert.equal(reviewItems.length, 1);
    assert.equal(reviewItems[0].messaging_draft_id, expected.draftId);
    assert.equal(reviewItems[0].sender_user_id, '30000000-0000-4000-8000-000000000002');
    assert.deepEqual(reviewItems[0].metadata, {
      source: 'suplia',
      conversationId: null,
      actionId: 'action-review-1',
      requestedProvider: 'google',
    });
    currentDraft = {
      ...persistedDrafts[0],
      versionId: '30000000-0000-4000-8000-000000000004',
      revision: 2,
      parentVersionId: persistedDrafts[0].versionId,
      lifecycle: 'ready',
      approval: {
        status: 'approved',
        decidedBy: '30000000-0000-4000-8000-000000000002',
        decidedAt: '2026-08-23T12:05:00.000Z',
        reason: null,
      },
      preflight: {
        status: 'passed',
        checkedAt: '2026-08-23T12:05:00.000Z',
        errors: [],
        warnings: [],
      },
      createdAt: '2026-08-23T12:05:00.000Z',
    };
    const replay = await sendSupliaEmail(input);
    assert.equal(replay.draftId, expected.draftId);
    assert.equal(replay.versionId, currentDraft.versionId);
    assert.equal(replay.to, 'ada@example.com');
    assert.equal(replay.subject, 'Seguimiento');
    assert.equal(persistedDrafts.length, 1);
    assert.equal(reviewItems.length, 1);
    assert.deepEqual(requestPaths, [
      '/rest/v1/unsubscribed_emails',
      '/rest/v1/excluded_domains',
      '/rest/v1/messaging_drafts',
      '/rest/v1/messaging_draft_versions',
      '/rest/v1/rpc/create_messaging_draft_v1',
      '/rest/v1/suplia_review_items',
      '/rest/v1/suplia_review_items',
      '/rest/v1/unsubscribed_emails',
      '/rest/v1/excluded_domains',
      '/rest/v1/messaging_drafts',
      '/rest/v1/messaging_draft_versions',
      '/rest/v1/suplia_review_items',
    ]);
  } finally {
    (globalThis as any).fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    if (originalUnsubscribeSecret === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    else process.env.UNSUBSCRIBE_TOKEN_SECRET = originalUnsubscribeSecret;
  }
});

test('SUPL.IA history persistence creates one contacted row and one event across replay', async () => {
  const contacted: Row[] = [];
  const events: Row[] = [];
  const admin = fakeAdmin(contacted, events);

  const first = await persistSupliaSentHistory(historyInput(admin, 'dispatch-1'));
  const replay = await persistSupliaSentHistory(historyInput(admin, 'dispatch-1'));

  assert.equal(contacted.length, 1);
  assert.equal(events.length, 1);
  assert.equal(replay.id, first.id);
  assert.equal(contacted[0].data.dispatchId, 'dispatch-1');
  assert.equal(events[0].meta.dispatchId, 'dispatch-1');
});

test('SUPL.IA replay reuses identifiers written before deterministic IDs were introduced', async () => {
  const contacted: Row[] = [{
    ...historyInput(fakeAdmin([], []), 'dispatch-legacy').contactedPayload,
    id: 'legacy-random-contacted-id',
    data: { source: 'suplia', dispatchId: 'dispatch-legacy' },
  }];
  const events: Row[] = [{
    ...historyInput(fakeAdmin([], []), 'dispatch-legacy').eventPayload,
    id: '50000000-0000-4000-8000-000000000001',
    contacted_id: 'legacy-random-contacted-id',
    meta: { source: 'suplia', dispatchId: 'dispatch-legacy' },
  }];
  const result = await persistSupliaSentHistory(historyInput(fakeAdmin(contacted, events), 'dispatch-legacy'));

  assert.equal(result.id, 'legacy-random-contacted-id');
  assert.equal(contacted.length, 1);
  assert.equal(events.length, 1);
});

test('SUPL.IA enriches the canonical dispatch projection instead of appending another sent history row', async () => {
  const input = historyInput(fakeAdmin([], []), 'dispatch-projected');
  const contactedPayload = input.contactedPayload as Record<string, any>;
  const eventPayload = input.eventPayload as Record<string, any>;
  contactedPayload.company = 'Analytical Engines';
  contactedPayload.data = { source: 'suplia', supliaActionId: 'action-1' };
  eventPayload.meta = { source: 'suplia', supliaActionId: 'action-1' };
  const contacted: Row[] = [{
    ...input.contactedPayload,
    id: 'canonical-contacted-id',
    company: null,
    data: { source: 'suplia', dispatchId: input.dispatchId, historyProjectionSource: 'outbound_dispatch' },
  }];
  const events: Row[] = [{
    ...input.eventPayload,
    id: 'canonical-sent-event-id',
    contacted_id: 'canonical-contacted-id',
    meta: { source: 'suplia', dispatchId: input.dispatchId },
  }];

  const result = await persistSupliaSentHistory({ ...input, admin: fakeAdmin(contacted, events) });

  assert.equal(result.id, 'canonical-contacted-id');
  assert.equal(contacted.length, 1);
  assert.equal(events.length, 1);
  assert.equal(contacted[0].company, 'Analytical Engines');
  assert.equal(contacted[0].data.supliaActionId, 'action-1');
  assert.equal(events[0].meta.supliaActionId, 'action-1');
});
