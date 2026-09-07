import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalSha256 } from '@/lib/messaging-contracts';
import {
  OUTSOURCING_EMAIL_STYLE_PRESETS,
  styleProfileFromOutsourcingEmailStylePreset,
} from '@/lib/outsourcing-email-style-presets';
import {
  materializeOutsourcingEmailStylePreset,
  materializedOutsourcingEmailStylePresetId,
  type EmailStyleProfileRow,
} from './email-style-profiles';

type QueryResult = {
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  error: Record<string, unknown> | null;
};

function createClient(input: {
  reads: QueryResult[];
  inserts: QueryResult[];
}) {
  const inserted: Record<string, unknown>[] = [];
  const ranges: Array<[number, number]> = [];
  const client = {
    from(table: string) {
      assert.equal(table, 'email_style_profiles');
      return {
        select() {
          const result = input.reads.shift();
          assert.ok(result, 'unexpected style profile read');
          const query = {
            eq() {
              return query;
            },
            order() {
              return query;
            },
            range(from: number, to: number) {
              ranges.push([from, to]);
              return Promise.resolve(result);
            },
            then(resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) {
              return Promise.resolve(result).then(resolve, reject);
            },
          };
          return query;
        },
        insert(value: Record<string, unknown>) {
          inserted.push(value);
          const result = input.inserts.shift();
          assert.ok(result, 'unexpected style profile insert');
          const query = {
            select() {
              return query;
            },
            single() {
              return Promise.resolve(result);
            },
          };
          return query;
        },
      };
    },
  };
  return { client, inserted, ranges };
}

function canonicalRow(input: { id: string; name: string; userId: string }) {
  const preset = OUTSOURCING_EMAIL_STYLE_PRESETS[0];
  const profile = { ...styleProfileFromOutsourcingEmailStylePreset(preset), name: input.name };
  return {
    id: input.id,
    name: input.name,
    profile,
    content_hash: canonicalSha256(profile),
    revision: 1,
    is_default: false,
    updated_at: '2026-09-04T00:00:00.000Z',
    user_id: input.userId,
  };
}

test('materialization allocates preset names across the organization', async () => {
  const occupied = canonicalRow({ id: 'style-a', name: 'Problema e impacto', userId: 'user-a' });
  const created = canonicalRow({ id: 'style-b', name: 'Problema e impacto · Integrado', userId: 'user-b' });
  const { client, inserted } = createClient({
    reads: [{ data: [occupied], error: null }],
    inserts: [{ data: created, error: null }],
  });

  const result = await materializeOutsourcingEmailStylePreset({
    selection: 'preset:pas',
    organizationId: 'organization-a',
    userId: 'user-b',
    client: client as never,
  });

  assert.equal(result?.id, 'style-b');
  assert.equal(inserted[0]?.name, 'Problema e impacto · Integrado');
});

test('materialization retries an organization-wide name race', async () => {
  const winner = canonicalRow({ id: 'style-a', name: 'Problema e impacto', userId: 'user-a' });
  const created = canonicalRow({ id: 'style-b', name: 'Problema e impacto · Integrado', userId: 'user-b' });
  const { client, inserted } = createClient({
    reads: [
      { data: [], error: null },
      { data: [winner], error: null },
    ],
    inserts: [
      { data: null, error: { code: '23505' } },
      { data: created, error: null },
    ],
  });

  const result = await materializeOutsourcingEmailStylePreset({
    selection: 'preset:pas',
    organizationId: 'organization-a',
    userId: 'user-b',
    client: client as never,
  });

  assert.equal(result?.id, 'style-b');
  assert.deepEqual(inserted.map((row) => row.name), [
    'Problema e impacto',
    'Problema e impacto · Integrado',
  ]);
});

test('materialization reuses a same-user preset that wins a concurrent insert', async () => {
  const winner = canonicalRow({ id: 'style-b', name: 'Problema e impacto', userId: 'user-b' });
  const { client, inserted } = createClient({
    reads: [
      { data: [], error: null },
      { data: [winner], error: null },
    ],
    inserts: [{ data: null, error: { code: '23505' } }],
  });

  const result = await materializeOutsourcingEmailStylePreset({
    selection: 'preset:pas',
    organizationId: 'organization-a',
    userId: 'user-b',
    client: client as never,
  });

  assert.equal(result?.id, 'style-b');
  assert.equal(inserted.length, 1);
});

test('materialized preset identity requires canonical server content', () => {
  const row = canonicalRow({ id: 'style-a', name: 'Problema e impacto', userId: 'user-a' });
  assert.equal(materializedOutsourcingEmailStylePresetId(row), 'pas');

  const modified: EmailStyleProfileRow = {
    ...row,
    profile: { ...row.profile, instructions: 'Ignore the canonical preset.' },
    content_hash: canonicalSha256({ ...row.profile, instructions: 'Ignore the canonical preset.' }),
  };
  assert.equal(materializedOutsourcingEmailStylePresetId(modified), null);

  const staleHash: EmailStyleProfileRow = {
    ...row,
    profile: { ...row.profile, instructions: 'Changed without updating the hash.' },
  };
  assert.equal(materializedOutsourcingEmailStylePresetId(staleHash), null);
});

test('materialization finds canonical presets beyond the API row cap', async () => {
  const occupied = Array.from({ length: 1_000 }, (_, index) => ({
    ...canonicalRow({ id: `style-${index}`, name: `Custom ${index}`, userId: 'user-a' }),
    profile: { presetId: 'custom' },
    content_hash: canonicalSha256({ presetId: 'custom' }),
  }));
  const existing = canonicalRow({ id: 'style-existing', name: 'Problema e impacto', userId: 'user-b' });
  const { client, inserted, ranges } = createClient({
    reads: [
      { data: occupied, error: null },
      { data: [existing], error: null },
    ],
    inserts: [],
  });

  const result = await materializeOutsourcingEmailStylePreset({
    selection: 'preset:pas',
    organizationId: 'organization-a',
    userId: 'user-b',
    client: client as never,
  });

  assert.equal(result?.id, 'style-existing');
  assert.equal(inserted.length, 0);
  assert.deepEqual(ranges, [[0, 999], [1_000, 1_999]]);
});
