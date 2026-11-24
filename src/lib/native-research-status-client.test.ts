import assert from 'node:assert/strict';
import test from 'node:test';

import type { NativeResearchLeadStatus } from './native-research-contracts';
import {
  fetchNativeResearchLeadStatuses,
  heldResearchReports,
  holdResearchReport,
  knownResearchVersions,
  mergeResearchStatuses,
  restoreHeldRunResults,
  type ResearchStatusMemory,
} from './native-research-status-client';

function status(leadId: string, version: string, overrides: Partial<NativeResearchLeadStatus> = {}): NativeResearchLeadStatus {
  return {
    leadId, status: 'completed', reportId: `report-${leadId}`, researchSnapshotId: `snapshot-${leadId}`,
    result: { reportId: `report-${leadId}`, marker: version } as any, errorCode: null, updatedAt: version, version, ...overrides,
  };
}

/** A server that holds one status per lead and answers `unchanged` for the versions the page says it holds. */
function fakeServer(stored: Record<string, NativeResearchLeadStatus>, options: { forget?: boolean } = {}) {
  const requests: Array<{ leadIds: string[]; known: Record<string, string> }> = [];
  const fetcher = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    requests.push({ leadIds: body.leadIds, known: body.known || {} });
    const items = (body.leadIds as string[]).flatMap((leadId) => {
      const held = stored[leadId];
      if (!held) return [];
      return body.known?.[leadId] === held.version ? [{ ...held, result: null, unchanged: true as const }] : [held];
    });
    return { ok: true, json: async () => ({ ok: true, items }) };
  }) as unknown as typeof fetch;
  return { requests, fetcher };
}

test('a reload of the list tells the server what the tab holds and keeps those reports', async () => {
  const memory: ResearchStatusMemory = new Map();
  const stored = { a: status('a', 'v1'), b: status('b', 'v1') };
  const server = fakeServer(stored);

  const first = await fetchNativeResearchLeadStatuses(['a', 'b', 'never-researched'], { fetcher: server.fetcher, memory });
  assert.deepEqual(server.requests[0].known, {}, 'nothing held on the first load');
  assert.deepEqual(first.map((item) => item.leadId), ['a', 'b']);

  const reloaded = await fetchNativeResearchLeadStatuses(['a', 'b', 'never-researched'], { fetcher: server.fetcher, memory });
  assert.deepEqual(server.requests[1].known, { a: 'v1', b: 'v1' });
  assert.equal(reloaded[0], first[0], 'the same report the tab held, not an empty one');
  assert.ok(reloaded.every((item) => item.result && !item.unchanged));

  // The lead was researched again.
  stored.a = status('a', 'v2');
  const changed = await fetchNativeResearchLeadStatuses(['a', 'b'], { fetcher: server.fetcher, memory });
  assert.equal((changed[0].result as any).marker, 'v2');
  assert.equal(changed[1], first[1]);
  assert.deepEqual(knownResearchVersions(['a', 'b', 'c'], memory), { a: 'v2', b: 'v1' });
});

test('a long list is asked fifty leads at a time and comes back in order', async () => {
  const ids = Array.from({ length: 130 }, (_, index) => `lead-${index}`);
  const server = fakeServer(Object.fromEntries(ids.map((id) => [id, status(id, 'v1')])));
  const statuses = await fetchNativeResearchLeadStatuses([...ids, ids[0], ' '], { fetcher: server.fetcher, memory: new Map() });
  assert.deepEqual(server.requests.map((request) => request.leadIds.length).sort((a, b) => b - a), [50, 50, 30]);
  assert.deepEqual(statuses.map((item) => item.leadId), ids);
});

test('a status answered unchanged that the tab does not hold is asked again in full', async () => {
  const memory: ResearchStatusMemory = new Map([['a', status('a', 'v1')]]);
  const merged = mergeResearchStatuses([
    { ...status('a', 'v1'), result: null, unchanged: true },
    { ...status('b', 'v1'), result: null, unchanged: true },
    { ...status('c', 'v9'), result: null, unchanged: true },
  ], new Map([...memory, ['c', status('c', 'v1')]]));
  assert.deepEqual(merged.items.map((item) => item.leadId), ['a']);
  assert.deepEqual(merged.missing, ['b', 'c'], 'not held, or held in another version');

  // The server says «unchanged» for a lead whose report the tab lost: the helper asks for it without `known`.
  const stored = { a: status('a', 'v1') };
  const requests: Array<Record<string, string>> = [];
  const fetcher = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    requests.push(body.known || {});
    const unchanged = requests.length === 1;
    return { ok: true, json: async () => ({ items: [unchanged ? { ...stored.a, result: null, unchanged: true } : stored.a] }) };
  }) as unknown as typeof fetch;
  const lost: ResearchStatusMemory = new Map();
  const statuses = await fetchNativeResearchLeadStatuses(['a'], { fetcher, memory: lost });
  assert.equal(requests.length, 2);
  assert.equal((statuses[0].result as any).marker, 'v1');
});

test('a failed answer is an error the page can show', async () => {
  const fetcher = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
  await assert.rejects(fetchNativeResearchLeadStatuses(['a'], { fetcher, memory: new Map() }), /NATIVE_RESEARCH_LEAD_STATUS_FAILED/);
  assert.deepEqual(await fetchNativeResearchLeadStatuses([], { fetcher, memory: new Map() }), []);
});

test('the poll of a batch puts back the reports the page holds', () => {
  const held = new Map<string, unknown>();
  const first = restoreHeldRunResults({ ok: true, run: { id: 'run-1', items: [
    { id: 'i1', job: { id: 'j1', status: 'completed', result_payload: { reportId: 'r1' } } },
    { id: 'i2', job: { id: 'j2', status: 'queued', result_payload: null } },
    { id: 'i3', job: { id: 'j3', status: 'failed', result_payload: { provider_status: 'failed' } } },
    { id: 'i4', job: null },
  ] } }, held) as any;
  assert.deepEqual([...held.keys()], ['j1'], 'what the next poll sends as `have`: only finished reports');
  assert.deepEqual(first.run.items[0].job.result_payload, { reportId: 'r1' });

  const next = restoreHeldRunResults({ ok: true, run: { id: 'run-1', items: [
    { id: 'i1', job: { id: 'j1', status: 'completed', result_payload: null, result_unchanged: true } },
    { id: 'i2', job: { id: 'j2', status: 'completed', result_payload: { reportId: 'r2' } } },
  ] } }, held) as any;
  assert.deepEqual(next.run.items[0].job.result_payload, { reportId: 'r1' });
  assert.deepEqual([...held.keys()], ['j1', 'j2']);

  // A report that is no longer there (the research was cancelled) is forgotten.
  restoreHeldRunResults({ run: { id: 'run-1', items: [{ id: 'i1', job: { id: 'j1', status: 'cancelled', result_payload: null } }] } }, held);
  assert.deepEqual([...held.keys()], ['j2']);
  assert.equal(restoreHeldRunResults(null, held), null);
  assert.deepEqual(restoreHeldRunResults({ error: 'NATIVE_RESEARCH_RUN_NOT_FOUND' }, held), { error: 'NATIVE_RESEARCH_RUN_NOT_FOUND' });
});

test('a written report read in its final form is kept for the next page; one being written is asked for again', () => {
  const memory = new Map<string, unknown>();
  holdResearchReport('report-a', { reportId: 'report-a' }, true, memory);
  holdResearchReport('report-b', { reportId: 'report-b' }, false, memory);
  assert.deepEqual(heldResearchReports(memory), { 'report-a': { reportId: 'report-a' } });

  // Its writing was asked again, or a later read found it pending: it is forgotten.
  holdResearchReport('report-a', null, false, memory);
  assert.deepEqual(heldResearchReports(memory), {});
  holdResearchReport('report-c', null, true, memory);
  assert.deepEqual(heldResearchReports(memory), {}, 'nothing to keep');
});
