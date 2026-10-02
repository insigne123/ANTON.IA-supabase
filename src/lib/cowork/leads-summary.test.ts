import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkLeadsSummary } from './leads-summary';

const lead = (id: string, email: string | null, linkedin_url: string | null = null) => ({ id, email, linkedin_url });

test('each contact is counted once, in its most advanced group, with exact figures', () => {
  const summary = coworkLeadsSummary({
    leads: [
      lead('a', 'ana@x.cl', 'https://www.linkedin.com/in/ana'), lead('b', 'Beto@X.cl'), lead('c', 'carla@x.cl'),
      lead('d', 'dani@x.cl', 'https://linkedin.com/company/x'), lead('e', null), lead('f', ''),
    ],
    // Ana replied (matched by email, case aside); Beto was contacted (by lead id); Carla was researched.
    contacted: [{ lead_id: null, email: 'ANA@x.cl', replied_at: '2026-09-30T10:00:00Z' }, { lead_id: 'b', email: 'otro@x.cl', replied_at: null }],
    researched: [{ lead_id: 'c' }, { lead_id: 'zz' }, { lead_id: null }],
  });
  assert.equal(summary.total, 6);
  assert.equal(summary.exact, true);
  assert.deepEqual(summary.groups.map(group => [group.id, group.count]), [['replied', 1], ['contacted', 1], ['ready', 1], ['with_email', 1], ['no_email', 2]]);
  assert.equal(summary.groups.reduce((sum, group) => sum + group.count, 0), summary.total, 'the groups add up to the total');
  assert.equal(summary.withLinkedinProfile, 1, 'only personal profiles (/in/) count');
  assert.ok(summary.groups.every(group => group.label && group.next));
});

test('a contacted person without a reply is not «ready», and a capped list says its figures are minimums', () => {
  const summary = coworkLeadsSummary({ leads: [lead('a', 'ana@x.cl')], contacted: [{ lead_id: 'a', email: null, replied_at: null }], researched: [{ lead_id: 'a' }] },
    { truncated: true });
  assert.deepEqual(summary.groups.filter(group => group.count).map(group => group.id), ['contacted']);
  assert.equal(summary.exact, false);
  assert.match(summary.note, /5\.000/);
});
