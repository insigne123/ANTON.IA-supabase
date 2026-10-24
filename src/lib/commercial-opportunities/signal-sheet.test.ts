import assert from 'node:assert/strict';
import test from 'node:test';
import { SECTION_TITLES, buildSignalSheet, groupRest, linkedinSearchUrl, sheetSections, type SignalSheet } from './signal-sheet';
import { bars } from './signal-facts';
import { NOW, hiringItem, postItem, report } from './signal-sheet-fixtures';

const build = (extra: Record<string, unknown> = {}) => buildSignalSheet({ item: hiringItem(), report: report(), now: NOW, ...extra })!;

test('the sheet of a company that is hiring carries the signal, the fit, the people and the words, with what the AI wrote', () => {
  const sheet = build();
  assert.deepEqual([sheet.kind, sheet.title, sheet.kindLabel, sheet.written], ['hiring', 'Retail Pacífico', 'Avisos de empleo', true]);
  assert.deepEqual(sheet.relation, { code: 'contact', label: 'Ya tienes contactos ahí' });
  assert.deepEqual([sheet.stars.count, sheet.stars.score], [4, 75]);
  assert.match(sheet.stars.text, /^Calce 4 de 5: /);
  assert.deepEqual(sheet.decision, { label: 'Contactar, validando primero lo pendiente', tone: 'evaluate' });
  assert.match(sheet.headline, /^Ofrecerles refuerzos de bodega/);
  assert.equal(sheet.whyNow.length, 3); assert.match(sheet.whyNow[0], /32 de los 41 avisos/);
  assert.equal(sheet.nextSteps.length, 3);
  assert.deepEqual(sheet.links.map(link => link.label), ['LinkedIn de la empresa', 'retailpacifico.cl']);
  assert.deepEqual(sheet.fit.services.map(service => [service.service, service.strength]), [['Outsourcing logístico', 'strong'], ['Servicios transitorios', 'strong'], ['Reclutamiento y selección', 'weak']]);
  assert.equal(sheet.fit.matchedService, 'Servicios transitorios y outsourcing logístico'); assert.equal(sheet.fit.gaps.length, 2);
  assert.deepEqual(sheet.buyers.map(buyer => [buyer.title, buyer.priority]), [['Gerente de Operaciones', 'primary'], ['Gerente de Personas', 'primary'], ['Gerente de Logística', 'secondary'], ['Jefe de Compras de servicios', 'secondary']]);
  assert.equal(sheet.buyers[0].searchUrl, 'https://www.linkedin.com/search/results/people/?keywords=Gerente%20de%20Operaciones%20Retail%20Pac%C3%ADfico');
  assert.deepEqual(sheet.messages.map(message => message.channelLabel), ['LinkedIn', 'Correo', 'Llamada']);
  assert.ok(sheet.messages[0].body.length <= 280); assert.match(sheet.messages[1].subject, /Refuerzos de bodega/);
  assert.deepEqual(sheet.cadence.map(step => [step.day, step.channelLabel]), [[0, 'Investigación'], [1, 'LinkedIn'], [3, 'Correo'], [7, 'Llamada'], [10, 'Correo'], [17, 'LinkedIn']]);
  assert.equal(sheet.objections.length, 3);
  assert.deepEqual(sheet.validate.map(item => item.owner), ['Ejecutivo comercial', 'Ejecutivo comercial']);
  assert.equal(sheet.questions.length, 4); assert.equal(sheet.risks[0].impact, 'high');
  assert.equal(sheet.warnings.length, 2);
});

test('the pulse of a company that is hiring has the figures the charts are drawn from', () => {
  const pulse = build().pulse;
  assert.equal(pulse.kind, 'hiring');
  if (pulse.kind !== 'hiring') return;
  assert.deepEqual(pulse.kpis.map(kpi => [kpi.label, kpi.value]), [['Avisos en 30 días', '41'], ['En la última semana', '32'], ['Cargos distintos', '7'], ['Regiones', '5']]);
  assert.equal(pulse.kpis[1].note, '11,7 veces su ritmo anterior');
  assert.equal(pulse.kpis[3].note, 'sobre todo Metropolitana');
  assert.equal(pulse.roles.length, 7); assert.equal(pulse.regions.length, 5);
  assert.equal(pulse.window, 'Últimos 30 días · el aviso más reciente es de hace 2 días');
  assert.ok(pulse.pace && pulse.pace.times! > 11);
  assert.deepEqual(pulse.publishers, ['BeBee', 'Computrabajo', 'Trabajando.com', 'Postula Retail']);
});

test('a long list of bars is gathered into «Otros» so a chart never needs more room than it has', () => {
  const list = bars(Array.from({ length: 10 }, (_, i) => ({ label: `cargo ${i + 1}`, value: 10 - i })), 55);
  const grouped = groupRest(list, 5, 55);
  assert.deepEqual(grouped.map(bar => bar.label), ['cargo 1', 'cargo 2', 'cargo 3', 'cargo 4', 'Otros (6)']);
  assert.equal(grouped[4].value, 6 + 5 + 4 + 3 + 2 + 1);
  assert.equal(grouped[4].share, 1, 'the group is the longest bar here: 21 against 10');
  assert.ok(Math.abs(grouped[0].share - 10 / 21) < 1e-9, 'and the rest are measured against it');
  assert.deepEqual(groupRest(list.slice(0, 3), 5), list.slice(0, 3), 'a short list is left as it is');
  const merged = groupRest(bars([{ label: 'a', value: 5 }, { label: 'b', value: 4 }, { label: 'c', value: 4 }, { label: 'd', value: 4 }]), 2);
  assert.equal(merged[1].value, 12); assert.equal(merged[1].share, 1, 'when the rest is bigger than any, it is the longest');
});

test('before anyone asks for the written report, the sheet still has the pulse, the fit the radar found and the titles the company usually contacts', () => {
  const sheet = buildSignalSheet({ item: hiringItem(), now: NOW, decisionMakerTitles: ['Gerente de Personas', 'Jefe de Reclutamiento'] })!;
  assert.equal(sheet.written, false); assert.equal(sheet.decision, null); assert.equal(sheet.preparedAt, null); assert.equal(sheet.executive, null);
  assert.equal(sheet.headline, 'Retail Pacífico está contratando: 41 avisos en 30 días.');
  assert.deepEqual(sheet.whyNow, [
    '41 avisos en 30 días, 32 de ellos en la última semana (11,7 veces su ritmo anterior).',
    'Los cargos más pedidos son reponedor (14), operario (8), bodeguero (7).',
    'Concentra sus avisos en Metropolitana: 19 de 41.',
    'Ya tienes contactos ahí: pide que te presenten con quien decide.',
  ], 'whole sentences from what the radar saw, not its fragments');
  assert.deepEqual(sheet.fit.services.map(service => [service.service, service.strength]), [['Servicios transitorios y outsourcing logístico', 'strong']]);
  assert.deepEqual(sheet.buyers.map(buyer => [buyer.title, buyer.priority, buyer.why]), [['Gerente de Personas', 'primary', 'Cargo que tu empresa suele contactar.'], ['Jefe de Reclutamiento', 'secondary', 'Cargo que tu empresa suele contactar.']]);
  assert.deepEqual([sheet.messages, sheet.cadence, sheet.objections, sheet.approach], [[], [], [], null]);
  assert.equal(sheet.company.summary, 'Cadena de retail que está reforzando tiendas y centros de distribución en la Región Metropolitana.', 'the line the radar wrote under the name');
  assert.equal(sheet.sample.length, 5);
  assert.equal(sheet.sample[3].url, null);
  assert.equal(sheet.sample[0].when, 'hace 2 días');
});

test('a report from before the structured plan still gives its angle and its message, found in the prose', () => {
  const sheet = build({ report: report(false) });
  assert.match(sheet.approach!.angle, /^apoyar la dotación de bodega|^Apoyar la dotación de bodega|^apoyar/i);
  assert.deepEqual([sheet.approach!.hooks, sheet.approach!.avoid], [[], []]);
  assert.equal(sheet.messages.length, 1);
  assert.equal(sheet.messages[0].channel, 'linkedin', 'it fits in a connection note');
  assert.match(sheet.messages[0].body, /^Hola \[nombre\], vimos que Retail Pacífico/);
  assert.deepEqual(sheet.cadence, []);
  assert.equal(sheet.whyNow[0], 'Hay 41 avisos en 30 días, 32 en la última semana.', 'the report\'s own reasons');
});

test('the company facts start from what the radar knows and add what the AI found, without repeating a label', () => {
  const sheet = build();
  assert.deepEqual(sheet.company.facts.map(fact => fact.label), ['Relación', 'Rubro', 'Tamaño', 'Presencia', 'Centro de distribución', 'Contratación']);
  assert.deepEqual(sheet.company.facts.find(fact => fact.label === 'Tamaño'), { label: 'Tamaño', value: 'No informado' });
  assert.equal(sheet.company.facts.find(fact => fact.label === 'Presencia')!.value, "Metropolitana, O'Higgins, Biobío");
  assert.match(sheet.company.summary!, /^Cadena de autoservicio/);
});

test('what is missing from a sheet is a checklist with what to do about each, and the sections follow it', () => {
  const full = build({ contactsCount: 3 });
  assert.deepEqual([full.completeness.done, full.completeness.total, full.completeness.percent], [10, 10, 100]);
  assert.ok(!sheetSections(full).includes('pending'), 'nothing is pending');
  const sheet = build();
  assert.deepEqual(sheet.completeness.items.filter(item => !item.done).map(item => item.key), ['contacts']);
  assert.equal(sheet.completeness.items.find(item => item.key === 'contacts')!.action, 'Busca a las personas en «Contactos».');
  const bare = buildSignalSheet({ item: hiringItem(), now: NOW })!;
  assert.deepEqual(bare.completeness.items.filter(item => item.done).map(item => item.key), ['signal', 'fit', 'company'], 'the line the radar wrote counts as the company');
  assert.equal(bare.completeness.percent, 30);
  assert.ok(bare.completeness.items.filter(item => !item.done).every(item => item.action.length > 10));
  assert.deepEqual(sheetSections(bare), ['summary', 'pulse', 'fit', 'company', 'sample', 'pending']);
  assert.deepEqual(sheetSections(sheet), ['summary', 'pulse', 'fit', 'company', 'buyers', 'approach', 'messages', 'cadence', 'objections', 'validate', 'plan', 'risks', 'questions', 'sample', 'pending']);
  for (const id of sheetSections(sheet)) assert.ok(SECTION_TITLES[id], id);
});

test('the sheet of a LinkedIn post is about the post: who, when, what it says and how it fits', () => {
  const sheet = buildSignalSheet({ item: postItem(), now: NOW })!;
  assert.deepEqual([sheet.kind, sheet.title, sheet.kindLabel, sheet.relation], ['linkedin_post', 'Norte Sur Transportes', 'Publicación de LinkedIn', null]);
  assert.deepEqual(sheet.links, [{ label: 'Ver la publicación', url: 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000/' }, { label: 'Perfil del autor', url: 'https://www.linkedin.com/in/ana-perez' }]);
  const pulse = sheet.pulse;
  assert.equal(pulse.kind, 'post');
  if (pulse.kind !== 'post') return;
  assert.deepEqual(pulse.kpis.map(kpi => [kpi.label, kpi.value, kpi.note]), [['Publicada', '19 de octubre de 2026', 'hace 3 días'], ['Quién publica', 'Una persona', 'identidad sin verificar']]);
  assert.match(pulse.post.text, /^Buscamos 30 conductores/); assert.equal(pulse.post.ago, 'hace 3 días');
  assert.equal(sheet.fit.services[0].strength, 'medium', 'a score of 62 fits in part');
  assert.equal(sheet.stars.count, 3);
  assert.deepEqual(sheet.sample, []);
  assert.deepEqual(sheet.company.facts, [{ label: 'Autor', value: 'Una persona' }, { label: 'Identidad', value: 'Sin verificar' }]);
});

test('anything that is not a signal has no sheet, and a signal with no data still has one', () => {
  assert.equal(buildSignalSheet({ item: { kind: 'tender', title: 'Licitación' } }), null);
  const empty = buildSignalSheet({ item: { kind: 'hiring', title: 'Una empresa', data: null }, now: NOW }) as SignalSheet;
  assert.equal(empty.title, 'Una empresa'); assert.equal(empty.stars.count, 1); assert.deepEqual(empty.links, []);
  assert.equal(linkedinSearchUrl('Gerente', 'Acme S.A.'), 'https://www.linkedin.com/search/results/people/?keywords=Gerente%20Acme%20S.A.');
});
