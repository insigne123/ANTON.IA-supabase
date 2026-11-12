import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_DROP_PLAN, assignDrops, companyDropCriteria, criteriaKey, departmentLabel, dropCampaignMessages, dropContactHref, dropDay, dropEmailSection, dropSchedule, shortDay, dropFit, dropHref, dropPlanOf, dropSubject, exploreSlots, foreignDomain, groupDropPeople, inferCriteria, nextDropDay, personDropCriteria, pickRankedDrops, placeLabel, researchFacts, seniorityLabel, tidyCompany, tidyTitle, whyText, type DropCandidate, type DropCriteria, type DropScore } from './lead-drops';

const criteria: DropCriteria = { titles: ['Gerente de Personas'], industries: ['retail'], locations: ['Chile'], sizes: [], source: 'perfil' };
const candidate = (id: string, company: string, extra: Partial<DropCandidate> = {}): DropCandidate => ({
  leadId: `lf_${id.padStart(24, '0')}`, name: `Persona ${id}`, title: 'Gerente de Personas', company, domain: `${company.toLowerCase().replace(/\s/g, '')}.cl`,
  industry: 'Retail', size: 300, city: 'Santiago', hasEmail: true, hasPhone: false, emailKey: `p${id}@${company.toLowerCase().replace(/\s/g, '')}.cl`, linkedinKey: null, about: null, ...extra,
});
const none = () => ({ emails: new Set<string>(), linkedins: new Set<string>(), leadIds: new Set<string>() });

test('the contact of the day goes out on Tuesdays, Wednesdays and Fridays, in Chile', () => {
  assert.deepEqual(['19', '20', '21', '22', '23'].map(day => dropDay(new Date(`2026-10-${day}T12:00:00.000Z`))), [false, true, true, false, true]);
  // Saturday 00:30 in Chile is still Friday 03:30Z: the day is Chile's.
  assert.equal(dropDay(new Date('2026-10-24T03:30:00.000Z')), false);
  assert.deepEqual(['20', '21', '22', '23', '24', '26'].map(day => nextDropDay(new Date(`2026-10-${day}T15:00:00.000Z`))),
    ['mañana', 'el viernes', 'mañana', 'el martes', 'el martes', 'mañana']);
});

test('one customer per company: its ficha, else the one most of the team declared, else what the team saved', () => {
  const people = { roles: 'Gerente de Personas, Jefe de RR. HH.', industries: 'retail', locations: '', size: '51-200' };
  const ops = { roles: 'Gerente de Operaciones', industries: 'minería' };
  assert.deepEqual(companyDropCriteria({ roles: 'Jefe de Seguridad', industries: 'minería', locations: 'Chile, Perú' }, [people, people], []),
    { titles: ['Jefe de Seguridad'], industries: ['minería'], locations: ['Chile', 'Perú'], sizes: [], source: 'empresa' }, 'the ficha wins over the team');
  assert.deepEqual(companyDropCriteria(null, [ops, people, {}, { ...people, roles: 'jefe de rr. hh., gerente de personas' }], []),
    { titles: ['Gerente de Personas', 'Jefe de RR. HH.'], industries: ['retail'], locations: ['Chile'], sizes: ['51,200'], source: 'equipo' }, 'the one most declared, written either way');
  assert.equal(companyDropCriteria({ roles: '', industries: '' }, [ops, people], [])?.titles[0], 'Gerente de Operaciones', 'on a tie, the first (admins come first)');
  const saved = [...Array(4).fill({ title: 'Jefe de Seguridad', industry: 'Minería' }), { title: 'Gerente General', industry: 'Retail' }];
  assert.deepEqual(companyDropCriteria(null, [{}], saved), { titles: ['Jefe de Seguridad', 'Gerente General'], industries: ['Minería', 'Retail'], locations: ['Chile'], sizes: [], source: 'contactos' });
  assert.equal(inferCriteria(saved.slice(0, 4)), null, 'too few contacts to say what the team looks for');
  assert.equal(companyDropCriteria(null, [], []), null);
});

test('people with the same customer share one search', () => {
  const a = companyDropCriteria({ roles: 'Gerente de Personas, Jefe de RR. HH.', industries: 'Retail' }, [], [])!;
  const b = companyDropCriteria({ roles: 'jefe de rr. hh., gerente de personas', industries: 'retail' }, [], [])!;
  assert.equal(criteriaKey(a), criteriaKey(b));
  assert.notEqual(criteriaKey(a), criteriaKey({ ...a, locations: ['Perú'] }));
});

test('similar customers share a search; a different area or country gets its own (29 oct)', () => {
  const company = companyDropCriteria({ roles: 'Gerente de Personas, Jefe de Reclutamiento y Selección', industries: 'Retail, Minería', locations: 'Chile' }, [], [])!;
  const of = (own: Record<string, string> | null) => personDropCriteria(own, company)!;
  const groups = groupDropPeople([
    { id: 'ana', criteria: of(null) },
    { id: 'leo', criteria: of({ roles: 'Gerentes de RRHH, Gerente de Personas', industries: 'retail, minería, construcción', locations: 'Chile, Perú' }) },
    { id: 'mau', criteria: of({ roles: 'Gerente de Facility, Gerente de Infraestructura', industries: 'Retail', locations: 'Chile' }) },
    { id: 'kri', criteria: of({ roles: 'Jefe de Reclutamiento y Selección', industries: 'Retail', locations: 'Perú' }) },
    { id: 'sin', criteria: of(null) },
  ], 5);
  assert.deepEqual(groups.map(group => group.people), [['ana', 'sin', 'leo'], ['mau'], ['kri']], 'Facility is not people; Perú alone is another country');
  assert.deepEqual(groups[0].criteria.titles, ['Gerente de Personas', 'Jefe de Reclutamiento y Selección', 'Gerentes de RRHH'], 'the search takes what Leo adds');
  assert.deepEqual(groups[0].criteria.industries, ['Retail', 'Minería', 'construcción']);
  assert.deepEqual(groups[0].criteria.locations, ['Chile'], 'the group searches where it started');
  assert.equal(of({ roles: 'Gerente de Facility', industries: '' }).source, 'perfil');
  assert.equal(of({ roles: '', industries: '' }).source, 'empresa');

  const capped = groupDropPeople([
    { id: 'ana', criteria: of(null) }, { id: 'mau', criteria: of({ roles: 'Gerente de Facility', industries: 'Retail' }) },
    { id: 'kri', criteria: of({ roles: 'Jefe de Selección', industries: 'Retail', locations: 'Perú' }) },
  ], 1);
  assert.deepEqual(capped.map(group => group.people), [['ana', 'mau', 'kri']], 'past the limit everyone shares the largest search');
});

test('in a shared search, each person gets the contacts closest to their own customer', () => {
  const ops: DropCriteria = { ...criteria, titles: ['Jefe de Operaciones'] };
  const pool = [candidate('1', 'A', { title: 'Gerente de Personas' }), candidate('2', 'B', { title: 'Jefe de Operaciones' })];
  const out = assignDrops(pool, ['ana', 'leo'], none(), { ...criteria, titles: ['Gerente de Personas', 'Jefe de Operaciones'] }, 1,
    person => (person === 'leo' ? ops : criteria));
  assert.deepEqual([out.get('ana')![0].company, out.get('leo')![0].company], ['A', 'B']);
});

test('each person gets different contacts, one per company, never someone the team has', () => {
  const pool = [
    candidate('1', 'Ripley'), candidate('2', 'Ripley'), candidate('3', 'Falabella', { hasPhone: true }), candidate('4', 'Paris'), candidate('5', 'Lider'),
    candidate('6', 'Tottus'), candidate('7', 'Unimarc'), candidate('8', 'Jumbo'), candidate('9', 'Hites'), candidate('10', 'Abcdin'),
    candidate('11', 'Corona', { hasEmail: false }), candidate('12', 'Sodimac', { emailKey: 'known@sodimac.cl' }), candidate('13', 'Easy'),
  ];
  const known = { ...none(), emails: new Set(['known@sodimac.cl']) };
  const out = assignDrops(pool, ['ana', 'leo'], known, criteria, 5);
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

test('with few contacts, everyone gets some; by default, one each', () => {
  const out = assignDrops([candidate('1', 'A'), candidate('2', 'B'), candidate('3', 'C')], ['ana', 'leo'], none(), criteria, 5);
  assert.deepEqual([out.get('ana')!.length, out.get('leo')!.length], [2, 1]);
  const daily = assignDrops([candidate('1', 'A'), candidate('2', 'A', { hasPhone: true }), candidate('3', 'B')], ['ana', 'leo'], none(), criteria);
  assert.deepEqual([...daily.values()].map(picks => picks.map(item => item.company)), [['A'], ['B']], 'one contact of the day each, at different companies');
});

test('a company from another country is not offered, even when the person works in the country asked (gou.mx, Santiago)', () => {
  // Rodrigo's contact of the day on 21 Oct: «Gerente de Personas» at a Mexican moving company, located in Santiago.
  const gou = candidate('1', 'Gou', { domain: 'gou.mx', hasPhone: true });
  const out = assignDrops([gou, candidate('2', 'Ripley')], ['ana'], none(), criteria);
  assert.deepEqual(out.get('ana')!.map(item => item.company), ['Ripley'], 'the Mexican company goes even with a phone');
  assert.deepEqual(assignDrops([gou], ['ana'], none(), criteria).get('ana'), [], 'and nothing is better than that contact');

  assert.equal(foreignDomain('gou.mx', ['Chile']), true);
  assert.equal(foreignDomain('www.empresa.com.ar', ['Chile']), true);
  assert.equal(foreignDomain('banco.com.co', ['Chile']), true);
  assert.equal(foreignDomain('ripley.cl', ['Chile']), false);
  assert.equal(foreignDomain('gou.mx', ['Chile', 'México']), false, 'a team that searches Mexico too');
  assert.equal(foreignDomain('gou.mx', ['Chile', 'Perú']), true, 'accents and other places do not matter');
  // A `.com` or a startup `.co` says no country; places that name none leave the search as it is.
  assert.equal(foreignDomain('ripley.com', ['Chile']), false);
  assert.equal(foreignDomain('startup.co', ['Chile']), false);
  assert.equal(foreignDomain('gou.mx', ['Santiago']), false);
  assert.equal(foreignDomain(null, ['Chile']), false);
});

test('why a contact fits, and the facts of its company', () => {
  // What matched, not the role again: it is on the screen right beside it.
  assert.equal(whyText({ title: 'Gerente de Personas', industry: 'Retail', city: 'Santiago' }, criteria), 'Calza con tu cliente ideal por su cargo y su rubro (retail), en Santiago.');
  assert.equal(whyText({ title: 'Gerente de Personas', industry: null, city: null }, { ...criteria, source: 'equipo' }), 'Calza con el cliente ideal de tu equipo por su cargo.');
  assert.equal(whyText({ title: null, industry: null, city: null }, { ...criteria, source: 'contactos' }), 'Calza con los contactos que guarda tu equipo.');
  assert.deepEqual(researchFacts({ company: 'Ripley', industry: 'Retail', size: 12000, city: 'Santiago', about: 'Vende ropa y hogar.' }), ['Vende ropa y hogar.', 'Retail · 12.000 personas · Santiago']);
});

test('a title as people write it: the linking words in lower case, one in capitals as it is', () => {
  assert.equal(tidyTitle('Jefe De Reclutamiento Y Selección'), 'Jefe de Reclutamiento y Selección');
  assert.equal(tidyTitle('Gerente  General De Operaciones E Innovación'), 'Gerente General de Operaciones e Innovación');
  assert.equal(tidyTitle('De la Fuente Consultores'), 'De la Fuente Consultores', 'the first word stays');
  assert.equal(tidyTitle('JEFE DE VENTAS'), 'JEFE DE VENTAS');
  assert.equal(tidyTitle('Head Of People'), 'Head Of People');
  assert.equal(tidyTitle('Subgerente de RR.HH.'), 'Subgerente de RR.HH.');
  assert.equal(tidyTitle(''), null);
  assert.equal(tidyTitle(null), null);
});

test('a company with its legal form as Chile writes it', () => {
  assert.equal(tidyCompany('Logistica S.a.'), 'Logistica S.A.');
  assert.equal(tidyCompany('Transportes Rutas Spa'), 'Transportes Rutas SpA');
  assert.equal(tidyCompany('Servicios Norte Ltda'), 'Servicios Norte Ltda.');
  assert.equal(tidyCompany('Aseo Sur Eirl'), 'Aseo Sur EIRL');
  assert.equal(tidyCompany('Casa Spa Termal'), 'Casa Spa Termal', 'only at the end');
  assert.equal(tidyCompany('Mesa'), 'Mesa');
  assert.equal(tidyCompany(' '), null);
});

test('the email table escapes what came from outside and links to the drop', () => {
  const item = { leadId: 'lf_1', name: 'Ana <b>', title: 'Gerente', company: 'R&R', domain: null, industry: null, size: null, city: null, hasEmail: true, hasPhone: false, why: 'Calza.', research: [], draft: null };
  const section = dropEmailSection([item], 'drop-1', 'https://app.antonia.ai/');
  assert.equal(section.link, `https://app.antonia.ai${dropHref('drop-1')}`);
  assert.match(section.html, /Ana &lt;b&gt;/);
  assert.match(section.html, /R&amp;R/);
  assert.doesNotMatch(section.html, /Ana <b>/);
  assert.match(section.text, /^Tu contacto de hoy, con su correo listo:/);
  assert.match(section.html, />Ver y guardar</);
  // One contact is a block, not a three-column table that breaks on a phone: name, role · company, why.
  assert.doesNotMatch(section.html, /<table|<th /);
  assert.match(section.html, /font-weight:600[^>]*>Ana &lt;b&gt;<\/p><p[^>]*>Gerente · R&amp;R<\/p><p[^>]*>Calza\.<\/p>/);
  assert.match(section.html, /Contacto del día<\/h2>/);
  // When the drop is all the email has, the title and its lead are left out.
  const bare = dropEmailSection([item], 'drop-1', 'https://app.antonia.ai/', { heading: false });
  assert.doesNotMatch(bare.html, /Contacto del día|Tu contacto de hoy, con su correo listo/);
  assert.doesNotMatch(bare.text, /^Tu contacto de hoy/);
  assert.match(bare.html, />Ver y guardar</);
  // Several: a card each with its own way in (below), and one link to all of them. Their email came with the search, so each is to save.
  const two = dropEmailSection([item, { ...item, leadId: 'lf_2' }], 'drop-1', 'https://app.antonia.ai/');
  assert.match(two.html, /href="https:\/\/app\.antonia\.ai\/search\/contactos\/drop-1\?c=lf_2"[^>]*>Ver y guardar<\/a>/);
  assert.match(two.html, />Ver los 2 juntos</);
  assert.match(two.text, /^2 contactos nuevos para ti:/);
  assert.match(two.text, /Guardarlos no gasta créditos\.$/);
  assert.equal(dropSubject([item]), 'Tu contacto de hoy: Gerente en R&R');
  assert.equal(dropSubject([{ title: null, company: null }]), 'Tu contacto de hoy');
  assert.equal(dropSubject([item, item]), '2 contactos nuevos para ti');
  // The first reason it is worth it for what the person sells goes under the why; the rest are in the PDF.
  const advised = dropEmailSection([{ ...item, reasons: ['Revisa a cada persona que entra.', 'Otra.'] }], 'drop-1', 'https://app.antonia.ai/');
  assert.match(advised.html, /Calza\.<\/p><p[^>]*>Revisa a cada persona que entra\.<\/p><\/div>/);
  assert.doesNotMatch(advised.html, /Otra\./);
  assert.match(advised.text, /Calza\. Revisa a cada persona que entra\./);
});

test('how a contact fits, criterion by criterion: by the words of the title and the industry, the place and the size', () => {
  const ana = { title: 'Head of People', industry: 'Retail', size: 300, city: 'Las Condes', state: 'Santiago Metropolitan Region', country: 'Chile' };
  const wanted: DropCriteria = { titles: ['Gerente de Personas', 'Jefe de RR. HH.'], industries: ['retail', 'minería'], locations: ['Santiago'], sizes: ['51,200', '201,500'], source: 'perfil' };
  assert.deepEqual(dropFit(ana, wanted), [
    { criterion: 'Cargo', theirs: 'Head of People', wanted: 'Gerente de Personas, Jefe de RR. HH.', match: 'yes' },
    { criterion: 'Rubro', theirs: 'Retail', wanted: 'retail, minería', match: 'yes' },
    { criterion: 'Lugar', theirs: 'Las Condes, Región Metropolitana, Chile', wanted: 'Santiago', match: 'partial' },
    { criterion: 'Tamaño', theirs: '300 personas', wanted: '51 a 200 personas o 201 a 500 personas', match: 'yes' },
  ], '«People» is «Personas»; Las Condes is a part of Santiago the search kept to');
  const other = dropFit({ title: 'Gerente de Ventas', industry: 'Reclutamiento y personal', size: null, city: 'Lima', state: null, country: 'Peru' },
    { titles: ['Gerente General', 'Jefe de Operaciones Comerciales'], industries: ['servicios transitorios'], locations: ['Chile'], sizes: ['5001,1000000'], source: 'empresa' },
    value => value === 'servicios transitorios');
  assert.deepEqual(other.map(entry => [entry.criterion, entry.match]), [['Cargo', 'partial'], ['Rubro', 'yes'], ['Lugar', 'no'], ['Tamaño', 'unknown']],
    '«Gerente General» is compared with its level; the industry as the search names it; Perú is not Chile; no size, no guess');
  assert.equal(other[3].wanted, 'Más de 5.000 personas');
  assert.deepEqual(dropFit({ title: null, industry: null, size: 10, city: null, state: null, country: null }, criteria).map(entry => [entry.criterion, entry.theirs, entry.match]),
    [['Cargo', 'Sin dato', 'unknown'], ['Rubro', 'Sin dato', 'unknown'], ['Lugar', 'Sin dato', 'unknown']], 'no size asked, no size row');
  assert.equal(placeLabel({ city: 'Santiago', state: 'Santiago', country: 'Chile' }), 'Santiago, Chile');
  assert.equal(placeLabel({ city: null, state: 'Valparaíso Region', country: null }), 'Región de Valparaíso');
  assert.deepEqual([seniorityLabel('manager'), seniorityLabel('c_suite'), departmentLabel('human_resources'), departmentLabel('field_sales'), seniorityLabel(null)],
    ['Gerencia o jefatura', 'Alta dirección', 'Recursos humanos', 'Field sales', null]);
});

test('a team\'s plan: how many contacts and on which days, and anything out of range falls back to one on Tuesdays, Wednesdays and Fridays', () => {
  assert.deepEqual(dropPlanOf({ lead_drop_size: 6, lead_drop_weekdays: [5, 1, 2, 3, 4, 4] }), { size: 6, weekdays: [1, 2, 3, 4, 5] });
  assert.deepEqual(dropPlanOf(null), DEFAULT_DROP_PLAN);
  assert.deepEqual(dropPlanOf({ lead_drop_size: 0, lead_drop_weekdays: [] }), DEFAULT_DROP_PLAN);
  assert.deepEqual(dropPlanOf({ lead_drop_size: 99, lead_drop_weekdays: [0, 6, 7] }), DEFAULT_DROP_PLAN, 'no weekends, no more than ten');
  assert.deepEqual(dropPlanOf({ lead_drop_size: '3', lead_drop_weekdays: ['2', '4'] }), { size: 3, weekdays: [2, 4] }, 'as the database may send them');
  const daily = dropPlanOf({ lead_drop_size: 6, lead_drop_weekdays: [1, 2, 3, 4, 5] });
  // 19 Oct 2026 is a Monday; the 24th, a Saturday.
  assert.deepEqual(['19', '20', '22', '24', '25'].map(day => dropDay(new Date(`2026-10-${day}T15:00:00.000Z`), daily)), [true, true, true, false, false]);
  assert.deepEqual(['19', '22', '23', '24'].map(day => nextDropDay(new Date(`2026-10-${day}T15:00:00.000Z`), daily)), ['mañana', 'mañana', 'el lunes', 'el lunes']);
});

test('the finder\'s pick: the customer\'s own roles by score, and the last slots for roles next to them', () => {
  assert.deepEqual([1, 2, 3, 6, 10].map(exploreSlots), [0, 0, 1, 2, 3]);
  const scores = new Map<string, DropScore>();
  const scored = (id: string, company: string, titleClass: DropScore['titleClass'], score: number, extra: Partial<DropCandidate> = {}) => {
    const item = candidate(id, company, extra);
    scores.set(item.leadId, { titleClass, score });
    return item;
  };
  const pool = [
    scored('1', 'Ripley', 'exact', 60), scored('2', 'Falabella', 'exact', 90), scored('3', 'Paris', 'similar', 80), scored('4', 'Lider', 'exact', 70),
    scored('5', 'Tottus', 'similar', 50), scored('6', 'Jumbo', 'exact', 40), scored('7', 'Hites', 'related', 85), scored('8', 'Easy', 'related', 30),
    scored('9', 'Sodimac', 'related', 55), scored('10', 'Falabella', 'exact', 88), scored('11', 'Corona', 'exact', 99, { hasEmail: false }),
    candidate('12', 'Unimarc'), // nothing to do with the customer's roles: the finder gave it no score
  ];
  const deps = { criteriaOf: () => criteria, scoreOf: (_person: string, item: DropCandidate) => scores.get(item.leadId) ?? null };
  const [mine] = [...pickRankedDrops(pool, ['ana'], none(), 6, deps).values()];
  assert.deepEqual(mine.map(item => [item.company, item.track ?? 'core']),
    [['Falabella', 'core'], ['Paris', 'core'], ['Lider', 'core'], ['Ripley', 'core'], ['Hites', 'explore'], ['Sodimac', 'explore']],
    'four of the customer\'s roles by score, one per company, then the two best of the roles next to them');
  assert.ok(!mine.some(item => item.company === 'Corona' || item.company === 'Unimarc'), 'nobody without an email, nobody without a score');

  // Two people share the pool in turns: nobody twice, and a company only once while there are others.
  const shared = pickRankedDrops(pool, ['ana', 'leo'], none(), 3, deps);
  const all = [...shared.values()].flat();
  assert.equal(new Set(all.map(item => item.leadId)).size, 6);
  assert.equal(new Set(all.map(item => item.company)).size, 6);
  assert.deepEqual([...shared.values()].map(items => items.filter(item => item.track === 'explore').length), [1, 1], 'each one\'s last slot explores');

  // Without roles next to the customer's, the exploring slots are filled with its own; without its own, with what there is.
  const onlyCore = pickRankedDrops(pool.filter(item => scores.get(item.leadId)?.titleClass !== 'related'), ['ana'], none(), 6, deps);
  assert.deepEqual(onlyCore.get('ana')!.map(item => [item.company, item.track]),
    [['Falabella', undefined], ['Paris', undefined], ['Lider', undefined], ['Ripley', undefined], ['Tottus', undefined], ['Jumbo', undefined]]);
  const onlyRelated = pickRankedDrops(pool.filter(item => scores.get(item.leadId)?.titleClass === 'related'), ['ana'], none(), 2, deps);
  assert.deepEqual(onlyRelated.get('ana')!.map(item => [item.company, item.track]), [['Hites', 'explore'], ['Sodimac', 'explore']]);
});

test('a role next to the customer\'s says so, instead of «calza por su cargo»', () => {
  assert.equal(whyText({ title: 'Jefe de Operaciones', industry: 'Retail', city: 'Santiago', track: 'explore' }, criteria),
    'Su cargo es vecino a los que buscas, en tu rubro objetivo (retail), en Santiago: te lo proponemos para probar si también te sirve.');
  assert.equal(whyText({ title: 'Jefe de Operaciones', industry: null, city: null, track: 'explore' }, criteria),
    'Su cargo es vecino a los que buscas: te lo proponemos para probar si también te sirve.');
});

test('a contact\'s emails as a campaign sends them: the first at once, each follow-up so many days after the one before', () => {
  const draft = { subject: 'Brigadas', body: 'Hola' };
  const followUps = [{ day: 3, subject: 'Uno', body: 'A' }, { day: 7, subject: 'Dos', body: 'B' }, { day: 11, subject: 'Tres', body: 'C' }];
  assert.deepEqual(dropCampaignMessages({ draft, followUps }).map(message => message.delayDays), [0, 2, 4, 4]);
  assert.deepEqual(dropCampaignMessages({ draft, followUps: [{ day: 1, subject: 'Uno', body: 'A' }, { day: 1, subject: 'Dos', body: 'B' }] }).map(message => message.delayDays), [0, 1, 1],
    'never two the same day, whatever the Writer said');
  assert.deepEqual(dropCampaignMessages({ draft: null, followUps }), []);
  // With the day it starts, no follow-up falls on a weekend: from a Friday, the one of two days later waits for Monday, and the
  // next ones keep their distance from it; from a Monday, the one that would fall on Sunday.
  assert.deepEqual(dropCampaignMessages({ draft, followUps }, new Date('2026-11-13T15:00:00.000Z')).map(message => message.delayDays), [0, 3, 4, 4]);
  assert.deepEqual(dropCampaignMessages({ draft, followUps }, new Date('2026-11-16T15:00:00.000Z')).map(message => message.delayDays), [0, 2, 5, 4]);
  assert.deepEqual(dropSchedule({ draft, followUps }, new Date('2026-11-16T15:00:00.000Z')), ['2026-11-16', '2026-11-18', '2026-11-23', '2026-11-27']);
  // Thursday 12 Nov 2026, late in Chile: the day is Chile's, and Saturday's follow-up goes on Monday.
  assert.deepEqual(dropSchedule({ draft, followUps }, new Date('2026-11-13T02:30:00.000Z')), ['2026-11-12', '2026-11-16', '2026-11-20', '2026-11-24']);
  assert.deepEqual(['2026-11-12', '2026-11-14', '2026-12-01'].map(shortDay), ['jue 12 nov', 'sáb 14 nov', 'mar 1 dic']);
});

test('the email of several contacts: a card each with why, what is happening, how to open and its campaign, and its own way in', () => {
  const base = (id: string, name: string, company: string, extra: Record<string, unknown> = {}) => ({ ...candidate(id, company), name, title: 'Gerente HSE', why: 'Calza con tu cliente ideal por su cargo.',
    research: [], provider: 'apollo' as const, draft: { subject: 'Brigadas en <faena>', body: `Hola {{nombre}},\n\n${'¿Cómo cubren los turnos de noche? '.repeat(12)}` },
    followUps: [{ day: 3, subject: 'Uno', body: 'A' }, { day: 7, subject: 'Dos', body: 'B' }], ...extra });
  const items = [
    base('1', 'Pedro Ar***a', 'Minera Andina', { reasons: ['Una razón de antes.'], approach: 'Un abordaje de antes.',
      brief: { company: 'Produce cobre.', fit: 'Una planta nueva suma áreas que proteger.', role: 'Responde por la seguridad.', opener: 'Pregúntale por la planta nueva.',
        news: { text: 'Anunció una planta concentradora nueva.', date: '3 nov 2026', source: 'Diario Financiero', url: 'https://diario.example/planta' } } }),
    base('2', 'Luisa Soto', 'Puerto Sur', { track: 'explore' as const, savedLeadId: 'e-2', reasons: ['Su cargo decide la contratación de brigadas.'] }),
    base('3', 'Ana Rojas', 'Forestal Sur', { savedLeadId: 'e-3', campaign: { id: 'c-1', provider: 'google' as const, approvedAt: '2026-11-12T12:00:00Z' }, draft: null, followUps: [] }),
  ];
  const section = dropEmailSection(items as any, 'drop-1', 'https://app.test/', { now: new Date('2026-11-12T12:00:00.000Z') });
  assert.equal(section.link, 'https://app.test/search/contactos/drop-1');
  assert.equal(dropContactHref(section.link, items[0] as any), 'https://app.test/search/contactos/drop-1?c=lf_000000000000000000000001&enriquecer=1');
  // The text version, as a phone's preview reads it.
  assert.match(section.text, /^3 contactos nuevos para ti, cada uno con su campaña lista:\n\nPedro A\., Gerente HSE en Minera Andina\nPor qué: Una planta nueva suma áreas que proteger\.\nAhora: Anunció una planta concentradora nueva \(Diario Financiero, 3 nov 2026\)\.\nCómo abrir: Pregúntale por la planta nueva\.\nPrimer correo: «Brigadas en <faena>»\. Hola Pedro, ¿Cómo cubren/,
    'the preview reads as the contact would get it: their first name, not «{{nombre}}»');
  assert.match(section.text, /2 seguimientos si no responde: lun 16 nov y vie 20 nov\.\nEnriquecer y revisar · 1 crédito: https:\/\/app\.test\/search\/contactos\/drop-1\?c=lf_000000000000000000000001&enriquecer=1/);
  assert.match(section.text, /Luisa Soto, Gerente HSE en Puerto Sur \(para explorar\)\nPor qué: Su cargo decide la contratación de brigadas\.\nPrimer correo:[\s\S]*Revisar y aprobar: https:\/\/app\.test\/search\/contactos\/drop-1\?c=lf_000000000000000000000002\n/,
    'with its email already: no lookup asked, and the step is to approve');
  assert.match(section.text, /Ana Rojas, Gerente HSE en Forestal Sur\nPor qué: Calza con tu cliente ideal por su cargo\.\nVer su campaña: /);
  assert.match(section.text, /Verlos todos: https:\/\/app\.test\/search\/contactos\/drop-1\nEnriquecer busca su correo y usa 1 crédito por contacto\. Al aprobar, los correos salen desde tu Gmail u Outlook y se detienen si responde\. Los correos completos van en el PDF adjunto\.$/);
  // The preview is cut at a word, and what came from outside is escaped.
  const preview = section.text.match(/Primer correo: «[^»]*»\. ([^\n]*)/)![1];
  assert.ok(preview.length <= 151 && preview.endsWith('…'));
  assert.match(section.html, /Brigadas en &lt;faena&gt;/);
  assert.doesNotMatch(section.html, /<faena>/);
  assert.equal((section.html.match(/Campaña lista<\/p>/g) || []).length, 2, 'the one without emails has no campaign block');
  assert.match(section.html, /href="https:\/\/app\.test\/search\/contactos\/drop-1\?c=lf_000000000000000000000001&amp;enriquecer=1"[^>]*>Enriquecer y revisar · 1 crédito<\/a>/);
  assert.match(section.html, /· para explorar/);
  assert.match(section.html, /Ver los 3 juntos/);
  // Inside another alert the heading is the alert's.
  assert.doesNotMatch(dropEmailSection(items as any, 'drop-1', 'https://app.test', { heading: false }).html, /<h2/);
});
