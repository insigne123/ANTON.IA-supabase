import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coworkOpportunitiesSummary, hiringSignal, matchesOpportunityQuery, projectSignal, tenderSignal, type CoworkHiringItem, type CoworkTenderItem,
} from './cowork';

const NOW = '2026-09-25T13:00:00Z';
const hiring = (company: string, score: number, extra: Partial<CoworkHiringItem> = {}): CoworkHiringItem => ({
  id: company, company, domain: null, region: null, url: null, score, reasons: [], status: 'new', mine: false, ads: 6,
  firstSeenAt: '2026-09-20T11:00:00Z', lastSeenAt: '2026-09-25T11:00:00Z',
  data: { ads: 6, adsLastWeek: 2, roles: [{ role: 'Operario', ads: 6 }], regions: [], publishers: [], sources: ['jsearch'], size: null, industry: null,
    isClient: false, isContact: false, firstPostedAt: null, lastPostedAt: null, windowDays: 30, evidence: [] },
  ...extra,
});
const tender: CoworkTenderItem = {
  id: 't', kind: 'tender', title: 'Suministro de personal de aseo', buyer: 'Municipalidad de Calama', region: null, amount: 96_000_000, currency: 'CLP',
  deadlineAt: '2026-09-27T15:00:00Z', publishedAt: '2026-09-22T13:00:00Z', url: null, score: 61, reasons: [], status: 'new', mine: false,
  firstSeenAt: '2026-09-25T11:20:00Z',
  data: { source: 'mercado_publico', code: '1057-88-LE26', buyerUnit: null, status: 'Publicada', keywords: [], description: null, items: [] },
};
const summary = (input: Partial<Parameters<typeof coworkOpportunitiesSummary>[0]> = {}) => coworkOpportunitiesSummary({
  profile: { offer: 'Personal transitorio', roles: ['Operario'], regions: [], minAds: 5, keywords: [], sectors: ['mineria'], minInvestmentUsd: null },
  hiring: [], tenders: [], projects: [], runs: [{ source: 'seia', status: 'succeeded', startedAt: '2026-09-01T12:00:00Z', fetched: 10, created: 1, error: null }],
  query: '', now: NOW, ready: { hiring: true, tenders: true }, ...input,
});

test('a company is found by its name without its legal form, or by its domain; an empty query finds everything', () => {
  assert.equal(matchesOpportunityQuery('walmart chile', ['Walmart Chile S.A.']), true);
  assert.equal(matchesOpportunityQuery('Walmart Chile SpA', ['Walmart Chile']), true);
  assert.equal(matchesOpportunityQuery('retailandes.cl', ['Retail Andes', 'retailandes.cl']), true);
  assert.equal(matchesOpportunityQuery('Falabella', ['Ripley']), false);
  assert.equal(matchesOpportunityQuery('', ['Ripley']), true);
  // A two-letter company does not match every query that contains those letters.
  assert.equal(matchesOpportunityQuery('Codelco', ['Co']), false);
});

test('the signal of each kind is a fact with its source and its date', () => {
  const company = hiring('Retail Andes', 80, { ads: 14 });
  company.data = { ...company.data, ads: 14, roles: [{ role: 'operario', ads: 6 }, { role: 'reponedor', ads: 4 }, { role: 'cajero', ads: 4 }],
    publishers: ['LinkedIn', 'Laborum'], lastPostedAt: '2026-09-24T12:00:00Z' };
  assert.equal(hiringSignal(company), 'Retail Andes publicó 14 avisos de empleo en los últimos 30 días (6 de operario y 4 de reponedor), el último el 24 sept 2026, según LinkedIn y Laborum.');
  // Without portals, the source the ads came from.
  assert.equal(hiringSignal(hiring('Acme', 50)), 'Acme publicó 6 avisos de empleo en los últimos 30 días (6 de Operario), según Google for Jobs.');
  assert.equal(tenderSignal(tender, Date.parse(NOW)), 'Municipalidad de Calama publicó la licitación «Suministro de personal de aseo» (1057-88-LE26) en Mercado Público el 22 sept 2026; cierra en 2 días · 27 sept.');
  assert.equal(projectSignal({ title: 'Desaladora Norte', owner: 'Aguas del Norte S.A.', presentedAt: '2026-03-03',
    data: { owner: null, presentation: 'EIA', typology: null, sector: null, state: 'En calificación', communes: null, presentedAt: null, qualifiedAt: null, investmentMusd: 320 } }),
  'Aguas del Norte S.A. ingresó al SEIA el proyecto «Desaladora Norte» (US$ 320 millones), presentado el 3 mar 2026; estado: En calificación.');
});

test('the best five of each kind go, best first and without the dismissed ones; the counts cover everything', () => {
  const companies = [...Array.from({ length: 6 }, (_, index) => hiring(`Empresa ${index}`, 50 + index)),
    hiring('Descartada', 99, { status: 'dismissed' }), hiring('Tomada', 40, { status: 'interested', mine: true })];
  const result = summary({ hiring: companies, tenders: [tender] });
  assert.deepEqual(result.hiring.map(item => item.company), ['Empresa 5', 'Empresa 4', 'Empresa 3', 'Empresa 2', 'Empresa 1']);
  assert.deepEqual(result.counts.hiring, { total: 7, new: 6, interested: 1, dismissed: 1, seenLast24h: 0 });
  assert.equal(result.counts.tenders.closingIn7Days, 1);
  assert.equal(result.counts.tenders.seenLast24h, 1);
  assert.equal(result.tenders[0].kind, 'Licitación');
  assert.equal(result.tenders[0].amount, '$96.000.000');
  // Asked by name, a dismissed one is shown with its status: the person may ask why it is out.
  const named = summary({ hiring: companies, query: 'Descartada' });
  assert.deepEqual(named.hiring.map(item => [item.company, item.status]), [['Descartada', 'descartada']]);
  assert.equal(named.query, 'Descartada');
});

test('what is missing is said: no profile, no keys, no SEIA file, a failed source', () => {
  const empty = summary({ profile: null, runs: [], ready: { hiring: false, tenders: false } });
  assert.equal(empty.profile, null);
  assert.equal(empty.gaps.length, 4);
  assert.match(empty.gaps.join(' '), /Aún no se define qué buscar: se hace en Oportunidades → «Definir búsqueda»/);
  assert.match(empty.gaps.join(' '), /JSearch o LinkedIn/);
  assert.match(empty.gaps.join(' '), /falta tu ticket de Mercado Público: es gratis, se pide una vez en chilecompra\.cl\/api con tu Clave Única/);
  assert.doesNotMatch(empty.gaps.join(' '), /lo agrega el administrador/, 'each person brings their own ticket');
  assert.match(empty.gaps.join(' '), /archivo del SEIA/);
  const failed = summary({ runs: [
    { source: 'linkedin', status: 'failed', startedAt: '2026-09-25T11:15:00Z', fetched: 0, created: 0, error: 'Apify respondió 401' },
    { source: 'linkedin', status: 'succeeded', startedAt: '2026-09-24T11:15:00Z', fetched: 200, created: 2, error: null },
    { source: 'seia', status: 'succeeded', startedAt: '2026-09-01T12:00:00Z', fetched: 10, created: 1, error: null },
  ] });
  // Only the last search of each source counts.
  assert.deepEqual(failed.gaps, ['La última búsqueda falló en LinkedIn.']);
  assert.deepEqual(failed.lastSearches.map(run => [run.source, run.status]), [['LinkedIn', 'failed'], ['Archivo del SEIA', 'succeeded']]);
  assert.deepEqual(failed.profile?.seiaSectors, ['Minería']);
});

test('a SEIA file older than a month is reminded, with where to upload it', () => {
  const late = summary({ runs: [{ source: 'seia', status: 'succeeded', startedAt: '2026-08-20T12:00:00Z', fetched: 10, created: 1, error: null }] });
  assert.deepEqual(late.gaps, ['Hace 36 días que no se sube un archivo del SEIA: descarga el del mes en el mapa de proyectos y súbelo en Oportunidades → «Proyectos de inversión».']);
  assert.deepEqual(summary().gaps, [], 'uploaded 24 days ago: nothing to remind');
});
