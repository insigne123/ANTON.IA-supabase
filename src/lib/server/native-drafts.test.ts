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
import { canonicalSha256, createChildMessagingDraftV1, type MessagingDraftV1 } from '@/lib/messaging-contracts';

const access = {
  organizationId: DRAFT_FIXTURE_IDS.organization,
  userId: DRAFT_FIXTURE_IDS.user,
};

function generated(context: DraftContextV2): GeneratedOutreachFromDraftContextV2 {
  const evidence = context.evidence.find((item) => item.supportedFactClaimIds.includes('claim-acme-overview'))!;
  return {
    subject: 'Una idea para Acme',
    body: `Hola Ada,

Vi que Acme publica un foco claro en reducir trabajo manual dentro de las operaciones. En Northstar ayudamos a equipos que quieren ordenar tareas repetitivas sin imponer cambios bruscos a su forma de trabajo.

Por tu rol de Directora de Operaciones, pensé que podría ser útil compartir un ejemplo práctico de cómo detectar procesos que consumen tiempo y priorizar los primeros ajustes. La idea es entender el contexto de Acme antes de proponer cualquier alternativa concreta.

${context.constraints.cta.exactText}`,
    personalization: [{
      evidenceId: evidence.evidenceId,
      claimId: 'claim-acme-overview',
      sourceUrl: evidence.source.url,
    }],
    hypothesisIds: [],
    provider: 'openai',
    model: 'test-model',
    promptVersion: 'native-draft/v2',
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
  assert.match(result.draft.content.text || '', /Hola Ada,\n\nVi que Acme/);
  assert.equal(fixture.persisted.length, 1);
  assert.deepEqual(fixture.metadata[0].claimIds, ['claim-acme-overview']);
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

Vi que Acme mantiene un foco claro en reducir trabajo manual dentro de sus operaciones.

En Northstar ayudamos a ordenar tareas repetitivas con un enfoque gradual, sin imponer cambios bruscos al equipo.

Por tu rol de Directora de Operaciones, pensé que podía ser útil compartir una forma práctica de detectar procesos que consumen tiempo y priorizar los primeros ajustes según el contexto actual de Acme.

${context.constraints.cta.exactText}`,
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
  assert.match(result.draft.content.text || '', /Hola Ada,\n\nVi que Acme/);
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
