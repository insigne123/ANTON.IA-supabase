import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// PR-4c: the panel reads the people a LinkedIn search shows, to save the chosen ones. Only what is on screen.
const helpers = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const content = await readFile(new URL('../prospecting-content.js', import.meta.url), 'utf8');

function read(html, url = 'https://www.linkedin.com/search/results/people/?keywords=rrhh') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  let handler;
  w.chrome = { runtime: { id: 'ext', onMessage: { addListener: fn => { handler = fn; } }, sendMessage: () => Promise.resolve({ ok: true, result: {} }) } };
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
  w.eval(helpers); w.eval(content);
  let answer;
  handler({ action: 'PROSPECT_READ_RESULTS' }, { id: 'ext' }, value => { answer = value; });
  w.close();
  return JSON.parse(JSON.stringify(answer));
}

test('each visible person with name, headline, and title and company when the headline says them', () => {
  const answer = read(`<main><ul>
    <li><div><a href="https://www.linkedin.com/in/ana-perez"><span aria-hidden="true">Ana Pérez</span><span class="visually-hidden">Ver el perfil de Ana Pérez</span></a><span>• 2º</span></div>
      <div class="entity-result__primary-subtitle">Gerente de Personas en Acme</div><div class="entity-result__secondary-subtitle">Santiago, Chile</div><button>Conectar</button></li>
    <li><a href="/in/bruno"><span aria-hidden="true">Bruno Díaz</span></a><div class="entity-result__primary-subtitle">Head of Operations at Logística Sur</div></li>
    <li><a href="/in/carla">Carla Soto</a><p>Analista de selección</p></li>
    <li><a href="/company/acme">Acme</a><p>Empresa</p></li>
  </ul></main>`);
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.results, [
    { linkedinUrl: 'https://www.linkedin.com/in/ana-perez', fullName: 'Ana Pérez', headline: 'Gerente de Personas en Acme', title: 'Gerente de Personas', companyName: 'Acme' },
    { linkedinUrl: 'https://www.linkedin.com/in/bruno', fullName: 'Bruno Díaz', headline: 'Head of Operations at Logística Sur', title: 'Head of Operations', companyName: 'Logística Sur' },
    { linkedinUrl: 'https://www.linkedin.com/in/carla', fullName: 'Carla Soto', headline: 'Analista de selección', title: 'Analista de selección', companyName: '' },
  ]);
});

test('outside a results page there is nobody to read, and a page shows at most 50', () => {
  assert.deepEqual(read('<main><ul><li><a href="/in/ana">Ana</a></li></ul></main>', 'https://www.linkedin.com/feed/').results, []);
  const many = Array.from({ length: 60 }, (_, index) => `<li><a href="/in/p${index}">Persona ${index}</a></li>`).join('');
  assert.equal(read(`<main><ul>${many}</ul></main>`).results.length, 50);
});
