import assert from 'node:assert/strict';
import test from 'node:test';
import { selectReportV2EditorClaims, writeReportV2 } from './write-report-v2';
import { serializeReportV2Context } from './write-report-v2-section';

test('editor permits profile and commercial reasoning without decorative citations and bounds model selection', async () => {
  const result = await writeReportV2({ entity: { contact: { title: 'Coordinador de Seleccion' } }, analysis: {}, claims: [], sellerProfile: { products: [] }, language: 'es' } as any, {
    generate: (async (options: any) => {
      assert.deepEqual(options.openAiModels, ['gpt-5.6-luna']);
      assert.equal(options.allowDefaultModelFallback, false);
      assert.match(options.prompt, /Coordinador de Seleccion/);
      return { data: { sections: [{ key: 'contact', title: 'Contacto', paragraphs: [{ text: 'Por su cargo, conviene explorar la coordinacion de entrevistas.', claimIds: [], context: 'target', basis: 'analysis' }] }] }, telemetry: { modelName: 'gpt-5.6-terra', durationMs: 1 } };
    }) as any,
  });
  assert.equal(result.sections[0].paragraphs[0].basis, 'analysis');
});

test('editor selection retains all reference surfaces, signal links, factual backbone and transitive derivations', () => {
  const claims = Array.from({ length: 12 }, (_, i) => ({ id: `c${String(i + 1).padStart(2, '0')}`, type: 'fact', dimension: 'company_size', statement: `Claim ${i}` })) as any[];
  claims[0] = { ...claims[0], type: 'derived', inputs: ['c02'], assumptions: [{ rationale: 'Keep assumptions' }], formula: 'x * 2' };
  claims[1] = { ...claims[1], type: 'derived', inputs: ['c03'] };
  claims[9].dimension = 'company_service';
  const analysis = { fitByProduct: [{ claimIds: ['c01'], headquartersContextClaimIds: ['c04'] }], buyingCommittee: [{ claimIds: ['c05'] }], volumeModel: { baseClaimId: 'c06' }, discoveryQuestions: [{ validatesClaimId: 'c07' }], objections: [{ derivedFrom: ['c08'] }], riskClaimIds: ['c09'], signalIds: ['sig_1234567890'] } as any;
  const selected = selectReportV2EditorClaims(analysis, claims, [{ id: 'sig_1234567890', claimId: 'c11' }] as any);
  assert.deepEqual(selected.map((claim) => claim.id), claims.slice(0, 11).map((claim) => claim.id));
  assert.equal(selected[0], claims[0]);
  assert.equal(claims.length, 12);
});

test('selection conservatively retains full evidence on absent or unresolved references and handles cycles', () => {
  const claims = [{ id: 'c01', type: 'derived', inputs: ['c02'] }, { id: 'c02', type: 'derived', inputs: ['c01'] }, { id: 'c03', type: 'fact' }] as any;
  for (const analysis of [{}, { riskClaimIds: ['c99'] }, { signalIds: ['sig_1234567890'] }]) {
    assert.equal(selectReportV2EditorClaims(analysis as any, claims), claims);
  }
  assert.deepEqual(selectReportV2EditorClaims({ riskClaimIds: ['c01'] } as any, claims), claims.slice(0, 2));
  assert.equal(selectReportV2EditorClaims({ riskClaimIds: ['c01'] } as any, [{ id: 'c01', type: 'derived', inputs: ['c99'] }] as any).length, 1);
});

test('initial editor cannot cite omitted claims; repair receives and can cite the full graph', async () => {
  const claims = [{ id: 'c01', type: 'fact', dimension: 'company_size', statement: 'Selected' }, { id: 'c02', type: 'fact', dimension: 'company_size', statement: 'Alternative' }] as any;
  const input = { entity: {}, analysis: { riskClaimIds: ['c01'] }, claims, sellerProfile: { products: [] }, language: 'es' } as any;
  for (const repair of [undefined, { sections: [], issues: [{ claimId: 'c02' }] }]) {
    const generate = (async (options: any) => {
      assert.ok(options.prompt.includes(serializeReportV2Context(repair ? claims : claims.slice(0, 1))));
      return { data: { sections: [{ key: 'company', title: 'Company', paragraphs: [{ text: 'Alternative', basis: 'source', claimIds: ['c02'], context: 'target' }] }] }, telemetry: { modelName: 'gpt-5.6-luna' } };
    }) as any;
    if (repair) assert.equal((await writeReportV2({ ...input, repair }, { generate })).sections[0].paragraphs[0].claimIds[0], 'c02');
    else await assert.rejects(writeReportV2(input, { generate }), /INVALID_CITATION/);
  }
});

test('editor rejects unsupported factual references rather than stripping their provenance', async () => {
  for (const claimIds of [[], ['c99']]) {
    await assert.rejects(writeReportV2({ entity: {}, analysis: {}, claims: [], sellerProfile: { products: [] }, language: 'es' } as any, {
      generate: (async () => ({ data: { sections: [{ key: 'company', title: 'Company', paragraphs: [{ text: 'Invented fact.', claimIds, context: 'target', basis: 'source' }] }] }, telemetry: { modelName: 'gpt-5.6-terra', durationMs: 1 } })) as any,
    }), /INVALID_CITATION/);
  }
});

test('initial and repair editor prompts require per-opportunity measurement and prohibit fabricated seller activity', async () => {
  for (const repair of [undefined, { sections: [], issues: [{ type: 'hard_hypothesis', fragment: 'Ya ayudamos a empresas.' }] }]) {
    let calls = 0;
    const paragraph = { text: 'Proponer un piloto de expedientes de facturacion; medir minutos por expediente antes y despues, sin prometer ahorro.', basis: 'recommendation', claimIds: [], context: 'target' };
    const result = await writeReportV2({ entity: { contact: { title: 'Director de Finanzas' } }, analysis: {}, claims: [], sellerProfile: { products: [{ key: 'automation', description: 'Automatizacion documental.' }] }, language: 'es', repair } as any, {
      generate: (async (options: any) => {
        calls++;
        assert.match(options.prompt, /CADA oportunidad en su propio parrafo/);
        assert.match(options.prompt, /que medir, unidad y comparacion con la linea base/);
        assert.match(options.prompt, /No basta 'medir eficiencia' ni una lista global/);
        assert.match(options.prompt, /No reemplaces el caso financiero por ingreso de personal/);
        assert.match(options.prompt, /No asumas que esos problemas o procesos existen/);
        assert.match(options.prompt, /PROHIBIDO inventar experiencia, traccion, clientes, conversaciones en curso o resultados del vendedor/);
        assert.match(options.prompt, /basis=recommendation no exime de respaldo/);
        assert.match(options.prompt, /heuristica no calibrada/);
        assert.match(options.prompt, /ticket y monto sin datos/);
        assert.match(options.prompt, /aprobador de presupuesto, firmante/);
        assert.match(options.prompt, /no se identificaron detonantes recientes verificables/);
        assert.match(options.prompt, /no hay caso comparable disponible/);
        assert.match(options.prompt, /si existe trabajo manual/);
        assert.match(options.prompt, /Una cita al cargo NO respalda/);
        assert.match(options.schema.shape.sections.element.shape.paragraphs.element.shape.text.description, /cada oportunidad incluye su piloto y metrica/);
        const data = { sections: [{ key: 'fit', title: 'Piloto', paragraphs: [paragraph] }] };
        assert.doesNotThrow(() => options.schema.parse(data));
        return { data, telemetry: { modelName: 'gpt-5.6-luna' } };
      }) as any,
    });
    assert.equal(calls, 1);
    assert.equal(result.sections[0].paragraphs[0].text, paragraph.text);
  }
});
