import assert from 'node:assert/strict';
import test from 'node:test';

import { assignDrops, companyDropCriteria, criteriaKey, departmentLabel, dropDay, dropEmailSection, dropFit, dropHref, dropSubject, foreignDomain, groupDropPeople, inferCriteria, nextDropDay, personDropCriteria, placeLabel, researchFacts, seniorityLabel, tidyCompany, tidyTitle, whyText, type DropCandidate, type DropCriteria } from './lead-drops';

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
  assert.match(dropEmailSection([item, item], 'drop-1', 'https://app.antonia.ai/').html, />Ver y guardar los 2</);
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
