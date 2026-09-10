import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { parseWebEvidenceV2 } from '@/lib/report-v2-extraction';
import { resolveEntityV2, RESOLVE_ENTITY_V2_SYSTEM_PROMPT } from './resolve-entity';

const golden = JSON.parse(readFileSync('test/fixtures/grupoexpro.golden.json', 'utf8'));
const provider = JSON.parse(readFileSync('test/fixtures/grupoexpro/provider-context.json', 'utf8'));

test('P1 keeps provider context non-probatory and deterministically corrects country and seniority', async () => {
  const source = parseWebEvidenceV2({
    html: readFileSync('test/fixtures/grupoexpro/peru.html', 'utf8'),
    url: 'https://grupoexpro.com/peru/quienes-somos/',
    targetDomain: golden.domain,
    retrievedAt: golden.capturedAt,
    jurisdiction: 'PE',
  });
  let captured: any = null;
  const result = await resolveEntityV2({
    contact: provider.contact,
    domain: golden.domain,
    sources: [source],
    today: '2026-09-08',
  }, {
    generate: async (options: any) => {
      captured = options;
      return {
        companyName: 'GrupoExpro',
        companyDomain: 'grupoexpro.com',
        contactCountry: 'CL',
        operatingCountries: ['CL'],
        countryScopedPaths: [{ country: 'CL', path: '/chile/' }],
        excludedPaths: ['/peru/'],
        contact: {
          fullName: provider.contact.fullName,
          title: provider.contact.title,
          seniority: 'manager',
          department: provider.contact.department,
          tenureMonths: null,
          companyTenureMonths: null,
          linkedinUrl: provider.contact.linkedin,
        },
        ambiguities: [],
      };
    },
  });

  assert.equal(captured.provider, 'openai');
  assert.equal(captured.systemPrompt, RESOLVE_ENTITY_V2_SYSTEM_PROMPT);
  assert.match(captured.prompt, /datos de proveedor, no evidencia/);
  assert.match(captured.prompt, /Coordinador.*SIEMPRE coordinator/);
  const schema = zodToJsonSchema(captured.schema, { target: 'openAi', $refStrategy: 'none' }) as any;
  assert.equal(schema.properties.countryScopedPaths.type, 'array');
  assert.equal(schema.properties.countryScopedPaths.items.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  assert.equal(result.contactCountry, 'PE');
  assert.equal(result.countryScopedPaths.CL, '/chile/');
  assert.equal(result.countryScopedPaths.PE, '/peru/');
  assert.equal(result.contact.seniority, 'coordinator');
  assert.equal(result.contact.title, golden.contact.title);
  assert.ok(result.excludedPaths.includes('/chile/'));
  assert.ok(!result.excludedPaths.includes('/peru/'));
});
