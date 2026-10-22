import assert from 'node:assert/strict';
import test from 'node:test';
import { agoText, bars, daysSince, pace, relationOf, signalFacts, RELATION_LABELS, type HiringFacts, type PostFacts } from './signal-facts';
import { NOW, hiringItem, postItem } from './signal-sheet-fixtures';

const near = (actual: number, expected: number, digits = 3) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} ≉ ${expected}`);

test('a company that is hiring is read from what the radar stored: counts, bars, pace and the ads it saw', () => {
  const facts = signalFacts(hiringItem()) as HiringFacts;
  assert.deepEqual([facts.kind, facts.company, facts.domain, facts.industry, facts.size], ['hiring', 'Retail Pacífico', 'retailpacifico.cl', 'Retail', null]);
  assert.deepEqual([facts.ads, facts.adsLastWeek, facts.windowDays], [41, 32, 30]);
  assert.equal(facts.relation, 'contact'); assert.equal(RELATION_LABELS[facts.relation], 'Ya tienes contactos ahí');
  assert.deepEqual(facts.roles.map(bar => [bar.label, bar.value]), [['reponedor', 14], ['operario', 8], ['bodeguero', 7], ['peoneta', 5], ['vendedor', 4], ['cajero', 2], ['conductor', 1]]);
  assert.equal(facts.roles[0].share, 1); near(facts.roles[1].share, 8 / 14); near(facts.roles[0].percent!, 14 / 41);
  assert.deepEqual(facts.regions.map(bar => bar.label), ['Metropolitana', "O'Higgins", 'Biobío', 'Maule', 'Ñuble']);
  assert.deepEqual(facts.publishers, ['BeBee', 'Computrabajo', 'Trabajando.com', 'Postula Retail']);
  assert.equal(facts.linkedinUrl, 'https://www.linkedin.com/company/retail-pacifico');
});

test('the week that just passed is compared with the weekly average of the days before it', () => {
  const result = pace(41, 32, 30)!;
  near(result.priorWeekly, 9 / (23 / 7)); near(result.times!, 32 / (9 / (23 / 7)), 2);
  assert.equal(pace(41, 32, 7), null, 'a window of one week has nothing before it');
  assert.equal(pace(0, 0, 30), null);
  assert.equal(pace(10, 12, 30), null, 'more ads last week than in all the window is not a count to trust');
  assert.deepEqual(pace(10, 10, 30), { lastWeek: 10, priorWeekly: 0, times: null }, 'all of them last week: no earlier rhythm to compare');
  const capped = signalFacts({ ...hiringItem(), data: { ...hiringItem().data, adsLastWeek: 99 } }) as HiringFacts;
  assert.equal(capped.adsLastWeek, 41, 'never more than the total of the window');
});

test('only web links leave the app, and an ad without a title still has one', () => {
  const facts = signalFacts(hiringItem()) as HiringFacts;
  assert.equal(facts.sample.length, 5);
  assert.deepEqual(facts.sample.map(ad => ad.url), ['https://example.com/avisos/1', 'https://example.com/avisos/2', 'https://example.com/avisos/3', null, 'https://example.com/avisos/5'], 'javascript: is dropped');
  const odd = signalFacts({ kind: 'hiring', company_name: 'X', company_linkedin_url: 'ftp://x', data: { ads: 3, evidence: [{ title: '', url: 'http://a.cl' }, null, 'texto'] } }) as HiringFacts;
  assert.equal(odd.linkedinUrl, null); assert.equal(odd.sample[0].title, 'Aviso'); assert.equal(odd.sample[0].url, 'http://a.cl');
});

test('a LinkedIn post is read for who wrote it, when, and what it says', () => {
  const facts = signalFacts(postItem()) as PostFacts;
  assert.deepEqual([facts.kind, facts.author, facts.authorType, facts.verified, facts.truncated], ['linkedin_post', 'Norte Sur Transportes', 'person', false, false]);
  assert.equal(facts.authorUrl, 'https://www.linkedin.com/in/ana-perez', 'the tracking part of the address is not kept');
  assert.match(facts.text, /^Buscamos 30 conductores clase A4/);
  assert.equal(facts.summary, 'Norte Sur Transportes busca 30 conductores para su nuevo centro de distribución.');
  assert.equal(daysSince(facts.postedAt, NOW), 3);
  assert.equal((signalFacts({ ...postItem(), data: { observed: { authorType: 'company' }, description: 'x' } }) as PostFacts).authorType, 'company');
});

test('nothing breaks with a signal that carries almost no data, and other kinds are not signals', () => {
  assert.equal(signalFacts({ kind: 'tender', title: 'Licitación' }), null);
  const empty = signalFacts({ kind: 'hiring', title: 'Una empresa', data: null }) as HiringFacts;
  assert.deepEqual([empty.company, empty.ads, empty.roles, empty.regions, empty.sample, empty.pace, empty.relation, empty.windowDays], ['Una empresa', 0, [], [], [], null, 'new', 30]);
  const bare = signalFacts({ kind: 'linkedin_post', data: { observed: 'x' } }) as PostFacts;
  assert.deepEqual([bare.author, bare.text, bare.postedAt, bare.authorType], ['Autor de la publicación', '', null, null]);
  assert.equal(relationOf({ isClient: true, isContact: true }), 'client'); assert.equal(relationOf({ isContact: true }), 'contact'); assert.equal(relationOf({}), 'new');
});

test('bars drop what has no value, put the biggest first and measure each against it', () => {
  const list = bars([{ label: 'a', value: 2 }, { label: '', value: 5 }, { label: 'b', value: 8 }, { label: 'c', value: 0 }], 20);
  assert.deepEqual(list.map(bar => [bar.label, bar.share, bar.percent]), [['b', 1, 0.4], ['a', 0.25, 0.1]]);
  assert.equal(bars([{ label: 'a', value: 1 }])[0].percent, null, 'without a total there is no percentage');
  assert.deepEqual(bars([]), []);
});

test('dates are said the way a person says them', () => {
  assert.equal(daysSince(null), null); assert.equal(daysSince('no es fecha'), null); assert.equal(daysSince(new Date(NOW + 86_400_000).toISOString(), NOW), 0);
  assert.deepEqual([0, 1, 3, 13, 14, 30, 59, 60, 200].map(days => agoText(days)), ['hoy', 'ayer', 'hace 3 días', 'hace 13 días', 'hace 2 semanas', 'hace 4 semanas', 'hace 8 semanas', 'hace 2 meses', 'hace 7 meses']);
  assert.equal(agoText(null), '');
});
