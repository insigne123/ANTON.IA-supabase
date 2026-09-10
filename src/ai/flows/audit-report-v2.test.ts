import assert from 'node:assert/strict';
import test from 'node:test';

import type { ClaimV2, SectionV2, SourceV2 } from '@/lib/report-v2-contracts';
import { auditReportV2, deterministicAuditReportV2, rewriteBlockingReportV2SectionsOnce } from './audit-report-v2';

const facts: ClaimV2[] = [{
  id: 'c01', internalId: null, type: 'fact', dimension: 'company_size', statement: 'Acme has 300 workers.',
  evidenceIds: ['f_aaaaaaaaaa'], observedAt: '2026-01-01T00:00:00.000Z', freshnessDays: 1, jurisdiction: 'PE', confidence: 0.9,
}, {
  id: 'c02', internalId: null, type: 'hypothesis', dimension: 'risk', statement: 'Manual work may be high.', evidenceIds: [],
  observedAt: null, freshnessDays: null, jurisdiction: 'PE', confidence: 0.5, validationQuestion: 'How much work is manual?',
}, {
  id: 'c03', internalId: null, type: 'fact', dimension: 'regulatory', statement: 'Chile applies a local regulation.',
  evidenceIds: ['f_bbbbbbbbbb'], observedAt: '2026-01-01T00:00:00.000Z', freshnessDays: 1, jurisdiction: 'CL', confidence: 0.9,
}];
const sources: SourceV2[] = [{
  id: 'src_aaaaaaaaaa', url: 'https://news.example/acme', canonicalUrl: 'https://news.example/acme',
  title: 'Acme announces a major operational expansion', sourceType: 'press', jurisdiction: 'PE',
  publishedAt: '2026-01-01T00:00:00.000Z', modifiedAt: null, retrievedAt: '2026-01-02T00:00:00.000Z', ownDomain: false,
  contentHash: 'a'.repeat(64),
}];

test('deterministic auditor detects every known v1 defect class that can block publication', () => {
  const sections: SectionV2[] = [{
    key: 'fit', title: 'Fit', blocks: [], paragraphs: [
      { text: 'Seller can help this account Seller can help this account with <section class="elementor-section"> wp-content/uploads/file.js', claimIds: [], context: 'target' },
      { text: 'Acme announces a major operational expansion.', claimIds: ['c01'], context: 'target' },
      { text: 'The account has a confirmed manual-work problem.', claimIds: ['c02'], context: 'target' },
      { text: 'Chile rules apply to this Peru operation.', claimIds: ['c03'], context: 'target' },
      { text: 'This sentence ends in a word centralizad', claimIds: ['c01'], context: 'target' },
    ],
  }];
  const issueTypes = new Set(deterministicAuditReportV2({ sections, claims: facts, sources, contactCountry: 'PE' }).map((issue) => issue.type));
  ['duplication', 'truncated', 'technical_noise', 'literal_copy', 'invalid_citation', 'jurisdiction', 'hard_hypothesis']
    .forEach((type) => assert.ok(issueTypes.has(type as any), `Missing ${type}`));
});

test('P7 uses a separate Luna review with the actual evidence', async () => {
  let options: any = null;
  const result = await auditReportV2({
    sections: [{ key: 'company', title: 'Company', paragraphs: [{ text: 'Acme has 300 workers.', claimIds: ['c01'], context: 'target' }], blocks: [] }],
    claims: facts,
    sources,
    contactCountry: 'PE',
    writerModels: ['gpt-5.6-luna'],
    companyContext: 'Acme ofrece soporte operativo y administracion.',
    sellerProfile: { products: [{ key: 'automation', description: 'Asistente documental' }] },
  }, {
    generate: (async (input: any) => {
      options = input;
      return { data: { issues: [] }, telemetry: { modelName: 'gpt-5.6-luna', durationMs: 1 } };
    }) as any,
  });
  assert.deepEqual(options.openAiModels, ['gpt-5.6-luna']);
  assert.equal(options.allowDefaultModelFallback, false);
  assert.ok(options.prompt.includes(facts[0].statement));
  assert.match(options.prompt, /Acme ofrece soporte operativo y administracion/);
  assert.match(options.prompt, /Asistente documental/);
  assert.equal(result.model, 'gpt-5.6-luna');
  assert.deepEqual(result.blockingSections, []);
});

test('does not block a discovery question that intentionally echoes its context', () => {
  const issues = deterministicAuditReportV2({
    sections: [{
      key: 'discovery', title: 'Discovery', blocks: [], paragraphs: [{
        text: 'La empresa enfrenta procesos de reclutamiento y seleccion. ¿Cuales son sus procesos de reclutamiento y seleccion actuales?',
        claimIds: ['c01'], context: 'target',
      }],
    }],
    claims: facts,
    sources,
    contactCountry: 'PE',
  });
  assert.equal(issues.some((issue) => issue.type === 'duplication'), false);
});

test('does not block a short phrase reused across separate sentences', () => {
  const issues = deterministicAuditReportV2({
    sections: [{
      key: 'signals', title: 'Signals', blocks: [], paragraphs: [{
        text: 'La cuenta muestra interes en la gestion del talento. Conviene revisar como aborda la gestion del talento en sus operaciones.',
        claimIds: ['c01'], context: 'target',
      }],
    }],
    claims: facts,
    sources,
    contactCountry: 'PE',
  });
  assert.equal(issues.some((issue) => issue.type === 'duplication'), false);
});

test('ignores an ungrounded model duplication finding', async () => {
  const result = await auditReportV2({
    sections: [{ key: 'company', title: 'Company', paragraphs: [{ text: 'Acme has 300 workers.', claimIds: ['c01'], context: 'target' }], blocks: [] }],
    claims: facts,
    sources,
    contactCountry: 'PE',
    writerModels: ['gpt-5.6-luna'],
  }, {
    generate: (async () => ({
      data: { issues: [{ section: 'company', paragraphIndex: 0, type: 'duplication', fragment: 'Acme has 300 workers', severity: 'block' }] },
      telemetry: { modelName: 'gpt-5.6-sol', durationMs: 1 },
    })) as any,
  });
  assert.equal(result.issues.some((issue) => issue.type === 'duplication'), false);
  assert.deepEqual(result.blockingSections, []);
});

test('rewrites each blocking section once and leaves accepted sections untouched', async () => {
  const sections: SectionV2[] = [
    { key: 'company', title: 'Company', paragraphs: [], blocks: [] },
    { key: 'fit', title: 'Fit', paragraphs: [], blocks: [] },
  ];
  let calls = 0;
  const result = await rewriteBlockingReportV2SectionsOnce({
    sections,
    blockingSections: ['fit', 'fit'],
    rewrite: async (section) => { calls += 1; return { ...section, title: 'Rewritten' }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.sections[0].title, 'Company');
  assert.equal(result.sections[1].title, 'Rewritten');
});

test('recommendations and imported profile paragraphs need no citations and closing quotes are not truncation', async () => {
  const input = {
    sections: [
      { key: 'discovery', title: 'Preguntas', blocks: [], paragraphs: [{ text: 'Preguntar: «¿Como coordinan las entrevistas?»', claimIds: [], context: 'target', basis: 'recommendation' }] },
      { key: 'volume', title: 'Volumen', blocks: [], paragraphs: [] },
    ], claims: [], sources: [], contactCountry: 'PE', writerModels: ['gpt-5.6-terra'],
  } as any;
  assert.deepEqual(deterministicAuditReportV2(input), []);
  const result = await auditReportV2(input, {
    generate: (async () => ({ data: { issues: [{ section: 'volume', paragraphIndex: null, type: 'generic', fragment: 'No hay dimensionamiento.', severity: 'block' }] }, telemetry: { modelName: 'gpt-5.6-terra', durationMs: 1 } })) as any,
  });
  assert.deepEqual(result.blockingSections, []);
});

test('auditor requests seller-evidence review and retains material blocks inside recommended openings', async () => {
  for (const fragment of ['Estamos conversando con equipos de reclutamiento', 'Ya ayudamos a empresas del sector', 'Nuestros clientes ahorraron un 30%']) {
    let calls = 0;
    const result = await auditReportV2({
      sections: [{ key: 'angle', title: 'Apertura', blocks: [], paragraphs: [{ text: `Propuesta: "${fragment}. Me gustaria entender su proceso."`, basis: 'recommendation', claimIds: [], context: 'target' }] }],
      claims: [], sources: [], contactCountry: 'PE', writerModels: ['gpt-5.6-luna'],
      sellerProfile: { companyName: 'Seller', products: [{ key: 'automation', description: 'Automatizacion documental.' }] },
    }, {
      generate: (async (options: any) => {
        calls++;
        assert.match(options.prompt, /RESPALDO DEL VENDEDOR/);
        assert.match(options.prompt, /incluso entre comillas en angle y con basis=recommendation/);
        assert.match(options.prompt, /hard_hypothesis con severity=block/);
        assert.match(options.prompt, /Una capacidad de automatizacion NO prueba clientes ni experiencia/);
        assert.match(options.schema.shape.issues.element.shape.type.description, /vendedor no respaldados/);
        const data = { issues: [{ section: 'angle', paragraphIndex: 0, type: 'hard_hypothesis', fragment, severity: 'block' }] };
        assert.doesNotThrow(() => options.schema.parse(data));
        return { data, telemetry: { modelName: 'gpt-5.6-luna', durationMs: 1 } };
      }) as any,
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.blockingSections, ['angle']);
    assert.equal(result.issues[0].severity, 'block');
    assert.equal(result.issues[0].fragment, fragment);
  }
});

test('supported seller activity, neutral capacity and proposed measurements remain admissible without decorative citations', async () => {
  const texts = [
    'Desarrollamos automatizacion documental; me gustaria entender su proceso.',
    'Hemos implementado un piloto documental en Example.',
    'Proponemos medir minutos por expediente antes y despues, sin prometer un ahorro.',
  ];
  const result = await auditReportV2({
    sections: [{ key: 'angle', title: 'Apertura', blocks: [], paragraphs: texts.map((text) => ({ text, basis: 'recommendation', claimIds: [], context: 'target' })) }],
    claims: [], sources: [], contactCountry: 'PE', writerModels: ['gpt-5.6-luna'],
    sellerProfile: { products: [{ key: 'automation', description: 'Desarrollamos automatizacion documental. Hemos implementado un piloto documental en Example.' }] },
  } as any, {
    generate: (async (options: any) => {
      assert.match(options.prompt, /Hemos implementado un piloto documental en Example/);
      assert.match(options.prompt, /Una capacidad explicitamente ofrecida, una pregunta exploratoria o una metrica propuesta SIN promesa/);
      return { data: { issues: [] }, telemetry: { modelName: 'gpt-5.6-luna', durationMs: 1 } };
    }) as any,
  });
  assert.deepEqual(result.issues, []);
});

test('auditor preserves located pilot-metric and role-specificity warnings without confusing them with invented facts', async () => {
  const fragment = 'Para Finanzas, automatizar ingreso de personal y medir eficiencia.';
  const result = await auditReportV2({
    sections: [{ key: 'fit', title: 'Piloto', blocks: [], paragraphs: [{ text: fragment, basis: 'recommendation', claimIds: [], context: 'target' }] }],
    claims: [], sources: [], contactCountry: 'PE', writerModels: ['gpt-5.6-luna'],
  } as any, {
    generate: (async (options: any) => {
      assert.match(options.prompt, /pilotos sin metrica observable propia/);
      assert.match(options.prompt, /facturacion, cobranza, cierre o excepciones financieras/);
      return { data: { issues: [{ section: 'fit', paragraphIndex: 0, type: 'generic', fragment, severity: 'warn' }] }, telemetry: { modelName: 'gpt-5.6-luna', durationMs: 1 } };
    }) as any,
  });
  assert.equal(result.issues[0].type, 'generic');
  assert.deepEqual(result.blockingSections, []);
});
