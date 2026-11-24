import assert from 'node:assert/strict';
import test from 'node:test';

import type { NativeResearchLeadStatus } from '@/lib/native-research-contracts';
import { assessResearchQuality } from '@/lib/native-research-quality';
import type { ResearchWorkspaceLead, ResearchWorkspaceRunItem } from '@/lib/research-workspace';
import {
  mergeResearchRunItems,
  paginateResearchRail,
  researchItemsFromLeadStatuses,
} from './research-workspace-ui';

const leads: ResearchWorkspaceLead[] = [
  { key: 'lead-1', id: 'lead-1', fullName: 'Ada', email: 'ada@example.com', companyName: 'Acme' },
  { key: 'lead-2', id: 'lead-2', fullName: 'Grace', email: 'grace@example.com', companyName: 'Beta' },
];

function runItem(lead: ResearchWorkspaceLead, id: string): ResearchWorkspaceRunItem {
  return {
    id,
    reportId: `report-${id}`,
    position: 0,
    leadRef: lead.key,
    status: 'completed',
    lead,
    result: null,
    researchSnapshotId: null,
    errorMessage: null,
    updatedAt: null,
    evidenceCount: 0,
    sourceCount: 0,
    qualityScore: null,
    canCreateDraft: false,
    readiness: 'missing_evidence',
  };
}

test('keeps prior per-lead reports while the active batch overrides only matching leads', () => {
  const priorAda = runItem(leads[0], 'prior-ada');
  const priorGrace = runItem(leads[1], 'prior-grace');
  const refreshedAda = { ...runItem(leads[0], 'active-ada'), status: 'running' as const, readiness: 'in_progress' as const };

  const merged = mergeResearchRunItems([priorAda, priorGrace], [refreshedAda]);

  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.lead.key === 'lead-1')?.id, 'active-ada');
  assert.equal(merged.find((item) => item.lead.key === 'lead-2')?.id, 'prior-grace');
});

test('maps persisted native status into a navigable rail item', () => {
  const quality = assessResearchQuality({
    status: 'completed',
    companyIdentityPresent: true,
    emailPresent: true,
    leadRolePresent: false,
    evidenceCount: 1,
    verifiedSourceCount: 1,
    companyFactCount: 1,
    companyFactSourceCount: 1,
    recentSignalCount: 0,
    overallConfidence: 0.72,
  });
  const statuses: NativeResearchLeadStatus[] = [{
    leadId: 'lead-2',
    status: 'completed',
    reportId: 'report-grace',
    researchSnapshotId: 'snapshot-grace',
    result: {
      status: 'completed',
      reportId: 'report-grace',
      researchSnapshotId: 'snapshot-grace',
      lead: { id: 'lead-2', fullName: 'Grace', email: 'grace@example.com', companyName: 'Beta' },
      score: 72,
      priority: 'medium',
      evidence: [{ id: 'evidence-1', statement: 'Beta publica una nueva iniciativa.', sourceId: 'source-1', sourceUrl: 'https://beta.example/news', kind: 'signal' }],
      sources: [{ id: 'source-1', title: 'Beta', url: 'https://beta.example/news', type: 'news', provider: 'web' }],
      angle: '',
      ordenEnvio: 1,
      esperaSugeridaDias: 0,
      promptPack: { context: '', claims: [], doNotClaim: [] },
      companyResearchCache: { hit: false, domain: null, expiresAt: null, artifactId: null, cacheIdentity: null },
      quality,
      draftEligibility: quality.draftEligibility,
      warnings: [],
    },
    errorCode: null,
    updatedAt: '2026-09-04T12:00:00.000Z',
  }];

  const items = researchItemsFromLeadStatuses(statuses, leads);

  assert.equal(items.length, 1);
  assert.equal(items[0].lead.key, 'lead-2');
  assert.equal(items[0].reportId, 'report-grace');
  assert.equal(items[0].researchSnapshotId, 'snapshot-grace');
  assert.equal(items[0].result?.lead.fullName, 'Grace');
});

test('caps rail rendering and clamps pagination without losing the filtered collection', () => {
  const items = Array.from({ length: 95 }, (_, index) => `lead-${index + 1}`);

  const second = paginateResearchRail(items, 2, 40);
  const beyondLast = paginateResearchRail(items, 99, 40);

  assert.deepEqual(second.items, items.slice(40, 80));
  assert.deepEqual({ page: second.page, totalPages: second.totalPages, start: second.start, end: second.end }, {
    page: 2,
    totalPages: 3,
    start: 41,
    end: 80,
  });
  assert.deepEqual(beyondLast.items, items.slice(80));
  assert.equal(beyondLast.page, 3);
});

test('a research refused for today\'s quota says it waits, as failed in its batch or as queued in the list', async () => {
  const { researchWaitsForQuota } = await import('@/lib/research-workspace');
  const [waiting] = researchItemsFromLeadStatuses([{
    leadId: 'lead-1', status: 'queued', reportId: 'report-ada', researchSnapshotId: null, result: null,
    errorCode: 'daily_research_quota_exceeded', updatedAt: '2026-11-23T15:16:00.000Z',
  }], leads);
  assert.equal(waiting.errorCode, 'daily_research_quota_exceeded');
  assert.equal(researchWaitsForQuota(waiting), true);
  assert.equal(researchWaitsForQuota({ ...waiting, status: 'failed' }), true, 'how its batch shows it');
  assert.equal(researchWaitsForQuota({ ...waiting, errorCode: 'native_research_failed', status: 'failed' }), false, 'another failure still asks for attention');
  assert.equal(researchWaitsForQuota({ ...waiting, errorCode: null }), false, 'a research that is simply running');
  assert.equal(researchWaitsForQuota({ ...waiting, status: 'completed' }), false);
  assert.equal(researchWaitsForQuota(null), false);
});

test('the status of the list of leads also tells a research that waits for quota', async () => {
  const { researchWaitsForQuota } = await import('@/lib/research-workspace');
  const status: NativeResearchLeadStatus = {
    leadId: 'lead-1', status: 'queued', reportId: 'report-ada', researchSnapshotId: null, result: null,
    errorCode: 'daily_research_quota_exceeded', updatedAt: null,
  };
  assert.equal(researchWaitsForQuota(status), true);
  assert.equal(researchWaitsForQuota({ ...status, errorCode: null }), false);
  assert.equal(researchWaitsForQuota({ ...status, status: 'completed' }), false);
});
