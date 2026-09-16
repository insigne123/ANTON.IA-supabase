import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { draftSnapshotFixture } from '../draft-v2-test-fixtures';
import { readCoworkResearch, summarizeCoworkResearch } from './research-read';

test('research summary preserves evidence links, classification and expiration without exposing request metadata', () => {
  const snapshot = draftSnapshotFixture();
  const scope = { userId: snapshot.scope.ownerUserId, organizationId: snapshot.scope.organizationId! };
  const result = summarizeCoworkResearch(snapshot, scope, snapshot.subject.leadId!, Date.parse('2027-01-01T00:00:00Z'));
  assert.ok(result.claims.length > 0);
  assert.ok(result.claims.every(claim => claim.expired));
  const sources = new Set(result.sources.map(source => source.id));
  assert.ok(result.evidence.every(item => sources.has(item.sourceId)));
  assert.deepEqual(result.claims.map(claim => claim.classification), snapshot.claims.map(claim => claim.classification));
  assert.equal('request' in result, false);
  assert.throws(() => summarizeCoworkResearch(snapshot, { ...scope, userId: 'other' }, snapshot.subject.leadId!), /identity/);
  assert.throws(() => summarizeCoworkResearch(snapshot, scope, 'other-lead'), /identity/);
});

test('lookup distinguishes no report from pending research and scopes every table', async () => {
  const filters: Array<Record<string, unknown>> = [];
  let job: unknown = null;
  const client = { from(table: string) {
    const filter: Record<string, unknown> = {}; filters.push(filter);
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: unknown) => { filter[key] = value; return chain; },
      maybeSingle: async () => ({ data: table === 'leads' ? { id: 'lead' } : job, error: null }),
    }; return chain;
  } } as unknown as SupabaseClient;
  const scope = { userId: 'owner', organizationId: 'org' };
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal((await readCoworkResearch(client, scope, id)).availability, 'not_found');
  job = { status: 'running', research_snapshot_id: null, updated_at: '2026-09-15T00:00:00Z' };
  const pending = await readCoworkResearch(client, scope, id);
  assert.equal(pending.availability, 'without_snapshot');
  assert.ok(filters.every(filter => filter.user_id === 'owner' && filter.organization_id === 'org'));
});
