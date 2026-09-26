import { z } from 'zod';

/**
 * LLM-as-judge for Cowork answers (plan 2.2). A model other than the one that
 * writes grades what the person saw against a fixed rubric, so the evaluation
 * catches what lexical checks cannot (a wrong count, an invented figure, a
 * dead end). It never approves effects; for now it only runs offline, on the
 * corpus, until it is calibrated against answers read by people.
 */

export const COWORK_JUDGE_DIMENSIONS = ['comprension', 'veracidad', 'utilidad', 'claridad', 'friccion'] as const;
export type CoworkJudgeDimension = typeof COWORK_JUDGE_DIMENSIONS[number];

const score = z.number().int().min(1).max(5);
export const coworkJudgeSchema = z.object({
  scores: z.object({ comprension: score, veracidad: score, utilidad: score, claridad: score, friccion: score }).strict(),
  /** Concrete problems a person would notice, in their words; empty when there are none. */
  problemas: z.array(z.string().max(300)).max(5),
  veredicto: z.enum(['buena', 'mejorable', 'mala']),
}).strict();
export type CoworkJudgement = z.infer<typeof coworkJudgeSchema>;

export const COWORK_JUDGE_INSTRUCTIONS = [
  'Eres un evaluador estricto de respuestas de Cowork, el asistente de ANTON.IA que ayuda a un vendedor B2B a prospectar por correo y LinkedIn.',
  'Recibes el pedido, el historial breve, quién es el usuario y qué vende, los datos que Cowork consultó y exactamente lo que el usuario vio. Evalúa solo eso: no premies lo que la respuesta pudo haber dicho.',
  'Rúbrica, de 1 a 5 cada dimensión:',
  '- comprension: 5 entiende el pedido y su intención (también si es vago o con faltas); 3 entiende a medias o responde otra cosa cercana; 1 no entiende o responde otra cosa.',
  '- veracidad: 5 cada cifra, nombre, fecha y estado coincide con los datos consultados o el contexto; 3 algún dato impreciso o una afirmación sin respaldo; 1 inventa datos, cuenta mal o contradice los datos. Contar mal (por ejemplo «3 de 5 con correo» cuando son 4) es 2 o menos. Si no consultó datos y no afirma nada de la cuenta, 5.',
  '- utilidad: 5 acerca el objetivo (contactos listos, correos o mensajes, envíos, respuestas) y deja un siguiente paso que Cowork puede hacer al tocarlo; 3 útil pero incompleta o genérica; 1 callejón sin salida o devuelve el trabajo al usuario.',
  '- claridad: 5 breve, directa, bien ordenada, en español simple, sin jerga técnica, códigos, IDs ni horas UTC; 3 se entiende con esfuerzo o sobra texto; 1 confusa. Jerga interna del sistema sin explicar (por ejemplo «cobertura», «barrido», «dominio desnudo», nombres de herramientas o campos) o un cierre técnico la dejan en 3 o menos.',
  '- friccion: 5 el usuario no tiene que hacer nada extra (no le pide datos que Cowork ya tiene o puede consultar, no lo obliga a pasos innecesarios, no le pregunta lo obvio); 3 una pregunta o paso evitable; 1 lo hace trabajar o esperar para nada. Pedir un dato que Cowork podía deducir o consultar, una decisión que podía tomar con un valor razonable y dejar editable, o detalles de algo que Cowork no puede hacer, es 2 o menos.',
  'Reglas del producto que Cowork debe respetar (no son fricción ni falta de utilidad): crear campañas, enviar correos, buscar prospectos nuevos con el proveedor, buscar el correo de un contacto (gasta un crédito), investigar, guardar contactos y mensajes o invitaciones de LinkedIn siempre se proponen con una tarjeta de aprobación y no se ejecutan sin ella; las campañas solo van a contactos guardados con correo; Cowork no tiene calendario. Un correo nuevo a contactos sale por una campaña: se crea pausada con una aprobación y se activa con otra; no hay envío directo de un texto escrito en el chat. Cowork no crea contactos a partir de un correo: solo guarda personas encontradas con el proveedor, y un correo que no está guardado lo importa el usuario. Un mensaje que empieza con «Usa exactamente esta versión» viene del botón «Usar esta versión» de una tarjeta de correo: pide fijar ese texto sin cambiarlo y no crear nada todavía (para eso está el botón «Crear campaña con esta versión»); ofrecer crear la campaña como siguiente paso es correcto. La tarjeta que aparece en tarjetaDeAprobacion es visible para el usuario con sus botones Aprobar y Descartar: evalúa si es la acción correcta y si la nota la explica. En cambio, ofrecer como siguiente paso una consulta gratuita que Cowork podía hacer antes de responder sí es fricción.',
  'Los datos de turnos anteriores (datosDelHistorial) cuentan como datos consultados. Si un nombre aparece enmascarado en los datos (por ejemplo «Carlos Ah***a») y la respuesta lo completa como un hecho, es un dato sin respaldo.',
  'problemas: hasta 5 problemas concretos que el usuario notaría, en una frase cada uno; vacío si no hay. veredicto: buena si todas las dimensiones son 4 o más; mala si alguna es 2 o menos; si no, mejorable.',
].join('\n');

/** What the person saw in a turn, as plain text for the judge. */
export type CoworkShownAnswer = {
  reply: string;
  cards?: string | null;
  question?: string | null;
  quickReplies?: string[];
  proposal?: { kind: string; label: string; note: string | null; detail?: unknown } | null;
  search?: unknown;
  document?: { title: string; content: string } | null;
  failed?: string | null;
};

const clip = (value: unknown, max: number) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}… [recortado]` : text;
};

/** The judge's input: the case and exactly what was shown, trimmed to a fair size. */
export function coworkJudgePrompt(input: {
  request: string;
  history?: Array<{ request: string; reply: string; observations?: unknown[] }>;
  userContext?: unknown;
  observations?: unknown[];
  shown: CoworkShownAnswer;
}) {
  const recent = (input.history || []).slice(-3);
  const card = input.shown.proposal
    ? { tipo: input.shown.proposal.kind, etiqueta: input.shown.proposal.label, nota: input.shown.proposal.note,
      ...(input.shown.proposal.detail === undefined ? {} : { detalle: clip(input.shown.proposal.detail, 3000) }) }
    : input.shown.search ? { tipo: 'búsqueda de prospectos con el proveedor', criterios: clip(input.shown.search, 1200) } : null;
  return JSON.stringify({
    pedido: input.request,
    historial: recent.map(turn => ({ pedido: clip(turn.request, 600), respuesta: clip(turn.reply, 800) })),
    datosDelHistorial: recent.flatMap(turn => turn.observations || []).slice(-4).map(observation => clip(observation, 2000)),
    usuario: input.userContext ?? null,
    datosConsultados: (input.observations || []).slice(0, 6).map(observation => clip(observation, 2500)),
    loQueVioElUsuario: {
      respuesta: input.shown.failed ? `Error: ${input.shown.failed}` : clip(input.shown.reply, 6000),
      documento: input.shown.document ? { titulo: input.shown.document.title, contenido: clip(input.shown.document.content, 5000) } : null,
      tarjetas: input.shown.cards ? clip(input.shown.cards, 5000) : null,
      preguntaFinal: input.shown.question ?? null,
      botones: input.shown.quickReplies || [],
      tarjetaDeAprobacion: card,
    },
  });
}

/** Mean per dimension and how many judgements fall at or under a score. */
export function coworkJudgeSummary(judgements: CoworkJudgement[]) {
  const mean = (dimension: CoworkJudgeDimension) => judgements.length
    ? Math.round(judgements.reduce((sum, item) => sum + item.scores[dimension], 0) / judgements.length * 100) / 100 : null;
  return {
    count: judgements.length,
    means: Object.fromEntries(COWORK_JUDGE_DIMENSIONS.map(dimension => [dimension, mean(dimension)])) as Record<CoworkJudgeDimension, number | null>,
    veredictos: { buena: judgements.filter(item => item.veredicto === 'buena').length, mejorable: judgements.filter(item => item.veredicto === 'mejorable').length,
      mala: judgements.filter(item => item.veredicto === 'mala').length },
    withLowScore: judgements.filter(item => COWORK_JUDGE_DIMENSIONS.some(dimension => item.scores[dimension] <= 2)).length,
  };
}

/** How close the judge is to people on the same answers: mean absolute error and share within one point. */
export function coworkJudgeAgreement(pairs: Array<{ human: Partial<Record<CoworkJudgeDimension, number>>; judge: CoworkJudgement['scores'] }>) {
  return Object.fromEntries(COWORK_JUDGE_DIMENSIONS.map(dimension => {
    const rated = pairs.filter(pair => typeof pair.human[dimension] === 'number');
    const errors = rated.map(pair => Math.abs((pair.human[dimension] as number) - pair.judge[dimension]));
    return [dimension, rated.length ? {
      n: rated.length,
      mae: Math.round(errors.reduce((sum, error) => sum + error, 0) / rated.length * 100) / 100,
      withinOne: Math.round(errors.filter(error => error <= 1).length / rated.length * 100) / 100,
    } : null];
  })) as Record<CoworkJudgeDimension, { n: number; mae: number; withinOne: number } | null>;
}
