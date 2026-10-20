import assert from 'node:assert/strict';
import test from 'node:test';

import { assignDrops, criteriaKey, dropCriteria, dropDay, dropEmailSection, dropHref, inferCriteria, researchFacts, whyText, type DropCandidate, type DropCriteria } from './lead-drops';

const criteria: DropCriteria = { titles: ['Gerente de Personas'], industries: ['retail'], locations: ['Chile'], sizes: [], source: 'perfil' };
const candidate = (id: string, company: string, extra: Partial<DropCandidate> = {}): DropCandidate => ({
  leadId: `lf_${id.padStart(24, '0')}`, name: `Persona ${id}`, title: 'Gerente de Personas', company, domain: `${company.toLowerCase().replace(/\s/g, '')}.cl`,
  industry: 'Retail', size: 300, city: 'Santiago', hasEmail: true, hasPhone: false, emailKey: `p${id}@${company.toLowerCase().replace(/\s/g, '')}.cl`, linkedinKey: null, about: null, ...extra,
});
const none = () => ({ emails: new Set<string>(), linkedins: new Set<string>(), leadIds: new Set<string>() });

test('drops go out on Tuesdays and Fridays, in Chile', () => {
  assert.equal(dropDay(new Date('2026-10-20T12:00:00.000Z')), true);
  assert.equal(dropDay(new Date('2026-10-21T12:00:00.000Z')), false);
  assert.equal(dropDay(new Date('2026-10-23T12:00:00.000Z')), true);
  // Saturday 00:30 in Chile is still Friday 03:30Z: the day is Chile's.
  assert.equal(dropDay(new Date('2026-10-24T03:30:00.000Z')), false);
});

test('the customer comes from the person, a teammate, or what the team saved', () => {
  assert.deepEqual(dropCriteria({ roles: 'Gerente de Personas, Jefe de RR. HH.', industries: 'retail', locations: '', size: '51-200' }, [], []),
    { titles: ['Gerente de Personas', 'Jefe de RR. HH.'], industries: ['retail'], locations: ['Chile'], sizes: ['51,200'], source: 'perfil' });
  assert.equal(dropCriteria({ roles: '', industries: '' }, [{ roles: 'Gerente de Operaciones', industries: 'minería' }], [])?.source, 'equipo');
  const saved = [...Array(4).fill({ title: 'Jefe de Seguridad', industry: 'Minería' }), { title: 'Gerente General', industry: 'Retail' }];
  assert.deepEqual(dropCriteria(null, [{}], saved), { titles: ['Jefe de Seguridad', 'Gerente General'], industries: ['Minería', 'Retail'], locations: ['Chile'], sizes: [], source: 'contactos' });
  assert.equal(inferCriteria(saved.slice(0, 4)), null, 'too few contacts to say what the team looks for');
  assert.equal(dropCriteria(null, [], []), null);
});

test('people with the same customer share one search', () => {
  const a = dropCriteria({ roles: 'Gerente de Personas, Jefe de RR. HH.', industries: 'Retail' }, [], [])!;
  const b = dropCriteria({ roles: 'jefe de rr. hh., gerente de personas', industries: 'retail' }, [], [])!;
  assert.equal(criteriaKey(a), criteriaKey(b));
  assert.notEqual(criteriaKey(a), criteriaKey({ ...a, locations: ['Perú'] }));
});

test('each person gets different contacts, one per company, never someone the team has', () => {
  const pool = [
    candidate('1', 'Ripley'), candidate('2', 'Ripley'), candidate('3', 'Falabella', { hasPhone: true }), candidate('4', 'Paris'), candidate('5', 'Lider'),
    candidate('6', 'Tottus'), candidate('7', 'Unimarc'), candidate('8', 'Jumbo'), candidate('9', 'Hites'), candidate('10', 'Abcdin'),
    candidate('11', 'Corona', { hasEmail: false }), candidate('12', 'Sodimac', { emailKey: 'known@sodimac.cl' }), candidate('13', 'Easy'),
  ];
  const known = { ...none(), emails: new Set(['known@sodimac.cl']) };
  const out = assignDrops(pool, ['ana', 'leo'], known, criteria);
  const ana = out.get('ana')!, leo = out.get('leo')!;
  assert.equal(ana.length, 5);
  assert.equal(leo.length, 5);
  assert.equal(ana[0].company, 'Falabella', 'the one with a phone goes first');
  const ids = [...ana, ...leo].map(item => item.leadId);
  assert.equal(new Set(ids).size, 10, 'nobody twice');
  assert.equal(new Set(ana.map(item => item.company)).size, 5, 'one per company for each person');
  assert.ok(!ids.includes(pool[10].leadId), 'without an email, no');
  assert.ok(!ids.includes(pool[11].leadId), 'the team has them already');
  const companies = [...ana, ...leo].map(item => item.company);
  assert.equal(new Set(companies).size, 10, 'while there are enough, a company for one person only');
});

test('with few contacts, everyone gets some', () => {
  const out = assignDrops([candidate('1', 'A'), candidate('2', 'B'), candidate('3', 'C')], ['ana', 'leo'], none(), criteria);
  assert.deepEqual([out.get('ana')!.length, out.get('leo')!.length], [2, 1]);
});

test('why a contact fits, and the facts of its company', () => {
  assert.equal(whyText({ title: 'Gerente de Personas', industry: 'Retail', city: 'Santiago' }, criteria), 'Gerente de Personas en retail en Santiago: calza con tu cliente ideal.');
  assert.equal(whyText({ title: null, industry: null, city: null }, { ...criteria, source: 'contactos' }), 'Calza con los contactos que guarda tu equipo.');
  assert.deepEqual(researchFacts({ company: 'Ripley', industry: 'Retail', size: 12000, city: 'Santiago', about: 'Vende ropa y hogar.' }), ['Vende ropa y hogar.', 'Retail · 12.000 personas · Santiago']);
});

test('the email table escapes what came from outside and links to the drop', () => {
  const item = { leadId: 'lf_1', name: 'Ana <b>', title: 'Gerente', company: 'R&R', domain: null, industry: null, size: null, city: null, hasEmail: true, hasPhone: false, why: 'Calza.', research: [], draft: null };
  const section = dropEmailSection([item], 'drop-1', 'https://app.antonia.ai/');
  assert.equal(section.link, `https://app.antonia.ai${dropHref('drop-1')}`);
  assert.match(section.html, /Ana &lt;b&gt;/);
  assert.match(section.html, /R&amp;R/);
  assert.doesNotMatch(section.html, /Ana <b>/);
  assert.match(section.text, /Un contacto nuevo para ti/);
});
