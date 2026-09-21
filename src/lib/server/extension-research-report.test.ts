import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionResearchReport } from './extension-research-report';
const access = { organizationId: 'org', userId: 'user' };
test('extension reads the visible final V2 document with scoped access, independently of partial collection status', async () => {
  const calls: any[] = [];
  const report = { revision: 2, sections: [{ title: 'Resumen y decisión' }], synthesis: { status: 'completed' } };
  const result = await extensionResearchReport({ status: 'partial', researchSnapshotId: 'snapshot' }, access, {
    loadState: async (input: any) => { calls.push(input); return { reportDocumentId: 'document', status: 'completed' } as any; },
    loadDocument: async (input: any) => { calls.push(input); return { id: 'document', document: report } as any; },
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.reportDocumentV2, report);
  assert.equal(result.reportVersion, 'document:2');
  assert.ok(calls.every(call => call.access === access));
});
test('pending or unavailable synthesis does not fabricate a final document', async () => {
  const result = await extensionResearchReport({ status: 'completed', researchSnapshotId: 'snapshot' }, access, {
    loadState: async () => ({ status: 'running', reportDocumentId: null } as any),
    loadDocument: async () => { throw new Error('Must not load missing document'); },
  });
  assert.equal(result.reportDocumentV2, null);
  assert.equal(result.reportSynthesisV2.status, 'running');
});
