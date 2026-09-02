import assert from 'node:assert/strict';
import test from 'node:test';

import type { MessagingDraftV1 } from '@/lib/messaging-contracts';
import { campaignFollowUpDraftIds } from '@/lib/server/native-drafts';
import { generateFollowUpDraftBatch } from './follow-up-draft-batch';

const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const snapshotId = '30000000-0000-4000-8000-000000000001';

function draft(draftId: string, versionId: string, subject: string): MessagingDraftV1 {
  return {
    schemaVersion: 1,
    draftId,
    versionId,
    organizationId,
    userId,
    researchSnapshotId: snapshotId,
    revision: 1,
    parentVersionId: null,
    lifecycle: 'draft',
    channel: 'email',
    recipient: { leadRef: null, displayName: 'Ada', email: 'ada@example.com', linkedinUrl: null },
    content: { subject, text: `Hola Ada, ${subject}.`, html: null },
    approval: { status: 'pending', decidedBy: null, decidedAt: null, reason: null },
    preflight: { status: 'passed', checkedAt: '2026-08-25T12:00:00.000Z', errors: [], warnings: [] },
    createdAt: '2026-08-25T12:00:00.000Z',
  };
}

const initialDraft = draft(
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'Contacto inicial',
);
const steps = [1, 2, 3].map((index) => ({
  id: `60000000-0000-4000-8000-00000000000${index}`,
  index,
  name: `Seguimiento ${index}`,
  offsetDays: index * 3,
  instruction: `Instrucción ${index}`,
  nativeDraftId: null,
}));

test('pre-generates follow-ups sequentially with style and ordered non-factual sequence context', async () => {
  const requests: any[] = [];
  const reservations: Array<{ stepId: string; draftId: string; versionId: string }> = [];
  const linked: string[] = [];
  const existingDrafts = new Map<string, MessagingDraftV1>();

  await generateFollowUpDraftBatch({
    organizationId,
    userId,
    snapshotId,
    config: {
      styleProfileId: '70000000-0000-4000-8000-000000000001',
      sequenceInstruction: 'Avanza la conversación sin repetir argumentos.',
    },
    initialDraft,
    steps,
    existingDrafts,
  }, {
    createDraft: async (request) => {
      requests.push(request);
      const index = requests.length;
      const ids = campaignFollowUpDraftIds({
        organizationId,
        userId,
        stepId: request.campaignRecipientStepId!,
      });
      return {
        status: 'drafted',
        draft: draft(
          ids.draftId,
          ids.versionId,
          `Borrador ${index}`,
        ),
      } as any;
    },
    reserveDraft: async (reservation) => { reservations.push(reservation); },
    linkDraft: async ({ stepId, draft: linkedDraft }) => {
      assert.equal(linkedDraft.approval.status, 'pending');
      linked.push(stepId);
    },
    recordError: async () => assert.fail('generation should not fail'),
  });

  assert.deepEqual(linked, steps.map((step) => step.id));
  assert.deepEqual(reservations.map((reservation) => reservation.stepId), steps.map((step) => step.id));
  assert.deepEqual(requests.map((request) => request.campaignRecipientStepId), steps.map((step) => step.id));
  assert.deepEqual(reservations.map(({ draftId, versionId }) => [draftId, versionId]), requests.map((request) => {
    const ids = campaignFollowUpDraftIds({ organizationId, userId, stepId: request.campaignRecipientStepId });
    return [ids.draftId, ids.versionId];
  }));
  assert.deepEqual(requests.map((request) => request.idempotencyKey), steps.map(
    (step) => `campaign-recipient-step:${step.id}`,
  ));
  assert.ok(requests.every((request) => request.styleProfileId === '70000000-0000-4000-8000-000000000001'));
  assert.deepEqual(requests.map((request) => request.sequenceContext.currentStep), steps.map((step) => ({
    index: step.index,
    total: 3,
    name: step.name,
    offsetDays: step.offsetDays,
    instruction: step.instruction,
  })));
  assert.deepEqual(requests.map((request) => request.sequenceContext.priorMessages.map(
    (message: any) => [message.kind, message.index, message.subject],
  )), [
    [['initial', 0, 'Contacto inicial']],
    [['initial', 0, 'Contacto inicial'], ['follow_up', 1, 'Borrador 1']],
    [['initial', 0, 'Contacto inicial'], ['follow_up', 1, 'Borrador 1'], ['follow_up', 2, 'Borrador 2']],
  ]);
});

test('records partial failures and retries only missing drafts on the next batch', async () => {
  const existingDrafts = new Map<string, MessagingDraftV1>();
  const errors: string[] = [];
  const attempts: string[] = [];
  let failSecond = true;
  const dependencies = {
    createDraft: async (request: any) => {
      attempts.push(request.idempotencyKey);
      const stepId = String(request.idempotencyKey).split(':').at(-1)!;
      const index = steps.find((step) => step.id === stepId)!.index;
      if (index === 2 && failSecond) {
        return { status: 'failed', message: 'generation unavailable' } as any;
      }
      const ids = campaignFollowUpDraftIds({ organizationId, userId, stepId });
      return {
        status: 'drafted',
        draft: draft(
          ids.draftId,
          ids.versionId,
          `Borrador ${index}`,
        ),
      } as any;
    },
    reserveDraft: async () => undefined,
    linkDraft: async () => undefined,
    recordError: async ({ error }: { error: string }) => { errors.push(error); },
  };
  const input = {
    organizationId,
    userId,
    snapshotId,
    config: { styleProfileId: null, sequenceInstruction: 'Continúa con claridad.' },
    initialDraft,
    steps,
    existingDrafts,
  };

  await generateFollowUpDraftBatch(input, dependencies);
  assert.equal(existingDrafts.size, 1);
  assert.deepEqual(errors, ['generation unavailable']);

  failSecond = false;
  await generateFollowUpDraftBatch(input, dependencies);
  assert.equal(existingDrafts.size, 3);
  assert.equal(attempts.filter((key) => key.endsWith(steps[0].id)).length, 1);
  assert.equal(attempts.filter((key) => key.endsWith(steps[1].id)).length, 2);
  assert.equal(attempts.filter((key) => key.endsWith(steps[2].id)).length, 1);
});

test('does not generate a targeted follow-up while an earlier draft is missing', async () => {
  const errors: string[] = [];
  let reserveCalls = 0;
  let generationCalls = 0;

  await generateFollowUpDraftBatch({
    organizationId,
    userId,
    snapshotId,
    config: { styleProfileId: null, sequenceInstruction: 'Continúa con claridad.' },
    initialDraft,
    steps,
    existingDrafts: new Map(),
    targetStepId: steps[1].id,
  }, {
    reserveDraft: async () => { reserveCalls += 1; },
    createDraft: async () => {
      generationCalls += 1;
      throw new Error('generation must not run');
    },
    linkDraft: async () => assert.fail('draft must not be linked'),
    recordError: async ({ error }) => { errors.push(error); },
  });

  assert.equal(reserveCalls, 0);
  assert.equal(generationCalls, 0);
  assert.deepEqual(errors, ['Genera primero los seguimientos anteriores para mantener la continuidad.']);
});

test('does not reserve a follow-up when the seller profile has no usable offer', async () => {
  const errors: string[] = [];
  let reserveCalls = 0;
  let generationCalls = 0;

  await generateFollowUpDraftBatch({
    organizationId,
    userId,
    snapshotId,
    config: { styleProfileId: null, sequenceInstruction: 'Continúa con claridad.' },
    initialDraft,
    steps: [steps[0]],
    existingDrafts: new Map(),
    sellerProfile: {
      name: null,
      jobTitle: null,
      companyName: 'Northstar',
      companyDomain: null,
      sector: null,
      description: null,
      services: [],
      valueProposition: null,
      proofPoints: [],
    },
  }, {
    reserveDraft: async () => { reserveCalls += 1; },
    createDraft: async () => {
      generationCalls += 1;
      throw new Error('generation must not run');
    },
    linkDraft: async () => assert.fail('draft must not be linked'),
    recordError: async ({ error }) => { errors.push(error); },
  });

  assert.equal(reserveCalls, 0);
  assert.equal(generationCalls, 0);
  assert.deepEqual(errors, ['Completa Productos y servicios o Propuesta de valor en tu perfil antes de crear el borrador.']);
});

test('reuses an unlinked durable reservation after the seller profile changes', async () => {
  const previousSellerProfile = {
    name: null,
    jobTitle: null,
    companyName: 'Northstar',
    companyDomain: null,
    sector: null,
    description: null,
    services: ['Automatización de operaciones'],
    valueProposition: null,
    proofPoints: [],
  };
  const sellerProfile = {
    ...previousSellerProfile,
    services: ['Integración de datos operativos'],
  };
  const reserved = campaignFollowUpDraftIds({
    organizationId,
    userId,
    stepId: steps[0].id,
    sellerProfile: previousSellerProfile,
  });
  const reservedStep = {
    ...steps[0],
    reservedDraftId: reserved.draftId,
    reservedVersionId: reserved.versionId,
  };
  const reservations: Array<{ stepId: string; draftId: string; versionId: string }> = [];
  const requests: any[] = [];

  await generateFollowUpDraftBatch({
    organizationId,
    userId,
    snapshotId,
    config: { styleProfileId: null, sequenceInstruction: 'Continúa con claridad.' },
    initialDraft,
    steps: [reservedStep],
    existingDrafts: new Map(),
    sellerProfile,
  }, {
    reserveDraft: async (reservation) => { reservations.push(reservation); },
    createDraft: async (request) => {
      requests.push(request);
      return { status: 'drafted', draft: draft(reserved.draftId, reserved.versionId, 'Borrador reintentado') } as any;
    },
    linkDraft: async () => undefined,
    recordError: async () => assert.fail('generation should not fail'),
  });

  assert.deepEqual(reservations, [{ stepId: reservedStep.id, ...reserved }]);
  assert.deepEqual(requests[0].reservedCampaignDraftIds, reserved);
  assert.deepEqual(requests[0].sellerProfile, sellerProfile);
  assert.notDeepEqual(
    reserved,
    campaignFollowUpDraftIds({ organizationId, userId, stepId: reservedStep.id, sellerProfile }),
  );
});

test('preserves an already linked follow-up when the seller profile changes', async () => {
  const linkedDraft = draft(
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000002',
    'Borrador editado',
  );
  let dependencyCalls = 0;

  await generateFollowUpDraftBatch({
    organizationId,
    userId,
    snapshotId,
    config: { styleProfileId: null, sequenceInstruction: 'Continúa con claridad.' },
    initialDraft,
    steps: [{ ...steps[0], nativeDraftId: linkedDraft.draftId }],
    existingDrafts: new Map([[steps[0].id, linkedDraft]]),
    sellerProfile: {
      name: null,
      jobTitle: null,
      companyName: 'Northstar',
      companyDomain: null,
      sector: null,
      description: null,
      services: ['Una oferta nueva'],
      valueProposition: null,
      proofPoints: [],
    },
  }, {
    reserveDraft: async () => { dependencyCalls += 1; },
    createDraft: async () => {
      dependencyCalls += 1;
      throw new Error('generation must not run');
    },
    linkDraft: async () => { dependencyCalls += 1; },
    recordError: async () => { dependencyCalls += 1; },
  });

  assert.equal(dependencyCalls, 0);
});
