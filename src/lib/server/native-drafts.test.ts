import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNativeDraft,
  normalizeNativeDraftBody,
  reviseNativeDraft,
  rewriteNativeDraft,
  type NativeDraftGenerationDependencies,
} from './native-drafts';
import {
  createDefaultDraftWritingStyleV2,
  normalizeDraftSellerProfileV2,
  type DraftContextV2,
} from './draft-context-v2';
import type { OutreachSequenceContextV2 } from '@/lib/campaigns-v2/outreach-sequence-context';
import {
  DRAFT_FIXTURE_IDS,
  DRAFT_FIXTURE_NOW,
  draftReportV2Fixture,
  draftSnapshotFixture,
} from './draft-v2-test-fixtures';
import type { GeneratedOutreachFromDraftContextV2 } from '@/ai/flows/generate-outreach-from-report';
import { buildDeterministicResearchReportDocumentV1 } from '@/ai/flows/synthesize-research-report';
import { canonicalSha256, createChildMessagingDraftV1, type MessagingDraftV1 } from '@/lib/messaging-contracts';
import { ResearchReportDocumentV1Schema } from '@/lib/research-report-contracts';
import { NATIVE_DRAFT_PROMPT_VERSION } from '@/lib/native-draft-version';
import { validateDraftPreflightV2 } from './draft-preflight-v2';

const access = {
  organizationId: DRAFT_FIXTURE_IDS.organization,
  userId: DRAFT_FIXTURE_IDS.user,
};

function generated(context: DraftContextV2): GeneratedOutreachFromDraftContextV2 {
  const evidence = context.evidence.find((item) => item.supportedFactClaimIds.includes('claim-acme-overview'))!;
  return {
    subject: 'Procesos en Acme',
    body: `Hola Ada,

Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.

En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la información disponible para el equipo.`,
    personalization: [{
      evidenceId: evidence.evidenceId,
      claimId: 'claim-acme-overview',
      sourceUrl: evidence.source.url,
    }],
    hypothesisIds: [],
    provider: 'openai',
    model: 'test-model',
    promptVersion: NATIVE_DRAFT_PROMPT_VERSION,
  };
}

function dependencies(snapshot = draftSnapshotFixture()) {
  const persisted: MessagingDraftV1[] = [];
  const metadata: any[] = [];
  let claims = 0;
  let releases = 0;
  const value: NativeDraftGenerationDependencies = {
    getSnapshot: async () => ({
      payload: snapshot,
      content_hash: canonicalSha256(snapshot),
      captured_at: '2026-08-20T12:00:00.000Z',
    }),
    loadSellerProfile: async () => normalizeDraftSellerProfileV2({
      name: 'Grace Hopper',
      companyName: 'Northstar',
      services: ['Automatización de operaciones'],
    }),
    loadWritingStyle: async () => createDefaultDraftWritingStyleV2(),
    ensureReportDocument: async () => {
      const document = buildDeterministicResearchReportDocumentV1({
        snapshot,
        generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
      });
      return ResearchReportDocumentV1Schema.parse({
        ...document,
        outreachBrief: {
          ...document.outreachBrief,
          factualAnchors: document.outreachBrief.factualAnchors.filter((anchor) =>
            anchor.citations.claimIds.includes('claim-acme-overview'),
          ),
        },
      });
    },
    claimGeneration: async () => {
      claims += 1;
      return { state: 'claimed', claimToken: 'claim-token' };
    },
    releaseGeneration: async () => {
      releases += 1;
      return true;
    },
    isSuppressed: async () => false,
    findPersistedDraft: async () => null,
    findExistingContentFingerprints: async () => [],
    persistDraft: async (draft) => {
      persisted.push(draft);
      return draft;
    },
    persistMetadata: async (input) => { metadata.push(input); },
    now: () => DRAFT_FIXTURE_NOW,
  };
  return {
    value,
    persisted,
    metadata,
    claimCount: () => claims,
    releaseCount: () => releases,
  };
}

test('native drafting returns a failure result when OpenAI is unavailable and never persists a generic email', async () => {
  const fixture = dependencies();
  fixture.value.generate = async () => { throw new Error('Missing OPENAI_API_KEY'); };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') return;
  assert.equal(result.code, 'openai_generation_failed');
  assert.equal(result.draft, null);
  assert.equal(result.preflight.status, 'failed');
  assert.equal(fixture.persisted.length, 0);
  assert.equal(fixture.claimCount(), 1);
  assert.equal(fixture.releaseCount(), 1);
});

test('native drafting acquires the privacy claim before synthesizing the report document', async () => {
  const fixture = dependencies();
  const events: string[] = [];
  fixture.value.generate = async ({ context }) => generated(context);
  const ensureReportDocument = fixture.value.ensureReportDocument!;
  fixture.value.claimGeneration = async () => {
    events.push('claim');
    return { state: 'claimed', claimToken: 'claim-token' };
  };
  fixture.value.ensureReportDocument = async (input) => {
    events.push('report');
    return ensureReportDocument(input);
  };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  assert.deepEqual(events.slice(0, 2), ['claim', 'report']);
});

test('native drafting can persist the initial draft and provenance in one atomic operation', async () => {
  const fixture = dependencies();
  let atomicMetadata: any = null;
  fixture.value.persistDraft = undefined;
  fixture.value.persistMetadata = undefined;
  fixture.value.persistDraftWithMetadata = async (draft, metadata) => {
    atomicMetadata = metadata;
    return draft;
  };
  fixture.value.generate = async ({ context }) => generated(context);

  const result = await createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, fixture.value);

  assert.equal(result.status, 'drafted');
  assert.equal(atomicMetadata?.versionId, result.status === 'drafted' ? result.draft.versionId : null);
  assert.equal(atomicMetadata?.reportSchemaVersion, 'research-report-document/v1');
  assert.match(atomicMetadata?.reportContentHash || '', /^[a-f0-9]{64}$/);
});

test('native drafting prefers visible Report V2 and persists its exact document provenance', async () => {
  const fixture = dependencies();
  const document = draftReportV2Fixture();
  const reportDocumentId = '70000000-0000-4000-8000-000000000001';
  const requestedReportDocumentIds: Array<string | undefined> = [];
  fixture.value.ensureReportDocument = undefined;
  fixture.value.loadReportDocumentV2 = async (input) => {
    requestedReportDocumentIds.push(input.reportDocumentId);
    return {
    id: reportDocumentId,
    researchSnapshotId: document.researchSnapshotId,
    organizationId: document.scope.organizationId,
    userId: document.scope.ownerUserId,
    schemaVersion: document.schemaVersion,
    deliveryState: 'visible',
    status: document.synthesis.status,
    generationMethod: 'model',
    provider: 'openai',
    model: 'writer-test',
    promptVersion: document.synthesis.promptVersion,
    contentHash: canonicalSha256(document),
    retryable: false,
    errorCode: null,
    errorMessage: null,
    document,
    generatedAt: document.synthesis.generatedAt,
    createdAt: document.synthesis.generatedAt,
    updatedAt: document.synthesis.generatedAt,
    };
  };
  fixture.value.generate = async ({ context }) => generated(context);

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  assert.equal(result.context.report?.document?.id, reportDocumentId);
  assert.equal(fixture.metadata[0]?.reportDocumentId, reportDocumentId);
  assert.equal(fixture.metadata[0]?.reportSchemaVersion, 'research-report-document/v2');
  assert.equal(fixture.metadata[0]?.reportRevision, document.revision);
  assert.equal(fixture.metadata[0]?.reportContentHash, canonicalSha256(document));

  if (result.status !== 'drafted') return;
  const rewriteDependencies: NativeDraftGenerationDependencies = {
    ...fixture.value,
    loadMetadata: async () => fixture.metadata[0],
    generate: async ({ context }) => ({
      ...generated(context),
      subject: 'Menos tareas manuales en Acme',
      body: `Hola Ada,

Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.

En Northstar automatizamos operaciones repetitivas para reducir tareas manuales y mantener la información disponible para el equipo.`,
    }),
    appendRevisionWithMetadata: async (parent, changes) => createChildMessagingDraftV1(parent, {
      ...changes,
      versionId: '70000000-0000-4000-8000-000000000002',
      createdAt: DRAFT_FIXTURE_NOW.toISOString(),
    }),
  };
  const rewritten = await rewriteNativeDraft({
    ...access,
    draft: result.draft,
    instruction: 'Hazlo más directo.',
  }, rewriteDependencies);

  assert.equal(rewritten.draft.revision, 2);
  assert.equal(requestedReportDocumentIds[requestedReportDocumentIds.length - 1], reportDocumentId);
});

test('requested rewrites fail closed when the pinned report row no longer matches provenance', async () => {
  const fixture = dependencies();
  const document = draftReportV2Fixture();
  fixture.value.ensureReportDocument = undefined;
  fixture.value.loadReportDocumentV2 = async () => ({
    id: '70000000-0000-4000-8000-000000000003',
    researchSnapshotId: document.researchSnapshotId,
    organizationId: document.scope.organizationId,
    userId: document.scope.ownerUserId,
    schemaVersion: document.schemaVersion,
    deliveryState: 'visible',
    status: document.synthesis.status,
    generationMethod: 'model',
    provider: 'openai',
    model: 'writer-test',
    promptVersion: document.synthesis.promptVersion,
    contentHash: canonicalSha256(document),
    retryable: false,
    errorCode: null,
    errorMessage: null,
    document,
    generatedAt: document.synthesis.generatedAt,
    createdAt: document.synthesis.generatedAt,
    updatedAt: document.synthesis.generatedAt,
  });
  fixture.value.generate = async ({ context }) => generated(context);
  const initial = await createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, fixture.value);
  assert.equal(initial.status, 'drafted');
  if (initial.status !== 'drafted') return;

  let generationCalls = 0;
  await assert.rejects(
    () => rewriteNativeDraft({ ...access, draft: initial.draft, instruction: 'Hazlo más directo.' }, {
      ...fixture.value,
      loadMetadata: async () => fixture.metadata[0],
      loadReportDocumentV2: async () => null,
      generate: async ({ context }) => { generationCalls += 1; return generated(context); },
    }),
    /NATIVE_DRAFT_REPORT_PROVENANCE_CHANGED/,
  );
  assert.equal(generationCalls, 0);
});

test('native drafting refuses to invent missing generation metadata for a persisted draft', async () => {
  const fixture = dependencies();
  const campaignRecipientStepId = '60000000-0000-4000-8000-000000000001';
  fixture.value.generate = async ({ context }) => generated(context);
  fixture.value.persistMetadata = async () => {
    throw new Error('metadata write unavailable');
  };

  const first = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
    campaignRecipientStepId,
  }, fixture.value);
  assert.equal(first.status, 'failed');
  assert.equal(fixture.persisted.length, 1);

  const persisted = fixture.persisted[0];
  let metadataWrites = 0;
  fixture.value.findPersistedDraft = async () => persisted;
  fixture.value.loadMetadata = async () => null;
  fixture.value.persistMetadata = async () => { metadataWrites += 1; };

  const replay = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
    campaignRecipientStepId,
  }, fixture.value);

  assert.equal(replay.status, 'failed');
  assert.equal(fixture.claimCount(), 2);
  assert.equal(metadataWrites, 0);
});

test('suppressed historical snapshots never synthesize a report document', async () => {
  const fixture = dependencies();
  let ensureReportCalls = 0;
  fixture.value.isSuppressed = async () => true;
  fixture.value.ensureReportDocument = async () => {
    ensureReportCalls += 1;
    throw new Error('Report synthesis should not run');
  };

  await assert.rejects(
    () => createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, fixture.value),
    /NATIVE_DRAFT_PRIVACY_SUPPRESSED/,
  );
  assert.equal(ensureReportCalls, 0);
  assert.equal(fixture.claimCount(), 0);
});

test('snapshots without an email return blocked without synthesizing a report document', async () => {
  const baseSnapshot = draftSnapshotFixture();
  const snapshot = {
    ...baseSnapshot,
    subject: { ...baseSnapshot.subject, email: undefined },
  };
  const fixture = dependencies(snapshot);
  let ensureReportCalls = 0;
  fixture.value.ensureReportDocument = async () => {
    ensureReportCalls += 1;
    throw new Error('Report synthesis should not run');
  };

  const result = await createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, fixture.value);

  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.equal(result.code, 'recipient_missing');
  assert.equal(ensureReportCalls, 0);
  assert.equal(fixture.claimCount(), 0);
});

test('native drafting asks the user to complete the commercial profile before generation', async () => {
  const fixture = dependencies();
  let ensureReportCalls = 0;
  fixture.value.loadSellerProfile = async () => normalizeDraftSellerProfileV2({
    companyName: 'Northstar',
    description: 'Empresa de tecnología.',
  });
  fixture.value.ensureReportDocument = async () => {
    ensureReportCalls += 1;
    throw new Error('Report synthesis should not run');
  };

  const result = await createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, fixture.value);

  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.equal(result.code, 'seller_profile_incomplete');
  assert.match(result.message, /Productos y servicios|Propuesta de valor/);
  assert.equal(ensureReportCalls, 0);
  assert.equal(fixture.claimCount(), 0);
});

test('native drafting permits one corrective generation pass, then persists a traceable immutable version', async () => {
  const fixture = dependencies();
  let generationCalls = 0;
  fixture.value.generate = async ({ context }) => {
    generationCalls += 1;
    const output = generated(context);
    return generationCalls === 1 ? { ...output, subject: '{{company.name}}' } : output;
  };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  if (result.status !== 'drafted') return;
  assert.equal(generationCalls, 2);
  assert.equal(result.draft.revision, 1);
  assert.equal(result.draft.lifecycle, 'draft');
  assert.equal(result.draft.preflight.status, 'passed');
  assert.equal(result.draft.approval.status, 'pending');
  assert.match(result.draft.content.text || '', /Hola Ada,\n\nAcme comunica que ayuda/);
  assert.ok(result.draft.content.text?.endsWith(result.context.constraints.cta.exactText));
  assert.equal(fixture.persisted.length, 1);
  assert.deepEqual(fixture.metadata[0].claimIds, ['claim-acme-overview']);
});

test('synthetic Oscar-like agro-export HR draft stays editable with warnings; invented numbers still block', async () => {
  // Synthetic fixture, not a reproduction of Oscar's live draft or screenshot.
  for (const inventedNumber of [false, true]) {
    const snapshot = draftSnapshotFixture();
    snapshot.subject.email = 'oscar@agro.example';
    snapshot.subject.person = { fullName: 'Oscar Champac', title: 'Gerente de Recursos Humanos' };
    snapshot.subject.company = { name: 'Agro Ejemplo', domain: 'agro.example', websiteUrl: 'https://agro.example/about' };
    const statement = 'Agro Ejemplo exporta productos agricolas a mercados internacionales.';
    snapshot.evidence[0].statement = statement;
    snapshot.claims[0].statement = statement;
    snapshot.sources[0].url = 'https://agro.example/about';
    snapshot.sources[0].canonicalUrl = 'https://agro.example/about';
    snapshot.sources[0].title = 'Agro Ejemplo';
    snapshot.sources[1].url = 'https://agro.example/equipo/oscar';
    snapshot.sources[1].canonicalUrl = 'https://agro.example/equipo/oscar';
    snapshot.sources[1].title = 'Oscar Champac';
    snapshot.evidence[1].statement = 'Oscar Champac figura como Gerente de Recursos Humanos en Agro Ejemplo.';
    snapshot.claims[1].statement = snapshot.evidence[1].statement;
    const fixture = dependencies(snapshot);
    fixture.value.loadSellerProfile = async () => normalizeDraftSellerProfileV2({
      name: 'Grace Hopper', companyName: 'Northstar', services: ['Seleccion de personal y recursos humanos'],
    });
    let calls = 0;
    fixture.value.generate = async ({ context }) => {
      calls += 1;
      const output = {
        ...generated(context),
        subject: 'Personas en Agro Ejemplo',
        body: `Hola Oscar,

${statement} Por tu rol de Gerente de Recursos Humanos, queria compartirte una idea.

En Northstar nos especializamos en seleccion de personal, facilitando el trabajo y ahorrando tiempo. Podemos ordenar ese relato. Podemos ordenar ese relato.${inventedNumber ? ' Agro Ejemplo exporta 300 toneladas.' : ''}`,
      };
      const validation = validateDraftPreflightV2(context, {
        subject: output.subject,
        body: `${output.body}\n\n${context.constraints.cta.exactText}`,
        personalization: output.personalization,
        hypothesisIds: output.hypothesisIds,
      });
      assert.equal(validation.valid, !inventedNumber, JSON.stringify(validation));
      for (const warning of ['facilitando', 'ahorrando tiempo', 'cargo formal', 'abstracto', 'repite una misma', 'relevancia comercial']) {
        assert.ok(validation.preflight.warnings.some((item) => item.includes(warning)), warning);
      }
      if (inventedNumber) assert.ok(validation.issues.some((issue) => issue.code === 'unsupported_material_claim'));
      return output;
    };
    const result = await createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, fixture.value);
    assert.equal(result.status, inventedNumber ? 'blocked' : 'drafted', JSON.stringify(result));
    assert.equal(calls, inventedNumber ? 2 : 1);
    assert.equal(fixture.persisted.length, inventedNumber ? 0 : 1);
    assert.equal(fixture.metadata.length, inventedNumber ? 0 : 1);
    if (result.status === 'drafted') {
      assert.equal(result.draft.lifecycle, 'draft');
      assert.equal(result.draft.approval.status, 'pending');
      assert.equal(result.draft.approval.decidedBy, null);
      assert.equal(result.preflight.status, 'passed');
      assert.deepEqual(result.preflight.errors, []);
      assert.deepEqual(fixture.persisted[0].preflight, result.preflight);
      assert.ok(result.preflight.warnings.some((warning) => warning.includes('facilitando')));
      assert.match(result.draft.content.text || '', /facilitando/);
      assert.deepEqual(fixture.metadata[0].claimIds, ['claim-acme-overview']);
    } else if (result.status === 'blocked') {
      assert.ok(result.issues.some((issue) => issue.code === 'unsupported_material_claim'));
    }
  }
});

test('native drafting deterministically narrows a catalogued personalization before preflight', async () => {
  const baseSnapshot = draftSnapshotFixture();
  const snapshot = {
    ...baseSnapshot,
    evidence: baseSnapshot.evidence.map((evidence) => evidence.id === 'evidence-acme'
      ? {
        ...evidence,
        statement: 'Outsourcing de Recursos Humanos, reclutamiento y servicios transitorios para optimizar la gestión de personas.',
      }
      : evidence),
  };
  const fixture = dependencies(snapshot);
  fixture.value.loadSellerProfile = async () => normalizeDraftSellerProfileV2({
    name: 'Grace Hopper',
    companyName: 'Northstar',
    services: ['Automatización de recursos humanos'],
  });
  let generationCalls = 0;
  fixture.value.generate = async ({ context }) => {
    generationCalls += 1;
    const output = generated(context);
    return {
      ...output,
      body: output.body
        .replace(
          'Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.',
          'Acme reúne outsourcing de Recursos Humanos, reclutamiento y servicios transitorios.',
        )
        .replace(
          'En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la información disponible para el equipo.',
          'En Northstar automatizamos tareas de recursos humanos para reducir trabajo manual y dejar la información disponible para el equipo.',
        ),
    };
  };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  assert.equal(generationCalls, 1);
  if (result.status !== 'drafted') return;
  assert.equal(result.preflight.status, 'passed');
  assert.match(result.draft.content.text || '', /Acme reúne outsourcing de Recursos Humanos\./);
  assert.doesNotMatch(result.draft.content.text || '', /reclutamiento|servicios transitorios/);
  assert.equal(fixture.persisted.length, 1);
});

test('native drafting preserves editorial warnings around a qualified commercial hypothesis', async () => {
  const fixture = dependencies();
  fixture.value.generate = async ({ context }) => {
    const output = generated(context);
    return {
      ...output,
      body: output.body.replace(
        'En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la información disponible para el equipo.',
        'Podría ser pertinente explorar si esa prioridad está presente hoy. En Northstar automatizamos tareas repetitivas para reducir trabajo manual.',
      ),
      hypothesisIds: ['claim-acme-opportunity'],
    };
  };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  if (result.status !== 'drafted') return;
  assert.ok(result.preflight.warnings.some((warning) => warning.includes('abstracto')));
  assert.equal(result.draft.approval.status, 'pending');
  assert.equal(fixture.metadata.length, 1);
});

test('native drafting passes a bounded campaign instruction and includes it in deterministic identity', async () => {
  const firstFixture = dependencies();
  const secondFixture = dependencies();
  let receivedInstruction = '';
  firstFixture.value.generate = async ({ context, instruction }) => {
    receivedInstruction = instruction || '';
    return generated(context);
  };
  secondFixture.value.generate = async ({ context }) => generated(context);

  const first = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
    idempotencyKey: 'campaign-recipient-step:step-1',
    instruction: 'Retoma el beneficio principal sin repetir el contacto inicial.',
  }, firstFixture.value);
  const second = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
    idempotencyKey: 'campaign-recipient-step:step-1',
    instruction: 'Formula un cierre breve y directo.',
  }, secondFixture.value);

  assert.equal(receivedInstruction, 'Retoma el beneficio principal sin repetir el contacto inicial.');
  assert.equal(first.status, 'drafted');
  assert.equal(second.status, 'drafted');
  if (first.status !== 'drafted' || second.status !== 'drafted') return;
  assert.notEqual(first.draft.draftId, second.draft.draftId);
  await assert.rejects(
    () => createNativeDraft({
      ...access,
      snapshotId: DRAFT_FIXTURE_IDS.snapshot,
      instruction: 'x'.repeat(1_001),
    }, dependencies().value),
    /NATIVE_DRAFT_INSTRUCTION_INVALID/,
  );
});

test('direct writing instructions remain separate from campaign guidance and change draft identity', async () => {
  const firstFixture = dependencies();
  const secondFixture = dependencies();
  const received: unknown[] = [];
  firstFixture.value.generate = async ({ context, userInstruction, instruction }) => {
    received.push({ userInstruction, instruction });
    return generated(context);
  };
  secondFixture.value.generate = async ({ context }) => generated(context);
  const input = { ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot, idempotencyKey: 'same-request', instruction: 'Presenta el beneficio.' };
  const first = await createNativeDraft({ ...input, userInstruction: '  Usa un tono directo.  ' }, firstFixture.value);
  const second = await createNativeDraft({ ...input, userInstruction: 'Usa un tono cercano.' }, secondFixture.value);
  assert.deepEqual(received, [{ userInstruction: 'Usa un tono directo.', instruction: 'Presenta el beneficio.' }]);
  assert.equal(first.status, 'drafted');
  assert.equal(second.status, 'drafted');
  if (first.status === 'drafted' && second.status === 'drafted') assert.notEqual(first.draft.draftId, second.draft.draftId);
  await assert.rejects(() => createNativeDraft({ ...input, userInstruction: 'x'.repeat(1_001) }, dependencies().value), /NATIVE_DRAFT_INSTRUCTION_INVALID/);
});

test('native drafting includes the seller profile in deterministic identity', async () => {
  const firstFixture = dependencies();
  const secondFixture = dependencies();
  firstFixture.value.generate = async ({ context }) => generated(context);
  secondFixture.value.generate = async ({ context }) => generated(context);
  secondFixture.value.loadSellerProfile = async () => normalizeDraftSellerProfileV2({
    name: 'Grace Hopper',
    companyName: 'Northstar',
    services: ['Automatización de operaciones'],
    proofPoints: ['Caso verificable en logística'],
  });

  const first = await createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, firstFixture.value);
  const second = await createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, secondFixture.value);

  assert.equal(first.status, 'drafted');
  assert.equal(second.status, 'drafted');
  if (first.status !== 'drafted' || second.status !== 'drafted') return;
  assert.notEqual(first.draft.draftId, second.draft.draftId);
  assert.notEqual(first.draft.versionId, second.draft.versionId);
});

test('campaign follow-up identity changes with the seller profile', async () => {
  const firstFixture = dependencies();
  const secondFixture = dependencies();
  firstFixture.value.generate = async ({ context }) => generated(context);
  secondFixture.value.generate = async ({ context }) => {
    const output = generated(context);
    return {
      ...output,
      body: output.body.replace(
        'En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la información disponible para el equipo.',
        'En Northstar integramos datos operativos para reducir trabajo manual y dejar la información disponible para el equipo.',
      ),
    };
  };
  secondFixture.value.loadSellerProfile = async () => normalizeDraftSellerProfileV2({
    name: 'Grace Hopper',
    companyName: 'Northstar',
    services: ['Integración de datos operativos'],
  });
  const campaignRecipientStepId = '80000000-0000-4000-8000-000000000008';

  const first = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
    campaignRecipientStepId,
  }, firstFixture.value);
  const second = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
    campaignRecipientStepId,
  }, secondFixture.value);

  assert.equal(first.status, 'drafted');
  assert.equal(second.status, 'drafted');
  if (first.status !== 'drafted' || second.status !== 'drafted') return;
  assert.notEqual(first.draft.draftId, second.draft.draftId);
  assert.notEqual(first.draft.versionId, second.draft.versionId);
});

test('campaign follow-up generation honors an existing durable reservation', async () => {
  const fixture = dependencies();
  fixture.value.generate = async ({ context }) => generated(context);
  const reservedCampaignDraftIds = {
    draftId: '90000000-0000-4000-8000-000000000003',
    versionId: '90000000-0000-4000-8000-000000000004',
  };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
    campaignRecipientStepId: '80000000-0000-4000-8000-000000000008',
    reservedCampaignDraftIds,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  if (result.status !== 'drafted') return;
  assert.equal(result.draft.draftId, reservedCampaignDraftIds.draftId);
  assert.equal(result.draft.versionId, reservedCampaignDraftIds.versionId);
});

test('native drafting appends an arbitrary approved CTA exactly once on the server', async () => {
  const fixture = dependencies();
  const exactCta = 'Gracias por considerar esta propuesta concreta.';
  fixture.value.loadWritingStyle = async () => {
    const style = createDefaultDraftWritingStyleV2();
    return {
      ...style,
      profile: { ...style.profile, cta: { label: exactCta } },
    };
  };
  fixture.value.generate = async ({ context }) => {
    const output = generated(context);
    assert.doesNotMatch(output.body, new RegExp(exactCta));
    return output;
  };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  if (result.status !== 'drafted') return;
  const body = result.draft.content.text || '';
  assert.equal(body.split(exactCta).length - 1, 1);
  assert.ok(body.endsWith(exactCta));
  assert.ok((body.match(/[\p{L}\p{N}]+/gu)?.length || 0) >= 35);
  assert.ok((body.match(/[\p{L}\p{N}]+/gu)?.length || 0) <= 180);
});

test('native drafting removes a model CTA before appending the approved CTA', async () => {
  const fixture = dependencies();
  let generationCalls = 0;
  fixture.value.generate = async ({ context }) => {
    generationCalls += 1;
    const output = generated(context);
    return {
      ...output,
      body: `${output.body}\n\n¿Te parece si coordinamos una llamada la próxima semana?`,
    };
  };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  if (result.status !== 'drafted') return;
  const body = result.draft.content.text || '';
  assert.equal(generationCalls, 1);
  assert.doesNotMatch(body, /coordinamos una llamada/i);
  assert.equal(body.split(result.context.constraints.cta.exactText).length - 1, 1);
  assert.ok(body.endsWith(result.context.constraints.cta.exactText));
  assert.equal(result.preflight.status, 'passed');
});

test('native drafting retries a candidate shortened by an unapproved CTA before persisting', async () => {
  const fixture = dependencies();
  let generationCalls = 0;
  fixture.value.generate = async ({ context }) => {
    generationCalls += 1;
    if (generationCalls > 1) return generated(context);
    return {
      ...generated(context),
      body: `Hola Ada,

Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.

En Northstar ordenamos tareas para que el equipo encuentre información.

¿Te parece si coordinamos una llamada la próxima semana?`,
    };
  };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  assert.equal(generationCalls, 2);
  if (result.status !== 'drafted') return;
  assert.equal(result.preflight.status, 'passed');
  assert.equal(fixture.persisted.length, 1);
});

test('native drafting returns structured issues after two failed preflight generations', async () => {
  const fixture = dependencies();
  let generationCalls = 0;
  fixture.value.generate = async ({ context }) => {
    generationCalls += 1;
    return { ...generated(context), body: 'Hola Ada.' };
  };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.equal(result.code, 'draft_preflight_failed');
  assert.equal(generationCalls, 2);
  assert.deepEqual(result.issues.map((issue) => issue.code), ['body_length', 'personalization_invalid']);
  assert.deepEqual(result.preflight.errors, result.issues.map((issue) => issue.message));
  assert.equal(fixture.persisted.length, 0);
  assert.equal(fixture.releaseCount(), 1);
});

test('simulated numeric drafts accept supported paraphrase, fail closed twice, and recover on retry', async () => {
  for (const mode of ['supported', 'unsupported-twice', 'recovery'] as const) {
    const snapshot = draftSnapshotFixture();
    snapshot.evidence.find((item) => item.id === 'evidence-acme')!.statement = 'Acme opera 16 sedes regionales para reducir trabajo manual en operaciones.';
    const fixture = dependencies(snapshot);
    let calls = 0;
    fixture.value.generate = async ({ context, rewrite }) => {
      calls += 1;
      if (calls === 2) {
        assert.match(rewrite!.previous.body, /1 FCL/);
        assert.ok(rewrite!.errors.some((error) => /1 FCL/.test(error)));
      }
      const output = generated(context);
      const invented = mode === 'unsupported-twice' || (mode === 'recovery' && calls === 1);
      return {
        ...output,
        body: output.body.replace('Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.',
          `Acme opera 16 sedes para reducir trabajo manual en operaciones.${invented ? ' Acme transporta 1 FCL.' : ''}`),
      };
    };
    const result = await createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, fixture.value);
    assert.equal(calls, mode === 'supported' ? 1 : 2, mode);
    assert.equal(result.status, mode === 'unsupported-twice' ? 'blocked' : 'drafted', JSON.stringify(result));
    assert.equal(fixture.persisted.length, mode === 'unsupported-twice' ? 0 : 1);
    assert.equal(fixture.metadata.length, mode === 'unsupported-twice' ? 0 : 1);
    assert.equal(fixture.releaseCount(), 1);
    if (result.status === 'blocked') {
      assert.equal(result.code, 'draft_preflight_failed');
      assert.ok(result.issues.some((issue) => issue.code === 'unsupported_material_claim'));
    } else if (result.status === 'drafted') {
      assert.equal(result.preflight.status, 'passed');
      assert.doesNotMatch(result.draft.content.text || '', /1 FCL/);
    }
  }
});

test('native draft body normalization preserves paragraph boundaries', () => {
  assert.equal(
    normalizeNativeDraftBody(' Hola Ada, \r\n\r\n  Primer párrafo.  \r\n\r\n\r\n Segundo párrafo. '),
    'Hola Ada,\n\nPrimer párrafo.\n\nSegundo párrafo.',
  );
});

test('requested AI rewrites create a canonical revision and replace its generation metadata', async () => {
  const fixture = dependencies();
  fixture.value.generate = async ({ context }) => generated(context);
  const initial = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);
  assert.equal(initial.status, 'drafted');
  if (initial.status !== 'drafted') return;

  let receivedInstruction = '';
  const receivedSequenceContext: { value: OutreachSequenceContextV2 | null } = { value: null };
  const replacedMetadata: any[] = [];
  const rewriteDependencies: NativeDraftGenerationDependencies = {
    ...fixture.value,
    loadReportDocumentV1: async () => ({
      document: await fixture.value.ensureReportDocument!({} as any),
    } as any),
    loadMetadata: async () => ({
      ...fixture.metadata[0],
      versionId: initial.draft.versionId,
      draftId: initial.draft.draftId,
      researchSnapshotId: DRAFT_FIXTURE_IDS.snapshot,
      styleProfileId: null,
      claimIds: ['claim-acme-overview'],
    }),
    generate: async ({ context, rewrite, sequenceContext }) => {
      receivedInstruction = rewrite?.instruction || '';
      receivedSequenceContext.value = sequenceContext || null;
      return {
        ...generated(context),
        subject: 'Menos tareas manuales en Acme',
        body: `Hola Ada,

Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.

En Northstar automatizamos operaciones repetitivas para reducir tareas manuales y mantener la información disponible para el equipo.`,
      };
    },
    appendRevisionWithMetadata: async (parent, changes, metadata) => {
      replacedMetadata.push(metadata);
      return createChildMessagingDraftV1(parent, {
        ...changes,
        versionId: 'e4c25535-06ec-4dcb-b071-6033f4605cb5',
        createdAt: DRAFT_FIXTURE_NOW.toISOString(),
      });
    },
  };

  const result = await rewriteNativeDraft({
    ...access,
    draft: initial.draft,
    instruction: 'Hazlo más directo y conserva párrafos breves.',
    sequenceContext: {
      sequenceInstruction: 'Aporta valor nuevo sin repetir mensajes anteriores.',
      priorMessages: [{
        kind: 'initial',
        index: 0,
        name: 'Contacto inicial',
        subject: initial.draft.content.subject || 'Procesos en Acme',
        body: initial.draft.content.text || '',
      }],
      currentStep: {
        index: 1,
        total: 2,
        name: 'Primer seguimiento',
        offsetDays: 3,
        instruction: 'Usa un hecho nuevo y una pregunta breve.',
      },
    },
  }, rewriteDependencies);

  assert.equal(receivedInstruction, 'Hazlo más directo y conserva párrafos breves.');
  const sequenceContext = receivedSequenceContext.value;
  assert.ok(sequenceContext);
  assert.equal(sequenceContext.currentStep.index, 1);
  assert.equal(sequenceContext.priorMessages[0].kind, 'initial');
  assert.equal(result.draft.revision, 2);
  assert.equal(result.draft.parentVersionId, initial.draft.versionId);
  assert.equal(result.preflight.status, 'passed');
  assert.match(result.draft.content.text || '', /Hola Ada,\n\nAcme comunica que ayuda/);
  assert.deepEqual(replacedMetadata[0].claimIds, ['claim-acme-overview']);
  assert.equal(replacedMetadata[0].generationMethod, 'model');
});

test('requested AI rewrites fail closed when provenance points to another research snapshot', async () => {
  const fixture = dependencies();
  fixture.value.generate = async ({ context }) => generated(context);
  const initial = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);
  assert.equal(initial.status, 'drafted');
  if (initial.status !== 'drafted') return;

  let claimCalls = 0;
  const rewriteDependencies: NativeDraftGenerationDependencies = {
    ...fixture.value,
    loadMetadata: async () => ({
      ...fixture.metadata[0],
      versionId: initial.draft.versionId,
      draftId: initial.draft.draftId,
      researchSnapshotId: '70000000-0000-4000-8000-000000000007',
      styleProfileId: null,
      claimIds: ['claim-acme-overview'],
    }),
    claimGeneration: async () => {
      claimCalls += 1;
      return { state: 'claimed', claimToken: 'claim-token' };
    },
  };

  await assert.rejects(
    () => rewriteNativeDraft({
      ...access,
      draft: initial.draft,
      instruction: 'Hazlo más directo.',
    }, rewriteDependencies),
    /NATIVE_RESEARCH_SNAPSHOT_CONFLICT/,
  );
  assert.equal(claimCalls, 0);
});

test('manual revisions claim the draft and preserve canonical snapshot metadata', async () => {
  const fixture = dependencies();
  fixture.value.generate = async ({ context }) => generated(context);
  const initial = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);
  assert.equal(initial.status, 'drafted');
  if (initial.status !== 'drafted') return;

  const childVersionId = 'e4c25535-06ec-4dcb-b071-6033f4605cb5';
  let claimCalls = 0;
  let releaseCalls = 0;
  let appendCalls = 0;
  const replacedMetadata: any[] = [];
  const revisionDependencies: NativeDraftGenerationDependencies = {
    ...fixture.value,
    loadMetadata: async ({ versionId }) => ({
      ...fixture.metadata[0],
      versionId,
      draftId: initial.draft.draftId,
      researchSnapshotId: DRAFT_FIXTURE_IDS.snapshot,
      styleProfileId: null,
      claimIds: ['claim-acme-overview'],
    }),
    claimGeneration: async () => {
      claimCalls += 1;
      return { state: 'claimed', claimToken: 'claim-token' };
    },
    releaseGeneration: async () => {
      releaseCalls += 1;
      return true;
    },
    appendRevisionWithMetadata: async (parent, changes, metadata) => {
      appendCalls += 1;
      replacedMetadata.push(metadata);
      return createChildMessagingDraftV1(parent, {
        ...changes,
        versionId: childVersionId,
        createdAt: DRAFT_FIXTURE_NOW.toISOString(),
      });
    },
  };

  const revised = await reviseNativeDraft({
    ...access,
    draft: initial.draft,
    subject: 'Procesos más claros en Acme',
    text: `${initial.draft.content.text}\n\nPodemos revisar el primer proceso prioritario.`,
  }, revisionDependencies);

  assert.equal(revised.versionId, childVersionId);
  assert.equal(appendCalls, 1);
  assert.equal(claimCalls, 1);
  assert.equal(releaseCalls, 1);
  assert.equal(revised.approval.status, 'pending');
  assert.equal(revised.preflight.status, 'pending');
  assert.equal(replacedMetadata[0].generationMethod, 'human');
  assert.equal(replacedMetadata[0].provider, null);
  assert.equal(replacedMetadata[0].model, null);
  assert.equal(replacedMetadata[0].reportContentHash, fixture.metadata[0].reportContentHash);
});

test('rewrite preview validates a proposal without any persistence and PATCH resets approval', async () => {
  const fixture = dependencies();
  fixture.value.generate = async ({ context }) => generated(context);
  const initial = await createNativeDraft({ ...access, snapshotId: DRAFT_FIXTURE_IDS.snapshot }, fixture.value);
  assert.equal(initial.status, 'drafted');
  if (initial.status !== 'drafted') return;
  const document = await fixture.value.ensureReportDocument!({} as any);
  const before = structuredClone(initial.draft);
  const noWrite = async (): Promise<never> => { throw new Error('Preview attempted persistence'); };
  const deps: NativeDraftGenerationDependencies = {
    ...fixture.value,
    loadMetadata: async () => fixture.metadata[0],
    loadReportDocumentV1: async () => ({ document } as any),
    ensureReportDocument: noWrite,
    claimGeneration: noWrite,
    releaseGeneration: noWrite,
    persistDraft: noWrite,
    persistDraftWithMetadata: noWrite,
    persistMetadata: noWrite,
    appendRevisionWithMetadata: noWrite,
    generate: async ({ context }) => ({ ...generated(context), subject: 'Menos tareas manuales en Acme' }),
  };
  const request = { ...access, draft: initial.draft, instruction: 'Mejora el asunto', previewOnly: true as const, expectedVersionId: initial.draft.versionId };
  const result = await rewriteNativeDraft(request, deps);
  assert.deepEqual(Object.keys(result.proposal).sort(), ['body', 'expectedVersionId', 'subject']);
  assert.equal(result.proposal.expectedVersionId, initial.draft.versionId);
  assert.equal(result.preflight.status, 'passed');
  assert.equal('draft' in result, false);
  assert.deepEqual(initial.draft, before);

  await assert.rejects(() => rewriteNativeDraft({ ...request, expectedVersionId: 'stale' }, deps), /NATIVE_DRAFT_VERSION_CONFLICT/);
  await assert.rejects(() => reviseNativeDraft({ ...access, draft: initial.draft, expectedVersionId: 'stale', subject: result.proposal.subject }, deps), /NATIVE_DRAFT_VERSION_CONFLICT/);
  await assert.rejects(() => rewriteNativeDraft(request, { ...deps, generate: async ({ context }) => ({ ...generated(context), body: 'Hola.' }) }), { name: 'NativeDraftPreflightError' });
  await assert.rejects(() => rewriteNativeDraft(request, { ...deps, isSuppressed: async () => true }), /NATIVE_DRAFT_PRIVACY_SUPPRESSED/);
  for (const styleProfileId of ['70000000-0000-4000-8000-000000000002', 'preset:another-style']) {
    await assert.rejects(() => rewriteNativeDraft({ ...request, styleProfileId }, {
      ...deps,
      loadWritingStyle: noWrite,
      generate: noWrite,
    }), /NATIVE_DRAFT_PREVIEW_STYLE_CHANGE_UNSUPPORTED/);
  }
  const sameStyleId = '70000000-0000-4000-8000-000000000002';
  const sameStyle = await rewriteNativeDraft({ ...request, styleProfileId: sameStyleId }, {
    ...deps,
    loadMetadata: async () => ({ ...fixture.metadata[0], styleProfileId: sameStyleId }),
    loadWritingStyle: async () => ({ ...createDefaultDraftWritingStyleV2(), id: sameStyleId }),
  });
  assert.equal(sameStyle.preflight.status, 'passed');

  const failedPersistence = {
    ...fixture.value,
    loadMetadata: deps.loadMetadata,
    loadReportDocumentV1: deps.loadReportDocumentV1,
    generate: deps.generate,
    appendRevisionWithMetadata: async (): Promise<never> => { throw new Error('atomic metadata failure'); },
  };
  const releasesBefore = fixture.releaseCount();
  await assert.rejects(() => reviseNativeDraft({ ...access, draft: initial.draft, subject: result.proposal.subject }, failedPersistence), /atomic metadata failure/);
  await assert.rejects(() => rewriteNativeDraft({ ...request, previewOnly: false }, failedPersistence), /atomic metadata failure/);
  assert.equal(fixture.releaseCount(), releasesBefore + 2);
  assert.deepEqual(initial.draft, before);

  const metadataUpdates: any[] = [];
  const applied = await reviseNativeDraft({ ...access, draft: { ...initial.draft, approval: { status: 'approved', decidedBy: access.userId, decidedAt: DRAFT_FIXTURE_NOW.toISOString(), reason: null } }, expectedVersionId: result.proposal.expectedVersionId, subject: result.proposal.subject, text: result.proposal.body }, {
    ...fixture.value,
    loadMetadata: async ({ versionId }) => ({ ...fixture.metadata[0], versionId }),
    appendRevisionWithMetadata: async (parent, changes, metadata) => {
      metadataUpdates.push(metadata);
      return createChildMessagingDraftV1(parent, { ...changes, versionId: 'e4c25535-06ec-4dcb-b071-6033f4605cb5', createdAt: DRAFT_FIXTURE_NOW.toISOString() });
    },
  });
  assert.equal(applied.approval.status, 'pending');
  assert.equal(applied.content.text, result.proposal.body);
  assert.equal(applied.content.html, null);
  assert.equal(metadataUpdates[0].generationMethod, 'human');
  assert.equal(metadataUpdates[0].styleProfileId, fixture.metadata[0].styleProfileId);
});

test('native drafting replaces model-supplied provenance IDs with the canonical factual evidence', async () => {
  const fixture = dependencies();
  fixture.value.generate = async ({ context }) => ({
    ...generated(context),
    personalization: [{
      evidenceId: 'evidence-invented-by-model',
      claimId: 'claim-acme-opportunity',
      sourceUrl: 'https://unverified.example/source',
    }],
  });

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'drafted');
  if (result.status !== 'drafted') return;
  assert.equal(result.preflight.status, 'passed');
  assert.deepEqual(fixture.metadata[0].claimIds, ['claim-acme-overview']);
});

test('research below the quality threshold returns a blocked result before it claims or calls OpenAI', async () => {
  const baseSnapshot = draftSnapshotFixture({ includeRole: false });
  const fixture = dependencies({
    ...baseSnapshot,
    quality: { ...baseSnapshot.quality, overallConfidence: 0.2 },
  });
  fixture.value.generate = async () => { throw new Error('OpenAI should not be called'); };

  const result = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
  }, fixture.value);

  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.equal(result.code, 'quality_below_threshold');
  assert.equal(result.draft, null);
  assert.equal(result.preflight.status, 'failed');
  assert.equal(fixture.claimCount(), 0);
  assert.equal(fixture.persisted.length, 0);
});
