import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDeterministicResearchReportDocumentV1 } from '@/ai/flows/synthesize-research-report';
import { ResearchReportDocumentV1Schema } from '@/lib/research-report-contracts';
import {
  buildResearchReport,
  buildResearchNarrative,
  canShowResearchDraftAction,
  createQueuedResearchWorkspaceRun,
  parseResearchReportDetail,
  parseResearchWorkspaceRun,
  researchDraftErrorMessage,
  researchDraftBlockReasonLabel,
  researchEvidenceKindLabel,
  researchSourceTypeLabel,
  researchWarningLabel,
  safeResearchSourceUrl,
  shouldPollResearchRun,
  type ResearchWorkspaceLead,
} from '@/lib/research-workspace';
import { draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';

const leads: ResearchWorkspaceLead[] = [
  { key: 'lead-ana', id: 'lead-ana', fullName: 'Ana Silva', email: 'ana@example.com', companyName: 'Acme' },
  { key: 'lead-bruno', id: 'lead-bruno', fullName: 'Bruno Díaz', email: 'bruno@example.com', companyName: 'Beta' },
];

test('maps a durable research run into visible quality, evidence, and drafting readiness', () => {
  const run = parseResearchWorkspaceRun({
    ok: true,
    run: {
      id: 'run-1',
      status: 'completed',
      total_count: 2,
      completed_count: 1,
      failed_count: 1,
      items: [
        {
          id: 'item-bruno',
          position: 1,
          lead_ref: 'lead-bruno',
          status: 'failed',
          error_message: 'internal detail that must not drive readiness',
          job: { status: 'failed', result_payload: null },
        },
        {
          id: 'item-ana',
          position: 0,
          lead_ref: 'lead-ana',
          status: 'completed',
          job: {
            status: 'completed',
            research_snapshot_id: 'snapshot-ana',
            result_payload: {
              status: 'completed',
              researchSnapshotId: 'snapshot-ana',
              lead: { fullName: 'Ana Silva', email: 'ana@example.com', title: 'Directora de Operaciones', companyName: 'Acme', city: 'Santiago', country: 'Chile' },
              score: 78,
              evidence: [{ id: 'evidence-1', statement: 'Acme abrió una nueva operación.', sourceUrl: 'https://example.com/news', kind: 'signal' }],
              sources: [{ id: 'source-1', title: 'Noticias de Acme', url: 'https://example.com/news', type: 'news' }],
              promptPack: {
                claims: [
                  'La empresa Acme ofrece software para coordinar operaciones comerciales.',
                  'Conviene explorar si la expansión abre una prioridad activa de coordinación.',
                ],
              },
              quality: { score: 78, sufficientResearch: true },
              draftEligibility: { eligible: true, blockReason: null },
            },
          },
        },
      ],
    },
  }, leads);

  assert.ok(run);
  assert.equal(run.items[0].lead.fullName, 'Ana Silva');
  assert.equal(run.items[0].qualityScore, 78);
  assert.equal(run.items[0].evidenceCount, 1);
  assert.equal(run.items[0].sourceCount, 1);
  assert.equal(run.items[0].result?.sources[0].type, 'news');
  assert.equal(run.items[0].result?.promptPack?.claims.length, 2);
  assert.equal(run.items[0].readiness, 'limited');
  assert.equal(run.items[0].canCreateDraft, false);
  assert.equal(run.items[1].readiness, 'needs_attention');
  assert.equal(run.items[1].canCreateDraft, false);
  assert.equal(shouldPollResearchRun(run), false);

  const narrative = buildResearchNarrative(run.items[0].result!);
  assert.equal(narrative.person, 'Ana Silva ocupa el cargo de Directora de Operaciones en Acme. Ubicación: Santiago, Chile.');
  assert.equal(narrative.company, 'No hay información de la empresa disponible para explicar qué hace Acme.');
  assert.equal(narrative.opportunity, 'No hay una oportunidad respaldada por la información disponible.');
  assert.deepEqual(narrative.findings, []);
});

test('uses the canonical snapshot for verified company context and drafting readiness', () => {
  const fixture = draftSnapshotFixture();
  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const snapshot = {
    ...fixture,
    claims: fixture.claims.map((claim) => ({ ...claim, freshness: { ...claim.freshness, validUntil } })),
  };
  const run = parseResearchWorkspaceRun({
    run: {
      id: 'run-canonical',
      status: 'completed',
      items: [{
        id: 'item-canonical',
        position: 0,
        lead_ref: 'lead-ada',
        status: 'completed',
        job: {
          status: 'completed',
          research_snapshot_id: snapshot.id,
          result_payload: {
            status: 'completed',
            researchSnapshotId: snapshot.id,
            lead: { id: 'lead-ada', fullName: 'Ada Lovelace', email: 'ada@acme.example', title: 'Directora de Operaciones', companyName: 'Acme', companyDomain: 'acme.example' },
            score: 78,
            evidence: [],
            sources: [],
            quality: { score: 78, sufficientResearch: true },
            draftEligibility: { eligible: true, blockReason: null },
            snapshot,
          },
        },
      }],
    },
  }, []);

  assert.ok(run?.items[0].result);
  const item = run.items[0];
  const report = buildResearchReport(item.result!);
  assert.equal(report.company.length, 1);
  assert.equal(report.sources.length, 2);
  assert.equal(report.company[0].statement, 'Acme comunica una propuesta para reducir trabajo manual en operaciones.');
  assert.equal(report.person.facts[0].statement, 'Ada Lovelace ocupa el cargo de Directora de Operaciones.');
  assert.equal(item.readiness, 'ready');
  assert.equal(item.canCreateDraft, true);
});

test('maps a validated report document first and keeps claim, evidence, and source counts independent', () => {
  const snapshot = draftSnapshotFixture();
  const deterministic = buildDeterministicResearchReportDocumentV1({
    snapshot,
    generatedAt: '2026-08-24T12:00:00.000Z',
  });
  const document = ResearchReportDocumentV1Schema.parse({
    ...deterministic,
    executiveSummary: {
      facts: deterministic.executiveSummary.facts,
    },
  });
  const detail = parseResearchReportDetail({
    reportId: 'report-ada',
    status: 'completed',
    researchSnapshotId: snapshot.id,
    result: {
      status: 'completed',
      researchSnapshotId: snapshot.id,
      lead: {
        fullName: 'Ada Lovelace',
        email: 'ada@acme.example',
        title: 'Directora de Operaciones',
        companyName: 'Acme',
        organizationIndustry: 'Software',
        organizationSize: 240,
      },
      score: 82,
      evidence: [],
      sources: [],
      quality: { score: 82, sufficientResearch: true },
      draftEligibility: { eligible: true, blockReason: null },
      warnings: [],
    },
    snapshot,
    reportDocument: document,
  });

  assert.ok(detail?.reportDocument);
  const report = buildResearchReport(detail.result, detail.reportDocument);
  assert.equal(report.executive[0].statement, 'Ada Lovelace ocupa el cargo de Directora de Operaciones.');
  assert.equal(report.coverage.claims, 3);
  assert.equal(report.coverage.evidenceRecords, 2);
  assert.equal(report.coverage.sources, 2);
  assert.equal(report.evidenceRecords.length, 2);
  assert.equal(report.sources.length, 2);
  assert.ok(report.person.fields.every((field) => !['Industria', 'Tamaño de empresa'].includes(field.label)));
  assert.deepEqual(report.companyContext.map((field) => field.label), ['Industria', 'Tamaño de empresa']);
  assert.equal(report.companySections.overview[0].evidence[0].sourceUrl, 'https://acme.example/about');
});

test('keeps historical payloads readable and explicitly marks unavailable company information', () => {
  const run = parseResearchWorkspaceRun({
    run: {
      id: 'run-historical',
      status: 'partial',
      items: [{
        id: 'item-historical',
        position: 0,
        lead_ref: 'historical-lead',
        status: 'partial',
        job: {
          result_payload: {
            status: 'partial',
            lead: { full_name: 'Lucía Soto', company_name: 'Compañía Reservada' },
            evidence: [{ statement: 'Lucía Soto participó en una conferencia del sector.', source_url: 'https://example.com/profile', kind: 'fact' }],
            sources: [{ title: 'Perfil público', url: 'https://example.com/profile' }],
            angle: '',
            quality: {},
            draft_eligibility: { eligible: false },
          },
        },
      }],
    },
  }, []);

  assert.ok(run);
  assert.ok(run.items[0].result);
  const result = run.items[0].result;
  const narrative = buildResearchNarrative(result);

  assert.deepEqual(result.promptPack?.claims, []);
  assert.equal(result.sources[0].type, undefined);
  assert.equal(narrative.companyAvailable, false);
  assert.equal(narrative.company, 'No hay información de la empresa disponible para explicar qué hace Compañía Reservada.');
  assert.equal(narrative.opportunityAvailable, false);
  assert.equal(narrative.opportunity, 'No hay una oportunidad respaldada por la información disponible.');
  assert.deepEqual(narrative.findings, ['Lucía Soto participó en una conferencia del sector.']);
});

test('keeps a completed result out of drafting when it lacks usable evidence', () => {
  const run = parseResearchWorkspaceRun({
    run: {
      id: 'run-2',
      status: 'partial',
      items: [
        {
          id: 'item-ana',
          position: 0,
          lead_ref: 'lead-ana',
          status: 'partial',
          job: {
            status: 'partial',
            research_snapshot_id: 'snapshot-ana',
            result_payload: {
              status: 'partial',
              researchSnapshotId: 'snapshot-ana',
              lead: { email: 'ana@example.com' },
              evidence: [],
              sources: [],
              quality: { score: 40, sufficientResearch: false },
              draftEligibility: { eligible: false, blockReason: 'insufficient_research' },
            },
          },
        },
      ],
    },
  }, leads);

  assert.ok(run);
  assert.equal(run.items[0].readiness, 'missing_evidence');
  assert.equal(run.items[0].canCreateDraft, false);
});

test('does not promote generic webpage boilerplate into the company narrative or findings', () => {
  const run = parseResearchWorkspaceRun({
    run: {
      id: 'run-generic-evidence',
      status: 'completed',
      items: [{
        status: 'completed',
        job: {
          research_snapshot_id: 'snapshot-generic',
          result_payload: {
            status: 'completed',
            lead: { email: 'ana@example.com', company_name: 'Acme' },
            evidence: [{
              statement: 'El sitio oficial describe a Acme como: Selecciona tu país para continuar.',
              source_url: 'https://acme.example/',
              kind: 'fact',
            }],
            sources: [{ url: 'https://acme.example/', type: 'official_site' }],
            quality: { score: 80, sufficient_research: true },
            draft_eligibility: { eligible: true },
          },
        },
      }],
    },
  }, []);

  assert.ok(run?.items[0].result);
  const narrative = buildResearchNarrative(run.items[0].result);
  assert.equal(narrative.companyAvailable, false);
  assert.equal(narrative.company, 'No hay información de la empresa disponible para explicar qué hace Acme.');
  assert.deepEqual(narrative.findings, []);
});

test('keeps hypotheses and signals out of factual narrative sections', () => {
  const run = parseResearchWorkspaceRun({
    run: {
      id: 'run-hypotheses',
      status: 'completed',
      items: [{
        status: 'completed',
        job: {
          research_snapshot_id: 'snapshot-hypotheses',
          result_payload: {
            status: 'completed',
            lead: { email: 'ana@example.com', company_name: 'Acme' },
            evidence: [
              { statement: 'Acme podría necesitar apoyo para crecer.', source_url: 'https://example.com/hypothesis', kind: 'hypothesis' },
              { statement: 'Acme publicó una vacante reciente.', source_url: 'https://example.com/jobs', kind: 'signal' },
              { statement: 'Acme fue fundada en 2012.', source_url: 'https://example.com/registry', kind: 'fact' },
            ],
            sources: [
              { url: 'https://example.com/hypothesis' },
              { url: 'https://example.com/jobs', type: 'jobs' },
              { url: 'https://example.com/registry', type: 'registry' },
            ],
            prompt_pack: { claims: ['La empresa Acme ofrece consultoría.', 'Conviene explorar una prioridad de crecimiento.'] },
            quality: { score: 82, sufficient_research: true },
            draft_eligibility: { eligible: true },
          },
        },
      }],
    },
  }, []);

  assert.ok(run?.items[0].result);
  const narrative = buildResearchNarrative(run.items[0].result);
  assert.equal(narrative.companyAvailable, false);
  assert.deepEqual(narrative.findings, ['Acme fue fundada en 2012.']);
  assert.doesNotMatch(JSON.stringify(narrative.findings), /podría|vacante|consultoría|conviene explorar/i);
});

test('keeps null and empty quality metrics unevaluated', () => {
  const run = parseResearchWorkspaceRun({
    run: {
      id: 'run-null-quality',
      status: 'completed',
      total_count: '',
      items: [{
        position: '',
        status: 'completed',
        job: {
          result_payload: {
            status: 'completed',
            lead: { email: 'ana@example.com' },
            score: null,
            evidence: [],
            sources: [],
            quality: { score: '' },
            draft_eligibility: { eligible: false },
          },
        },
      }],
    },
  }, leads);

  assert.ok(run);
  assert.equal(run.totalCount, 1);
  assert.equal(run.items[0].position, 0);
  assert.equal(run.items[0].result?.score, null);
  assert.equal(run.items[0].result?.quality.score, null);
  assert.equal(run.items[0].qualityScore, null);
});

test('shows a draft action only with ready state and snapshot prerequisites', () => {
  const base = { eligible: true, canCreateDraft: true };

  assert.equal(canShowResearchDraftAction({ ...base, readiness: 'review', snapshotId: 'snapshot-1' }), false);
  assert.equal(canShowResearchDraftAction({ ...base, readiness: 'ready', snapshotId: null }), false);
  assert.equal(canShowResearchDraftAction({ ...base, readiness: 'ready', snapshotId: '   ' }), false);
  assert.equal(canShowResearchDraftAction({ ...base, readiness: 'ready', snapshotId: 'snapshot-1', eligible: false }), false);
  assert.equal(canShowResearchDraftAction({ ...base, readiness: 'ready', snapshotId: 'snapshot-1', canCreateDraft: false }), false);
  assert.equal(canShowResearchDraftAction({ readiness: 'ready', snapshotId: 'snapshot-1', eligible: true }), true);
});

test('treats the batch creation response as an in-progress selection until its durable state arrives', () => {
  const run = createQueuedResearchWorkspaceRun({
    runId: 'run-3',
    leads,
    items: [{ jobId: 'job-ana', reportId: 'report-ana', leadRef: 'lead-ana', position: 0, status: 'queued' }],
  });

  assert.equal(run.items[0].status, 'queued');
  assert.equal(run.items[0].reportId, 'report-ana');
  assert.equal(run.items[0].readiness, 'in_progress');
  assert.equal(shouldPollResearchRun(run), true);
});

test('maps native report labels into concise user-facing copy', () => {
  assert.equal(researchEvidenceKindLabel('signal'), 'Señal reciente');
  assert.equal(researchEvidenceKindLabel('hypothesis'), 'Hipótesis por validar');
  assert.equal(researchSourceTypeLabel('official_site'), 'Sitio oficial');
  assert.equal(researchSourceTypeLabel(undefined), 'Fuente');
  assert.equal(
    researchDraftBlockReasonLabel('company_contact_limit_reached'),
    'Se alcanzó el límite de contactos para esta empresa.',
  );
  assert.equal(
    researchDraftBlockReasonLabel(null, 'missing_evidence'),
    'Falta evidencia con fuentes antes de redactar.',
  );
});

test('surfaces the first structured draft issue and the remaining issue count', () => {
  assert.equal(
    researchDraftErrorMessage({
      error: 'NATIVE_DRAFT_PREFLIGHT_FAILED',
      message: 'No se pudo preparar el borrador.',
      issues: [
        { code: 'cta_count', message: 'Revisa la llamada a la acción del mensaje.', location: 'body' },
        { code: 'body_length', message: 'Reduce la extensión del mensaje.', location: 'body' },
        { code: 'personalization_missing', message: 'Agrega una personalización respaldada.', location: 'research' },
      ],
    }, 'Inténtalo nuevamente.'),
    'Revisa la llamada a la acción del mensaje. Hay 2 puntos más por revisar.',
  );
  assert.equal(
    researchDraftErrorMessage({ result: { issues: [{ message: 'Confirma la fuente usada para personalizar.' }] } }, 'Inténtalo nuevamente.'),
    'Confirma la fuente usada para personalizar.',
  );
});

test('allows only safe external source protocols', () => {
  assert.equal(safeResearchSourceUrl('https://example.com/research'), 'https://example.com/research');
  assert.equal(safeResearchSourceUrl('http://example.com/source'), 'http://example.com/source');
  assert.equal(safeResearchSourceUrl('javascript:alert(1)'), null);
  assert.equal(safeResearchSourceUrl('data:text/html,unsafe'), null);
  assert.equal(safeResearchSourceUrl('/relative-source'), null);
});

test('maps technical research warnings into user-facing guidance', () => {
  assert.equal(
    researchWarningLabel('official_site_fetch_failed'),
    'No pudimos consultar el sitio oficial; se usaron otras fuentes.',
  );
  assert.equal(
    researchWarningLabel('company_profile_unavailable'),
    'No pudimos consultar fuentes adicionales sobre la actividad de la empresa.',
  );
  assert.equal(researchWarningLabel('custom_provider_error'), 'Hay una señal que conviene validar antes de contactar.');
  assert.equal(researchWarningLabel('Revisa la fecha de esta señal.'), 'Revisa la fecha de esta señal.');
});
