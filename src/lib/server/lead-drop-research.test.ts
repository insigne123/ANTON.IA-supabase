import assert from 'node:assert/strict';
import test from 'node:test';

import { briefNewsLine, companySite, companyTokens, mentionsCompany, newsDate, researchDropContact, searchName } from './lead-drop-research';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const item = (title: string, link: string, snippet = '', extra: Record<string, unknown> = {}) => ({ title, link, snippet, source: null, date: null, position: null, ...extra });
const seller = { company: 'Extintores del Norte', offer: 'Sistemas contra incendios para faenas mineras.', services: ['Detección', 'Extinción'], proofPoints: [], sector: 'Seguridad industrial' };
const contact = { title: 'Gerente HSE', company: 'Minera Andina S.A.', country: 'Chile' };

test('the words that tell a company from another, and its own site among the results', () => {
  assert.deepEqual(companyTokens('Atlantica Sustainable Infrastructure Plc'), ['atlantica', 'sustainable', 'infrastructure']);
  assert.deepEqual(companyTokens('Equipo FCAB'), ['fcab']);
  assert.deepEqual(companyTokens('Empresas S.A.'), [], 'a name of legal words only tells nothing');
  const results = [
    item('Minera Andina | LinkedIn', 'https://cl.linkedin.com/company/minera-andina'),
    item('Minera Andina sube su producción', 'https://www.mch.cl/2026/andina'),
    item('Andina: cobre del norte', 'https://www.mineraandina.cl/quienes-somos'),
    item('Andina Foods', 'https://andinafoods.com'),
  ];
  assert.equal(companySite('Minera Andina S.A.', results), 'mineraandina.cl', 'not the network nor the trade paper, though they come first');
  assert.equal(companySite('Equipo FCAB', [item('FCAB', 'https://www.fcab.cl/')]), 'fcab.cl');
  assert.equal(companySite('Minera Andina S.A.', results.slice(0, 2)), null);
  // A text is about the company when it says its name, not just a word of it.
  const andina = companyTokens('Minera Andina S.A.');
  assert.equal(mentionsCompany('Minera Andina invertirá en una planta', andina), true);
  assert.equal(mentionsCompany('Cumbre andina de turismo', andina), false);
  assert.equal(mentionsCompany('Sindicato de la minera rechaza la oferta', andina), false, '«minera» alone is any mining company');
  assert.equal(mentionsCompany('Liebherr presenta su nuevo camión', companyTokens('Liebherr Mining')), true, 'a first word that is the company\'s own is enough');
  assert.equal(mentionsCompany('El FCAB renueva locomotoras', companyTokens('Equipo FCAB')), true);
  assert.equal(searchName('Minera Andina S.A.'), 'Minera Andina');
  assert.equal(searchName('Rutas del Sur SpA'), 'Rutas del Sur');
  assert.equal(searchName('Atlantica Sustainable Infrastructure Plc'), 'Atlantica Sustainable Infrastructure');
});

test('when a piece of news is from, as the search says it', () => {
  assert.equal(newsDate('hace 3 días', NOW)?.toISOString().slice(0, 10), '2026-11-09');
  assert.equal(newsDate('2 weeks ago', NOW)?.toISOString().slice(0, 10), '2026-10-29');
  assert.equal(newsDate('hace 5 horas', NOW)?.toISOString().slice(0, 10), '2026-11-12');
  assert.equal(newsDate('12 oct 2026', NOW)?.toISOString().slice(0, 10), '2026-10-12');
  assert.equal(newsDate('3 de noviembre de 2026', NOW)?.toISOString().slice(0, 10), '2026-11-03');
  assert.equal(newsDate('Oct 12, 2026', NOW)?.toISOString().slice(0, 10), '2026-10-12');
  assert.equal(newsDate('ayer por la tarde', NOW), null);
  assert.equal(newsDate(null, NOW), null);
});

test('the brief: five lines from what the web says, with the news\' date and source as the search gave them', async () => {
  const searches: any[] = [];
  const search = async (request: any) => {
    searches.push(request);
    return { items: request.kind === 'organic'
      ? [item('Minera Andina | LinkedIn', 'https://cl.linkedin.com/company/minera-andina', 'Minera Andina produce cobre.'), item('Minera Andina', 'https://www.mineraandina.cl/', 'Minera Andina opera dos faenas de cobre en Antofagasta.'), item('Recetas andinas', 'https://recetas.example/andinas', 'Cocina del altiplano.')]
      : [item('Minera Andina invertirá en una nueva planta concentradora', 'https://diario.example/andina-planta', 'La empresa anunció la obra para 2027.', { source: 'Diario Financiero', date: 'hace 3 días' }),
        item('Minera Andina cierra balance', 'https://diario.example/andina-2019', 'Resultados.', { source: 'El Diario', date: '12 mar 2019' }),
        item('Cumbre andina de turismo', 'https://diario.example/turismo', 'Los países de la región se reunieron.', { source: 'Otro', date: 'hace 1 día' })] };
  };
  const pages: string[] = [];
  const home = async (domain: string) => { pages.push(domain); return { title: 'Minera Andina', description: 'Cobre del norte de Chile', text: 'Operamos las faenas Andina Norte y Andina Sur, con 1.800 trabajadores.' }; };
  const prompts: any[] = [];
  const generate = async (options: any) => {
    prompts.push({ system: options.systemPrompt, prompt: JSON.parse(options.prompt), model: options.openAiModel });
    return { empresa: 'Produce cobre en dos faenas de Antofagasta, con 1.800 trabajadores.', novedad: { n: 0, texto: 'Anunció una nueva planta concentradora para 2027.' },
      porque: 'Una planta nueva suma áreas con riesgo de incendio que hoy no tienen protección.', cargo: 'Responde por la seguridad de las faenas y por cumplir ante la autoridad.',
      apertura: 'Pregúntale cómo están pensando la protección contra incendios de la nueva planta, que reduce un 40% los siniestros.' };
  };
  const found = await researchDropContact({ organizationId: 'org-1', contact, seller }, { generate, now: NOW, search: search as any, home });
  assert.deepEqual(searches.map(call => [call.kind, call.query, call.countryCode]), [['organic', 'Minera Andina empresa', 'cl'], ['news', '"Minera Andina"', 'cl']]);
  assert.deepEqual(pages, ['mineraandina.cl']);
  assert.equal(found?.domain, 'mineraandina.cl');
  assert.deepEqual(found?.brief, {
    company: 'Produce cobre en dos faenas de Antofagasta, con 1.800 trabajadores.',
    news: { text: 'Anunció una nueva planta concentradora para 2027.', date: '9 nov 2026', source: 'Diario Financiero', url: 'https://diario.example/andina-planta' },
    fit: 'Una planta nueva suma áreas con riesgo de incendio que hoy no tienen protección.',
    role: 'Responde por la seguridad de las faenas y por cumplir ante la autoridad.',
    opener: null,
  }, 'the opening had a figure nobody gave (40%): it is left out');
  assert.equal(briefNewsLine(found!.brief.news!), 'Anunció una nueva planta concentradora para 2027 (Diario Financiero, 9 nov 2026).');
  const [{ prompt, model }] = prompts;
  assert.equal(model, 'claude-haiku-5-5');
  assert.deepEqual(prompt.noticias.map((entry: any) => [entry.n, entry.medio, entry.fecha]), [[0, 'Diario Financiero', '9 nov 2026']], 'not the one of 2019, nor the one about something else');
  assert.deepEqual(prompt.resultados.map((entry: any) => entry.titulo), ['Minera Andina | LinkedIn', 'Minera Andina']);
  assert.equal(prompt.vendedor.oferta, 'Sistemas contra incendios para faenas mineras.');
  assert.deepEqual(prompt.contacto, { cargo: 'Gerente HSE', empresa: 'Minera Andina S.A.', rubro: null });
});

test('nothing found, or the model down: no brief, and never an error', async () => {
  const empty = async () => ({ items: [] });
  let asked = 0;
  const generate = async () => { asked++; return {}; };
  assert.equal(await researchDropContact({ organizationId: 'org-1', contact, seller }, { generate, now: NOW, search: empty as any, home: async () => null }), null);
  assert.equal(asked, 0, 'without evidence the model is not asked');
  assert.equal(await researchDropContact({ organizationId: 'org-1', contact: { title: 'Gerente', company: null }, seller }, { generate, now: NOW, search: empty as any }), null);
  const failing = async () => { throw new Error('down'); };
  const some = async () => ({ items: [item('Minera Andina', 'https://www.mineraandina.cl/', 'Minera Andina opera dos faenas.')] });
  assert.equal(await researchDropContact({ organizationId: 'org-1', contact, seller }, { generate: failing, now: NOW, search: some as any, home: failing as any }), null);
  assert.equal(await researchDropContact({ organizationId: 'org-1', contact, seller }, { generate, now: NOW, search: failing as any, home: failing as any }), null);
});

test('without what the team sells, only what the company does and what is happening there', async () => {
  const search = async (request: any) => ({ items: request.kind === 'organic' ? [item('Minera Andina', 'https://www.mineraandina.cl/', 'Minera Andina opera dos faenas.')] : [] });
  const generate = async () => ({ empresa: 'Opera dos faenas de cobre.', novedad: null, porque: 'Le sirve.', cargo: 'Le importa.', apertura: 'Pregunta.' });
  const found = await researchDropContact({ organizationId: 'org-1', contact, seller: null }, { generate, now: NOW, search: search as any, home: async () => null });
  assert.deepEqual(found?.brief, { company: 'Opera dos faenas de cobre.', news: null, fit: null, role: null, opener: null });
});

test('the brief says what is known: what the model says of its own sources is left out, and the prompt asks it not to', async () => {
  const search = async (request: any) => ({ items: request.kind === 'organic' ? [item('Minera Andina', 'https://www.mineraandina.cl/', 'Minera Andina procesa cobre.')] : [] });
  let asked = '';
  const generate = async (options: any) => {
    asked = options.systemPrompt;
    return { empresa: 'Minera Andina procesa cobre; no hay evidencia disponible sobre dónde opera.', novedad: null,
      porque: 'Sus faenas necesitan detección y extinción de incendios, aunque la evidencia no detalla sus riesgos.',
      cargo: 'No se especifica de qué responde.', apertura: 'Pregúntale cómo protegen hoy sus faenas.' };
  };
  const found = await researchDropContact({ organizationId: 'org-1', contact, seller }, { generate, now: NOW, search: search as any, home: async () => null });
  assert.deepEqual(found?.brief, { company: 'Minera Andina procesa cobre.', news: null, fit: 'Sus faenas necesitan detección y extinción de incendios.', role: null,
    opener: 'Pregúntale cómo protegen hoy sus faenas.' });
  assert.match(asked, /nunca hables de la evidencia, de lo que falta ni de lo que no/);
});
