import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
};

const {
  findReportForLead,
  getLeadReports,
  setLeadResearchStorageScope,
  upsertLeadReports,
} = await import('@/lib/lead-research-storage');

function scopedKey(userId: string, organizationId: string | null) {
  return `leadflow-lead-research:v2:user:${userId}:organization:${organizationId || 'personal'}`;
}

function cachedReport(leadRef: string) {
  return {
    id: leadRef,
    company: { name: 'Shared Company', domain: 'shared.example' },
    createdAt: new Date().toISOString(),
    websiteSummary: { overview: 'Evidence', services: [], sources: [] },
    signals: [],
    meta: { leadRef },
  };
}

test('browser cache matches exact lead ref or email, never company', () => {
  values.clear();
  setLeadResearchStorageScope('test-user', 'org-1');
  values.set(scopedKey('test-user', 'org-1'), JSON.stringify({
    version: 2,
    updatedAt: new Date().toISOString(),
    items: [cachedReport('lead-1'), cachedReport('person@example.test')],
  }));

  assert.equal(findReportForLead({ leadId: 'lead-1', companyDomain: 'other.example' })?.id, 'lead-1');
  assert.equal(findReportForLead({ email: 'PERSON@example.test', companyName: 'Other' })?.id, 'person@example.test');
  assert.equal(findReportForLead({ companyDomain: 'shared.example', companyName: 'Shared Company' }), null);
});

test('browser cache rejects a stale individual report even when the collection was updated recently', () => {
  values.clear();
  setLeadResearchStorageScope('test-user', 'org-1');
  values.set(scopedKey('test-user', 'org-1'), JSON.stringify({
    version: 2,
    updatedAt: new Date().toISOString(),
    items: [{ ...cachedReport('stale-lead'), createdAt: '2020-01-01T00:00:00.000Z' }],
  }));

  assert.equal(findReportForLead({ leadId: 'stale-lead' }), null);
});

test('browser cache is isolated by both user and organization', () => {
  values.clear();
  setLeadResearchStorageScope('test-user', 'org-1');
  upsertLeadReports([cachedReport('org-1-lead')]);

  setLeadResearchStorageScope('test-user', 'org-2');
  assert.deepEqual(getLeadReports(), []);
  upsertLeadReports([cachedReport('org-2-lead')]);

  setLeadResearchStorageScope('other-user', 'org-1');
  assert.deepEqual(getLeadReports(), []);

  setLeadResearchStorageScope('test-user', 'org-1');
  assert.deepEqual(getLeadReports().map((item) => item.id), ['org-1-lead']);
});

test('legacy unscoped and user-only caches remain inaccessible', () => {
  values.clear();
  values.set('leadflow-lead-research', JSON.stringify([cachedReport('global-legacy')]));
  values.set('leadflow-lead-research:test-user', JSON.stringify([cachedReport('user-legacy')]));

  setLeadResearchStorageScope('test-user', 'org-1');

  assert.deepEqual(getLeadReports(), []);
  assert.equal(values.has('leadflow-lead-research'), true);
  assert.equal(values.has('leadflow-lead-research:test-user'), true);
});
