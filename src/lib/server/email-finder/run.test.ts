import assert from 'node:assert/strict';
import test from 'node:test';

import { call, reply, ScriptedModel } from '@/lib/agent-harness/scripted';

import { forgetEmailDomains } from './company-domain';
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
  /** Verifications each attempt already spent, by attempt id. */
  spent?: Record<string, number>;
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
      // What each claimed attempt already spent (select('id,verifications').in('id', …)).
      then: (resolve: (value: unknown) => unknown) => resolve({
        data: table === 'email_finder_attempts' ? Object.entries(input.spent || {}).map(([id, verifications]) => ({ id, verifications })) : [],
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

/** The lead table read by id, for the company of the lead (select(...).in('id', ...)), and nothing else. */
function factsTable(rows: Record<string, Record<string, unknown>>) {
  const chain: any = {
    select: () => chain, eq: () => chain, ilike: () => chain, in: () => chain, gte: () => chain,
    limit: async () => ({ data: [], error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: Object.values(rows), error: null }),
  };
  return chain;
}
const quiet = async <T>(work: () => Promise<T>) => {
  const info = console.info;
  console.info = () => {};
  try { return await work(); } finally { console.info = info; }
};
test.beforeEach(() => forgetEmailDomains());

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

test('a lead whose domain receives no mail takes the one of its colleagues\u2019 verified emails, and only companies reach Claude', async () => {
  // 6 Nov 2026: 36 people of one company whose site is a .com and whose mail is a .cl, with 6 verified addresses at the .cl.
  const known = [
    { id: 'k1', organization_domain: 'beta.com', email: 'acastro@beta.test', full_name: 'Alex Castro Diaz', email_status: 'verified' },
    { id: 'k2', organization_domain: 'beta.com', email: 'acid@beta.test', full_name: 'Andrea Cid Moreno', email_status: 'verified' },
  ];
  const { client, rpcCalls } = fakeClient({ leads: [lead({ lead_domain: 'beta.com' })], known });
  const { asked, fetchImpl } = reoon({ 'psoto@beta.test': 'safe' });
  const summary = await runEmailFinderTick({ client, environment: ENV, fetchImpl, lookupMx: async domain => domain !== 'beta.com' });
  assert.deepEqual(asked, ['psoto@beta.test'], 'the company format of the colleagues goes first');
  const [saved] = completion(rpcCalls);
  assert.deepEqual([saved.p_status, saved.p_domain, saved.p_email], ['found', 'beta.test', 'psoto@beta.test']);
  assert.deepEqual(summary.enabled && summary.domainsFound, { colegas: 1, ia: 0 });

  // Nobody of the company in the base: Claude is asked, with the company and never the person.
  const alone = fakeClient({ leads: [lead({ lead_domain: null })] });
  const model = new ScriptedModel([reply([call('entregar_dominios', { empresas: [{ id: 'e1', dominio: 'gamma.test', certeza: 'alta' }] })])]);
  const second = reoon({ 'paula.soto@gamma.test': 'safe' });
  const facts = { 'lead-1': { id: 'lead-1', organization_name: 'Gamma Servicios', country: 'Chile' } };
  const withFacts = { ...alone.client, from: (table: string) => table === 'enriched_leads' ? factsTable(facts) : alone.client.from(table) };
  const run = await quiet(() => runEmailFinderTick({ client: withFacts, environment: { ...ENV, EMAIL_FINDER_DOMAIN_AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' },
    fetchImpl: second.fetchImpl, lookupMx: async domain => domain === 'gamma.test', model }));
  assert.equal(model.calls, 1);
  const sent = String(model.requests[0].messages[0].content);
  assert.match(sent, /Gamma Servicios/);
  assert.ok(!/Paula|Soto|@/.test(sent), 'no name or email of the person');
  assert.deepEqual(completion(alone.rpcCalls).map(params => [params.p_status, params.p_domain]), [['found', 'gamma.test']]);
  assert.deepEqual(run.enabled && run.domainsFound, { colegas: 0, ia: 1 });

  // Not found either way: the lead closes as before.
  const nowhere = fakeClient({ leads: [lead({ lead_domain: 'sin-correo.test' })] });
  await quiet(() => runEmailFinderTick({ client: nowhere.client, environment: ENV, fetchImpl: second.fetchImpl, lookupMx: async () => false }));
  assert.equal(completion(nowhere.rpcCalls)[0].p_status, 'no_mx');
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

test('a person who already spent twice the addresses of a run is closed without asking Reoon again', async () => {
  // 2 Nov 2026: leads cut short by the time of the run were verified again from their first address, up to 200 times each.
  const { client, rpcCalls } = fakeClient({ leads: [lead()], spent: { 'a0000000-0000-4000-8000-000000000001': 12 } });
  const { asked, fetchImpl } = reoon({ 'paula.soto@acme.test': 'safe' });
  await runEmailFinderTick({ client, environment: ENV, fetchImpl, lookupMx: hasMx });
  assert.deepEqual(asked, [], 'no verification spent');
  const [saved] = completion(rpcCalls);
  assert.equal(saved.p_status, 'not_found');
  assert.equal(saved.p_last_result, 'verification_cap');
  assert.equal(saved.p_verifications, 0);
});

test('a person cut short by the time of the run counts the attempt and waits an hour; one not started goes back as it was', async () => {
  const { client, rpcCalls } = fakeClient({
    leads: [lead(), lead({ attempt_id: 'a0000000-0000-4000-8000-000000000002', target_lead_id: 'lead-2', full_name: 'Ana Rojas', first_name: 'Ana', last_name: 'Rojas' })],
  });
  const slow = (async (url: URL) => {
    await new Promise(resolve => setTimeout(resolve, 40));
    return Response.json({ email: url.searchParams.get('email'), status: 'invalid' });
  }) as unknown as typeof fetch;
  await runEmailFinderTick({ client, environment: ENV, fetchImpl: slow, lookupMx: hasMx, budgetMs: 20 });
  const [first, second] = completion(rpcCalls);
  assert.deepEqual([first.p_status, first.p_last_result, first.p_retry_after_seconds, first.p_verifications], ['retry', 'cut_short', 3600, 1],
    'started: an attempt, not the next run again from its first address');
  assert.deepEqual([second.p_status, second.p_retry_after_seconds, second.p_verifications], ['release', 3600, 0]);
});

test('a verification that timed out is counted: Reoon charges it all the same', async () => {
  const { client, rpcCalls } = fakeClient({ leads: [lead()] });
  let calls = 0;
  const flaky = (async (url: URL) => {
    calls += 1;
    if (calls === 2) throw new Error('timeout');
    return Response.json({ email: url.searchParams.get('email'), status: 'invalid' });
  }) as unknown as typeof fetch;
  await runEmailFinderTick({ client, environment: ENV, fetchImpl: flaky, lookupMx: hasMx });
  const [saved] = completion(rpcCalls);
  assert.deepEqual([saved.p_status, saved.p_last_result, saved.p_verifications], ['retry', 'reoon_unreachable', 2]);
});
