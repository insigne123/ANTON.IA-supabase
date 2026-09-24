import { z } from 'zod';
import { buildDraftMessageBrief, draftMessageBriefForModel } from './draft-message-brief';
import { selectOutreachStrategy } from './outreach-evidence-ranking';
import { selectOutreachExamples } from './outreach-example-library';
import type { DraftContextV2 } from './server/draft-context-v2';

// Email drafts for the SAME recipient. Each follow-up tries a different
// approach to the same topic so that one of them lands: proof, another
// angle, then a direct breakup close. The playbook's channel switch and
// alternate recipient are deliberately not email steps or evidence of contact.
export const RESEARCH_SEQUENCE_STEPS = [
  { name: 'Respaldo', offsetDays: 3, instruction: 'Cambia el enfoque respecto al inicial: entra directo con una prueba autorizada o un beneficio concreto distinto al ya usado, sin anunciar que traes algo nuevo ("hay otro punto además de…", "retomo…"). Si no hay prueba nueva, precisa el alcance (qué incluye y qué queda fuera). No repitas la propuesta del inicial con otras palabras.' },
  { name: 'Segundo ángulo', offsetDays: 5, instruction: 'Cambia el enfoque otra vez: abre directo con otra aplicación del mismo servicio u otra consecuencia práctica para este cargo (por ejemplo, impacto operativo frente a impacto en personas). Beneficio concreto primero, sin rodeos. No re-presentes al vendedor ni repitas el ejemplo del correo anterior.' },
  { name: 'Cierre', offsetDays: 10, instruction: 'Cierre directo y breve (máximo 60 palabras): retoma el BENEFICIO en una frase (el costo que se va, lo que queda resuelto), no solo el tema; deja claro que esta es la última vez que escribirás sobre esto y termina con una sola pregunta directa de sí o no (por ejemplo, si lo dejas hasta aquí). Sin pedir reunión, sin presentar nada nuevo, sin afirmar envíos previos ni silencio.' },
] as const;

export const DEFAULT_SEQUENCE_OFFSETS = [3, 5, 10];

export function researchSequenceSteps(followUpCount: number, offsets: number[] = []) {
  const selected = followUpCount === 0 ? [] : followUpCount === 1
    ? [RESEARCH_SEQUENCE_STEPS[2]]
    : followUpCount === 2 ? [RESEARCH_SEQUENCE_STEPS[0], RESEARCH_SEQUENCE_STEPS[2]]
      : [...RESEARCH_SEQUENCE_STEPS];
  const days = offsets.length > 0 ? offsets : DEFAULT_SEQUENCE_OFFSETS.slice(0, selected.length);
  return selected.map((step, index) => ({ ...step, offsetDays: days[index] ?? RESEARCH_SEQUENCE_STEPS[index].offsetDays }));
}

export function researchSequenceStepNames(followUpCount: number) {
  return researchSequenceSteps(followUpCount).map((step) => step.name);
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
