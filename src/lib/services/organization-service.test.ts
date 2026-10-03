import assert from 'node:assert/strict';
import test from 'node:test';

import { organizationService } from './organization-service';

type Call = { method: string; url: string };

function stubFetch(answer: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { method: String(init?.method || 'GET').toUpperCase(), url: String(input) };
    calls.push(call);
    const { status = 200, body } = answer(call);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const list = (active: string) => ({ activeOrganizationId: active, organizations: [{ id: active, name: 'Yago QA', role: 'owner', memberCount: 3 }] });

test('callers that ask for the organization at the same time share one request', async () => {
  let active = 'org-a';
  const net = stubFetch((call) => (call.method === 'GET' ? { body: list(active) } : { body: { ok: true } }));
  try {
    const ids = await Promise.all(Array.from({ length: 9 }, () => organizationService.getCurrentOrganizationId()));
    assert.deepEqual(new Set(ids), new Set(['org-a']));
    assert.equal(net.calls.filter((call) => call.url === '/api/organizations').length, 1, 'nine callers, one request');

    active = 'org-b';
    await organizationService.setCurrentOrganization('org-b');
    assert.equal(await organizationService.getCurrentOrganizationId(), 'org-b', 'a switch forgets the shared answer');
    assert.equal(net.calls.filter((call) => call.url === '/api/organizations' && call.method === 'GET').length, 2);

    await organizationService.updateOrganization('org-b', { name: 'Yago QA 2' });
    await organizationService.listOrganizations();
    assert.equal(net.calls.filter((call) => call.url === '/api/organizations' && call.method === 'GET').length, 3, 'any write forgets it too');
  } finally {
    net.restore();
    await organizationService.setCurrentOrganization('org-reset').catch(() => {});
  }
});

test('the shared answer expires after a few seconds, and a failure is never shared', async () => {
  const realNow = Date.now;
  let now = realNow.call(Date) + 60_000;
  Date.now = () => now;
  let fail = true;
  const net = stubFetch(() => (fail ? { status: 500, body: { error: 'down' } } : { body: list('org-a') }));
  try {
    assert.equal(await organizationService.getCurrentOrganizationId(), null, 'a failed lookup reads as no organization');
    fail = false;
    assert.equal(await organizationService.getCurrentOrganizationId(), 'org-a', 'the next caller asks again');
    await organizationService.getCurrentOrganizationId();
    const gets = () => net.calls.filter((call) => call.url === '/api/organizations').length;
    assert.equal(gets(), 2);
    now += 6_000;
    await organizationService.getCurrentOrganizationId();
    assert.equal(gets(), 3, 'after the window it asks again');
  } finally {
    Date.now = realNow;
    net.restore();
  }
});
