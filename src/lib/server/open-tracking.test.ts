import assert from 'node:assert/strict';
import test from 'node:test';

import { addMessageTracking } from '../email-tracking';
import { readOpenTracking, readOpenTrackingState, saveOpenTracking, sendTracking } from './open-tracking';

test('what a send measures: what it asked for, else the organization\'s choice for a new message; clicks only when asked (plan de uso M4)', () => {
  assert.deepEqual(sendTracking({ organizationOpens: true, newMessage: true }), { track: true, links: false }, 'opens only, links as they are');
  assert.deepEqual(sendTracking({ organizationOpens: false, newMessage: true }), { track: false, links: false }, 'off by default');
  assert.deepEqual(sendTracking({ organizationOpens: true, newMessage: false }), { track: false, links: false }, 'a reply in a conversation is not measured');
  assert.deepEqual(sendTracking({ open: false, organizationOpens: true, newMessage: true }), { track: false, links: false }, 'the request can say no');
  assert.deepEqual(sendTracking({ clicks: true, organizationOpens: false, newMessage: true }), { track: true, links: true });
});

test('the open pixel alone leaves every link as it was', () => {
  const html = '<p>Hola <a href="https://axis.cl/demo">la demo</a></p>';
  const opens = addMessageTracking({ html, baseUrl: 'https://app.example/', trackingKey: 'dispatch-0001', links: false });
  assert.equal(opens.trackedLinks, 0);
  assert.match(opens.html, /href="https:\/\/axis\.cl\/demo"/);
  assert.match(opens.html, /<img src="https:\/\/app\.example\/api\/tracking\/open\?dispatch=dispatch-0001"/);
  const both = addMessageTracking({ html, baseUrl: 'https://app.example', trackingKey: 'dispatch-0001' });
  assert.equal(both.trackedLinks, 1, 'without links: false, as before');
  assert.equal(addMessageTracking({ html, baseUrl: 'https://app.example', trackingKey: null, links: false }).pixelEnabled, false, 'no key, nothing');
});

const client = (rows: { organizations?: any[]; members?: any[] }, options: { missingColumn?: boolean } = {}) => {
  const updates: any[] = [];
  const from = (table: string) => {
    const filters: Record<string, string> = {};
    let update: any = null;
    const chain: any = {
      select: () => chain,
      update: (values: any) => { update = values; return chain; },
      eq: (key: string, value: string) => { filters[key] = value; return chain; },
      maybeSingle: () => chain,
      then: (resolve: any) => {
        if (options.missingColumn && table === 'organizations') return resolve({ data: null, error: { code: '42703', message: 'column does not exist' } });
        if (update) { updates.push({ table, filters: { ...filters }, update }); return resolve({ data: null, error: null }); }
        const source = table === 'organizations' ? rows.organizations || [] : rows.members || [];
        const found = source.find(row => Object.entries(filters).every(([key, value]) => String(row[key]) === value));
        return resolve({ data: found ?? null, error: null });
      },
    };
    return chain;
  };
  return { client: { from }, updates };
};

test('read and saved for the organization, by its owners and administrators only; before the column exists it is off', async () => {
  const org = { id: 'org-1', open_tracking_enabled: true };
  const members = [{ organization_id: 'org-1', user_id: 'u-admin', role: 'admin' }, { organization_id: 'org-1', user_id: 'u-ana', role: 'member' }];
  assert.equal(await readOpenTracking(client({ organizations: [org] }).client, 'org-1'), true);
  assert.equal(await readOpenTracking(client({ organizations: [{ id: 'org-1', open_tracking_enabled: null }] }).client, 'org-1'), false);
  assert.equal(await readOpenTracking(client({}, { missingColumn: true }).client, 'org-1'), false, 'missing column: off');
  assert.deepEqual(await readOpenTrackingState(client({}, { missingColumn: true }).client, 'org-1'), { enabled: false, available: false }, 'and no switch is offered');
  assert.deepEqual(await readOpenTrackingState(client({ organizations: [org] }).client, 'org-1'), { enabled: true, available: true });

  const saving = client({ organizations: [org], members });
  assert.deepEqual(await saveOpenTracking(saving.client, { organizationId: 'org-1', userId: 'u-admin' }, false), { enabled: false });
  assert.deepEqual(saving.updates, [{ table: 'organizations', filters: { id: 'org-1' }, update: { open_tracking_enabled: false } }]);
  await assert.rejects(saveOpenTracking(saving.client, { organizationId: 'org-1', userId: 'u-ana' }, true), /Solo un administrador/);
  await assert.rejects(saveOpenTracking(client({ members }, { missingColumn: true }).client, { organizationId: 'org-1', userId: 'u-admin' }, true), /aún no está disponible/);
});
