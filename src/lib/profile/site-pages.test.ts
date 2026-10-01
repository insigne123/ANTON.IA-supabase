import test from 'node:test';
import assert from 'node:assert/strict';

import { countryLandingUrl, profilePageCandidates, readableProfilePage } from './site-pages';

const SELECTOR = `<html><head><title>GrupoExpro | Selecciona tu país</title></head><body>
  <a href="https://grupoexpro.com/chile/">INGRESAR</a><a href="https://grupoexpro.com/peru/">INGRESAR</a>
  <a href="https://otra.com/chile/">Otra</a></body></html>`;

test('a home page that only asks for the country leads to the country page', () => {
  assert.equal(countryLandingUrl(SELECTOR, new URL('https://grupoexpro.com/'), 'grupoexpro.com', 'Chile'), 'https://grupoexpro.com/chile/');
  assert.equal(countryLandingUrl(SELECTOR, new URL('https://grupoexpro.com/'), 'grupoexpro.com', 'Perú'), 'https://grupoexpro.com/peru/');
  assert.equal(countryLandingUrl('<a href="/cl">Chile</a>', new URL('https://www.fintoc.com/'), 'fintoc.com'), 'https://www.fintoc.com/cl');
  assert.equal(countryLandingUrl('<a href="/precios">Precios</a>', new URL('https://acme.cl/'), 'acme.cl'), null);
});

const COUNTRY = `<nav>menu</nav>
  <a href="/quienes-somos/">Quiénes Somos</a>
  <a href="/certificacion">Certificaciones</a>
  <a href="/portfolio/servicios-transitorios/">Servicios Transitorios</a>
  <a href="/portfolio/outsourcing/">Outsourcing</a>
  <a href="/portfolio/seleccion/">Selección</a>
  <a href="/portfolio/nomina/">Nómina</a>
  <a href="/portfolio/facility/">Facility</a>
  <a href="/blog/">Blog</a><a href="/contacto-chile/">Contacto</a><a href="/trabaja-con-nosotros/">Trabaja con nosotros</a>
  <a href="https://www.trabajaya.cl/">Postula</a><a href="mailto:comercial@acme.cl">Correo</a>
  <a href="/category/noticias/">Noticias</a><a href="/servicios/#top">Servicios (ancla)</a>`;

test('offer, company and proof pages are read first; news, jobs, contact and other domains never', () => {
  const pages = profilePageCandidates({
    pages: [{ html: COUNTRY, url: 'https://grupoexpro.com/chile/' }],
    domain: 'grupoexpro.com',
    exclude: ['https://grupoexpro.com/chile/'],
    limit: 8,
  });
  assert.deepEqual(pages.slice(0, 2), ['https://grupoexpro.com/quienes-somos', 'https://grupoexpro.com/certificacion'],
    'one company page and one proof page are reserved before the offer pages');
  assert.equal(pages.filter((url) => url.includes('/portfolio/')).length, 4, 'at most four pages from the same section');
  assert.equal(pages.length, 7, 'the fifth portfolio page waits: the limit is not filled with more of the same');
  assert.ok(pages.includes('https://grupoexpro.com/servicios'), 'the anchor is dropped, the page is kept');
  for (const url of pages) assert.doesNotMatch(url, /blog|contacto|trabaja|noticias|trabajaya|mailto/);
});

test('a page is read as a visitor sees it: no scripts, menus, links or code, entities decoded', () => {
  const html = `<html><head><title>PSOL | Test Psicolaborales Online</title>
    <meta name="description" content="Evaluaciones psicolaborales online r&aacute;pidas y confiables.">
    <script>var x = 1;</script><style>.a{}</style></head><body>
    <nav>Inicio Soy Postulante</nav>
    <h1>Selecciona al talento ideal</h1>
    <p>Entregamos informes de competencias &amp; personalidad.</p>
    <p>https://psol-latam.com/wp-content/uploads/video.mp4</p>
    <div>';$carousel+='';</div>
    <footer>Privacidad</footer></body></html>`;
  const page = readableProfilePage('https://psol-latam.com/', html);
  assert.equal(page.title, 'PSOL | Test Psicolaborales Online');
  assert.match(page.description || '', /^Evaluaciones psicolaborales online/);
  assert.match(page.text, /Selecciona al talento ideal\. Entregamos informes de competencias & personalidad\./);
  assert.doesNotMatch(page.text, /var x|Soy Postulante|Privacidad|wp-content|carousel/);
});
