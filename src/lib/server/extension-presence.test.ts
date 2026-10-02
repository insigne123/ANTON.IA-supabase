import test from 'node:test';
import assert from 'node:assert/strict';
import { readExtensionPresence } from './extension-presence';

const NOW = Date.parse('2026-10-02T15:00:00Z');
const ORG = 'org-1';
type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>, calls: Array<{ table: string; filters: unknown[] }>) {
  return {
    from(table: string) {
      const call = { table, filters: [] as unknown[] };
      calls.push(call);
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { call.filters.push(['eq', key, value]); return query; },
        or: (filter: string) => { call.filters.push(['or', filter]); return query; },
        in: (key: string, values: unknown[]) => { call.filters.push(['in', key, values]); return query; },
        limit: async () => ({ data: tables[table] || [], error: null }),
      };
      return query;
    },
  };
}
const ana = 'https://www.linkedin.com/in/ana-perez';
const bruno = 'https://www.linkedin.com/in/bruno';
const anaShort = 'https://www.linkedin.com/in/ana';
const tables = {
  leads: [{ user_id: 'me', email: 'Ana@Acme.cl', linkedin_url: 'https://www.linkedin.com/in/ana-perez/' }],
  enriched_leads: [{ user_id: 'other', email: null, linkedin_url: 'https://linkedin.com/in/bruno' }],
  contacted_leads: [{ email: 'ana@acme.cl', sent_at: '2026-09-25T12:00:00Z', replied_at: '2026-09-27T12:00:00Z' }],
  extension_linkedin_sends: [{ profile_url: bruno, updated_at: '2026-09-30T12:00:00Z' }],
};
const run = async (locks: Record<string, unknown> = {}) => {
  const calls: Array<{ table: string; filters: unknown[] }> = [];
  const lockCalls: unknown[] = [];
  const client = fakeClient(tables, calls);
  const presence = await readExtensionPresence({ supabase: client as any, organizationId: ORG, user: { id: 'me' } as any }, [ana, bruno, anaShort], NOW, {
    readTeamLocks: (async (...args: unknown[]) => { lockCalls.push(args); return { enabled: true, byEmail: {}, byProviderId: {}, byLinkedin: locks }; }) as any,
    admin: () => client as any,
  });
  return { presence, calls, lockCalls };
};

test('each profile says what the organization knows, matched by the exact profile', async () => {
  const { presence, calls, lockCalls } = await run();
  assert.deepEqual(presence[ana], { label: 'Respondió hace 5 días', tone: 'success', blocks: false });
  assert.deepEqual(presence[bruno], { label: 'Contactado hace 2 días por LinkedIn', tone: 'info', blocks: false });
  // «ana» is a shorter handle that the «ilike» also brings: it is a different person and nothing is known of her.
  assert.equal(presence[anaShort], undefined);
  // Every read is scoped to the active organization, and only confirmed LinkedIn sends count.
  for (const call of calls) assert.ok(call.filters.some(filter => JSON.stringify(filter) === JSON.stringify(['eq', 'organization_id', ORG])), call.table);
  assert.ok(calls.find(call => call.table === 'extension_linkedin_sends')!.filters.some(filter => JSON.stringify(filter) === JSON.stringify(['eq', 'status', 'confirmed'])));
  assert.deepEqual((lockCalls[0] as unknown[])[2], { linkedinUrls: ['linkedin.com/in/ana-perez', 'linkedin.com/in/bruno', 'linkedin.com/in/ana'] });
});

test('someone else working the person comes before one\'s own facts', async () => {
  const { presence } = await run({ 'linkedin.com/in/bruno': { status: 'active', ownerName: 'Ana', mine: false, replied: true, lastContactedAt: '2026-09-30T12:00:00Z' } });
  assert.deepEqual(presence[bruno], { label: 'En conversación con Ana', tone: 'warning', blocks: true });
});

test('nothing to ask, nothing read; at most 50 profiles', async () => {
  const calls: Array<{ table: string; filters: unknown[] }> = [];
  const empty = await readExtensionPresence({ supabase: fakeClient({}, calls) as any, organizationId: ORG, user: { id: 'me' } as any }, ['https://example.com/x'], NOW,
    { readTeamLocks: (async () => { throw new Error('should not read'); }) as any, admin: () => fakeClient({}, calls) as any });
  assert.deepEqual(empty, {});
  assert.equal(calls.length, 0);
  const many = Array.from({ length: 80 }, (_, index) => `https://www.linkedin.com/in/p${index}`);
  const lockCalls: unknown[] = [];
  await readExtensionPresence({ supabase: fakeClient({}, calls) as any, organizationId: ORG, user: { id: 'me' } as any }, many, NOW,
    { readTeamLocks: (async (...args: unknown[]) => { lockCalls.push(args); return { enabled: false, byEmail: {}, byProviderId: {}, byLinkedin: {} }; }) as any, admin: () => fakeClient({}, calls) as any });
  assert.equal(((lockCalls[0] as unknown[])[2] as { linkedinUrls: string[] }).linkedinUrls.length, 50);
});
