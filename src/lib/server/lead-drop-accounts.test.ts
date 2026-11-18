import assert from 'node:assert/strict';
import test from 'node:test';

import type { DropCriteria } from '@/lib/lead-drops';
import { memory } from './goals-alerts-test-fixtures';
import { ACCOUNT_FIT, accountDomain, accountsOf, accountsToOpen, expansionIndustries, learnResearchedAccounts, readAccounts, saveAccounts, scoreAccounts, type DropAccount } from './lead-drop-accounts';
import { industrySets } from './lead-drops';

const NOW = new Date('2026-11-17T11:00:00.000Z');
const criteria: DropCriteria = { titles: ['Gerente HSE'], industries: ['Minería', 'Forestal'], locations: ['Chile'], sizes: [], source: 'perfil' };
const entry = (company: string, domain: string | null, extra: Record<string, unknown> = {}) => ({
  lead: { id: `id-${company}-${Math.random()}`, organization_name: company, organization_domain: domain, organization_industry: '', organization_size: null,
    organization: { short_description: '' }, ...extra }, contact: {} }) as any;
const account = (domain: string, extra: Partial<DropAccount> = {}): DropAccount => ({ domain, name: domain, industry: null, size: null, about: null, score: null, reason: null,
  origin: 'customer', segment: null, peopleLeft: null, openedAt: null, scoredAt: null, ...extra });

test('a company is known by its site: lower case, without «www.» nor a path; nothing when it is not a site', () => {
  assert.equal(accountDomain('WWW.Minera-Aurora.example'), 'minera-aurora.example');
  assert.equal(accountDomain('https://www.forestal.example/quienes-somos'), 'forestal.example');
  assert.equal(accountDomain('Minera Aurora'), null);
  assert.equal(accountDomain(null), null);
});

test('the companies of a search: each once, with what any of its people said of it; nobody without a site', () => {
  const found = accountsOf([
    entry('Minera Aurora', 'www.aurora.example'),
    entry('Minera Aurora', 'aurora.example', { organization_industry: 'mining & metals', organization_size: 800, organization: { short_description: 'Opera dos faenas de cobre.' } }),
    entry('Sin Sitio', null),
  ]);
  assert.deepEqual(found.map(item => [item.domain, item.industry, item.size, item.about, item.score, item.origin]), [['aurora.example', 'mining & metals', 800, 'Opera dos faenas de cobre.', null, 'customer']]);
  assert.deepEqual(accountsOf([entry('Constructora', 'obra.example')], 'expansion', 'Construcción').map(item => [item.origin, item.segment]), [['expansion', 'Construcción']]);
});

test('the companies opened today: the ones that fit, the best first, equals by turns, and none that ran out this month', () => {
  const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
  const list = [
    account('baja.example', { score: ACCOUNT_FIT - 1 }), account('sin-nota.example'),
    account('ayer.example', { score: 8, openedAt: day(1), peopleLeft: 3 }), account('nunca.example', { score: 8 }), account('semana.example', { score: 8, openedAt: day(7), peopleLeft: 1 }),
    account('mejor.example', { score: 10, openedAt: day(1), peopleLeft: 2 }),
    account('agotada.example', { score: 10, openedAt: day(5), peopleLeft: 0 }), account('descansada.example', { score: 9, openedAt: day(31), peopleLeft: 0 }),
  ];
  assert.deepEqual(accountsToOpen(list, NOW).map(item => item.domain), ['mejor.example', 'descansada.example', 'nunca.example', 'semana.example', 'ayer.example']);
  assert.deepEqual(accountsToOpen(list, NOW, 2).map(item => item.domain), ['mejor.example', 'descansada.example']);
});

test('each company is scored once for what the team sells, with a reason; what the team wrote reaches the model, and one it does not answer for is asked again', async () => {
  const asked: any[] = [];
  const generate = async (options: any) => {
    const prompt = JSON.parse(options.prompt);
    asked.push({ system: options.systemPrompt, prompt });
    return { companies: prompt.empresas.filter((item: any) => item.empresa !== 'Muda').map((item: any) => ({ i: item.i, nota: item.empresa === 'Minera Aurora' ? 9 : 2,
      razon: item.empresa === 'Minera Aurora' ? 'Opera faenas con brigadas propias.' : null })) };
  };
  const accounts = [account('aurora.example', { name: 'Minera Aurora', about: 'Opera dos faenas de cobre.' }), account('insumos.example', { name: 'Insumos Mineros' }),
    account('muda.example', { name: 'Muda' }), account('ya.example', { name: 'Ya evaluada', score: 7, reason: 'Antes.' })];
  const scored = await scoreAccounts({ accounts, criteria, seller: { company: 'Brigadas del Sur', offer: 'Brigadas de emergencia para faenas.' }, lessons: { liked: ['Gerente HSE · Minería'], disliked: [] },
    preferences: { teamNotes: 'Le vendemos a quien opera, no a proveedores.' }, generate: generate as any, now: NOW });
  assert.equal(scored, 2);
  assert.deepEqual(accounts.map(item => [item.domain, item.score, item.reason, Boolean(item.scoredAt)]), [
    ['aurora.example', 9, 'Opera faenas con brigadas propias.', true], ['insumos.example', 2, null, true], ['muda.example', null, null, false], ['ya.example', 7, 'Antes.', false]]);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].prompt.empresas.map((item: any) => item.empresa), ['Minera Aurora', 'Insumos Mineros', 'Muda'], 'the one with a score is not asked again');
  assert.equal(asked[0].prompt.en_sus_palabras, 'Le vendemos a quien opera, no a proveedores.');
  assert.equal(asked[0].prompt.vendedor.oferta, 'Brigadas de emergencia para faenas.');
  assert.match(asked[0].system, /Distingue a quien opera/);
  // The model down: nothing is scored, nothing breaks.
  assert.equal(await scoreAccounts({ accounts: [account('otra.example')], criteria, seller: null, generate: (async () => { throw new Error('down'); }) as any, now: NOW }), 0);
});

test('the industries next to the customer\'s: never one it already searches, each with the words of its companies', async () => {
  const generate = async () => ({ rubros: [{ rubro: 'Minería', palabras: ['mining'] }, { rubro: 'Construcción', palabras: ['Construcción', 'construction'] },
    { rubro: 'construccion', palabras: ['obras'] }, { rubro: 'Sanitarias', palabras: [] }] });
  assert.deepEqual(await expansionIndustries({ criteria, seller: null, generate: generate as any }), [{ industry: 'Construcción', keywords: ['construcción', 'construction'] }]);
  assert.deepEqual(await expansionIndustries({ criteria, seller: null }), [], 'without a model there is no widening');
  assert.deepEqual(await expansionIndustries({ criteria, seller: null, generate: (async () => { throw new Error('down'); }) as any }), []);
});

test('the companies are kept by organization and customer; without the table the finder goes on as before', async () => {
  const { client, tables } = memory({ lead_drop_accounts: [] as any[] }, { unique: { lead_drop_accounts: ['organization_id', 'customer_key', 'domain'] } });
  assert.equal(await saveAccounts(client as any, 'org-1', 'k1', [account('aurora.example', { name: 'Minera Aurora', score: 9, reason: 'Opera faenas.', scoredAt: NOW.toISOString() })], NOW), true);
  assert.equal(await saveAccounts(client as any, 'org-1', 'k1', [account('aurora.example', { name: 'Minera Aurora', score: 9, reason: 'Opera faenas.', openedAt: NOW.toISOString(), peopleLeft: 0 })], NOW), true);
  await saveAccounts(client as any, 'org-1', 'k2', [account('otra.example')], NOW);
  assert.equal(tables.lead_drop_accounts.length, 2, 'the same company of the same customer is one row');
  const read = await readAccounts(client as any, 'org-1', 'k1');
  assert.deepEqual([...read.values()].map(item => [item.domain, item.score, item.peopleLeft, item.openedAt]), [['aurora.example', 9, 0, NOW.toISOString()]]);
  const missing = memory({}, { missing: ['lead_drop_accounts'] });
  assert.equal((await readAccounts(missing.client as any, 'org-1', 'k1')).size, 0);
  assert.equal(await saveAccounts(missing.client as any, 'org-1', 'k1', [account('aurora.example')], NOW), false);
});

test('a customer\'s industries as the search can ask for them: the ones with a tag together, the rest as words of the company, none left out', () => {
  assert.deepEqual(industrySets({ ...criteria, industries: ['Retail', 'Construcción'] }), [['retail', 'construction']]);
  assert.deepEqual(industrySets({ ...criteria, industries: ['Minería', 'Energía', 'Forestal', 'Celulosa', 'Puertos'] }), [['mining & metals', 'oil & energy', 'forestal', 'celulosa', 'puertos']],
    '«forestal», «celulosa» and «puertos» were left out of the search until 16 Nov 2026');
  assert.deepEqual(industrySets({ ...criteria, industries: ['Retail', 'Forestal'] }), [['retail'], ['forestal']], 'a tag and a word in the same search leave almost nobody: one search each');
  assert.deepEqual(industrySets({ ...criteria, industries: [] }), []);
});

test('the companies the research found are learnt: scored with what it read and kept once; a known one keeps what it had (18 nov)', async () => {
  const KEY = '0123456789abcdef';
  const { client, tables } = memory({ lead_drop_accounts: [] as any[] }, { unique: { lead_drop_accounts: ['organization_id', 'customer_key', 'domain'] } });
  await saveAccounts(client as any, 'org-1', KEY, [account('aurora.example', { name: 'Minera Aurora', score: 9, reason: 'Opera faenas.', openedAt: NOW.toISOString(), peopleLeft: 4, scoredAt: NOW.toISOString() })], NOW);
  const asked: any[] = [];
  const generate = async (options: any) => {
    const prompt = JSON.parse(options.prompt); asked.push(prompt);
    return { companies: prompt.empresas.map((entry: any) => ({ i: entry.i, nota: entry.empresa === 'Forestal Sur' ? 8 : 3, razon: `Por ${entry.descripcion}` })) };
  };
  const later = new Date('2026-11-18T08:00:00.000Z');
  const learnt = await learnResearchedAccounts(client as any, { organizationId: 'org-1', customerKey: KEY, criteria, seller: { company: 'Brigadas SpA', offer: 'Brigadas de emergencia' }, generate: generate as any, now: later,
    companies: [
      { domain: 'https://www.Forestal-Sur.example/nosotros', name: 'Forestal Sur', industry: 'Forestal', size: 800, about: 'Opera aserraderos en el Biobío.' },
      { domain: 'forestal-sur.example', name: 'Forestal Sur S.A.', about: 'La misma, dos veces.' },
      { domain: 'aurora.example', name: 'Minera Aurora', about: 'Ya conocida.' },
      { domain: 'ropa.example', name: 'Ropa Ltda', about: 'Vende ropa.' },
      { domain: null, name: 'Sin Sitio', about: 'No se sabe su sitio.' },
      { domain: 'sin-nombre.example', name: '', about: 'Sin nombre.' },
    ] });
  assert.equal(learnt, 2, 'the two new ones');
  assert.deepEqual(asked[0].empresas.map((entry: any) => [entry.empresa, entry.sitio, entry.rubro, entry.empleados, entry.descripcion]),
    [['Forestal Sur', 'forestal-sur.example', 'Forestal', 800, 'Opera aserraderos en el Biobío.'], ['Ropa Ltda', 'ropa.example', null, null, 'Vende ropa.']], 'only the new ones are scored, with what the research read');
  const rows = new Map<string, any>(tables.lead_drop_accounts.map((row: any) => [row.domain, row]));
  assert.equal(rows.size, 3);
  assert.deepEqual([rows.get('forestal-sur.example').score, rows.get('forestal-sur.example').reason, rows.get('forestal-sur.example').scored_at, rows.get('forestal-sur.example').opened_at, rows.get('forestal-sur.example').origin],
    [8, 'Por Opera aserraderos en el Biobío.', later.toISOString(), null, 'customer']);
  assert.equal(rows.get('ropa.example').score, 3);
  assert.deepEqual([rows.get('aurora.example').score, rows.get('aurora.example').people_left, rows.get('aurora.example').opened_at], [9, 4, NOW.toISOString()], 'the known one keeps its score and what was learnt on opening it');
  // The next morning the finder reads them: the one that fits is opened.
  assert.deepEqual(accountsToOpen([...(await readAccounts(client as any, 'org-1', KEY)).values()], later).map(item => item.domain), ['aurora.example', 'forestal-sur.example']);
  // With the model down they are kept without a score, and the finder asks again; nothing to learn, a key that is not one, or no table: nothing is kept.
  const down = memory({ lead_drop_accounts: [] as any[] }, { unique: { lead_drop_accounts: ['organization_id', 'customer_key', 'domain'] } });
  assert.equal(await learnResearchedAccounts(down.client as any, { organizationId: 'org-1', customerKey: KEY, criteria, seller: null, generate: (async () => { throw new Error('down'); }) as any, now: later,
    companies: [{ domain: 'forestal-sur.example', name: 'Forestal Sur', about: 'Opera aserraderos.' }] }), 1);
  assert.deepEqual(down.tables.lead_drop_accounts.map((row: any) => [row.domain, row.score, row.scored_at]), [['forestal-sur.example', null, null]]);
  assert.equal(await learnResearchedAccounts(down.client as any, { organizationId: 'org-1', customerKey: KEY, criteria, seller: null, now: later, companies: [] }), 0);
  assert.equal(await learnResearchedAccounts(down.client as any, { organizationId: 'org-1', customerKey: 'no-es-una-clave', criteria, seller: null, now: later, companies: [{ domain: 'otra.example', name: 'Otra', about: 'x' }] }), 0);
  const missing = memory({}, { missing: ['lead_drop_accounts'] });
  assert.equal(await learnResearchedAccounts(missing.client as any, { organizationId: 'org-1', customerKey: KEY, criteria, seller: null, now: later, companies: [{ domain: 'otra.example', name: 'Otra', about: 'x' }] }), 0);
});
