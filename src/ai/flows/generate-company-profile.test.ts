import test from 'node:test';
import assert from 'node:assert/strict';

import { generateCompanyProfile } from './generate-company-profile';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

test('company profile generation requires tenant scope', async () => {
  await assert.rejects(
    generateCompanyProfile({ companyName: 'Acme' } as any, {
      findEvidence: async () => { throw new Error('must not run without scope'); },
      generate: async () => { throw new Error('must not run without scope'); },
    }),
  );
});

test('company profile generation grounds the model and preserves the supplied website', async () => {
  const seen: Array<{ companyName: string; domain?: string; organizationId?: string }> = [];
  const output = await generateCompanyProfile(
    { companyName: 'Acme', website: 'https://www.acme.cl/nosotros/', organizationId: ORGANIZATION_ID },
    {
      findEvidence: async (input) => {
        seen.push(input);
        return [{ title: 'Acme', link: 'https://acme.cl/', snippet: 'Acme presta servicios.', source: 'acme.cl', official: true }];
      },
      generate: async ({ prompt }) => {
        assert.match(prompt, /acme\.cl/);
        assert.match(prompt, /official/);
        return {
          sector: 'Servicios B2B',
          website: 'https://otra.cl/',
          domain: 'otra.cl',
          description: 'Acme presta servicios.',
          services: 'Soporte, consultoria',
          valueProposition: 'Operacion continua.',
        };
      },
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].domain, 'acme.cl');
  assert.equal(seen[0].organizationId, ORGANIZATION_ID);
  assert.equal(output.website, 'https://acme.cl/nosotros');
  assert.equal(output.domain, 'acme.cl');
  assert.equal(output.sector, 'Servicios B2B');
  assert.equal(output.services, 'Soporte, consultoria');
});

test('company profile generation rejects invalid websites before any provider call', async () => {
  await assert.rejects(
    generateCompanyProfile(
      { companyName: 'Acme', website: 'not a domain', organizationId: ORGANIZATION_ID },
      { findEvidence: async () => { throw new Error('must not run'); } },
    ),
  );
});
