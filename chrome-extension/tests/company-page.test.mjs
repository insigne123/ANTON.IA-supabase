import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { companyFacts, companyRequest, contactsHeading, emptyCompanyText } from '../ui/company-card.ts';

// PR-4d: the panel reads the LinkedIn company page on screen, and on its «Personas» tab the people it shows, like a search.
const helpers = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const content = await readFile(new URL('../prospecting-content.js', import.meta.url), 'utf8');

function ask(html, url, action) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  let handler;
  w.chrome = { runtime: { id: 'ext', onMessage: { addListener: fn => { handler = fn; } }, sendMessage: () => Promise.resolve({ ok: true, result: {} }) } };
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
  w.eval(helpers); w.eval(content);
  let answer;
  handler({ action }, { id: 'ext' }, value => { answer = value; });
  w.close();
  return JSON.parse(JSON.stringify(answer));
}

const header = `<h1>Minera Norte S.A.</h1>
  <div class="org-top-card-summary-info-list">
    <div class="org-top-card-summary-info-list__info-item">Minería</div>
    <div class="inline-block"><div class="org-top-card-summary-info-list__info-item">Antofagasta, Antofagasta</div>
      <div class="org-top-card-summary-info-list__info-item">12 mil seguidores</div>
      <div class="org-top-card-summary-info-list__info-item">1.001-5.000 empleados</div></div>
  </div>
  <a href="https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fwww.mineranorte.cl%2F&urlhash=x" aria-label="Visitar sitio web">Visitar sitio web</a>`;

test('the company page: its handle, name, the facts of its header and its own site, unwrapped from LinkedIn', () => {
  const answer = ask(`<main>${header}</main>`, 'https://www.linkedin.com/company/Minera-Norte/', 'PROSPECT_READ_COMPANY');
  assert.deepEqual(answer.company, { linkedinUrl: 'https://www.linkedin.com/company/minera-norte', name: 'Minera Norte S.A.', industry: 'Minería',
    headquarters: 'Antofagasta, Antofagasta', size: '1.001-5.000 empleados', website: 'https://www.mineranorte.cl/' });
});

test('its «Acerca de» tab says the same with its own words; outside a company page there is no company', () => {
  const about = `<main><h1>Minera Norte S.A.</h1><dl>
    <dt>Sitio web</dt><dd><a href="https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fmineranorte.cl">https://mineranorte.cl</a></dd>
    <dt>Sector</dt><dd>Minería</dd>
    <dt>Tamaño de la empresa</dt><dd><span>1.001-5.000 empleados</span><span>2.345 en LinkedIn</span></dd>
    <dt>Sede</dt><dd>Antofagasta</dd></dl></main>`;
  const company = ask(about, 'https://www.linkedin.com/company/minera-norte/about/', 'PROSPECT_READ_COMPANY').company;
  assert.deepEqual([company.industry, company.size, company.headquarters, company.website],
    ['Minería', '1.001-5.000 empleados', 'Antofagasta', 'https://mineranorte.cl']);
  assert.equal(ask(about, 'https://www.linkedin.com/in/ana/', 'PROSPECT_READ_COMPANY').company, null);
});

test('its «Personas» tab is read like a search, and the company is the page’s when the headline does not say it', () => {
  const people = `<main>${header}<ul>
    <li><a href="https://www.linkedin.com/in/ana-rojas"><div class="artdeco-entity-lockup__title">Ana Rojas</div></a>
      <div class="artdeco-entity-lockup__subtitle">Jefa de Operaciones</div></li>
    <li><a href="/in/luis-soto">Luis Soto</a><div class="artdeco-entity-lockup__subtitle">Gerente de Personas en Minera Norte</div></li>
  </ul></main>`;
  assert.deepEqual(ask(people, 'https://www.linkedin.com/company/minera-norte/people/', 'PROSPECT_READ_RESULTS').results, [
    { linkedinUrl: 'https://www.linkedin.com/in/ana-rojas', fullName: 'Ana Rojas', headline: 'Jefa de Operaciones', title: 'Jefa de Operaciones', companyName: 'Minera Norte S.A.' },
    { linkedinUrl: 'https://www.linkedin.com/in/luis-soto', fullName: 'Luis Soto', headline: 'Gerente de Personas en Minera Norte', title: 'Gerente de Personas', companyName: 'Minera Norte' },
  ]);
  // The company's home tab shows no list of people to choose from.
  assert.deepEqual(ask(people, 'https://www.linkedin.com/company/minera-norte/', 'PROSPECT_READ_RESULTS').results, []);
});

test('the card: the facts in one line, the request once the name is on screen, and plain words for the contacts', () => {
  const page = { linkedinUrl: 'https://www.linkedin.com/company/minera-norte', name: 'Minera Norte', industry: 'Minería', size: '1.001-5.000 empleados', website: 'https://mineranorte.cl' };
  assert.equal(companyFacts(page), 'Minería · 1.001-5.000 empleados');
  assert.equal(companyRequest({ ...page, name: '' }), null);
  assert.deepEqual(companyRequest(page), { linkedinUrl: page.linkedinUrl, name: 'Minera Norte', domain: 'https://mineranorte.cl', industry: 'Minería', size: '1.001-5.000 empleados', headquarters: '' });
  assert.equal(contactsHeading({ contacts: [], total: 0, truncated: false }), 'Sin contactos guardados');
  assert.equal(contactsHeading({ contacts: [{}], total: 1, truncated: false }), '1 contacto guardado');
  assert.equal(contactsHeading({ contacts: Array(20).fill({}), total: 34, truncated: false }), '34 contactos guardados · se muestran 20');
  assert.match(emptyCompanyText(page), /^Todavía no tienes contactos de Minera Norte\. Busca a sus decisores/);
  assert.match(emptyCompanyText({ ...page, people: true }), /Elige abajo a quienes ves en LinkedIn/);
});
