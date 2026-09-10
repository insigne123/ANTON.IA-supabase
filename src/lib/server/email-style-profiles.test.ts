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
  resolveEmailStyleProfile,
  type EmailStyleProfileRow,
} from './email-style-profiles';

type QueryResult = {
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  error: Record<string, unknown> | null;
};

function createClient(input: {
  reads: QueryResult[];
  inserts: QueryResult[];
  member?: boolean;
}) {
  const inserted: Record<string, unknown>[] = [];
  const ranges: Array<[number, number]> = [];
  const client = {
    from(table: string) {
      if (table === 'organization_members') {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: input.member === false ? null : { role: 'member' }, error: null }),
        };
        return query;
      }
      assert.equal(table, 'email_style_profiles');
      return {
        select() {
          const result = input.reads.shift();
          assert.ok(result, 'unexpected style profile read');
          const filters: Array<[string, unknown]> = [];
          const query = {
            eq(key: string, value: unknown) {
              filters.push([key, value]);
              return query;
            },
            is() {
              return query;
            },
            order() {
              return query;
            },
            range(from: number, to: number) {
              ranges.push([from, to]);
              return Promise.resolve({ ...result, data: Array.isArray(result.data)
                ? result.data.filter((row) => filters.every(([key, value]) => row[key] === undefined || row[key] === value)) : result.data });
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

test('materialization does not reserve another users personal name', async () => {
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
  assert.equal(inserted[0]?.name, 'Problema e impacto');
});

test('materialization retries a same-owner name race', async () => {
  const winner = { ...canonicalRow({ id: 'style-a', name: 'Problema e impacto', userId: 'user-b' }), profile: {} };
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

test('materialization skips case and space variants reserved by the personal name index', async () => {
  const occupied = [' PROBLEMA E IMPACTO ', 'problema e impacto · integrado'].map((name, index) => ({
    ...canonicalRow({ id: `style-${index}`, name, userId: 'user-b' }), profile: {},
  }));
  const created = canonicalRow({ id: 'new', name: 'Problema e impacto · Integrado 2', userId: 'user-b' });
  const { client, inserted } = createClient({ reads: [{ data: occupied, error: null }], inserts: [{ data: created, error: null }] });
  await materializeOutsourcingEmailStylePreset({ selection: 'preset:pas', organizationId: 'org-a', userId: 'user-b', client: client as never });
  assert.equal(inserted[0].name, created.name);
});

test('direct materialization rejects a nonmember before reading or writing profiles', async () => {
  const { client, inserted } = createClient({ reads: [], inserts: [], member: false });
  await assert.rejects(materializeOutsourcingEmailStylePreset({ selection: 'preset:pas', organizationId: 'org-a', userId: 'outsider', client: client as never }), /EMAIL_STYLE_FORBIDDEN/);
  assert.equal(inserted.length, 0);
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
    ...canonicalRow({ id: `style-${index}`, name: `Custom ${index}`, userId: 'user-b' }),
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

function resolverClient(rows: any[], member = true) {
  const filters: any[] = [];
  return { filters, from(table: string) {
    const conditions: Array<[string, any]> = [];
    const query: any = {
      select: () => query,
      eq: (key: string, value: any) => { conditions.push([key, value]); filters.push([table, key, value]); return query; },
      is: (key: string, value: any) => { conditions.push([key, value]); filters.push([table, key, value]); return query; },
      maybeSingle: async () => ({ data: table === 'organization_members' ? member ? { role: 'member' } : null
        : rows.find((row) => conditions.every(([key, value]) => row[key] === value)) || null, error: null }),
    };
    return query;
  } };
}

const personal = { ...canonicalRow({ id: 'a8be3d8a-8b6e-4be3-9a56-9cb4dcebef52', name: 'Shared name', userId: 'user-a' }),
  organization_id: 'org-a', library_scope: 'personal', archived_at: null, is_default: true };
const team = { ...personal, id: 'b8be3d8a-8b6e-4be3-9a56-9cb4dcebef52', user_id: 'admin', library_scope: 'team' };

test('native resolver selects persisted team UUID and retains profile/hash/revision', async () => {
  const client = resolverClient([personal, team]);
  const result = await resolveEmailStyleProfile({ organizationId: 'org-a', userId: 'user-a', styleProfileId: team.id, client: client as never });
  assert.equal(result?.id, team.id);
  assert.deepEqual(result?.profile, team.profile);
  assert.equal(result?.content_hash, team.content_hash);
  assert.equal(result?.revision, team.revision);
});

test('native resolver prefers personal names/defaults then team defaults', async () => {
  for (const styleName of [null, 'Shared name']) {
    const result = await resolveEmailStyleProfile({ organizationId: 'org-a', userId: 'user-a', styleName, client: resolverClient([team, personal]) as never });
    assert.equal(result?.id, personal.id);
  }
  const result = await resolveEmailStyleProfile({ organizationId: 'org-a', userId: 'user-a', client: resolverClient([team]) as never });
  assert.equal(result?.id, team.id);
});

test('native resolver denies archived, other-owner, cross-tenant and virtual branded IDs', async () => {
  for (const hidden of [{ ...personal, archived_at: '2026-09-09' }, { ...personal, user_id: 'other' },
    { ...personal, organization_id: 'other' }]) {
    await assert.rejects(resolveEmailStyleProfile({ organizationId: 'org-a', userId: 'user-a', styleProfileId: hidden.id,
      client: resolverClient([hidden]) as never }), /NATIVE_DRAFT_STYLE_NOT_FOUND/);
  }
  await assert.rejects(resolveEmailStyleProfile({ organizationId: 'org-a', userId: 'user-a', styleProfileId: 'grupoexpro:est',
    client: resolverClient([team]) as never }), /NATIVE_DRAFT_STYLE_NOT_FOUND/);
});

test('native resolver rechecks membership even with an administrative client', async () => {
  const client = resolverClient([team], false);
  await assert.rejects(resolveEmailStyleProfile({ organizationId: 'org-a', userId: 'outsider', client: client as never }), /EMAIL_STYLE_FORBIDDEN/);
  assert.ok(client.filters.every(([table]) => table === 'organization_members'));
});
