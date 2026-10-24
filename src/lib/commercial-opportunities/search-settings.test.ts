import assert from 'node:assert/strict';
import test from 'node:test';
import { criteriaDraft, criteriaProblem, discoverySources, draftToSave, readSearchSettings, searchSettingsSchema, tenderPreferences, tenderRuledOut, unspscMatch } from './search-settings';

const criteria = { keywords: ['verificación de antecedentes'], postQueries: ['"contratación masiva"'], roles: ['Reclutador'] };

test('without settings every source runs every day, as before', () => {
  const settings = readSearchSettings(null);
  assert.deepEqual(settings, { sources: {}, hiringEvery: 'day', tenders: { minAmount: null, maxAmount: null, avoidBuyers: [], buyers: [], regions: [], unspsc: [] } });
  assert.deepEqual(discoverySources(settings, criteria, 3), ['tenders', 'hiring', 'posts']);
  assert.deepEqual(discoverySources(settings, {}, 3), ['criteria'], 'nothing derived yet: the criteria first');
  assert.deepEqual(readSearchSettings({ sources: { posts: 'no' } }), readSearchSettings({}), 'a broken value is the defaults, never an error');
});

test('a source turned off does not run; job ads once a week run on Mondays; tenders run while either of its two is on', () => {
  const only = readSearchSettings({ sources: { posts: false, hiring: true }, hiringEvery: 'week' });
  assert.deepEqual(discoverySources(only, criteria, 3), ['tenders'], 'Wednesday: no job ads that week day, no LinkedIn');
  assert.deepEqual(discoverySources(only, criteria, 1), ['tenders', 'hiring'], 'Monday');
  assert.deepEqual(discoverySources(readSearchSettings({ sources: { tenders: false } }), criteria, 2), ['tenders', 'hiring', 'posts'], 'Compra Ágil still runs in the tenders job');
  assert.deepEqual(discoverySources(readSearchSettings({ sources: { tenders: false, compraAgil: false } }), criteria, 2), ['hiring', 'posts']);
  assert.deepEqual(discoverySources(readSearchSettings({}), { keywords: ['aseo'], postQueries: [], roles: [] }, 2), ['tenders'], 'no searches, no LinkedIn');
});

test('the criteria say in words what each source needs', () => {
  const on = readSearchSettings({});
  assert.match(criteriaProblem(on, { keywords: ['aseo'], postQueries: [] })!, /LinkedIn necesita al menos una búsqueda/);
  assert.equal(criteriaProblem(readSearchSettings({ sources: { posts: false } }), { keywords: ['aseo'], postQueries: [] }), null, 'LinkedIn off: no search needed');
  assert.match(criteriaProblem(readSearchSettings({ sources: { posts: false } }), { keywords: [], postQueries: [] })!, /licitaciones necesitan al menos una palabra/);
  assert.match(criteriaProblem(readSearchSettings({ sources: { tenders: false, compraAgil: false, posts: false, hiring: false } }), { keywords: [], postQueries: [] })!, /al menos una fuente/);
  assert.throws(() => searchSettingsSchema.parse({ tenders: { unspsc: ['8011a'] } }), /2 a 8 dígitos/);
});

test('the administrator\'s own rules leave a tender out before the AI reads it, with the reason the list shows', () => {
  const settings = readSearchSettings({ tenders: { minAmount: 5_000_000, maxAmount: 200_000_000, avoidBuyers: ['Municipalidad de Maipú'] } });
  assert.match(tenderRuledOut(settings, { amount: 1_200_000, currency: 'CLP', company: 'Hospital Regional' })!, /bajo el mínimo/);
  assert.match(tenderRuledOut(settings, { amount: 900_000_000, currency: 'CLP', company: 'Hospital Regional' })!, /supera el máximo/);
  assert.equal(tenderRuledOut(settings, { amount: 50_000_000, currency: 'CLP', company: 'Hospital Regional' }), null);
  assert.equal(tenderRuledOut(settings, { amount: null, company: 'Hospital Regional' }), null, 'an amount it does not say is read, never left out');
  assert.equal(tenderRuledOut(settings, { amount: 1_000, currency: 'UF', company: 'Hospital Regional' }), null, 'another currency is not compared with pesos');
  assert.match(tenderRuledOut(settings, { amount: 50_000_000, currency: 'CLP', company: 'I. MUNICIPALIDAD DE MAIPU' })!, /Es de Municipalidad de Maipú, un organismo que pediste evitar/);
});

test('the preferences the AI weighs are only the ones set, and an UNSPSC prefix matches the items that start with it', () => {
  assert.deepEqual(tenderPreferences(readSearchSettings({})), {});
  assert.deepEqual(tenderPreferences(readSearchSettings({ tenders: { regions: ['Biobío'], unspsc: ['8011'] } })), { regionesPreferidas: ['Biobío'], codigosUnspsc: ['8011'] });
  assert.equal(unspscMatch(['8011'], [{ code: '80111601' }, { code: null }]), true);
  assert.equal(unspscMatch(['8011'], [{ code: '72101507' }]), false);
  assert.equal(unspscMatch([], [{ code: '80111601' }]), false);
});

test('the dialog edits what is saved, and says what to fix in words', () => {
  const draft = criteriaDraft({ keywords: ['aseo'], postQueries: ['"aseo industrial"'], roles: [], decisionMakerTitles: ['Jefe de Compras'] },
    { sources: { hiring: false }, tenders: { minAmount: 5_000_000, unspsc: ['7611'] } });
  assert.deepEqual([draft.keywords, draft.sources, draft.minAmount, draft.maxAmount, draft.unspsc],
    ['aseo', { tenders: true, compraAgil: true, posts: true, hiring: false }, '5.000.000', '', '7611']);
  const saved = draftToSave({ ...draft, maxAmount: '200.000.000', avoidBuyers: 'Municipalidad de Maipú\n\n', unspsc: '7611, 761115 7611' });
  assert.ok('search' in saved);
  assert.deepEqual(saved.search.tenders, { minAmount: 5_000_000, maxAmount: 200_000_000, regions: [], buyers: [], avoidBuyers: ['Municipalidad de Maipú'], unspsc: ['7611', '761115'] });
  assert.deepEqual(saved.criteria, { keywords: ['aseo'], postQueries: ['"aseo industrial"'], roles: [], decisionMakerTitles: ['Jefe de Compras'] });
  assert.deepEqual(draftToSave({ ...draft, minAmount: '9.000.000', maxAmount: '1.000.000' }), { problem: 'El monto mínimo no puede ser mayor que el máximo.' });
  assert.deepEqual(draftToSave({ ...draft, unspsc: '7611 aseo' }), { problem: 'Los códigos UNSPSC tienen de 2 a 8 dígitos: revisa «aseo».' });
  assert.match((draftToSave({ ...draft, postQueries: '' }) as { problem: string }).problem, /LinkedIn necesita al menos una búsqueda/);
  assert.ok('search' in draftToSave({ ...draft, postQueries: '', sources: { ...draft.sources, posts: false } }), 'LinkedIn off: no search needed');
});
