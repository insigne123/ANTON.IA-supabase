import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCoworkListContact } from './list-review';
const id = '00000000-0000-4000-8000-000000000001';

function mockClient(rows: Record<string, unknown[]>, leadRow: unknown) {
  const tables: string[] = [];
  // Resolve list queries through rows map keyed by table.
  const resolving = { from(table: string) {
    tables.push(table);
    let scoped = false;
    const chain: Record<string, (...args: any[]) => any> = {
      select() { return chain; },
      eq(key: unknown, value: unknown) { if (key === 'organization_id') { assert.equal(value, 'org'); scoped = true; } return chain; },
      neq() { return chain; },
      not() { return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() {
        assert.equal(scoped, true);
        if (table === 'leads') return { data: leadRow, error: null };
        return { data: null, error: null };
      },
      then(resolve: (value: unknown) => void) { resolve({ data: rows[table] || [], error: null }); },
    };
    return chain;
  } };
  return { client: resolving, tables };
}

test('list review scopes every targeted query and never authorizes sends', async () => {
  const { client, tables } = mockClient({}, { id, email: 'a@example.com', company: 'Acme', linkedin_url: 'https://www.linkedin.com/in/ana' });
  const result = await reviewCoworkListContact(client as never, { userId: 'owner', organizationId: 'org' }, id,
    async () => ({ status: 'blocked', reasons: ['unsubscribe'] }));
  assert.equal(result.disposition, 'blocked');
  assert.equal(result.listReady, false);
  assert.equal(result.sendAuthorized, false);
  assert.equal(result.history.complete, true);
  assert.ok(tables.includes('extension_profile_captures'));
  assert.ok(tables.includes('enriched_leads'));
});

test('immutable capture corroborates only on strict title and company match', async () => {
  const lead = { id, email: 'a@example.com', title: 'Gerenta', company: 'Acme', linkedin_url: 'https://www.linkedin.com/in/ana' };
  const { client } = mockClient({
    extension_profile_captures: [{ title: 'Gerenta', company_name: 'Acme', captured_at: new Date().toISOString() }],
  }, lead);
  const result = await reviewCoworkListContact(client as never, { userId: 'owner', organizationId: 'org' }, id,
    async () => ({ status: 'ok', reasons: [] }));
  assert.equal(result.profileCheck.status, 'corroborated');
});

test('partial title overlap never corroborates the profile', async () => {
  const lead = { id, email: 'a@example.com', title: 'Asistente de gerente', company: 'Acme', linkedin_url: 'https://www.linkedin.com/in/ana' };
  const { client } = mockClient({
    extension_profile_captures: [{ title: 'Gerente', company_name: 'Acme', captured_at: new Date().toISOString() }],
  }, lead);
  const result = await reviewCoworkListContact(client as never, { userId: 'owner', organizationId: 'org' }, id,
    async () => ({ status: 'ok', reasons: [] }));
  assert.equal(result.profileCheck.status, 'mismatch');
  assert.equal(result.listReady, false);
});

test('invalid target cannot invoke privacy checks or database reads', async () => {
  await assert.rejects(reviewCoworkListContact({ from() { assert.fail(); } } as never,
    { userId: 'u', organizationId: 'o' }, 'invalid', async () => { assert.fail(); }));
});
