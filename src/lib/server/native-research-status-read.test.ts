import assert from 'node:assert/strict';
import test from 'node:test';

import { listNativeResearchLeadStatuses, listNativeResearchRun } from './native-research';

const ORG = 'org-1';
const USER = 'user-1';
const access = { organizationId: ORG, userId: USER };

/** A database that answers the filters these readers use and notes what each read asked for. */
function fakeDatabase(tables: Record<string, any[]>) {
  const reads: Array<{ table: string; select: string; ids: string[] }> = [];
  return {
    reads,
    resultReads: () => reads.filter((read) => read.select === 'id,result_payload'),
    from(table: string) {
      const state: { select: string; eq: Record<string, unknown>; in: Record<string, unknown[]>; order?: [string, boolean]; limit?: number } = { select: '*', eq: {}, in: {} };
      const run = () => {
        let rows = (tables[table] || []).filter((row) => (
          Object.entries(state.eq).every(([column, value]) => row[column] === value)
          && Object.entries(state.in).every(([column, values]) => values.includes(row[column]))
        ));
        if (state.order) {
          const [column, ascending] = state.order;
          rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
        }
        if (state.limit) rows = rows.slice(0, state.limit);
        const columns = state.select === '*' ? null : state.select.split(',');
        const data = rows.map((row) => (columns ? Object.fromEntries(columns.map((column) => [column, row[column]])) : row));
        reads.push({ table, select: state.select, ids: data.map((row) => String(row.id)) });
        return data;
      };
      const chain: any = {
        select(columns: string) { state.select = columns; return chain; },
        eq(column: string, value: unknown) { state.eq[column] = value; return chain; },
        in(column: string, values: unknown[]) { state.in[column] = values; return chain; },
        order(column: string, options?: { ascending?: boolean }) { state.order = [column, options?.ascending !== false]; return chain; },
        limit(count: number) { state.limit = count; return chain; },
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        then(resolve: any, reject: any) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
}

function job(id: string, leadId: string, status: string, updatedAt: string, overrides: Record<string, unknown> = {}) {
  const stored = ['completed', 'partial', 'insufficient_data'].includes(status);
  return {
    id,
    provider: 'native-research-v1',
    organization_id: ORG,
    user_id: USER,
    lead_id: leadId,
    status,
    provider_report_id: `report-${id}`,
    research_snapshot_id: stored ? `snapshot-${id}` : null,
    result_payload: stored ? { status, reportId: `report-${id}`, evidence: [], sources: [], snapshot: { big: id } } : null,
    error_code: null,
    error_message: null,
    started_at: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    ...overrides,
  };
}

test('the list reads the report of the latest research of each lead, and only that one', async () => {
  const database = fakeDatabase({
    lead_research_jobs: [
      job('a-old', 'lead-a', 'completed', '2026-11-01T10:00:00Z'),
      job('a-new', 'lead-a', 'completed', '2026-11-20T10:00:00Z'),
      job('b', 'lead-b', 'partial', '2026-11-10T10:00:00Z'),
      job('c', 'lead-c', 'queued', '2026-11-24T10:00:00Z', { error_code: 'daily_research_quota_exceeded' }),
      job('other', 'lead-a', 'completed', '2026-11-23T10:00:00Z', { user_id: 'someone-else' }),
    ],
  });
  const statuses = await listNativeResearchLeadStatuses({ leadIds: ['lead-a', 'lead-b', 'lead-c', 'lead-d'], access }, database);

  assert.deepEqual(statuses.map((status) => [status.leadId, status.status, status.reportId]).sort(), [
    ['lead-a', 'completed', 'report-a-new'],
    ['lead-b', 'partial', 'report-b'],
    ['lead-c', 'queued', 'report-c'],
  ]);
  const byLead = Object.fromEntries(statuses.map((status) => [status.leadId, status]));
  assert.equal((byLead['lead-a'].result as any).snapshot.big, 'a-new');
  assert.equal(byLead['lead-a'].researchSnapshotId, 'snapshot-a-new');
  assert.equal(byLead['lead-c'].result, null);
  assert.equal(byLead['lead-c'].errorCode, 'daily_research_quota_exceeded');
  assert.ok(statuses.every((status) => status.version && !status.unchanged));
  assert.deepEqual(database.resultReads().map((read) => read.ids.sort()), [['a-new', 'b']], 'not the earlier research of the lead, not the one still waiting');
  assert.ok(!database.reads[0].select.includes('result_payload'), 'the first read says which research is the latest, without the reports');
});

test('what the page already holds comes back unchanged, without reading its report again', async () => {
  const rows = [
    job('a', 'lead-a', 'completed', '2026-11-20T10:00:00Z'),
    job('b', 'lead-b', 'completed', '2026-11-10T10:00:00Z'),
  ];
  const first = await listNativeResearchLeadStatuses({ leadIds: ['lead-a', 'lead-b'], access }, fakeDatabase({ lead_research_jobs: rows }));
  const known = Object.fromEntries(first.map((status) => [status.leadId, status.version as string]));

  const reload = fakeDatabase({ lead_research_jobs: rows });
  const again = await listNativeResearchLeadStatuses({ leadIds: ['lead-a', 'lead-b'], access, known }, reload);
  assert.deepEqual(reload.resultReads(), [], 'a reload of the list reads no report');
  assert.ok(again.every((status) => status.unchanged === true && status.result === null));
  assert.deepEqual(again.map((status) => status.version).sort(), Object.values(known).sort());

  // The lead was researched again: its new report is read, the other one is not.
  const later = fakeDatabase({ lead_research_jobs: [...rows, job('a2', 'lead-a', 'partial', '2026-11-24T18:00:00Z')] });
  const changed = Object.fromEntries((await listNativeResearchLeadStatuses({ leadIds: ['lead-a', 'lead-b'], access, known }, later)).map((status) => [status.leadId, status]));
  assert.deepEqual(later.resultReads().map((read) => read.ids), [['a2']]);
  assert.equal(changed['lead-a'].unchanged, undefined);
  assert.equal(changed['lead-a'].reportId, 'report-a2');
  assert.equal((changed['lead-a'].result as any).snapshot.big, 'a2');
  assert.equal(changed['lead-b'].unchanged, true);
});

test('many reports are read a few per request', async () => {
  const database = fakeDatabase({
    lead_research_jobs: Array.from({ length: 45 }, (_, index) => job(`j${index}`, `lead-${index}`, 'completed', `2026-11-20T10:00:${String(index).padStart(2, '0')}Z`)),
  });
  const statuses = await listNativeResearchLeadStatuses({ leadIds: Array.from({ length: 45 }, (_, index) => `lead-${index}`), access }, database);
  assert.equal(statuses.filter((status) => status.result).length, 45);
  assert.deepEqual(database.resultReads().map((read) => read.ids.length), [20, 20, 5]);
});

test('the poll of a batch does not read again the reports the page holds', async () => {
  const tables = {
    research_runs: [{ id: 'run-1', organization_id: ORG, user_id: USER, status: 'running' }],
    research_run_items: [
      { id: 'i1', run_id: 'run-1', organization_id: ORG, user_id: USER, job_id: 'j1', lead_ref: 'lead-1', position: 0, status: 'completed', error_code: null, error_message: null, updated_at: 't' },
      { id: 'i2', run_id: 'run-1', organization_id: ORG, user_id: USER, job_id: 'j2', lead_ref: 'lead-2', position: 1, status: 'queued', error_code: null, error_message: null, updated_at: 't' },
      { id: 'i3', run_id: 'run-1', organization_id: ORG, user_id: USER, job_id: 'j3', lead_ref: 'lead-3', position: 2, status: 'completed', error_code: null, error_message: null, updated_at: 't' },
      { id: 'i4', run_id: 'run-1', organization_id: ORG, user_id: USER, job_id: 'j4', lead_ref: 'lead-4', position: 3, status: 'failed', error_code: 'native_research_failed', error_message: null, updated_at: 't' },
    ],
    lead_research_jobs: [
      job('j1', 'lead-1', 'completed', '2026-11-24T10:00:00Z'),
      job('j2', 'lead-2', 'queued', '2026-11-24T10:00:00Z'),
      job('j3', 'lead-3', 'completed', '2026-11-24T10:00:05Z'),
      job('j4', 'lead-4', 'failed', '2026-11-24T10:00:06Z', { result_payload: { provider_status: 'failed' } }),
    ],
  };

  const firstPoll = fakeDatabase(tables);
  const first: any = await listNativeResearchRun({ runId: 'run-1', access }, firstPoll);
  assert.deepEqual(firstPoll.resultReads().map((read) => read.ids.sort()), [['j1', 'j3', 'j4']], 'nothing is read for the job still waiting');
  assert.deepEqual(first.items.map((item: any) => [item.job.id, Boolean(item.job.result_payload), item.job.result_unchanged]), [
    ['j1', true, undefined], ['j2', false, undefined], ['j3', true, undefined], ['j4', true, undefined],
  ]);

  const nextPoll = fakeDatabase(tables);
  const next: any = await listNativeResearchRun({ runId: 'run-1', access, have: ['j1', 'j2', 'j4'] }, nextPoll);
  assert.deepEqual(nextPoll.resultReads().map((read) => read.ids.sort()), [['j3', 'j4']], 'only a finished report can be held: the failed one is read as before');
  assert.deepEqual(next.items.map((item: any) => [item.job.id, Boolean(item.job.result_payload), item.job.result_unchanged]), [
    ['j1', false, true], ['j2', false, undefined], ['j3', true, undefined], ['j4', true, undefined],
  ]);
  assert.equal(next.items[0].status, 'completed', 'the item and the job keep their status');

  assert.equal(await listNativeResearchRun({ runId: 'run-of-someone-else', access }, fakeDatabase(tables)), null);
});
