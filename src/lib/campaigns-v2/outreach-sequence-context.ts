import { z } from 'zod';

export const OutreachSequenceContextV2Schema = z.object({
  sequenceInstruction: z.string().trim().min(1).max(1_000),
  priorMessages: z.array(z.object({
    kind: z.enum(['initial', 'follow_up']),
    index: z.number().int().min(0).max(3),
    name: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(998),
    body: z.string().trim().min(1).max(500_000),
  }).strict()).min(1).max(4),
  currentStep: z.object({
    index: z.number().int().min(1).max(4),
    total: z.number().int().min(1).max(4),
    name: z.string().trim().min(1).max(120),
    offsetDays: z.number().int().min(1).max(365),
    instruction: z.string().trim().min(1).max(1_000),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.currentStep.index > value.currentStep.total) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currentStep', 'index'],
      message: 'Current sequence index cannot exceed the total',
    });
  }
  if (value.priorMessages.length > value.currentStep.index) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priorMessages'],
      message: 'Sequence context cannot contain future messages',
    });
  }
  value.priorMessages.forEach((message, index) => {
    const previousIndex = value.priorMessages[index - 1]?.index ?? -1;
    if (
      (index === 0 && (message.index !== 0 || message.kind !== 'initial'))
      || (index > 0 && (message.kind !== 'follow_up' || message.index <= previousIndex))
      || message.index >= value.currentStep.index
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priorMessages', index],
        message: 'Sequence messages must be ordered with the initial email first',
      });
    }
  });
});

export type OutreachSequenceContextV2 = z.infer<typeof OutreachSequenceContextV2Schema>;
