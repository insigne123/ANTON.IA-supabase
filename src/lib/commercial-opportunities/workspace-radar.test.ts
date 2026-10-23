import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { EXCLUSION_MOTIVES, OPPORTUNITY_CATEGORIES, tenderWordsOfTheDay, OPPORTUNITY_SOURCES, TENDER_PREREQUISITES, byClosing, bySource, categoryTerms, closesLabel, exclusionGroups, inCategories, parseCategories, searchTerm, sourceKinds, startHere, workAdvice } from './workspace-radar';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const item = (id: string, evaluation: string | null, deadline: string | null, score = 50, extra: Record<string, unknown> = {}) => ({
  id, kind: 'tender', title: `Licitación ${id}`, company_name: null, buyer_name: 'Organismo', company_domain: null, url: null, score,
  reasons: [`Motivo ${id}`], deadline_at: deadline, amount: null, currency: null, updated_at: at(0),
  data: { ...(evaluation ? { evaluation } : {}), ...extra },
});

test('each opportunity says what to do: recommended → Postular, review → Evaluar, excluded → No postular, else Por evaluar', () => {
  assert.equal(workAdvice(item('a', 'recommended', at(10)), NOW).label, 'Postular');
  assert.equal(workAdvice(item('b', 'review', at(10)), NOW).label, 'Evaluar');
  assert.equal(workAdvice(item('c', 'excluded', at(10)), NOW).label, 'No postular');
  assert.equal(workAdvice(item('d', null, at(10)), NOW).label, 'Por evaluar');
  assert.equal(workAdvice({ ...item('e', null, null), kind: 'private' }, NOW).label, 'Evaluar', 'a private invitation starts in review');
});

test('a LinkedIn signal is a conversation to start: Contactar or No contactar, never Postular', () => {
  assert.equal(workAdvice({ ...item('a', 'recommended', null), kind: 'hiring' }, NOW).label, 'Contactar');
  assert.equal(workAdvice({ ...item('b', 'excluded', null), kind: 'linkedin_post' }, NOW).label, 'No contactar');
  assert.equal(workAdvice({ ...item('c', 'review', null), kind: 'linkedin_post' }, NOW).label, 'Evaluar');
});

test('a deadline within three days is urgent, a past one is closed, and an excluded one is never urgent', () => {
  const soon = workAdvice(item('a', 'recommended', at(1.5)), NOW);
  assert.equal(soon.urgent, true);
  assert.equal(closesLabel(soon), 'cierra mañana');
  assert.equal(workAdvice(item('b', 'recommended', at(10)), NOW).urgent, false);
  const past = workAdvice(item('c', 'recommended', at(-1)), NOW);
  assert.equal(past.closed, true);
  assert.equal(past.urgent, false);
  assert.equal(closesLabel(past), 'cerrada');
  assert.equal(workAdvice(item('d', 'excluded', at(1)), NOW).urgent, false);
  assert.equal(closesLabel(workAdvice(item('e', 'review', at(0.2)), NOW)), 'cierra hoy');
  assert.equal(closesLabel(workAdvice(item('f', 'review', null), NOW)), null);
});

test('«Por dónde empezar» keeps the recommended ones with at least a day to prepare, nearest deadline first, then the ones to evaluate', () => {
  const items = [
    item('late', 'recommended', at(20)), item('soon', 'recommended', at(3)), item('today', 'recommended', at(0.5)),
    item('review', 'review', at(2)), item('excluded', 'excluded', at(2)), item('post', 'recommended', null),
  ];
  assert.deepEqual(startHere(items, NOW).map(entry => entry.id), ['soon', 'late', 'review']);
  assert.equal(startHere(items, NOW, 1).length, 1);
  assert.deepEqual(startHere([item('x', 'excluded', at(5))], NOW), []);
});

test('the excluded ones are grouped by why, the largest group first and those without a motive last', () => {
  const groups = exclusionGroups([
    item('a', 'excluded', at(5), 5, { excludedMotive: 'requisito' }), item('b', 'excluded', at(5), 5, { excludedMotive: 'otro_producto' }),
    item('c', 'excluded', at(5), 5, { excludedMotive: 'otro_producto' }), item('d', 'excluded', at(5), 5),
    item('e', 'excluded', at(5), 5, { excludedMotive: 'inventado' }),
  ]);
  assert.deepEqual(groups.map(group => [group.label, group.items.length]),
    [['Piden otra cosa', 2], ['Exigen algo que no ofreces', 1], ['Otros motivos', 2]]);
  assert.deepEqual(EXCLUSION_MOTIVES, ['otro_producto', 'parte_menor', 'requisito', 'escala', 'sin_compra']);
});

test('the evaluation asks why an excluded one was left out and keeps it next to the verdict; the page shows the radar parts', () => {
  const sources = readFileSync('src/lib/server/commercial-opportunities/workspace-sources.ts', 'utf8');
  assert.match(sources, /motive: z\.enum\(EXCLUSION_MOTIVES\)\.nullable\(\)\.optional\(\)/, 'results saved before the motive still parse');
  assert.match(sources, /excludedMotive: answer\.verdict === 'excluded' \? answer\.motive \?\? null : null/);
  const page = readFileSync('src/components/commercial-opportunities/OpportunityWorkWorkspace.tsx', 'utf8');
  assert.match(page, /<AdvicePill item=\{item\}[^>]*\/>/);
  assert.match(page, /filter === 'recommended' && !search && source === 'all' && !categories\.length && <StartHere/, 'a line of service is a filter: no suggestions over it');
  assert.match(page, /bySource\(items\)\.map\(group =>/);
  assert.match(page, /listGroups\.map\(group =>/);
  assert.match(page, /filter === 'excluded' \? <ExclusionGroups items=\{group\.items\}/);
  assert.match(page, /<TenderPrerequisites \/>/);
  assert.ok(TENDER_PREREQUISITES.length >= 4 && TENDER_PREREQUISITES.every(block => block.items.length >= 3));
});

test('each view is split in Licitaciones and LinkedIn, the open ones by nearest closing, closed ones last', () => {
  const list = [
    item('closed', 'review', at(-2)), item('later', 'review', at(20)), item('none', 'review', null, 90), item('soon', 'review', at(2)),
    { ...item('ad-low', 'review', null, 40), kind: 'hiring' }, { ...item('post-high', 'review', null, 80), kind: 'linkedin_post' },
    { ...item('received', 'review', at(5)), kind: 'private' },
  ];
  assert.deepEqual(byClosing(list.filter(i => !['hiring', 'linkedin_post'].includes(i.kind)), NOW).map(i => i.id), ['soon', 'received', 'later', 'none', 'closed']);
  const groups = bySource(list, NOW);
  assert.deepEqual(groups.map(g => [g.label, g.items.map(i => i.id)]),
    [['Licitaciones', ['soon', 'received', 'later', 'none', 'closed']], ['LinkedIn', ['post-high', 'ad-low']]]);
  assert.deepEqual(bySource([item('a', 'review', at(3))], NOW).map(g => g.key), ['tenders'], 'an empty group is not shown');
  assert.deepEqual(byClosing([item('old', null, at(-9)), item('recent', null, at(-1))], NOW).map(i => i.id), ['recent', 'old']);
});

test('the sources say which kinds each one holds, and every kind the radar finds has one', () => {
  assert.deepEqual(OPPORTUNITY_SOURCES.map(source => source.label), ['Todas las fuentes', 'Licitaciones', 'Compra Ágil', 'LinkedIn', 'Recibidas']);
  assert.deepEqual(sourceKinds('linkedin'), ['hiring', 'linkedin_post']);
  assert.deepEqual(sourceKinds('all'), []);
  assert.deepEqual(sourceKinds('otra'), [], 'an unknown source filters nothing');
  for (const kind of ['tender', 'compra_agil', 'hiring', 'linkedin_post', 'private']) assert.ok(OPPORTUNITY_SOURCES.some(source => (source.kinds as readonly string[]).includes(kind)), kind);
});

test('what a person types is searched without what would end a PostgREST filter', () => {
  assert.equal(searchTerm('aseo, (hospital)*'), 'aseo hospital');
  assert.equal(searchTerm('RR.HH. 100%_'), 'RR.HH. 100');
  assert.equal(searchTerm('  '), '');
  assert.equal(searchTerm('a'.repeat(300)).length, 100);
});

test('the lines of service are read from the query string: the known ones, once each, in the order of the list', () => {
  assert.deepEqual(OPPORTUNITY_CATEGORIES.map(category => category.id), ['seguridad', 'aseo', 'outsourcing', 'reclutamiento']);
  assert.deepEqual(parseCategories('reclutamiento, seguridad,seguridad,marte'), ['seguridad', 'reclutamiento']);
  assert.deepEqual(parseCategories(''), []);
  assert.deepEqual(parseCategories(null), []);
  assert.deepEqual(categoryTerms([]), []);
  assert.ok(categoryTerms(['seguridad']).includes('guardia'));
  assert.ok(categoryTerms(['seguridad', 'aseo']).includes('servicio de aseo'));
  // The words go into a filter as they are: none can carry a wildcard, a comma, a parenthesis or a quote.
  for (const term of categoryTerms(OPPORTUNITY_CATEGORIES.map(category => category.id))) assert.doesNotMatch(term, /[%_*,()"'\\]/, term);
});

test('an opportunity is in a line of service when its title or its summary names it, whatever the case and the accents', () => {
  const op = (title: string, summary?: string) => ({ title, data: summary ? { summary: { text: summary } } : {} });
  assert.equal(inCategories(op('SERVICIO DE GUARDIAS DE SEGURIDAD PARA OFICINAS'), ['seguridad']), true);
  assert.equal(inCategories(op('Servicio de Vigilancia CESFAM Rosario'), ['seguridad']), true);
  assert.equal(inCategories(op('SERVICIO DE ASEO CEVS LONCOCHE'), ['seguridad']), false);
  assert.equal(inCategories(op('Servicio de reclutamiento y selección de personal'), ['reclutamiento']), true);
  assert.equal(inCategories(op('SERVICIO DE SELECCION DE PERSONAL'), ['reclutamiento']), true, 'without the accent');
  assert.equal(inCategories(op('Servicio de externalización de nómina'), ['outsourcing']), true, 'a stem covers the ending');
  assert.equal(inCategories(op('Contratación de apoyo', 'Suministro de personal transitorio para bodega'), ['outsourcing']), true, 'the summary line counts');
  // Any of the lines picked; none picked is everything.
  assert.equal(inCategories(op('Servicio de aseo para el Tribunal'), ['seguridad', 'aseo']), true);
  assert.equal(inCategories(op('Compra de escritorios'), []), true);
  assert.equal(inCategories({ title: null, data: null }, ['aseo']), false);
});

test('«aseo» is the service, not a «paseo» nor the purchase of cleaning supplies', () => {
  const op = (title: string) => ({ title, data: {} });
  assert.equal(inCategories(op('HABILITACIÓN PASEO PEATONAL CALLE COLO COLO'), ['aseo']), false);
  assert.equal(inCategories(op('CONSTRUCCION PASEO FLUVIAL SEGURO RIO CONTAO'), ['aseo']), false);
  assert.equal(inCategories(op('Adquisición de artículos de aseo para FF-Riveros'), ['aseo']), false);
  assert.equal(inCategories(op('PNS PRODUCTOS DE LIMPIEZA AREAS CLINICAS'), ['aseo']), false);
  for (const title of ['SERV. DE ASEO NAD REGIONES DE ÑUBLE A LOS LAGOS', 'SERVICIOS EXTERNOS DE ASEO', 'Servicio de Aseo para el Tribunal de Quellón', 'SERVICIO ASEO OFICINA PROVINCIAL TOCOPILLA', 'SERV ASEO MANT. Y ALIMENT. CF CHUNGARA'])
    assert.equal(inCategories(op(title), ['aseo']), true, title);
});

test('Compra Ágil is asked with a few of the company\'s words each day, in turn, until all have been asked; a short list goes whole', () => {
  const words = Array.from({ length: 30 }, (_, index) => `palabra ${index + 1}`);
  const days = Array.from({ length: 5 }, (_, day) => tenderWordsOfTheDay(words, day));
  assert.ok(days.every(day => day.length === 6), 'six a day');
  assert.deepEqual(days[0], ['palabra 1', 'palabra 2', 'palabra 3', 'palabra 4', 'palabra 5', 'palabra 6']);
  assert.deepEqual(days[1].slice(0, 2), ['palabra 7', 'palabra 8']);
  assert.deepEqual(new Set(days.flat()), new Set(words), 'five days ask all thirty');
  assert.deepEqual(tenderWordsOfTheDay(words, 5), days[0], 'and then it starts again');
  assert.deepEqual(tenderWordsOfTheDay(words, 3), tenderWordsOfTheDay(words, 3), 'the same day, the same words');
  assert.deepEqual(tenderWordsOfTheDay(words, 3.9), tenderWordsOfTheDay(words, 3), 'a day is a whole day');
  // A list that does not divide by six still reaches every word, and wraps around the end.
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(new Set([0, 1, 2, 3, 4, 5, 6].flatMap(day => tenderWordsOfTheDay(seven, day))), new Set(seven));
  assert.deepEqual(tenderWordsOfTheDay(seven, 1), ['g', 'a', 'b', 'c', 'd', 'e']);
  // Short lists, repeats and blanks.
  assert.deepEqual(tenderWordsOfTheDay(['aseo', 'seguridad'], 123), ['aseo', 'seguridad']);
  assert.deepEqual(tenderWordsOfTheDay(['aseo', ' aseo ', '', 'seguridad'], 0), ['aseo', 'seguridad']);
  assert.deepEqual(tenderWordsOfTheDay([], 4), []);
  assert.deepEqual(tenderWordsOfTheDay(words, -1).length, 6, 'a date before the epoch still gives six');
});

test('the daily search of Compra Ágil takes its words from the day, not the first six', () => {
  const sources = readFileSync('src/lib/server/commercial-opportunities/workspace-sources.ts', 'utf8');
  assert.match(sources, /tenderWordsOfTheDay\(context\.criteria\?\.keywords \|\| \[\], Date\.now\(\) \/ 86_400_000\)/);
  assert.doesNotMatch(sources, /criteria\?\.keywords \|\| \[\]\)\.slice\(0, 6\)/);
});
