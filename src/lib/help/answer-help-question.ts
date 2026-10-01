import { z } from 'genkit';

import { generateStructured } from '@/ai/openai-json';
import {
  helpSectionById, helpSectionHref, manualAsText, searchHelp, type HelpSection,
} from '@/lib/help/manual';

/**
 * «Pregúntale a la IA» (docs/ui-ux/ayuda-y-manual.md): answers a question about the app using only the manual, and says so
 * when the manual does not cover it. When the model is not available, the answer is the closest FAQs of the manual.
 */

export const HELP_QUESTION_MAX = 500;

const ModelAnswerSchema = z.object({
  /** Two to five sentences, in Spanish, only from the manual. */
  answer: z.string(),
  /** False when the manual does not cover the question. */
  answered: z.boolean(),
  /** Ids of the manual sections the answer comes from. */
  sectionIds: z.array(z.string()),
});

export type HelpLink = { id: string; title: string; href: string; screen: string | null };
export type HelpAnswer =
  | { source: 'ai'; answer: string; answered: boolean; sections: HelpLink[] }
  | { source: 'manual'; answer: null; answered: boolean; matches: Array<{ section: HelpLink; q: string | null; a: string }> };

type Generate = (options: {
  prompt: string;
  systemPrompt: string;
  schema: typeof ModelAnswerSchema;
  temperature: number;
  timeoutMs: number;
  maxOutputTokens: number;
  maxAttempts: number;
}) => Promise<z.infer<typeof ModelAnswerSchema>>;

export function helpLink(section: HelpSection): HelpLink {
  return { id: section.id, title: section.title, href: helpSectionHref(section.id), screen: section.href || null };
}

const SYSTEM_PROMPT = [
  'Eres la ayuda de ANTON.IA, una app de prospección B2B: buscar prospectos, encontrar su correo, investigarlos, escribirles y seguir las respuestas.',
  'Respondes en español, de tú, en 2 a 5 frases cortas y concretas, con los nombres de pantallas y botones tal como aparecen en el manual (entre «»).',
  'Usa solo lo que dice el manual que se te entrega. No inventes pantallas, botones, cifras, precios ni funciones.',
  'Si el manual no responde la pregunta, dilo con honestidad (answered = false) y sugiere escribir al administrador de su organización.',
  'Si la pregunta no es sobre la app, responde que solo puedes ayudar con el uso de ANTON.IA (answered = false).',
  'En sectionIds pon los ids (entre corchetes en el manual) de las secciones que usaste, la más útil primero, máximo 3.',
  'Devuelves solo JSON válido.',
].join(' ');

export async function answerHelpQuestion(input: {
  question: string;
  /** The screen the person asked from, to read first. */
  sectionId?: string | null;
  /** The sections this person can see (hidden features are never described). */
  sections: HelpSection[];
}, dependencies: { generate?: Generate } = {}): Promise<HelpAnswer> {
  const question = input.question.trim().slice(0, HELP_QUESTION_MAX);
  const visible = new Map(input.sections.map((section) => [section.id, section]));
  const current = input.sectionId && visible.has(input.sectionId) ? helpSectionById(input.sectionId) : null;
  try {
    const generated = await (dependencies.generate || generateStructured)({
      systemPrompt: SYSTEM_PROMPT,
      prompt: [
        'MANUAL DE ANTON.IA',
        manualAsText(input.sections),
        '',
        current ? `La persona está en la pantalla «${current.title}» [${current.id}].` : 'La persona está en el Centro de ayuda.',
        `PREGUNTA: ${question}`,
      ].join('\n'),
      schema: ModelAnswerSchema,
      temperature: 0.1,
      timeoutMs: 25_000,
      maxOutputTokens: 1_500,
      maxAttempts: 1,
    });
    const answer = generated.answer.trim();
    if (!answer) throw new Error('empty_answer');
    const sections = [...new Set(generated.sectionIds.map((id) => id.trim().replace(/^\[|\]$/g, '')))]
      .flatMap((id) => {
        const section = visible.get(id);
        return section ? [helpLink(section)] : [];
      })
      .slice(0, 3);
    return { source: 'ai', answer, answered: generated.answered, sections };
  } catch (error) {
    console.warn('[help/ask] answered from the manual:', error instanceof Error ? error.message.slice(0, 160) : 'unknown');
    const matches = searchHelp(question, input.sections, 3).map((match) => ({
      section: helpLink(match.section),
      q: match.faq?.q || null,
      a: match.faq?.a || match.section.summary,
    }));
    return { source: 'manual', answer: null, answered: matches.length > 0, matches };
  }
}

/** A few questions per person and minute, per server instance: enough for a real doubt, not for a loop. */
export function createHelpRateLimiter(limit = 8, windowMs = 5 * 60_000) {
  const calls = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const recent = (calls.get(key) || []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      calls.set(key, recent);
      return false;
    }
    recent.push(now);
    calls.set(key, recent);
    if (calls.size > 5_000) calls.delete(calls.keys().next().value as string);
    return true;
  };
}
