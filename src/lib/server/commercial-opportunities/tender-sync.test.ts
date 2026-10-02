import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tender } from '@/lib/commercial-opportunities/tenders';
import type { TenderOpportunityRow, TenderSignalRow } from '@/lib/commercial-opportunities/records';
import { runTenderSync, type TenderStore } from './tender-sync';
import { dailyOpportunityPlan } from './daily';

const NOW = '2026-10-02T12:00:00Z';
const ORG = '00000000-0000-4000-8000-000000000002';
const PROFILE = { id: 'p1', keywords: ['suministro de personal', 'outsourcing'], unspscCodes: [], regions: [] };
const tender = (source: Tender['source'], code: string, name: string, extra: Partial<Tender> = {}): Tender => ({
  source, code, name, description: null, buyer: 'Organismo', buyerUnit: null, region: null, amount: 20_000_000, currency: 'CLP',
  publishedAt: '2026-09-30T12:00:00Z', closesAt: '2026-10-10T12:00:00Z', status: 'publicada', items: [], ...extra });

function memoryStore(existing: string[] = []) {
  const runs: Array<Record<string, unknown>> = [];
  const rows: TenderOpportunityRow[] = [];
  const signals: TenderSignalRow[] = [];
  const store: TenderStore = {
    async closeStaleRuns() {},
    async hasRunningRun() { return false; },
    async startRun(input) { runs.push({ id: `r${runs.length + 1}`, ...input }); return `r${runs.length}`; },
    async finishRun(id, patch) { Object.assign(runs.find(run => run.id === id)!, patch); },
    async existingKeys(keys) { return new Set(keys.filter(key => existing.includes(key))); },
    async saveOpportunities(list) { rows.push(...list); return new Map(list.map(row => [row.dedupe_key, `id-${row.dedupe_key}`])); },
    async saveSignals(list) { signals.push(...list); },
  };
  return { store, runs, rows, signals };
}

test('Compra Ágil by keyword and the open tenders whose name fits are saved, each with its evidence', async () => {
  const memory = memoryStore(['1509-5-LE26']);
  const asked: string[] = [];
  const details: string[] = [];
  const result = await runTenderSync({
    store: memory.store, profile: PROFILE, ticket: 't', organizationId: ORG, now: NOW,
    sources: {
      compraAgil: async input => { asked.push(input.keyword); return { tenders: input.keyword === 'outsourcing' ? [] : [tender('compra_agil', 'A-1-COT26', 'Suministro de personal de aseo'), tender('compra_agil', 'A-2-COT26', 'Compra de resmas')], requests: 1 }; },
      listLicitaciones: async () => [tender('mercado_publico', '1509-5-LE26', 'Outsourcing de call center'), tender('mercado_publico', '99-1-LP26', 'Pavimentación de calles')],
      getLicitacion: async code => { details.push(code); return tender('mercado_publico', code, 'Outsourcing de call center', { buyer: 'Municipalidad', amount: 60_000_000 }); },
    },
  });
  assert.deepEqual(asked, ['suministro de personal', 'outsourcing']);
  assert.deepEqual(details, ['1509-5-LE26'], 'only the names that may fit are asked in detail');
  assert.deepEqual(result, { status: 'done', found: 4, matched: 2, created: 1, sources: [
    { source: 'compra_agil', found: 2, requests: 2, error: null }, { source: 'mercado_publico', found: 2, requests: 2, error: null }] });
  assert.deepEqual(memory.rows.map(row => [row.kind, row.dedupe_key, row.buyer_name]), [['compra_agil', 'A-1-COT26', 'Organismo'], ['tender', '1509-5-LE26', 'Municipalidad']]);
  assert.deepEqual(memory.signals.map(signal => signal.opportunity_id), ['id-A-1-COT26', 'id-1509-5-LE26']);
  assert.deepEqual(memory.runs.map(run => [run.source, run.status, run.created, run.updated, run.costUsd]), [['compra_agil', 'succeeded', 1, 0, 0], ['mercado_publico', 'succeeded', 0, 1, 0]]);
});

test('a spent quota stops asking Compra Ágil, and the tenders still come', async () => {
  const memory = memoryStore();
  let calls = 0;
  const result = await runTenderSync({
    store: memory.store, profile: { ...PROFILE, keywords: ['a', 'b', 'c'].map(item => `suministro ${item}`) }, ticket: 't', organizationId: ORG, now: NOW,
    sources: {
      compraAgil: async () => { calls++; throw new Error('Compra Ágil: se acabó la cuota diaria del ticket.'); },
      listLicitaciones: async () => [tender('mercado_publico', '1-1-LE26', 'Suministro a de personal')],
      getLicitacion: async () => null,
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.matched, 1, 'a missing detail keeps the listing');
  assert.equal(memory.runs[0].status, 'failed');
  assert.match(String(memory.runs[0].error), /cuota diaria/);
});

test('without a ticket or without words nothing starts; if saving fails both runs close as failed', async () => {
  const sources = { compraAgil: async () => assert.fail('not asked'), listLicitaciones: async () => assert.fail('not asked'), getLicitacion: async () => null };
  await assert.rejects(runTenderSync({ store: memoryStore().store, profile: PROFILE, ticket: undefined, organizationId: ORG, sources }),
    (error: Error & { status?: number }) => error.status === 503);
  await assert.rejects(runTenderSync({ store: memoryStore().store, profile: { ...PROFILE, keywords: [] }, ticket: 't', organizationId: ORG, sources }),
    (error: Error & { status?: number }) => error.status === 400);
  const memory = memoryStore();
  memory.store.saveOpportunities = async () => { throw new Error('No se pudo guardar las oportunidades.'); };
  await assert.rejects(runTenderSync({ store: memory.store, profile: PROFILE, ticket: 't', organizationId: ORG, now: NOW, sources: {
    compraAgil: async () => ({ tenders: [tender('compra_agil', 'A-1-COT26', 'Suministro de personal')], requests: 1 }),
    listLicitaciones: async () => [], getLicitacion: async () => null } }), /guardar/);
  assert.deepEqual(memory.runs.map(run => run.status), ['failed', 'failed']);
});

test('the daily sync visits each organization once and only with the keys it has', () => {
  const profiles = [{ organization_id: 'o1', created_by: 'u1' }, { organization_id: 'o1', created_by: 'u2' }, { organization_id: 'o2', created_by: 'u3' }];
  assert.deepEqual(dailyOpportunityPlan(profiles, { ticket: true, jsearch: false }), [
    { organizationId: 'o1', userId: 'u1', tenders: true, hiring: false }, { organizationId: 'o2', userId: 'u3', tenders: true, hiring: false }]);
  assert.deepEqual(dailyOpportunityPlan(profiles, { ticket: false, jsearch: false }), []);
});
