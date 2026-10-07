import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tender } from '@/lib/commercial-opportunities/tenders';
import type { TenderOpportunityRow, TenderSignalRow } from '@/lib/commercial-opportunities/records';
import { runTenderSync, type TenderStore } from './tender-sync';
import { tenderProfileKey, type TenderScreening } from './tender-ai';
import { MercadoPublicoBusyError } from './mercado-publico';

const NOW = '2026-10-02T12:00:00Z';
const ORG = '00000000-0000-4000-8000-000000000002';
const PROFILE = { id: 'p1', keywords: ['suministro de personal', 'outsourcing'], unspscCodes: [], regions: [] };
const noWait = async () => {};
/** The model is not asked: every tender is left to the words, as before Plan 15. */
const words = async (): Promise<TenderScreening> => ({ verdicts: new Map(), screened: new Set(), batches: 0, failedBatches: 0, costUsd: 0 });
const tender = (source: Tender['source'], code: string, name: string, extra: Partial<Tender> = {}): Tender => ({
  source, code, name, description: null, buyer: 'Organismo', buyerUnit: null, region: null, amount: 20_000_000, currency: 'CLP',
  publishedAt: '2026-09-30T12:00:00Z', closesAt: '2026-10-10T12:00:00Z', status: 'publicada', items: [], ...extra });
/** What the listing of Mercado Público brings: name, deadline and status, nothing else. */
const listed = (code: string, name: string, extra: Partial<Tender> = {}) =>
  tender('mercado_publico', code, name, { buyer: null, amount: null, currency: null, publishedAt: null, ...extra });

function memoryStore(existing: string[] = [], stored: Tender[] = []) {
  const runs: Array<Record<string, unknown>> = [];
  const rows: TenderOpportunityRow[] = [];
  const signals: TenderSignalRow[] = [];
  const store: TenderStore = {
    async closeStaleRuns() {},
    async hasRunningRun() { return false; },
    async startRun(input) { runs.push({ id: `r${runs.length + 1}`, ...input }); return `r${runs.length}`; },
    async finishRun(id, patch) { Object.assign(runs.find(run => run.id === id)!, patch); },
    async existingKeys(keys) { return new Set(keys.filter(key => existing.includes(key))); },
    async storedTenders(codes) { return new Map(stored.filter(item => codes.includes(item.code)).map(item => [item.code, item])); },
    async storedVerdicts() { return new Map(); },
    async saveOpportunities(list) { rows.push(...list); return new Map(list.map(row => [row.dedupe_key, `id-${row.dedupe_key}`])); },
    async saveSignals(list) { signals.push(...list); },
  };
  return { store, runs, rows, signals };
}

test('the open tenders whose name fits and Compra Ágil by keyword are saved, each with its evidence, one source after the other', async () => {
  const memory = memoryStore(['1509-5-LE26']);
  const order: string[] = [];
  const result = await runTenderSync({
    store: memory.store, profile: PROFILE, ticket: 't', organizationId: ORG, now: NOW, wait: noWait, screen: words,
    sources: {
      compraAgil: async input => { order.push(`compra:${input.keyword}`); return { tenders: input.keyword === 'outsourcing' ? [] : [tender('compra_agil', 'A-1-COT26', 'Suministro de personal de aseo'), tender('compra_agil', 'A-2-COT26', 'Compra de resmas')], requests: 1, error: null }; },
      listLicitaciones: async () => { order.push('list'); return [listed('1509-5-LE26', 'Outsourcing de call center'), listed('99-1-LP26', 'Pavimentación de calles')]; },
      getLicitacion: async code => { order.push(`detail:${code}`); return tender('mercado_publico', code, 'Outsourcing de call center', { buyer: 'Municipalidad', amount: 60_000_000 }); },
    },
  });
  // Plan 15: the listing first; Compra Ágil while the model reads it; the details of what fits at the end.
  assert.deepEqual([order[0], order[order.length - 1]], ['list', 'detail:1509-5-LE26'], 'only the names that may fit are asked in detail');
  assert.deepEqual(order.slice(1, -1).sort(), ['compra:outsourcing', 'compra:suministro'], 'Compra Ágil is asked for the distinctive word of each phrase');
  assert.deepEqual(result, { status: 'done', found: 4, matched: 2, screened: 0, costUsd: 0, created: 1, sources: [
    { source: 'mercado_publico', found: 2, requests: 2, error: null }, { source: 'compra_agil', found: 2, requests: 2, error: null }] });
  assert.deepEqual(memory.rows.map(row => [row.kind, row.dedupe_key, row.buyer_name]), [['tender', '1509-5-LE26', 'Municipalidad'], ['compra_agil', 'A-1-COT26', 'Organismo']]);
  assert.deepEqual(memory.signals.map(signal => signal.opportunity_id), ['id-1509-5-LE26', 'id-A-1-COT26']);
  assert.deepEqual(memory.runs.map(run => [run.source, run.status, run.created, run.updated, run.costUsd]), [['mercado_publico', 'succeeded', 0, 1, 0], ['compra_agil', 'succeeded', 1, 0, 0]]);
});

test('code 10500 (simultaneous requests) is waited out and asked again, never taken for the daily quota', async () => {
  const memory = memoryStore();
  const waits: number[] = [];
  let attempts = 0;
  const result = await runTenderSync({
    store: memory.store, profile: PROFILE, ticket: 't', organizationId: ORG, now: NOW, wait: async ms => { waits.push(ms); }, screen: words,
    sources: {
      compraAgil: async () => ({ tenders: [], requests: 1, error: null }),
      listLicitaciones: async () => [listed('1-1-LE26', 'Outsourcing de aseo')],
      getLicitacion: async code => {
        attempts++;
        if (attempts < 3) throw new MercadoPublicoBusyError();
        return tender('mercado_publico', code, 'Outsourcing de aseo', { buyer: 'Hospital' });
      },
    },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [500, 500, 500, 2_000, 5_000], 'a pause before each Compra Ágil word and the detail, then 2 and 5 seconds');
  assert.equal(result.status, 'done');
  assert.equal(result.sources[0].requests, 4, 'the listing and three tries of the detail, each counted');
  assert.equal(memory.rows[0].buyer_name, 'Hospital');
});

test('a ticket that stays busy stops the details and leaves the rest for the next search, keeping the listing', async () => {
  const memory = memoryStore();
  const asked: string[] = [];
  const result = await runTenderSync({
    store: memory.store, profile: PROFILE, ticket: 't', organizationId: ORG, now: NOW, wait: noWait, screen: words,
    sources: {
      compraAgil: async () => ({ tenders: [], requests: 1, error: null }),
      listLicitaciones: async () => [listed('1-1-LE26', 'Outsourcing uno'), listed('2-1-LE26', 'Outsourcing dos'), listed('3-1-LE26', 'Outsourcing tres')],
      getLicitacion: async code => { asked.push(code); throw new MercadoPublicoBusyError(); },
    },
  });
  assert.equal(asked.length, 4, 'one detail, tried four times');
  assert.equal(result.status, 'partial');
  assert.equal(result.matched, 3, 'the three tenders are saved with what the listing brought');
  const error = String(result.sources[0].error);
  assert.match(error, /1 de 1 detalles no se pudieron leer: Mercado Público siguió ocupado/);
  assert.match(error, /2 detalles quedan para la próxima búsqueda/);
  assert.doesNotMatch(error, /cuota/);
  assert.equal(memory.runs[0].status, 'succeeded', 'the listing worked: the run is not a failure');
});

test('a tender saved with its detail is not asked again and keeps its buyer, with today\'s deadline', async () => {
  const saved = tender('mercado_publico', '1-1-LE26', 'Outsourcing de aseo', { buyer: 'Municipalidad', region: 'Antofagasta', amount: 80_000_000,
    items: [{ code: '80111600', name: 'Servicios de personal temporal' }], closesAt: '2026-10-08T12:00:00Z' });
  const memory = memoryStore(['1-1-LE26'], [saved]);
  const result = await runTenderSync({
    store: memory.store, profile: PROFILE, ticket: 't', organizationId: ORG, now: NOW, wait: noWait, screen: words,
    sources: {
      compraAgil: async () => ({ tenders: [], requests: 1, error: null }),
      listLicitaciones: async () => [listed('1-1-LE26', 'Outsourcing de aseo', { closesAt: '2026-10-15T12:00:00Z' })],
      getLicitacion: async () => assert.fail('a saved detail is not asked again'),
    },
  });
  assert.equal(result.sources[0].requests, 1);
  const row = memory.rows[0];
  assert.deepEqual([row.buyer_name, row.region, row.amount, row.deadline_at], ['Municipalidad', 'Antofagasta', 80_000_000, '2026-10-15T12:00:00.000Z']);
  assert.equal(row.data.items.length, 1);
});

test('details go to names with the whole word, open and nearest deadline first, at most 40', async () => {
  const memory = memoryStore();
  const asked: string[] = [];
  const open = [
    listed('X-1', 'Microoutsourcing de datos'), listed('X-2', 'Outsourcing cerrado', { closesAt: '2026-10-01T12:00:00Z' }),
    ...Array.from({ length: 45 }, (_, index) => listed(`T-${index}`, `Outsourcing ${index}`, { closesAt: new Date(Date.parse('2026-10-03T12:00:00Z') + (44 - index) * 3_600_000).toISOString() })),
  ];
  await runTenderSync({
    store: memory.store, profile: PROFILE, ticket: 't', organizationId: ORG, now: NOW, wait: noWait, screen: words,
    sources: { compraAgil: async () => ({ tenders: [], requests: 1, error: null }), listLicitaciones: async () => open,
      getLicitacion: async code => { asked.push(code); return null; } },
  });
  assert.equal(asked.length, 40);
  assert.equal(asked[0], 'T-44', 'the nearest deadline first');
  assert.ok(!asked.includes('X-1') && !asked.includes('X-2'), 'neither a word inside another nor a closed tender');
});

test('the time budget leaves details and Compra Ágil words for the next search instead of running past the route', async () => {
  const memory = memoryStore();
  let time = 0;
  const asked: string[] = [];
  const result = await runTenderSync({
    store: memory.store, profile: { ...PROFILE, keywords: ['outsourcing', 'aseo'] }, ticket: 't', organizationId: ORG, now: NOW,
    clock: () => time, wait: async ms => { time += ms; }, budgetMs: 60_000, screen: words,
    sources: {
      compraAgil: async () => { time += 20_000; return { tenders: [], requests: 1, error: null }; },
      listLicitaciones: async () => Array.from({ length: 6 }, (_, index) => listed(`T-${index}`, `Outsourcing ${index}`)),
      getLicitacion: async code => { asked.push(code); time += 10_000; return null; },
    },
  });
  assert.equal(asked.length, 4, 'details go on until the budget ends');
  assert.match(String(result.sources[0].error), /2 detalles quedan para la próxima búsqueda/);
  assert.match(String(result.sources[1].error), /1 búsquedas quedan para la próxima vez/, 'Compra Ágil stops at 60 % of the budget');
  assert.equal(memory.runs[1].status, 'succeeded', 'running out of time is not a failure');
  assert.equal(result.matched, 6);
});

test('Compra Ágil asks one distinctive word per phrase, keeps going after a failure and stops when the ticket is refused', async () => {
  const asked: string[] = [];
  const keywords = ['selección de personal', 'suministro de personal', 'call center', 'contact center', 'outsourcing'];
  const result = await runTenderSync({
    store: memoryStore().store, profile: { ...PROFILE, keywords }, ticket: 't', organizationId: ORG, now: NOW, wait: noWait, screen: words,
    sources: {
      compraAgil: async input => {
        asked.push(input.keyword);
        if (input.keyword === 'center') throw Object.assign(new Error('Compra Ágil respondió 500 (falla de Mercado Público).'), { requests: 3 });
        return { tenders: [], requests: 1, error: null };
      },
      listLicitaciones: async () => [], getLicitacion: async () => null,
    },
  });
  assert.deepEqual(asked.sort(), ['center', 'contact', 'outsourcing', 'selección', 'suministro']);
  assert.equal(result.sources[1].requests, 7, 'the retries of the failed word count too');
  assert.match(String(result.sources[1].error), /1 de 5 búsquedas fallaron: Compra Ágil respondió 500/);

  const refused: string[] = [];
  const stopped = await runTenderSync({
    store: memoryStore().store, profile: { ...PROFILE, keywords: ['aseo', 'jardinería', 'vigilancia'] }, ticket: 't', organizationId: ORG, now: NOW, wait: noWait, screen: words,
    sources: {
      compraAgil: async input => { refused.push(input.keyword); throw new Error('Compra Ágil rechazó el ticket.'); },
      listLicitaciones: async () => [listed('1-1-LE26', 'Servicio de aseo')], getLicitacion: async () => null,
    },
  });
  assert.equal(refused.length, 1);
  assert.equal(stopped.status, 'partial');
  assert.equal(stopped.matched, 1, 'a missing detail keeps the listing');
  assert.match(String(stopped.sources[1].error), /rechazó el ticket/);
});

test('both tender sources failing are a failed search, not proof of no matches', async () => {
  const memory = memoryStore();
  const result = await runTenderSync({ store: memory.store, profile: PROFILE, ticket: 't', organizationId: ORG, now: NOW, wait: noWait, screen: words,
    sources: { compraAgil: async () => { throw new Error('Ticket rechazado'); }, listLicitaciones: async () => { throw new Error('Ticket rechazado'); },
      getLicitacion: async () => assert.fail('not asked') } });
  assert.equal(result.status, 'failed');
  assert.equal(result.matched, 0);
  assert.deepEqual(memory.runs.map(run => run.status), ['failed', 'failed']);
});

test('without a ticket or without words nothing starts; if saving fails both runs close as failed', async () => {
  const sources = { compraAgil: async () => assert.fail('not asked'), listLicitaciones: async () => assert.fail('not asked'), getLicitacion: async () => null };
  await assert.rejects(runTenderSync({ store: memoryStore().store, profile: PROFILE, ticket: undefined, organizationId: ORG, sources }),
    (error: Error & { status?: number }) => error.status === 503);
  await assert.rejects(runTenderSync({ store: memoryStore().store, profile: { ...PROFILE, keywords: [] }, ticket: 't', organizationId: ORG, sources }),
    (error: Error & { status?: number }) => error.status === 400);
  const memory = memoryStore();
  memory.store.saveOpportunities = async () => { throw new Error('No se pudo guardar las oportunidades.'); };
  await assert.rejects(runTenderSync({ store: memory.store, profile: PROFILE, ticket: 't', organizationId: ORG, now: NOW, wait: noWait, screen: words, sources: {
    compraAgil: async () => ({ tenders: [tender('compra_agil', 'A-1-COT26', 'Suministro de personal')], requests: 1, error: null }),
    listLicitaciones: async () => [], getLicitacion: async () => null } }), /guardar/);
  assert.deepEqual(memory.runs.map(run => run.status), ['failed', 'failed']);
});

test('the model reads every open tender: it keeps what fits with its reason, leaves out what does not, and the words cover what it could not read', async () => {
  const offer = { offer: 'Servicios transitorios y outsourcing de personal', keywords: PROFILE.keywords };
  const profileKey = tenderProfileKey(offer);
  const memory = memoryStore();
  memory.store.storedVerdicts = async () => new Map([
    ['A-4', { fit: 'alta' as const, reason: 'Ya leída: piden personal de reemplazo', profileKey }],
    ['A-6', { fit: 'alta' as const, reason: 'Leída con otra oferta', profileKey: 'otra' }],
  ]);
  const read: string[][] = [];
  const screen = async (tenders: Array<{ code: string }>): Promise<TenderScreening> => {
    read.push(tenders.map(item => item.code));
    const verdicts = new Map<string, { fit: 'alta' | 'media'; reason: string; profileKey: string }>();
    if (tenders.some(item => item.code === 'A-1')) verdicts.set('A-1', { fit: 'alta', reason: 'Piden 12 auxiliares de aseo con dotación permanente', profileKey });
    if (tenders.some(item => item.code === 'A-3')) verdicts.set('A-3', { fit: 'media', reason: 'Parte del servicio es personal de apoyo', profileKey });
    if (tenders.some(item => item.code === 'C-1')) verdicts.set('C-1', { fit: 'alta', reason: 'Piden personal transitorio para bodega', profileKey });
    // A-5's batch could not be read: it is not in `screened`.
    return { verdicts, screened: new Set(tenders.map(item => item.code).filter(code => code !== 'A-5')), batches: 1, failedBatches: 0, costUsd: 0.004 };
  };
  const detailed: string[] = [];
  const result = await runTenderSync({
    store: memory.store, profile: { ...PROFILE, offer: offer.offer }, ticket: 't', organizationId: ORG, now: NOW, wait: noWait, screen,
    sources: {
      compraAgil: async () => ({ tenders: [tender('compra_agil', 'C-1', 'Personal para bodega'), tender('compra_agil', 'C-2', 'Compra de resmas')], requests: 1, error: null }),
      listLicitaciones: async () => [
        listed('A-1', 'Servicio de aseo Hospital Regional'), listed('A-2', 'Outsourcing de call center'), listed('A-3', 'Servicio de casino y apoyo'),
        listed('A-4', 'Personal de reemplazo'), listed('A-5', 'Outsourcing de bodega'), listed('A-6', 'Servicio de guardias'),
        listed('A-7', 'Outsourcing cerrado', { closesAt: '2026-10-01T12:00:00Z' }),
      ],
      getLicitacion: async code => { detailed.push(code); return tender('mercado_publico', code, code === 'A-5' ? 'Outsourcing de bodega' : `Detalle ${code}`, { buyer: 'Hospital' }); },
    },
  });
  assert.deepEqual(read[0].sort(), ['A-1', 'A-2', 'A-3', 'A-5', 'A-6'], 'a verdict for this offer is reused, one for another offer is read again, a closed tender is not read');
  assert.deepEqual(read[1], ['C-1', 'C-2'], 'the Compra Ágil quotes are read too');
  assert.deepEqual(detailed, ['A-1', 'A-4', 'A-3', 'A-5'], '«alta» first, then «media», then what the words found where the model could not read');
  const kept = Object.fromEntries(memory.rows.map(row => [row.dedupe_key, row]));
  assert.deepEqual(Object.keys(kept).sort(), ['A-1', 'A-3', 'A-4', 'A-5', 'C-1'], '«Outsourcing de call center» says a word, but the model left it out');
  assert.equal(kept['A-1'].reasons[0], 'Piden 12 auxiliares de aseo con dotación permanente');
  assert.deepEqual(kept['A-1'].data.ai, { fit: 'alta', reason: 'Piden 12 auxiliares de aseo con dotación permanente', profileKey });
  assert.ok(kept['A-1'].score > kept['A-3'].score, '«alta» scores above «media»');
  assert.equal(kept['A-5'].data.ai, undefined, 'found by the words');
  assert.equal(result.screened, 7, 'five Mercado Público tenders and the two quotes were read');
  assert.match(String(result.sources[0].error), /La IA revisó 5 de 6 licitaciones abiertas; 1 se revisaron solo por palabras/);
  assert.deepEqual(memory.runs.map(run => [run.source, run.costUsd]), [['mercado_publico', 0.004], ['compra_agil', 0.004]], 'what the model cost is recorded');
});
