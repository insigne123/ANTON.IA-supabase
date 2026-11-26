import assert from 'node:assert/strict';
import test from 'node:test';

import { shareMailboxAfterConnect } from './shared-mailbox';

type Row = Record<string, unknown>;

const USER = 'user-1';
const ORG = 'org-team';

/** Just enough of the Supabase client for the share step: select/update with eq/in/not, and rpc. */
function fakeAdmin(initial: { provider_tokens?: Row[]; organization_members?: Row[]; organization_shared_mailboxes?: Row[] }, options: { rpc?: { data?: unknown; error?: { message: string } | null }; failRead?: string } = {}) {
  const tables: Record<string, Row[]> = {
    provider_tokens: [...(initial.provider_tokens || [])],
    organization_members: [...(initial.organization_members || [])],
    organization_shared_mailboxes: [...(initial.organization_shared_mailboxes || [])],
  };
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const client = {
    from(table: string) {
      const tests: Array<(row: Row) => boolean> = [];
      let values: Row | null = null;
      const builder: any = {
        select() { return builder; },
        update(next: Row) { values = next; return builder; },
        eq(column: string, value: unknown) { tests.push((row) => row[column] === value); return builder; },
        in(column: string, list: unknown[]) { tests.push((row) => list.includes(row[column])); return builder; },
        not(column: string, operator: string, value: unknown) {
          assert.equal(operator, 'is');
          tests.push((row) => (row[column] ?? null) !== value);
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          if (options.failRead === table && !values) return resolve({ data: null, error: { message: 'boom' } });
          const rows = tables[table].filter((row) => tests.every((check) => check(row)));
          if (values) { for (const row of rows) Object.assign(row, values); return resolve({ error: null }); }
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
    async rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      return options.rpc ?? { data: 2, error: null };
    },
  };
  return { client, tables, rpcCalls };
}

const quiet = async <T>(run: () => Promise<T>): Promise<{ value: T; warnings: unknown[][] }> => {
  const original = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try { return { value: await run(), warnings }; } finally { console.warn = original; }
};

test('the organization\'s mailbox, connected by a member, is shared with the team', async () => {
  const { client, rpcCalls } = fakeAdmin({
    provider_tokens: [{ user_id: USER, provider: 'outlook', shared_organization_id: null }],
    organization_members: [{ user_id: USER, organization_id: ORG }],
    organization_shared_mailboxes: [{ organization_id: ORG, provider: 'outlook', email: 'contacto@equipo.test' }],
  });
  const asked: string[] = [];
  const result = await shareMailboxAfterConnect(
    { userId: USER, provider: 'outlook', accessToken: 'access' },
    { admin: client, mailboxEmail: async (provider, token) => { asked.push(`${provider}:${token}`); return ' Contacto@Equipo.test '; } },
  );

  assert.deepEqual(result, { shared: true, members: 2 });
  assert.deepEqual(asked, ['outlook:access']);
  assert.deepEqual(rpcCalls, [{ name: 'share_organization_mailbox_v1', args: { p_organization_id: ORG, p_user_id: USER, p_provider: 'outlook' } }]);
});

test('another mailbox stays the person\'s own, and a shared copy they replace stops being marked as the team\'s', async () => {
  const { client, tables, rpcCalls } = fakeAdmin({
    provider_tokens: [
      { user_id: USER, provider: 'outlook', shared_organization_id: ORG },
      { user_id: 'colleague', provider: 'outlook', shared_organization_id: ORG },
      { user_id: USER, provider: 'google', shared_organization_id: ORG },
    ],
    organization_members: [{ user_id: USER, organization_id: ORG }],
    organization_shared_mailboxes: [{ organization_id: ORG, provider: 'outlook', email: 'contacto@equipo.test' }],
  });
  const result = await shareMailboxAfterConnect(
    { userId: USER, provider: 'outlook', accessToken: 'access' },
    { admin: client, mailboxEmail: async () => 'persona@equipo.test' },
  );

  assert.deepEqual(result, { shared: false, members: 0 });
  assert.equal(rpcCalls.length, 0);
  assert.deepEqual(tables.provider_tokens.map((row) => row.shared_organization_id), [null, ORG, ORG]);
});

test('an organization that lists no mailbox never asks the provider whose mailbox it is', async () => {
  const { client, rpcCalls } = fakeAdmin({
    provider_tokens: [{ user_id: USER, provider: 'outlook', shared_organization_id: null }],
    organization_members: [{ user_id: USER, organization_id: ORG }],
    // The team's mailbox is Outlook; this person connected Gmail, and another organization's listing is not theirs.
    organization_shared_mailboxes: [
      { organization_id: ORG, provider: 'google', email: 'contacto@equipo.test' },
      { organization_id: 'org-other', provider: 'outlook', email: 'contacto@equipo.test' },
    ],
  });
  let asked = 0;
  const result = await shareMailboxAfterConnect(
    { userId: USER, provider: 'outlook', accessToken: 'access' },
    { admin: client, mailboxEmail: async () => { asked += 1; return 'contacto@equipo.test'; } },
  );

  assert.deepEqual(result, { shared: false, members: 0 });
  assert.equal(asked, 0);
  assert.equal(rpcCalls.length, 0);
});

test('without an access token the address cannot be checked, so nothing is shared', async () => {
  const { client, tables, rpcCalls } = fakeAdmin({
    provider_tokens: [{ user_id: USER, provider: 'outlook', shared_organization_id: ORG }],
    organization_members: [{ user_id: USER, organization_id: ORG }],
    organization_shared_mailboxes: [{ organization_id: ORG, provider: 'outlook', email: 'contacto@equipo.test' }],
  });
  const result = await shareMailboxAfterConnect({ userId: USER, provider: 'outlook', accessToken: null }, { admin: client, mailboxEmail: async () => 'contacto@equipo.test' });

  assert.deepEqual(result, { shared: false, members: 0 });
  assert.equal(rpcCalls.length, 0);
  assert.equal(tables.provider_tokens[0].shared_organization_id, null);
});

test('a failure never breaks the connection: it answers «not shared» and logs neither a token nor an address', async () => {
  const setup = {
    provider_tokens: [{ user_id: USER, provider: 'outlook', shared_organization_id: null }],
    organization_members: [{ user_id: USER, organization_id: ORG }],
    organization_shared_mailboxes: [{ organization_id: ORG, provider: 'outlook', email: 'contacto@equipo.test' }],
  };
  const input = { userId: USER, provider: 'outlook' as const, accessToken: 'secret-access-token' };

  const refused = await quiet(() => shareMailboxAfterConnect(input, { admin: fakeAdmin(setup, { rpc: { data: null, error: { message: 'not authorized' } } }).client, mailboxEmail: async () => 'contacto@equipo.test' }));
  const unreadable = await quiet(() => shareMailboxAfterConnect(input, { admin: fakeAdmin(setup, { failRead: 'organization_members' }).client, mailboxEmail: async () => 'contacto@equipo.test' }));
  const noIdentity = await quiet(() => shareMailboxAfterConnect(input, { admin: fakeAdmin(setup).client, mailboxEmail: async () => { throw new Error('graph 401'); } }));

  for (const outcome of [refused, unreadable, noIdentity]) {
    assert.deepEqual(outcome.value, { shared: false, members: 0 });
    assert.equal(outcome.warnings.length, 1);
    const logged = JSON.stringify(outcome.warnings);
    assert.ok(!logged.includes('secret-access-token') && !logged.includes('contacto@equipo.test'), logged);
  }
});
