import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNativeDraft,
  normalizeNativeDraftBody,
  rewriteNativeDraft,
  type NativeDraftGenerationDependencies,
} from './native-drafts';
import {
  createDefaultDraftWritingStyleV2,
  normalizeDraftSellerProfileV2,
  type DraftContextV2,
} from './draft-context-v2';
import {
  DRAFT_FIXTURE_IDS,
  DRAFT_FIXTURE_NOW,
  draftSnapshotFixture,
} from './draft-v2-test-fixtures';
import type { GeneratedOutreachFromDraftContextV2 } from '@/ai/flows/generate-outreach-from-report';
import { buildDeterministicResearchReportDocumentV1 } from '@/ai/flows/synthesize-research-report';
import { canonicalSha256, createChildMessagingDraftV1, type MessagingDraftV1 } from '@/lib/messaging-contracts';
import { ResearchReportDocumentV1Schema } from '@/lib/research-report-contracts';

const access = {
  organizationId: DRAFT_FIXTURE_IDS.organization,
  userId: DRAFT_FIXTURE_IDS.user,
};

function generated(context: DraftContextV2): GeneratedOutreachFromDraftContextV2 {
  const evidence = context.evidence.find((item) => item.supportedFactClaimIds.includes('claim-acme-overview'))!;
  return {
    subject: 'Una idea para Acme',
    body: `Hola Ada,

Acme publica que ayuda a equipos de operaciones a reducir trabajo manual. En Northstar ayudamos a equipos que quieren ordenar tareas repetitivas sin imponer cambios bruscos a su forma de trabajo.

Pensé que podría ser útil compartir un ejemplo práctico de cómo detectar procesos que consumen tiempo y priorizar los primeros ajustes. La idea es entender el contexto de Acme antes de proponer cualquier alternativa concreta.`,
    personalization: [{
      evidenceId: evidence.evidenceId,
      claimId: 'claim-acme-overview',
      sourceUrl: evidence.source.url,
    }],
    hypothesisIds: [],
    provider: 'openai',
    model: 'test-model',
    promptVersion: 'native-draft/v7',
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

test('native drafting repairs missing generation metadata before replaying a persisted draft', async () => {
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
  let repairedMetadata: any = null;
  fixture.value.findPersistedDraft = async () => persisted;
  fixture.value.loadMetadata = async () => null;
  fixture.value.persistMetadata = async (input) => { repairedMetadata = input; };

  const replay = await createNativeDraft({
    ...access,
    snapshotId: DRAFT_FIXTURE_IDS.snapshot,
    campaignRecipientStepId,
  }, fixture.value);

  assert.equal(replay.status, 'drafted');
  assert.equal(fixture.claimCount(), 1);
  assert.equal(repairedMetadata?.draftId, persisted.draftId);
  assert.equal(repairedMetadata?.versionId, persisted.versionId);
  assert.equal(repairedMetadata?.model, 'persisted-recovery');
  assert.deepEqual(repairedMetadata?.claimIds, ['claim-acme-overview']);
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
  assert.match(result.draft.content.text || '', /Hola Ada,\n\nAcme publica que ayuda/);
  assert.ok(result.draft.content.text?.endsWith(result.context.constraints.cta.exactText));
  assert.equal(fixture.persisted.length, 1);
  assert.deepEqual(fixture.metadata[0].claimIds, ['claim-acme-overview']);
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
  assert.ok((body.match(/[\p{L}\p{N}]+/gu)?.length || 0) >= 60);
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

test('native drafting retries when CTA removal makes the final body too short', async () => {
  const fixture = dependencies();
  let generationCalls = 0;
  let correctiveErrors: string[] = [];
  fixture.value.generate = async ({ context, rewrite }) => {
    generationCalls += 1;
    if (rewrite) correctiveErrors = rewrite.errors;
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
  assert.ok(correctiveErrors.some((error) => /entre 60 y 180 palabras/i.test(error)));
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
  const replacedMetadata: any[] = [];
  const rewriteDependencies: NativeDraftGenerationDependencies = {
    ...fixture.value,
    loadMetadata: async () => ({
      versionId: initial.draft.versionId,
      draftId: initial.draft.draftId,
      styleProfileId: null,
      claimIds: ['claim-acme-overview'],
    }),
    generate: async ({ context, rewrite }) => {
      receivedInstruction = rewrite?.instruction || '';
      return {
        ...generated(context),
        subject: 'Acme, una alternativa más directa',
        body: `Hola Ada,

Acme publica que ayuda a equipos de operaciones a reducir trabajo manual.

En Northstar ayudamos a ordenar tareas repetitivas con un enfoque gradual, sin imponer cambios bruscos al equipo.

Pensé que podía ser útil compartir una forma práctica de detectar procesos que consumen tiempo y priorizar los primeros ajustes según el contexto actual de Acme.`,
      };
    },
    appendRevision: async (parent, changes) => createChildMessagingDraftV1(parent, {
      ...changes,
      versionId: 'e4c25535-06ec-4dcb-b071-6033f4605cb5',
      createdAt: DRAFT_FIXTURE_NOW.toISOString(),
    }),
    replaceMetadata: async (input) => { replacedMetadata.push(input); },
  };

  const result = await rewriteNativeDraft({
    ...access,
    draft: initial.draft,
    instruction: 'Hazlo más directo y conserva párrafos breves.',
  }, rewriteDependencies);

  assert.equal(receivedInstruction, 'Hazlo más directo y conserva párrafos breves.');
  assert.equal(result.draft.revision, 2);
  assert.equal(result.draft.parentVersionId, initial.draft.versionId);
  assert.equal(result.preflight.status, 'passed');
  assert.match(result.draft.content.text || '', /Hola Ada,\n\nAcme publica que ayuda/);
  assert.deepEqual(replacedMetadata[0].claimIds, ['claim-acme-overview']);
  assert.equal(replacedMetadata[0].generationMethod, 'model');
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
