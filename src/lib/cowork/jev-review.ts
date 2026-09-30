import type { JevAnswer, JevQuestion } from '@/lib/server/jev';
import { coworkJudgePrompt, type CoworkJudgement, type CoworkJudgeDimension } from './judge';

/**
 * Jev as a fast reviewer of Cowork answers. Instead of one model call that grades the answer,
 * Jev answers atomic yes/no questions about the failures the judge keeps finding, in about
 * 0.2 s. It reads the same material as the judge (coworkJudgePrompt): the request, the recent
 * history, who the person is and what they sell, what Cowork consulted and exactly what the
 * person saw. The questions are in English (Jev's best language); the state stays in Spanish.
 */

export const COWORK_JEV_QUESTIONS = {
  offers_free_read: { type: 'noul', instructions: 'The reply ends by offering (in its final question or suggested buttons) to look something up or to prepare something that the assistant could have done itself right away without the user\'s approval, such as checking contacts, sends, replies, campaigns, metrics or files, or preparing a list, an order, a summary or a text, instead of doing it in this reply.' },
  asks_known_data: { type: 'noul', instructions: 'The reply asks the user for information that is already present in the user context (who the user is, what they sell) or in the consulted data.' },
  denies_present_context: { type: 'noul', instructions: 'The reply says it does not know, cannot see or does not have something that is actually present in the user context or in the consulted data, for example what the user\'s company sells.' },
  unsupported_figure: { type: 'noul', instructions: 'The reply states a number, count, percentage, amount or date that does not match or is not supported by the consulted data, the user context or the history.' },
  unsupported_name: { type: 'noul', instructions: 'The reply names a person or company that is not in the consulted data, or completes a masked surname (such as "Carlos Ah***a") as if it were known.' },
  misses_request: { type: 'noul', instructions: 'The reply does not address what the user asked for in their request.' },
  verdict: { type: 'choice', instructions: 'Overall, how good is this reply for a B2B salesperson who asked the request, given the consulted data?', criteria: {
    good: 'Understands the request, every fact matches the data, useful, clear and leaves nothing extra for the user to do.',
    improvable: 'Useful, but with one fixable issue: vague, an avoidable question or step, or a small inaccuracy.',
    bad: 'Misunderstands the request, invents or miscounts data, is a dead end, or makes the user do work the assistant could do.',
  } },
} satisfies Record<string, JevQuestion>;

export type CoworkJevQuestionId = Exclude<keyof typeof COWORK_JEV_QUESTIONS, 'verdict'>;
export const COWORK_JEV_CHECKS = Object.keys(COWORK_JEV_QUESTIONS).filter(id => id !== 'verdict') as CoworkJevQuestionId[];

/** What each question means for the person, and the rubric dimension it takes down. */
export const COWORK_JEV_PROBLEMS: Record<CoworkJevQuestionId, { problem: string; dimension: CoworkJudgeDimension }> = {
  offers_free_read: { problem: 'Termina ofreciendo una consulta o una preparación que Cowork podía hacer ahora: hazla y responde con lo que encuentres.', dimension: 'friccion' },
  asks_known_data: { problem: 'Le pide al usuario un dato que ya está en su contexto o en lo consultado.', dimension: 'friccion' },
  denies_present_context: { problem: 'Dice que no sabe o no ve algo que sí está en el contexto del usuario o en lo consultado.', dimension: 'veracidad' },
  unsupported_figure: { problem: 'Da una cifra, un conteo o una fecha que no calza con los datos consultados.', dimension: 'veracidad' },
  unsupported_name: { problem: 'Nombra a una persona o empresa, o completa un apellido, sin respaldo en los datos.', dimension: 'veracidad' },
  misses_request: { problem: 'No responde lo que el usuario pidió.', dimension: 'comprension' },
};

/** Probability at or above which a question counts as fired. */
export type CoworkJevThresholds = Partial<Record<CoworkJevQuestionId, number>>;
/**
 * Calibrated against the offline judge on 1,576 corpus answers (docs/cowork-jev.md): only
 * «offers a read it could do» separates well (AUC 0.89 against the judge's own problems); at
 * 0.88, 9 of 10 answers it flags have friction 2 or less. The other checks stay close to chance
 * on these answers, so by default they never fire: they are asked only to keep measuring them.
 */
export const COWORK_JEV_DEFAULT_THRESHOLDS: CoworkJevThresholds = { offers_free_read: 0.88 };

/** The judge's material, with English keys so Jev reads the structure. */
export function coworkJevState(input: Parameters<typeof coworkJudgePrompt>[0]) {
  const judge = JSON.parse(coworkJudgePrompt(input)) as {
    pedido: string; historial: unknown[]; datosDelHistorial: unknown[]; usuario: unknown; datosConsultados: unknown[];
    loQueVioElUsuario: { respuesta: string; documento: unknown; tarjetas: unknown; preguntaFinal: unknown; botones: unknown; tarjetaDeAprobacion: unknown };
  };
  const shown = judge.loQueVioElUsuario;
  return {
    request: judge.pedido,
    history: judge.historial,
    earlierData: judge.datosDelHistorial,
    user: judge.usuario,
    consultedData: judge.datosConsultados,
    shownToUser: { reply: shown.respuesta, document: shown.documento, cards: shown.tarjetas, finalQuestion: shown.preguntaFinal,
      buttons: shown.botones, approvalCard: shown.tarjetaDeAprobacion },
  };
}

/** Probability of each check; null when Jev did not answer it. */
export function coworkJevProbabilities(answers: Record<string, JevAnswer> | null) {
  return Object.fromEntries(COWORK_JEV_CHECKS.map(id => {
    const answer = answers?.[id];
    return [id, answer?.type === 'noul' ? answer.noul : null];
  })) as Record<CoworkJevQuestionId, number | null>;
}

/**
 * Jev's answers as a regular judgement, so the correction path stays the same: each fired
 * question takes its dimension down to 2 and adds its problem in Spanish. The verdict is «mala»
 * when anything fired; otherwise Jev's own verdict, if it answered it.
 */
export function coworkJevJudgement(answers: Record<string, JevAnswer> | null, thresholds: CoworkJevThresholds = {}): CoworkJudgement & { fired: CoworkJevQuestionId[] } | null {
  if (!answers) return null;
  const probabilities = coworkJevProbabilities(answers);
  const fired = COWORK_JEV_CHECKS.filter(id => {
    const value = probabilities[id];
    const threshold = thresholds[id] ?? COWORK_JEV_DEFAULT_THRESHOLDS[id];
    return value !== null && threshold !== undefined && value >= threshold;
  });
  const scores = { comprension: 5, veracidad: 5, utilidad: 5, claridad: 5, friccion: 5 };
  for (const id of fired) scores[COWORK_JEV_PROBLEMS[id].dimension] = 2;
  const verdict = answers.verdict?.type === 'choice' ? answers.verdict.choice : null;
  const veredicto = fired.length ? 'mala' : verdict === 'bad' ? 'mala' : verdict === 'improvable' ? 'mejorable' : 'buena';
  if (!fired.length && veredicto !== 'buena') scores.utilidad = veredicto === 'mala' ? 2 : 4;
  return { scores, problemas: fired.map(id => COWORK_JEV_PROBLEMS[id].problem), veredicto, fired };
}
