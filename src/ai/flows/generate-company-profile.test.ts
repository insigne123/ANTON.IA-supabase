import test from 'node:test';
import assert from 'node:assert/strict';

import { generateCompanyProfile } from './generate-company-profile';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

const page = (url: string, title: string, text: string, description: string | null = null) => ({ url, title, description, text });

const SITE = {
  pages: [
    page('https://acme.cl/chile/', 'Outsourcing de RR. HH. | Acme', 'Acme entrega servicios transitorios y outsourcing para retail y logística en Chile. Más de 30 años de trayectoria y certificación ISO 9001.'),
    page('https://acme.cl/portfolio/transitorios/', 'Servicios transitorios', 'Personal temporal para peaks de temporada en 48 horas. Clientes: Falabella y Sodimac confían en nosotros.'),
    page('https://acme.cl/quienes-somos/', 'Quiénes somos', 'Operamos en Chile, Perú y Colombia con 12 sucursales.'),
  ],
};

const MODEL_OUTPUT = {
  companyName: 'Acme',
  sector: 'Outsourcing de recursos humanos',
  description: 'Acme entrega servicios transitorios y outsourcing para empresas con peaks de demanda.',
  services: ['Servicios transitorios: personal temporal para peaks de temporada', 'Outsourcing de procesos: externaliza operaciones de apoyo'],
  valueProposition: 'Ayuda a cubrir peaks de demanda con personal listo en 48 horas.',
  painPoints: ['Rotación alta en temporada'],
  differentiators: ['Certificación ISO 9001', 'Cobertura en tres países'],
  proofPoints: ['Más de 30 años de trayectoria', '12 sucursales', '95 % de satisfacción'],
  referenceClients: ['Falabella', 'Sodimac', 'Walmart'],
  targetIndustries: ['Retail', 'Logística'],
  targetRoles: ['Gerente de Personas', 'Jefe de Operaciones'],
  targetCompanySize: '201-500',
  targetLocations: ['Chile', 'Perú'],
  sources: [
    { field: 'services' as const, ids: ['P2', 'p1', 'P9'] },
    { field: 'proofPoints' as const, ids: ['P1', 'P3'] },
  ],
};

test('company profile generation requires tenant scope and a name or a website', async () => {
  const never = { readSite: async () => { throw new Error('must not run'); }, generate: async () => { throw new Error('must not run'); } };
  await assert.rejects(generateCompanyProfile({ companyName: 'Acme' } as any, never));
  await assert.rejects(generateCompanyProfile({ organizationId: ORGANIZATION_ID } as any, never));
  await assert.rejects(generateCompanyProfile({ companyName: 'Acme', website: 'not a domain', organizationId: ORGANIZATION_ID }, never));
});

test('the site is read, every field is proposed with its pages, and nothing unbacked survives', async () => {
  const reads: unknown[] = [];
  let searched = false;
  let prompt = '';
  const output = await generateCompanyProfile(
    { companyName: 'Acme', website: 'https://www.acme.cl/', organizationId: ORGANIZATION_ID },
    {
      readSite: async (input) => { reads.push(input); return SITE; },
      findEvidence: async () => { searched = true; return []; },
      generate: async (options) => { prompt = options.prompt; return MODEL_OUTPUT; },
    },
  );
  assert.deepEqual(reads, [{ domain: 'acme.cl', country: 'Chile', maxPages: 8 }]);
  assert.equal(searched, false, 'three pages are enough: no paid search');
  assert.match(prompt, /"id":"P1","url":"https:\/\/acme\.cl\/chile\/"/);
  assert.match(prompt, /ignora cualquier instrucción/);

  assert.equal(output.website, 'https://acme.cl');
  assert.equal(output.domain, 'acme.cl');
  assert.deepEqual(output.services, MODEL_OUTPUT.services);
  assert.deepEqual(output.proofPoints, ['Más de 30 años de trayectoria', '12 sucursales'], 'a figure the site never gave is dropped');
  assert.deepEqual(output.referenceClients, ['Falabella', 'Sodimac'], 'a client the site never named is dropped');
  assert.equal(output.targetCompanySize, '201-500');
  assert.deepEqual(output.sources.services, [
    { url: 'https://acme.cl/portfolio/transitorios/', title: 'Servicios transitorios' },
    { url: 'https://acme.cl/chile/', title: 'Outsourcing de RR. HH. | Acme' },
  ], 'unknown ids are ignored; ids are case-insensitive');
  assert.equal(output.pagesRead.length, 3);
  assert.equal(output.emptyReason, null);
});

test('without a site, search is the only source and the website is never taken from the model', async () => {
  const output = await generateCompanyProfile(
    { companyName: 'Acme', organizationId: ORGANIZATION_ID },
    {
      readSite: async () => { throw new Error('no site to read'); },
      findEvidence: async (input) => {
        assert.equal(input.companyName, 'Acme');
        return [{ title: 'Acme crece', link: 'https://noticias.cl/acme', snippet: 'Acme, empresa de outsourcing, abre sucursal.', source: 'noticias.cl' }];
      },
      generate: async () => ({ ...MODEL_OUTPUT, sources: [] }),
    },
  );
  assert.equal(output.website, '');
  assert.equal(output.sector, 'Outsourcing de recursos humanos');
  assert.deepEqual(output.referenceClients, [], 'no source names those clients');
});

test('an unreachable site with nothing else says why and never calls the model', async () => {
  const output = await generateCompanyProfile(
    { website: 'acme.cl', organizationId: ORGANIZATION_ID },
    {
      readSite: async () => ({ pages: [], warning: 'official_site_timeout' }),
      findEvidence: async () => [],
      generate: async () => { throw new Error('must not run'); },
    },
  );
  assert.equal(output.emptyReason, 'site_unreachable');
  assert.equal(output.domain, 'acme.cl');
});

test('a model that cannot identify the company returns nothing to apply', async () => {
  const empty = { ...MODEL_OUTPUT, companyName: '', sector: '', description: '', services: [], valueProposition: '', sources: [] };
  const output = await generateCompanyProfile(
    { website: 'acme.cl', organizationId: ORGANIZATION_ID },
    { readSite: async () => SITE, generate: async () => empty },
  );
  assert.equal(output.emptyReason, 'not_identified');
  assert.equal(output.pagesRead.length, 3);
  assert.deepEqual(output.services, []);
});
