import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRequestedSupliaProvider, persistSupliaSentHistory } from './suplia-email';

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
