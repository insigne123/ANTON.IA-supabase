import assert from 'node:assert/strict';
import test from 'node:test';
import { briefReportV2Specialists } from './report-v2-specialists';

test('three distinct specialties share one Luna request and count its telemetry once even without web claims', async () => {
  const calls: any[] = [];
  let active = 0;
  let peak = 0;
  const result = await briefReportV2Specialists({ entity: { contact: { title: 'Directora de Finanzas' } }, claims: [], sellerProfile: { companyName: 'Example', products: [{ key: 'accounting' }] } } as any, {
    generate: (async (options: any) => {
      calls.push(options);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      const brief = { observations: [{ text: 'Una directora financiera puede priorizar el control del cierre.', basis: 'analysis', claimIds: [] }], opportunities: [], questions: [] };
      return { data: { company: brief, contact: brief, sector: brief }, telemetry: { modelName: options.openAiModels[0], durationMs: 1 } };
    }) as any,
  });
  assert.equal(calls.length, 1);
  assert.equal(peak, 1);
  for (const specialty of ['company', 'contact', 'sector']) assert.ok(calls[0].prompt.includes(`${specialty}:`));
  assert.equal(new Set(calls.map((call) => call.prompt.split('\n').slice(0, 4).join('\n'))).size, 1);
  assert.ok(calls.every((call) => call.prompt.includes('Directora de Finanzas') && call.prompt.includes('accounting')));
  assert.ok(calls.every((call) => call.allowDefaultModelFallback === false && call.maxOutputTokens === 7500));
  calls.forEach((call) => assert.deepEqual(call.openAiModels, ['gpt-5.6-luna']));
  assert.equal(result.filter((item) => item.brief?.observations.length).length, 3);
  assert.equal(result.filter((item) => item.telemetry).length, 1);
  assert.match(calls[0].prompt, /Para Finanzas\/CFO prioriza facturacion, cobranza, cierre y excepciones/);
  assert.match(calls[0].prompt, /Para Reclutamiento prioriza candidatos, entrevistas y expedientes/);
  assert.match(calls[0].prompt, /metrica observable propia y pregunta de validacion/);
  assert.match(calls[0].prompt, /sin afirmar que el proceso, problema o sistema exista/);
  assert.doesNotMatch(calls[0].prompt, /distintos a los que plantearias a un director financiero/);
  assert.match(calls[0].schema.shape.contact.shape.opportunities.element.description, /metrica observable propia/);
});

test('invalid source citations are filtered independently in every block', async () => {
  const result = await briefReportV2Specialists({ entity: {}, claims: [], sellerProfile: { products: [] } } as any, {
    generate: (async () => {
      const brief = { observations: [{ text: 'Invented current size.', basis: 'source', claimIds: ['c99'] }, { text: 'Uncited fact.', basis: 'source', claimIds: [] }], opportunities: [], questions: [] };
      return { data: { company: brief, contact: brief, sector: brief }, telemetry: { modelName: 'gpt-5.6-luna', durationMs: 1 } };
    }) as any,
  });
  assert.equal(result.filter((item) => item.error).length, 0);
  assert.ok(result.every((item) => !item.brief?.observations.length));
});

test('failure or incomplete fused response degrades all briefs without model escalation', async () => {
  for (const fail of [true, false]) {
    let calls = 0;
    const result = await briefReportV2Specialists({ entity: {}, claims: [], sellerProfile: { products: [] } } as any, {
      generate: (async () => {
        calls++;
        if (fail) throw new Error('timeout');
        return { data: { company: { observations: [], opportunities: [], questions: [] } }, telemetry: {} };
      }) as any,
    });
    assert.equal(calls, 1);
    assert.equal(result.length, 3);
    assert.ok(result.every((item) => item.error && item.brief === null && item.telemetry === null));
  }
});

test('valid evidence and uncited role analysis survive in separate blocks', async () => {
  const result = await briefReportV2Specialists({ entity: {}, claims: [{ id: 'c01' }], sellerProfile: { products: [] } } as any, {
    generate: (async () => {
      const brief = { observations: [{ text: 'Sourced.', basis: 'source', claimIds: ['c01'] }, { text: 'Role hypothesis.', basis: 'analysis', claimIds: [] }], opportunities: [], questions: [] };
      return { data: { company: brief, contact: brief, sector: brief }, telemetry: {} };
    }) as any,
  });
  assert.ok(result.every((item) => item.brief?.observations.length === 2));
});
