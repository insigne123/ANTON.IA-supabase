import assert from 'node:assert/strict';
import test from 'node:test';

import { runEmailFinderTick } from './run';

const ENV = { EMAIL_FINDER_ENABLED: 'true', REOON_API_KEY: 'test-reoon-key' };

function lead(overrides: Record<string, unknown> = {}) {
  return {
    attempt_id: 'a0000000-0000-4000-8000-000000000001',
    claimed_at: '2026-10-29T12:00:00.000Z',
    target_table: 'enriched_leads',
    target_lead_id: 'lead-1',
    organization_id: 'o0000000-0000-4000-8000-000000000001',
    user_id: 'u0000000-0000-4000-8000-000000000001',
    full_name: 'Paula Soto Rojas',
    first_name: 'Paula',
    last_name: 'Soto Rojas',
    lead_domain: 'acme.test',
    website_domain: null,
    company_domain: null,
    ...overrides,
  };
}

function fakeClient(input: {
  leads: Array<Record<string, unknown>>;
  known?: Array<Record<string, unknown>>;
  catchAllKnown?: boolean;
  suppressed?: boolean;
}) {
  const rpcCalls: Array<{ name: string; params: Record<string, any> }> = [];
  const query = (table: string) => {
    const chain: any = {
      select: () => chain, eq: () => chain, ilike: () => chain, in: () => chain, gte: () => chain,
      limit: async () => ({
        data: table === 'email_finder_attempts' ? (input.catchAllKnown ? [{ id: 'x' }] : [])
          : table === 'enriched_leads' ? input.known || [] : [],
        error: null,
      }),
    };
    return chain;
  };
  return {
    rpcCalls,
    client: {
      from: query,
      rpc: async (name: string, params: Record<string, any>) => {
        rpcCalls.push({ name, params });
        if (name === 'claim_email_finder_candidates_v1') return { data: input.leads, error: null };
        if (name === 'has_apollo_enrichment_email_suppression_v1') return { data: Boolean(input.suppressed), error: null };
        if (name === 'complete_email_finder_attempt_v1') {
          return { data: params.p_status === 'release' ? 'retry' : params.p_status, error: null };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    },
  };
}

function reoon(answers: Record<string, string | number>) {
  const asked: string[] = [];
  const fetchImpl = (async (url: URL) => {
    const email = url.searchParams.get('email') || '';
    asked.push(email);
    assert.equal(url.searchParams.get('mode'), 'power');
    const answer = answers[email] ?? 'invalid';
    if (typeof answer === 'number') return Response.json({ status: 'error', reason: 'Not enough credits' }, { status: answer });
    return Response.json({ email, status: answer });
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}

const hasMx = async () => true;
const completion = (calls: Array<{ name: string; params: Record<string, any> }>) =>
  calls.filter(call => call.name === 'complete_email_finder_attempt_v1').map(call => call.params);

test('does nothing until it is switched on and Reoon has a key', async () => {
  const { client, rpcCalls } = fakeClient({ leads: [lead()] });
  assert.deepEqual(await runEmailFinderTick({ client, environment: { EMAIL_FINDER_ENABLED: 'true' } }), { enabled: false });
  assert.deepEqual(await runEmailFinderTick({ client, environment: { REOON_API_KEY: 'k' } }), { enabled: false });
  assert.equal(rpcCalls.length, 0);
});

test('keeps the first address Reoon confirms and stops asking', async () => {
  const { client, rpcCalls } = fakeClient({ leads: [lead()] });
  const { asked, fetchImpl } = reoon({ 'psoto@acme.test': 'safe' });
  const summary = await runEmailFinderTick({ client, environment: ENV, fetchImpl, lookupMx: hasMx });
  assert.deepEqual(asked, ['paula.soto@acme.test', 'psoto@acme.test']);
  const [saved] = completion(rpcCalls);
  assert.equal(saved.p_status, 'found');
  assert.equal(saved.p_email, 'psoto@acme.test');
  assert.equal(saved.p_email_status, 'verified');
  assert.equal(saved.p_verifications, 2);
  assert.equal(summary.enabled && summary.verifications, 2);
});

test('a domain that accepts any address keeps a guess only when the company format is clear', async () => {
  const known = [
    { id: 'k1', email: 'acastro@acme.test', full_name: 'Alex Castro Diaz' },
    { id: 'k2', email: 'acid@acme.test', full_name: 'Andrea Cid Moreno' },
  ];
  const clear = fakeClient({ leads: [lead()], known });
  const first = reoon({ 'psoto@acme.test': 'catch_all' });
  await runEmailFinderTick({ client: clear.client, environment: ENV, fetchImpl: first.fetchImpl, lookupMx: hasMx });
  assert.deepEqual(first.asked, ['psoto@acme.test']);
  assert.equal(completion(clear.rpcCalls)[0].p_status, 'guessed');
  assert.equal(completion(clear.rpcCalls)[0].p_email_status, 'extrapolated');

  const unclear = fakeClient({ leads: [lead()] });
  const second = reoon({ 'paula.soto@acme.test': 'catch_all' });
  await runEmailFinderTick({ client: unclear.client, environment: ENV, fetchImpl: second.fetchImpl, lookupMx: hasMx });
  assert.equal(completion(unclear.rpcCalls)[0].p_status, 'catch_all');
  assert.equal(completion(unclear.rpcCalls)[0].p_email, null);
});

test('a domain already known to accept any address spends no checks', async () => {
  const { client, rpcCalls } = fakeClient({ leads: [lead()], catchAllKnown: true });
  const { asked, fetchImpl } = reoon({});
  await runEmailFinderTick({ client, environment: ENV, fetchImpl, lookupMx: hasMx });
  assert.deepEqual(asked, []);
  assert.equal(completion(rpcCalls)[0].p_status, 'catch_all');
});

test('no checks for people who unsubscribed, domains without mail or names without a surname', async () => {
  const suppressed = fakeClient({ leads: [lead()], suppressed: true });
  const run = reoon({});
  await runEmailFinderTick({ client: suppressed.client, environment: ENV, fetchImpl: run.fetchImpl, lookupMx: hasMx });
  assert.equal(completion(suppressed.rpcCalls)[0].p_status, 'suppressed');

  const noMx = fakeClient({ leads: [lead({ lead_domain: 'sin-correo.test' })] });
  await runEmailFinderTick({ client: noMx.client, environment: ENV, fetchImpl: run.fetchImpl, lookupMx: async () => false });
  assert.equal(completion(noMx.rpcCalls)[0].p_status, 'no_mx');

  const noName = fakeClient({ leads: [lead({ full_name: 'Pedro B', first_name: 'Pedro', last_name: 'B' })] });
  await runEmailFinderTick({ client: noName.client, environment: ENV, fetchImpl: run.fetchImpl, lookupMx: hasMx });
  assert.equal(completion(noName.rpcCalls)[0].p_status, 'no_name');
  assert.deepEqual(run.asked, []);
});

test('the website or another lead of the same company gives the domain when the lead has none', async () => {
  const { client, rpcCalls } = fakeClient({
    leads: [lead({ lead_domain: null, website_domain: 'https://www.beta.test/contacto', company_domain: 'beta-sa.test' })],
  });
  const { asked, fetchImpl } = reoon({ 'paula.soto@beta.test': 'safe' });
  await runEmailFinderTick({ client, environment: ENV, fetchImpl, lookupMx: hasMx });
  assert.deepEqual(asked, ['paula.soto@beta.test']);
  assert.equal(completion(rpcCalls)[0].p_domain, 'beta.test');
});

test('when Reoon refuses the account the run stops and gives every lead back for later', async () => {
  const { client, rpcCalls } = fakeClient({
    leads: [lead(), lead({ attempt_id: 'a0000000-0000-4000-8000-000000000002', target_lead_id: 'lead-2' })],
  });
  const { asked, fetchImpl } = reoon({ 'paula.soto@acme.test': 402 });
  const summary = await runEmailFinderTick({ client, environment: ENV, fetchImpl, lookupMx: hasMx });
  assert.deepEqual(asked, ['paula.soto@acme.test']);
  assert.deepEqual(completion(rpcCalls).map(params => [params.p_status, params.p_retry_after_seconds]), [
    ['release', 3600],
    ['release', 3600],
  ]);
  assert.equal(summary.enabled && summary.stoppedBy, 'reoon_account_refused');
});

test('when every answer is unknown the lead is tried again later', async () => {
  const { client, rpcCalls } = fakeClient({ leads: [lead()] });
  const answers = Object.fromEntries(['paula.soto', 'psoto', 'paulasoto', 'p.soto', 'paula', 'paula_soto']
    .map(local => [`${local}@acme.test`, 'unknown']));
  const { fetchImpl } = reoon(answers);
  await runEmailFinderTick({ client, environment: ENV, fetchImpl, lookupMx: hasMx });
  const [saved] = completion(rpcCalls);
  assert.equal(saved.p_status, 'retry');
  assert.equal(saved.p_verifications, 6);
});
