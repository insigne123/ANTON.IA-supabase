import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PhoneRefundError, listPhoneRefunds, notifyPhoneRefunds, phoneRefundsEnabled, reportPhoneRefunds, reviewPhoneRefund } from './phone-refunds';

const ORG = 'org-1';
type Row = Record<string, any>;
/** The tables these functions read and write, held in memory; `fail` answers an error for a table. */
function memory(tables: Record<string, Row[]>, fail: Record<string, { code: string }> = {}) {
  let next = 1;
  const client = { from(table: string) {
    const filters: Array<[string, unknown]> = []; let patch: Row | null = null; let inserted: Row[] | null = null; let window: [number, number] | null = null; let top: number | null = null; let sort: [string, boolean] | null = null;
    const rows = () => (tables[table] ||= []);
    const run = () => {
      if (fail[table]) return { data: null, error: fail[table] };
      if (inserted) {
        for (const row of inserted) if (table === 'phone_refund_claims' && rows().some(known => known.organization_id === row.organization_id && known.phone === row.phone)) return { data: null, error: { code: '23505' } };
        rows().push(...inserted.map(row => ({ id: `claim-${next++}`, status: 'reported', reported_at: `2026-12-02T12:00:0${next}Z`, reviewed_at: null, review_note: null, ...row })));
        return { data: null, error: null };
      }
      let found = rows().filter(row => filters.every(([key, value]) => row[key] === value));
      if (patch) { for (const row of found) Object.assign(row, patch); }
      if (sort) found = [...found].sort((a, b) => (String(a[sort![0]]) < String(b[sort![0]]) ? -1 : 1) * (sort![1] ? 1 : -1));
      if (window) found = found.slice(window[0], window[1] + 1);
      if (top != null) found = found.slice(0, top);
      return { data: found, error: null };
    };
    const chain: any = {
      select: () => chain, eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
      order: (key: string, options?: { ascending?: boolean }) => { sort = [key, options?.ascending !== false]; return chain; },
      limit: (count: number) => { top = count; return chain; }, range: (from: number, to: number) => { window = [from, to]; return chain; },
      insert: (value: Row[]) => { inserted = value; return chain; }, update: (value: Row) => { patch = value; return chain; },
      maybeSingle: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error }; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  } };
  return { client, tables };
}
const seed = () => memory({
  organizations: [{ id: ORG, name: 'Constructora Ejemplo' }],
  organization_credit_prices: [{ organization_id: ORG, email_credits: 1, phone_credits: 5, both_credits: null, phone_refunds: true }],
  enriched_leads: [
    { id: 'l-1', organization_id: ORG, full_name: 'Ana Rojas', primary_phone: '+56 9 8765 4321', phone_numbers: [{ sanitized_number: '+56987654321' }, { raw_number: '+56 2 2345 6789' }] },
    { id: 'l-2', organization_id: ORG, full_name: 'Pía Mella', primary_phone: null, phone_numbers: [{ number: '933334444' }] },
    { id: 'l-x', organization_id: 'org-2', full_name: 'De otra empresa', primary_phone: '+56 9 5555 6666', phone_numbers: [] },
  ],
  enriched_opportunities: [], phone_refund_claims: [],
});
const scope = { organizationId: ORG, userId: 'u-admin' };

test('the customer sends the numbers: only phones the service delivered are taken, once, at what a phone costs the organization', async () => {
  const { client, tables } = seed();
  const told: unknown[] = [];
  const notify = async (...args: unknown[]) => { told.push(args.slice(1)); };
  const report = await reportPhoneRefunds(client, scope, '9 8765 4321\n+56987654321, +56 9 3333 4444; +56 9 5555 6666\nhola', { notify: notify as any });
  assert.deepEqual(report, { added: 2, repeated: [], unknown: ['56955556666'], invalid: ['hola'] }, 'another organization\'s phone is not this one\'s');
  assert.deepEqual(tables.phone_refund_claims.map(row => [row.organization_id, row.reported_by, row.phone, row.contact_name, row.credits, row.status]), [
    [ORG, 'u-admin', '56987654321', 'Ana Rojas', 5, 'reported'], [ORG, 'u-admin', '933334444', 'Pía Mella', 5, 'reported'],
  ], 'kept as the service delivered it, with whose it is');
  assert.deepEqual(told, [[ORG, [{ phone: '56987654321', name: 'Ana Rojas' }, { phone: '933334444', name: 'Pía Mella' }], 5]]);

  // Sent again, written another way: already in the list, nothing new and nobody told.
  const again = await reportPhoneRefunds(client, scope, '+56 9 8765 4321\n56 2 2345 6789', { notify: notify as any });
  assert.deepEqual(again, { added: 1, repeated: ['56987654321'], unknown: [], invalid: [] });
  assert.equal(tables.phone_refund_claims.length, 3);
  assert.deepEqual((await listPhoneRefunds(client, ORG)).map(claim => claim.phone).sort(), ['56223456789', '56987654321', '933334444']);
});

test('nothing is taken from an organization whose agreement does not include it, nor more than a hundred at once', async () => {
  const { client, tables } = seed();
  tables.organization_credit_prices[0].phone_refunds = false;
  assert.equal(await phoneRefundsEnabled(client, ORG), false);
  await assert.rejects(reportPhoneRefunds(client, scope, '+56 9 8765 4321'), (error: unknown) => error instanceof PhoneRefundError && error.status === 403 && /no incluye la devolución/.test(error.message));
  assert.equal(tables.phone_refund_claims.length, 0);
  assert.equal(await phoneRefundsEnabled(seed().client, 'org-without-row'), false, 'no row: the default plan');
  assert.equal(await phoneRefundsEnabled(memory({}, { organization_credit_prices: { code: '42P01' } }).client, ORG), false, 'before the migration');
  const many = Array.from({ length: 101 }, (_, index) => `+569${String(10000000 + index)}`).join('\n');
  await assert.rejects(reportPhoneRefunds(seed().client, scope, many), /hasta 100 teléfonos/);
  assert.deepEqual(await reportPhoneRefunds(seed().client, scope, 'hola'), { added: 0, repeated: [], unknown: [], invalid: ['hola'] });
});

test('the team answers each phone once: confirmed or not, with the moment', async () => {
  const { client, tables } = seed();
  await reportPhoneRefunds(client, scope, '+56 9 8765 4321\n+56 9 3333 4444', { notify: async () => undefined });
  const [first, second] = tables.phone_refund_claims;
  const now = new Date('2026-12-04T15:00:00Z');
  const confirmed = await reviewPhoneRefund(client, ORG, first.id, 'confirmed', ' Fuera de servicio ', now);
  assert.deepEqual([confirmed.status, confirmed.credits, confirmed.reviewedAt, confirmed.reviewNote], ['confirmed', 5, '2026-12-04T15:00:00.000Z', 'Fuera de servicio']);
  await assert.rejects(reviewPhoneRefund(client, ORG, first.id, 'rejected', null, now), (error: unknown) => error instanceof PhoneRefundError && error.status === 409);
  await assert.rejects(reviewPhoneRefund(client, 'org-2', second.id, 'confirmed', null, now), /ya fue revisado o no existe/, 'another organization\'s panel does not answer it');
  assert.equal((await reviewPhoneRefund(client, ORG, second.id, 'rejected', null, now)).status, 'rejected');
  assert.equal(tables.phone_refund_claims[0].status, 'confirmed');
});

test('the team is told there are phones to try, through Resend only and only when someone is set to hear', async () => {
  const { client } = seed();
  const sent: any[] = [];
  const fetcher = (async (_url: string, init: any) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'm-1' }), { status: 200 }); }) as unknown as typeof fetch;
  const taken = [{ phone: '56987654321', name: 'Ana Rojas' }, { phone: '933334444', name: null }];
  await notifyPhoneRefunds(client, ORG, taken, 5, { env: { RESEND_API_KEY: 'k' }, fetch: fetcher });
  await notifyPhoneRefunds(client, ORG, taken, 5, { env: { PROVIDER_ALERT_EMAILS: 'equipo@yago.cl' }, fetch: fetcher });
  assert.equal(sent.length, 0, 'nobody to tell, or no way to send');
  await notifyPhoneRefunds(client, ORG, taken, 5, { env: { RESEND_API_KEY: 'k', PROVIDER_ALERT_EMAILS: 'equipo@yago.cl' }, fetch: fetcher });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Constructora Ejemplo reportó 2 teléfonos que no existen');
  assert.match(String(sent[0].text), /\+56987654321 · Ana Rojas\n\+933334444\n/);
  assert.match(String(sent[0].text), /5 días hábiles\.\nCada confirmado devuelve 5 créditos\./);
});

test('the database keeps the list for the server alone, and gives back only what was confirmed', () => {
  const sql = readFileSync('supabase/migrations/20261120120000_credit_prices_and_phone_refunds.sql', 'utf8');
  for (const table of ['organization_credit_prices', 'phone_refund_claims']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`));
  }
  assert.doesNotMatch(sql, /create policy/);
  assert.match(sql, /unique \(organization_id, phone\)/);
  assert.match(sql, /r\.status = 'confirmed'/);
  assert.match(sql, /coalesce\(price\.both_credits, 9\)/, 'an organization without prices of its own is counted as before');
  assert.match(sql, /revoke all on function public\.apollo_credit_allocation_status_v3\(uuid, timestamptz\) from public, anon, authenticated;/);
});
