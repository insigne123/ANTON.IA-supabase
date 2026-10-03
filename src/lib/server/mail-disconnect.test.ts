import assert from 'node:assert/strict';
import test from 'node:test';

import { disconnectMailProvider, revokeGoogleRefreshToken } from './mail-disconnect';
import { encryptStoredToken } from './token-crypto';

type Row = Record<string, unknown>;

/** Just enough of the Supabase query builder for the disconnection: select/eq/maybeSingle, delete and update. */
function fakeAdmin(initial: { provider_tokens: Row[]; profiles: Row[] }, failures: { update?: boolean } = {}) {
  const tables: Record<string, Row[]> = { provider_tokens: [...initial.provider_tokens], profiles: [...initial.profiles] };
  const log: string[] = [];
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let mode: 'select' | 'delete' | 'update' = 'select';
      let values: Row = {};
      const matches = (row: Row) => filters.every(([column, value]) => row[column] === value);
      const builder: any = {
        select() { return builder; },
        delete() { mode = 'delete'; return builder; },
        update(next: Row) { mode = 'update'; values = next; return builder; },
        eq(column: string, value: unknown) { filters.push([column, value]); return builder; },
        maybeSingle: async () => ({ data: tables[table].find(matches) ?? null, error: null }),
        then(resolve: (value: unknown) => void) {
          if (mode === 'delete') {
            log.push(`delete ${table}`);
            tables[table] = tables[table].filter((row) => !matches(row));
            return resolve({ error: null });
          }
          if (mode === 'update') {
            log.push(`update ${table} ${JSON.stringify(values)}`);
            if (failures.update) return resolve({ error: { message: 'boom' } });
            for (const row of tables[table].filter(matches)) Object.assign(row, values);
            return resolve({ error: null });
          }
          resolve({ data: tables[table].filter(matches), error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as never, tables, log };
}

const USER = 'user-1';

test('Gmail: the token row goes first, then Google revokes the decrypted token, and the default sender moves to Outlook', async () => {
  const { client, tables, log } = fakeAdmin({
    provider_tokens: [
      { user_id: USER, provider: 'google', refresh_token: encryptStoredToken('google-refresh') },
      { user_id: USER, provider: 'outlook', refresh_token: encryptStoredToken('outlook-refresh') },
      { user_id: 'someone-else', provider: 'google', refresh_token: 'x' },
    ],
    profiles: [{ id: USER, default_mail_provider: 'google' }],
  });
  const revoked: string[] = [];
  const result = await disconnectMailProvider(client, USER, 'google', { revokeGoogle: async (token) => { revoked.push(token); log.push('revoke'); } });

  assert.deepEqual(result, { disconnected: true, preferred: 'outlook' });
  assert.deepEqual(revoked, ['google-refresh']);
  assert.deepEqual(log, ['delete provider_tokens', 'revoke', 'update profiles {"default_mail_provider":"outlook"}']);
  assert.deepEqual(tables.provider_tokens.map((row) => `${row.user_id}:${row.provider}`), [`${USER}:outlook`, 'someone-else:google']);
});

test('Outlook: no revocation call, and with nothing left connected the default sender is cleared', async () => {
  const { client, tables } = fakeAdmin({
    provider_tokens: [{ user_id: USER, provider: 'outlook', refresh_token: encryptStoredToken('outlook-refresh') }],
    profiles: [{ id: USER, default_mail_provider: 'outlook' }],
  });
  let revokes = 0;
  const result = await disconnectMailProvider(client, USER, 'outlook', { revokeGoogle: async () => { revokes += 1; } });
  assert.deepEqual(result, { disconnected: true, preferred: null });
  assert.equal(revokes, 0);
  assert.equal(tables.profiles[0].default_mail_provider, null);
});

test('a default that pointed elsewhere stays; disconnecting twice answers the same without errors', async () => {
  const { client, log } = fakeAdmin({
    provider_tokens: [
      { user_id: USER, provider: 'google', refresh_token: encryptStoredToken('google-refresh') },
      { user_id: USER, provider: 'outlook', refresh_token: encryptStoredToken('outlook-refresh') },
    ],
    profiles: [{ id: USER, default_mail_provider: 'google' }],
  });
  assert.deepEqual(await disconnectMailProvider(client, USER, 'outlook', { revokeGoogle: async () => {} }), { disconnected: true, preferred: 'google' });
  assert.ok(!log.some((entry) => entry.startsWith('update')), 'Gmail stays the default');
  assert.deepEqual(await disconnectMailProvider(client, USER, 'outlook', { revokeGoogle: async () => {} }), { disconnected: false, preferred: 'google' });
});

test('a failed or slow revocation, or a failed preference update, never undoes the disconnection', async () => {
  const warnings: string[] = [];
  const { client, tables } = fakeAdmin({
    provider_tokens: [{ user_id: USER, provider: 'google', refresh_token: encryptStoredToken('google-refresh') }],
    profiles: [{ id: USER, default_mail_provider: 'google' }],
  }, { update: true });
  const result = await disconnectMailProvider(client, USER, 'google', {
    revokeGoogle: async () => { throw new Error('network down'); },
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(result, { disconnected: true, preferred: null });
  assert.equal(tables.provider_tokens.length, 0);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Google revoke failed: network down/);
  assert.match(warnings[1], /Default sender not updated/);
  assert.ok(!warnings.join(' ').includes('google-refresh'), 'the token never reaches the logs');
});

test('the revocation posts the token form-encoded to Google and gives up after the timeout', async () => {
  const calls: Array<{ url: string; body: string }> = [];
  await revokeGoogleRefreshToken('tok-123', (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response(null, { status: 200 });
  }) as typeof fetch);
  assert.deepEqual(calls, [{ url: 'https://oauth2.googleapis.com/revoke', body: 'token=tok-123' }]);

  const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })) as typeof fetch;
  await assert.rejects(revokeGoogleRefreshToken('tok-123', hanging, 20), /aborted/);
});
