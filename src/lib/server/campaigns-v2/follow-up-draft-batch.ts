import {
  OutreachSequenceContextV2Schema,
  type OutreachSequenceContextV2,
} from '@/lib/campaigns-v2/outreach-sequence-context';
import type { MessagingDraftV1 } from '@/lib/messaging-contracts';
import {
  campaignFollowUpDraftIds,
  type createNativeDraft,
  type NativeDraftGenerationResult,
} from '@/lib/server/native-drafts';

type FollowUpDraftStep = {
  id: string;
  index: number;
  name: string;
  offsetDays: number;
  instruction: string;
  nativeDraftId: string | null;
};

type FollowUpDraftBatchDependencies = {
  createDraft: (input: Parameters<typeof createNativeDraft>[0]) => Promise<NativeDraftGenerationResult>;
  reserveDraft: (input: { stepId: string; draftId: string; versionId: string }) => Promise<void>;
  linkDraft: (input: { stepId: string; draft: MessagingDraftV1 }) => Promise<void>;
  recordError: (input: { stepId: string; error: string }) => Promise<void>;
};

function text(value: unknown) {
  return String(value || '').trim();
}

function draftMessage(
  draft: MessagingDraftV1,
  input: { kind: 'initial' | 'follow_up'; index: number; name: string },
) {
  return {
    ...input,
    subject: text(draft.content.subject),
    body: text(draft.content.text || draft.content.html),
  };
}

function generationError(error: unknown) {
  return (error instanceof Error ? error.message : text(error) || 'draft_generation_failed').slice(0, 2_000);
}

export async function generateFollowUpDraftBatch(input: {
  organizationId: string;
  userId: string;
  snapshotId: string;
  config: { sequenceInstruction: string; styleProfileId: string | null };
  initialDraft: MessagingDraftV1;
  steps: FollowUpDraftStep[];
  existingDrafts: Map<string, MessagingDraftV1>;
  targetStepId?: string;
}, dependencies: FollowUpDraftBatchDependencies) {
  const steps = [...input.steps].sort((left, right) => left.index - right.index);
  const total = steps.length;

  for (const step of steps) {
    if (input.targetStepId && step.id !== input.targetStepId) continue;
    if (step.nativeDraftId || input.existingDrafts.has(step.id)) continue;

    const priorMessages = [draftMessage(input.initialDraft, {
      kind: 'initial' as const,
      index: 0,
      name: 'Contacto inicial',
    })];
    let missingPriorDraft = false;
    for (const priorStep of steps) {
      if (priorStep.index >= step.index) break;
      const priorDraft = input.existingDrafts.get(priorStep.id);
      if (!priorDraft) {
        missingPriorDraft = true;
        break;
      }
      priorMessages.push(draftMessage(priorDraft, {
        kind: 'follow_up',
        index: priorStep.index,
        name: priorStep.name,
      }));
    }
    if (missingPriorDraft) {
      await dependencies.recordError({
        stepId: step.id,
        error: 'Genera primero los seguimientos anteriores para mantener la continuidad.',
      });
      break;
    }
    const sequenceContext: OutreachSequenceContextV2 = OutreachSequenceContextV2Schema.parse({
      sequenceInstruction: input.config.sequenceInstruction,
      priorMessages,
      currentStep: {
        index: step.index,
        total,
        name: step.name,
        offsetDays: step.offsetDays,
        instruction: step.instruction,
      },
    });

    try {
      const reserved = campaignFollowUpDraftIds({
        organizationId: input.organizationId,
        userId: input.userId,
        stepId: step.id,
      });
      await dependencies.reserveDraft({ stepId: step.id, ...reserved });
      const result = await dependencies.createDraft({
        organizationId: input.organizationId,
        userId: input.userId,
        snapshotId: input.snapshotId,
        styleProfileId: input.config.styleProfileId,
        instruction: step.instruction,
        sequenceContext,
        idempotencyKey: `campaign-recipient-step:${step.id}`,
        campaignRecipientStepId: step.id,
      });
      if (result.status !== 'drafted') {
        await dependencies.recordError({ stepId: step.id, error: result.message.slice(0, 2_000) });
        break;
      }
      if (result.draft.draftId !== reserved.draftId || result.draft.versionId !== reserved.versionId) {
        throw new Error('CAMPAIGN_V2_RESERVED_DRAFT_IDENTITY_MISMATCH');
      }
      await dependencies.linkDraft({ stepId: step.id, draft: result.draft });
      input.existingDrafts.set(step.id, result.draft);
    } catch (error) {
      await dependencies.recordError({ stepId: step.id, error: generationError(error) });
      break;
    }
  }
}
