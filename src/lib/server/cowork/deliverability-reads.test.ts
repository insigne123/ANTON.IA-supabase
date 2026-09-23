import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupDomainDns, readDeliverabilityBounces, readDeliverabilityCheck, readDeliverabilitySender } from './deliverability-reads';

const scope = { userId: 'user-1', organizationId: 'org-1' };

function mockClient(tables: Record<string, { rows?: unknown[]; count?: number; error?: { message: string }; single?: unknown }> = {}) {
  const client = {
    from: (table: string) => {
      const state = tables[table] || {};
      const chain: Record<string, (...args: any[]) => any> = {
        select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
        or: () => chain, gte: () => chain, in: () => chain, not: () => chain, is: () => chain,
        upsert: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: state.single ?? null, error: state.error || null }),
        then: (resolve: (value: unknown) => void) => resolve(state.error
          ? { data: null, error: state.error }
          : { data: state.rows ?? [], error: null, count: state.count ?? (state.rows?.length || 0) }),
      };
      return chain;
    },
  } as never;
  return client;
}

const fakeDns: typeof lookupDomainDns = async (domain: string) => ({
  mx: [{ exchange: `mail.${domain}` }],
  spf: [['v=spf1 include:_spf.google.com -all']],
  dmarc: domain === 'yago.cl' ? [['v=DMARC1; p=reject;']] : [],
  dkim: [{ selector: 'google', records: domain === 'yago.cl' ? [['v=DKIM1; p=abc123']] : [] }],
});

test('lookup resolves mx, spf, dmarc and dkim selectors', async () => {
  const found = await lookupDomainDns('yago.cl', {
    mx: async () => [{ exchange: 'mail.yago.cl' }],
    txt: async (name: string) => name === 'yago.cl' ? [['v=spf1 -all']] : name.startsWith('_dmarc.') ? [['v=DMARC1; p=reject']] : name.startsWith('google.') ? [['v=DKIM1; p=abc123']] : [],
  });
  assert.equal(found.mx.length, 1);
  assert.equal(found.dkim.find((entry) => entry.records.length > 0)?.selector, 'google');
});

test('check serves fresh cache without touching dns', async () => {
  let calls = 0;
  const report = { domain: 'yago.cl', checkedAt: new Date().toISOString(), source: 'live', overall: 'pass' };
  const client = mockClient({ cowork_deliverability_checks: { rows: [{ result: report, checked_at: new Date().toISOString() }] } });
  const result = await readDeliverabilityCheck(client, scope, 'yago.cl', async () => { calls += 1; return fakeDns('yago.cl'); });
  assert.equal(result.report.source, 'cache');
  assert.equal(calls, 0);
});

test('check queries live dns on stale cache and grades strictly', async () => {
  const client = mockClient({ cowork_deliverability_checks: { rows: [{ result: null, checked_at: new Date(Date.now() - 48 * 3600000).toISOString() }] } });
  const pass = await readDeliverabilityCheck(client, scope, 'yago.cl', fakeDns);
  assert.equal(pass.report.overall, 'pass');
  assert.equal(pass.report.source, 'live');
  const fail = await readDeliverabilityCheck(client, scope, 'otro.cl', fakeDns);
  assert.equal(fail.report.dmarc.status, 'fail');
  assert.equal(fail.report.dkim.status, 'unknown');
  assert.equal(fail.report.overall, 'fail');
});

test('check rejects non-domains before any lookup', async () => {
  const client = mockClient();
  await assert.rejects(readDeliverabilityCheck(client, scope, 'https://yago.cl/x', fakeDns), /dominio válido/);
});

test('DNS outage does not get cached as absent SPF or DMARC', async () => {
  const client = mockClient();
  await assert.rejects(readDeliverabilityCheck(client, scope, 'yago.cl',
    () => lookupDomainDns('yago.cl', {
      mx: async () => [{ exchange: 'mail.yago.cl' }],
      txt: async (name) => {
        if (name === '_dmarc.yago.cl') throw Object.assign(new Error('resolver down'), { code: 'ESERVFAIL' });
        return [];
      },
    })), /resolver down/);
});

test('unrelated TXT at a DKIM selector does not prove DKIM', async () => {
  const client = mockClient();
  const result = await readDeliverabilityCheck(client, scope, 'yago.cl', async () => ({
    mx: [{ exchange: 'mail.yago.cl' }], spf: [['v=spf1 -all']],
    dmarc: [['v=DMARC1; p=reject']], dkim: [{ selector: 'google', records: [['unrelated TXT']] }],
  }));
  assert.equal(result.report.dkim.status, 'unknown');
});

test('bounces diagnose causes against the threshold', async () => {
  const client = mockClient({
    contacted_leads: { rows: [{ bounce_category: 'mailbox_not_found', email: 'a@x.test' }], count: 1 },
  });
  const result = await readDeliverabilityBounces(client, scope);
  assert.equal(result.period, 'last_30_days');
  assert.equal(result.causes[0].action, 'do_not_contact_fix_email');
  assert.deepEqual(result.recipientDomains[0], { domain: 'x.test', count: 1 });
});

test('sender stays unverified without samples or profile', async () => {
  const client = mockClient({ profiles: { single: null }, contacted_leads: { rows: [] } });
  const result = await readDeliverabilitySender(client, scope);
  assert.equal(result.verdict, 'unverified');
  assert.equal(result.declared, null);
});
