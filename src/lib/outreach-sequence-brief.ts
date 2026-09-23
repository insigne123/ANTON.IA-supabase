import { z } from 'zod';
import { buildDraftMessageBrief, draftMessageBriefForModel } from './draft-message-brief';
import { selectOutreachStrategy } from './outreach-evidence-ranking';
import { selectOutreachExamples } from './outreach-example-library';
import type { DraftContextV2 } from './server/draft-context-v2';

// Four email drafts for the SAME recipient. The playbook's channel switch and
// alternate recipient are deliberately not email steps or evidence of contact.
export const RESEARCH_SEQUENCE_STEPS = [
  { name: 'Respaldo', offsetDays: 3, instruction: 'Aporta una prueba autorizada o concreta cómo se aplica la misma oferta. No inventes cifras, garantías ni objeciones del contacto.' },
  { name: 'Segundo ángulo', offsetDays: 5, instruction: 'Profundiza una aplicación distinta del mismo servicio pertinente a este cargo. No cambies de destinatario ni afirmes contacto con colegas.' },
  { name: 'Cierre', offsetDays: 10, instruction: 'Cierra el tema en menos de 80 palabras, sin presión ni nueva oferta. No afirmes envíos previos, silencio ni falta de prioridad.' },
] as const;

export function researchSequenceSteps(followUpCount: number) {
  const selected = followUpCount === 0 ? [] : followUpCount === 1
    ? [RESEARCH_SEQUENCE_STEPS[2]]
    : followUpCount === 2 ? [RESEARCH_SEQUENCE_STEPS[0], RESEARCH_SEQUENCE_STEPS[2]]
      : [...RESEARCH_SEQUENCE_STEPS];
  return selected.map((step, index) => ({ ...step, offsetDays: RESEARCH_SEQUENCE_STEPS[index].offsetDays }));
}

export const SharedSequenceBriefSchema = z.object({
  version: z.literal('research-sequence/v1'),
  topic: z.string().max(4_000),
  role: z.string().max(1_000).nullable(),
  authorizedContext: z.string().max(100_000),
  stages: z.array(z.object({
    index: z.number().int().min(0).max(3),
    goal: z.enum(['initial', 'proof', 'angle', 'close']),
    exampleIds: z.array(z.string()).max(3),
  }).strict()).min(1).max(4),
}).strict();
export type SharedSequenceBrief = z.infer<typeof SharedSequenceBriefSchema>;

export function buildSharedSequenceBrief(context: DraftContextV2, followUpCount = 3): SharedSequenceBrief {
  const strategy = selectOutreachStrategy(context);
  const topic = strategy?.capability || context.seller.services[0] || context.seller.valueProposition || '';
  const goals: Array<'initial' | 'proof' | 'angle' | 'close'> = followUpCount === 0 ? ['initial'] : followUpCount === 1 ? ['initial', 'close'] : followUpCount === 2 ? ['initial', 'proof', 'close'] : ['initial', 'proof', 'angle', 'close'];
  return SharedSequenceBriefSchema.parse({
    version: 'research-sequence/v1',
    topic,
    role: context.person.title || null,
    authorizedContext: JSON.stringify({ ...draftMessageBriefForModel(buildDraftMessageBrief(context)), writingStyle: context.style.profile, approvedCta: context.constraints.cta.exactText }),
    stages: goals.map((goal, index) => ({
      index, goal,
      exampleIds: selectOutreachExamples({ goal, role: context.person.title, offering: topic, count: 2 }).map((example) => example.id),
    })),
  });
}
