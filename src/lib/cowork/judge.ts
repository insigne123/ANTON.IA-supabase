import { z } from 'zod';
import { coworkBlocksText } from './blocks';
import { coworkChoices } from './answer-quality';
import type { CoworkBlock, CoworkChoices, CoworkSuggestion } from './contracts';
import { coworkLocalStamp, coworkTimeZone, coworkWithLocalTimes } from './decision-context';
import { COWORK_NEXT_STEP_RULE } from './next-step';

/**
 * LLM-as-judge for Cowork answers (plan 2.2). A model other than the one that
 * writes grades what the person saw against a fixed rubric, so the evaluation
 * catches what lexical checks cannot (a wrong count, an invented figure, a
 * dead end). It never approves effects. Offline it grades the corpus; in the
 * turn (plan 2, G2, COWORK_JUDGE_ENABLED) it reads the coordinator's answer
 * before it is shown and asks for one correction when it is worth it.
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

/** Importing contacts as the turn ran it: off, the person imports; on (F4, COWORK_CONTACTS_IMPORT_ENABLED), Cowork proposes it with its card. */
const IMPORT_RULE = {
  off: 'Cowork no crea contactos a partir de un correo: solo guarda personas encontradas con el proveedor, y un correo que no está guardado lo importa el usuario.',
  on: 'Cowork no crea contactos a partir de un correo escrito en el chat: guarda personas encontradas con el proveedor e importa a las personas de un archivo subido (CSV, Excel o lista JSON) con una tarjeta de aprobación que muestra quiénes entran; la importación deja fuera sola a quienes ya estaban guardados y a las filas sin nombre, así que no hace falta revisarlo antes. Las cifras de esa tarjeta (cuántos entran, cuántos ya estaban, cuántos sin nombre o sin correo) las calcula el servidor contra el archivo completo y los contactos guardados: son datos, no afirmaciones sin respaldo; si la respuesta dice otra cifra, es la respuesta la que se equivoca. Si el usuario pide importar o guardar a las personas de un archivo, o una campaña o un correo para las que no están guardadas, lo correcto es proponer esa importación, no mandarlo a hacerlo a mano; si solo pregunta qué trae el archivo o a quién escribir primero, lo correcto es responder eso y ofrecer la importación de las que faltan como siguiente paso.',
};

/** Replying in a thread as the turn ran it: off, the drafted reply is sent from Contactados; on (COWORK_REPLY_THREAD_ENABLED), Cowork proposes sending it with a card. */
const REPLY_THREAD_RULE = 'Cowork responde a quien escribió dentro del hilo original: lee su conversación (replies.thread), propone la respuesta con una tarjeta de aprobación que muestra el texto exacto, y solo sale si el usuario la aprueba. Ante una persona que espera respuesta y cuya conversación se puede responder, proponerla es lo correcto; una propuesta no es un envío hecho, así que decir que ya se envió es un dato falso. No se responde a quien pidió no recibir más mensajes, a un aviso automático, a quien ya tiene respuesta ni a quien dijo que no, y decir que no se le escribe es lo correcto. Si varias personas esperan, solo cabe una propuesta de envío por turno: los borradores van en tarjetas de correo (no son envíos y no se aprueban), Cowork ofrece proponer el envío de la primera y cada envío es una propuesta aparte, con su propia tarjeta y su propia aprobación. Eso es lo correcto; pedir aprobar las tres juntas es el error.';

/** LinkedIn batches as the turn ran them: off, each person has their own card; on (COWORK_LINKEDIN_BATCH_ENABLED), several people go in one. */
const LINKEDIN_BATCH_RULE = 'Para varias personas en LinkedIn, Cowork propone un lote con una sola tarjeta de aprobación (invitaciones sin nota o mensajes, cada uno con su propio texto) en vez de una tarjeta por persona: ante un pedido de varias personas, proponer el lote es lo correcto y pedir aprobar una por una es fricción. La tarjeta muestra quién va, quién no sale hoy y por qué (una empresa por día entre correo y LinkedIn, el cupo semanal, la respuesta de la empresa, o que no tiene perfil) y la persona puede quitar gente antes de aprobar: cuántas salen lo fija el servidor y lo muestra la tarjeta, así que una respuesta que dice otra cifra es la que se equivoca. Un lote no es un envío: encola trabajos que la extensión ejecuta ante cada perfil, y decir que ya se enviaron es un dato falso.';

const judgeRules = (contactsImport: boolean, replyThread = false, linkedinBatch = false) => [
  'Eres un evaluador estricto de respuestas de Cowork, el asistente de ANTON.IA que ayuda a un vendedor B2B a prospectar por correo y LinkedIn.',
  'Recibes el pedido, el historial breve, quién es el usuario y qué vende, los datos que Cowork consultó y exactamente lo que el usuario vio. Evalúa solo eso: no premies lo que la respuesta pudo haber dicho.',
  'Rúbrica, de 1 a 5 cada dimensión:',
  '- comprension: 5 entiende el pedido y su intención (también si es vago o con faltas); 3 entiende a medias o responde otra cosa cercana; 1 no entiende o responde otra cosa.',
  '- veracidad: 5 cada cifra, nombre, fecha y estado coincide con los datos consultados o el contexto; 3 algún dato impreciso o una afirmación sin respaldo; 1 inventa datos, cuenta mal o contradice los datos. Contar mal (por ejemplo «3 de 5 con correo» cuando son 4) es 2 o menos. Si no consultó datos y no afirma nada de la cuenta, 5.',
  '- utilidad: 5 acerca el objetivo (contactos listos, correos o mensajes, envíos, respuestas) y deja un siguiente paso que Cowork puede hacer al tocarlo; 3 útil pero incompleta o genérica; 1 callejón sin salida o devuelve el trabajo al usuario.',
  '- claridad: 5 breve, directa, bien ordenada, en español simple, sin jerga técnica, códigos, IDs ni horas UTC; 3 se entiende con esfuerzo o sobra texto; 1 confusa. Jerga interna del sistema sin explicar (por ejemplo «cobertura», «barrido», «dominio desnudo», nombres de herramientas o campos) o un cierre técnico la dejan en 3 o menos.',
  '- friccion: 5 el usuario no tiene que hacer nada extra (no le pide datos que Cowork ya tiene o puede consultar, no lo obliga a pasos innecesarios, no le pregunta lo obvio); 3 una pregunta o paso evitable; 1 lo hace trabajar o esperar para nada. Pedir un dato que Cowork podía deducir o consultar, una decisión que podía tomar con un valor razonable y dejar editable, o detalles de algo que Cowork no puede hacer, es 2 o menos.',
  `Reglas del producto que Cowork debe respetar (no son fricción ni falta de utilidad): crear campañas, enviar correos, buscar prospectos nuevos con el proveedor, buscar el correo de un contacto (gasta un crédito), investigar, guardar contactos, ejecutar código y mensajes o invitaciones de LinkedIn siempre se proponen con una tarjeta de aprobación y no se ejecutan sin ella; las campañas solo van a contactos guardados con correo; Cowork no tiene calendario. Cowork sí entrega archivos de lo que muestra: cada tarjeta trae su botón «Descargar» (tabla, cifras y gráfico en Excel o CSV; correo y secuencia en Word o PDF; el documento del panel en Word, PDF o Markdown), así que ante «pásamelo a Excel» o «dámelo en Word» lo correcto es la tarjeta y una frase que diga cómo bajarla; proponer código para armar ese archivo, o decir que no puede hacer archivos, sí es fricción y una respuesta que no sirve. Un correo nuevo a contactos sale por una campaña: se crea pausada con una aprobación y se activa con otra; no hay envío directo de un texto escrito en el chat. ${IMPORT_RULE[contactsImport ? 'on' : 'off']}${replyThread ? ` ${REPLY_THREAD_RULE}` : ''}${linkedinBatch ? ` ${LINKEDIN_BATCH_RULE}` : ''} Cowork lee los archivos que subió el usuario si son CSV, JSON, Excel (.xlsx), PDF con texto, Word (.docx), Markdown o texto; un .xls antiguo, un PDF escaneado sin texto, un archivo protegido con clave o uno demasiado grande no se leen: lo correcto es decirlo y pedir el contenido pegado o en otro formato. Para cruces o cálculos sobre miles de filas, proponer código con su tarjeta de aprobación también es correcto. Un mensaje que empieza con «Usa exactamente esta versión» viene del botón «Usar esta versión» de una tarjeta de correo: pide fijar ese texto sin cambiarlo y no crear nada todavía (para eso está el botón «Crear campaña con esta versión»); ofrecer crear la campaña como siguiente paso es correcto. La tarjeta que aparece en tarjetaDeAprobacion es visible para el usuario con sus botones Aprobar y Descartar: evalúa si es la acción correcta y si la nota la explica. En cambio, ofrecer como siguiente paso una consulta gratuita que Cowork podía hacer antes de responder sí es fricción.`,
  'Los datos de turnos anteriores (datosDelHistorial) cuentan como datos consultados. Si un nombre aparece enmascarado en los datos (por ejemplo «Carlos Ah***a») y la respuesta lo completa como un hecho, es un dato sin respaldo.',
  'Una pregunta final con opciones (opciones) se responde tocando una o varias, o escribiendo otra respuesta: pedir así un dato que solo el usuario sabe (a qué segmentos va una campaña, en qué industria buscar) no es fricción; pedir con opciones algo que Cowork podía decidir con un valor razonable o consultar sí lo es, igual que ofrecer como opciones un sí y un no.',
  'Lo que trae usuario (oferta, servicios, pruebas y rubro) también cuenta como dato consultado: nombrarlo no es una afirmación sin respaldo, y decir que no se sabe o no se ve un dato que sí está ahí es veracidad 2 o menos.',
  'problemas: hasta 5 problemas concretos que el usuario notaría, en una frase cada uno; vacío si no hay. veredicto: buena si todas las dimensiones son 4 o más; mala si alguna es 2 o menos; si no, mejorable.',
].join('\n');

export const COWORK_JUDGE_INSTRUCTIONS = judgeRules(false);

/**
 * The judge in the turn (G2) reads the answer before it is shown, while it can still be fixed:
 * the same rubric, stricter with offering what Cowork could do right away. The offline judge
 * keeps COWORK_JUDGE_INSTRUCTIONS as it is, so the evaluation does not move with it.
 */
/** The work's date is the clock of the conversation, not the day the judge runs: the judge counts days from it. */
export const COWORK_JUDGE_NOW_RULE = 'ahora es la fecha y hora del trabajo: cuenta los días desde ella, no desde la fecha de hoy.';
const TURN_RULE = [
  `Esta revisión ocurre antes de mostrar la respuesta, y Cowork todavía puede corregirla. Cómo debe cerrar una respuesta: ${COWORK_NEXT_STEP_RULE}`,
  'Si la pregunta final ofrece algo que Cowork podía hacer ahora sin aprobación y que el pedido necesitaba, la fricción es 2 o menos, y el problema dice qué debió hacer. No es fricción ofrecer una acción que necesita aprobación ni preguntar una decisión que solo el usuario puede tomar, y los botones pueden ofrecer otros pedidos. Ante una pregunta general («¿qué puedes hacer?», una explicación), presentar las capacidades y ofrecer un primer paso con aprobación no es fricción: no le exijas consultas que el pedido no necesita.',
  COWORK_JUDGE_NOW_RULE,
].join('\n');
export const COWORK_JUDGE_TURN_INSTRUCTIONS = [COWORK_JUDGE_INSTRUCTIONS, TURN_RULE].join('\n');

/**
 * The rubric for a turn as it ran: with contacts.import on, Cowork proposes importing the people
 * of a file, with email.reply_thread on it proposes answering in the thread and with the LinkedIn batches
 * on it proposes several people in one card, so the judge expects those proposals; off, the rules above. `inTurn` adds what the
 * judge in the turn is stricter with. Offline and in the turn, the same flag as the coordinator.
 */
export function coworkJudgeInstructions(options: { contactsImport?: boolean; replyThread?: boolean; linkedinBatch?: boolean; inTurn?: boolean } = {}) {
  const rules = options.contactsImport || options.replyThread || options.linkedinBatch
    ? judgeRules(Boolean(options.contactsImport), Boolean(options.replyThread), Boolean(options.linkedinBatch)) : COWORK_JUDGE_INSTRUCTIONS;
  return options.inTurn ? [rules, TURN_RULE].join('\n') : rules;
}

/** What the person saw in a turn, as plain text for the judge. */
export type CoworkShownAnswer = {
  reply: string;
  cards?: string | null;
  question?: string | null;
  quickReplies?: string[];
  /** The options that answer the closing question (V5), when it came with them. */
  choices?: CoworkChoices | null;
  proposal?: { kind: string; label: string; note: string | null; detail?: unknown } | null;
  search?: unknown;
  document?: { title: string; content: string } | null;
  failed?: string | null;
};

const clip = (value: unknown, max: number) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}… [recortado]` : text;
};

/** Everything the turn consulted, as the coordinator read it (with local times), within one
 * budget: each read keeps a summary of its list (how many, how many with email, whether it was
 * cut) and as much of its data as its share allows, so a correct count never looks unsupported
 * only because the judge saw a slice of the data. */
export function coworkJudgeEvidence(observations: unknown[], options: { total?: number; each?: number; timeZone?: string } = {}) {
  const total = options.total ?? 24_000;
  const each = options.each ?? 8_000;
  const local = coworkWithLocalTimes(observations, options.timeZone ?? coworkTimeZone()) as unknown[];
  const texts = local.map(observation => JSON.stringify(observation ?? null)
    .replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, '[id]'));
  // Unused share of a short read goes to the long ones.
  let left = total;
  const order = texts.map((text, index) => ({ index, length: text.length })).sort((a, b) => a.length - b.length);
  const shares = new Array<number>(texts.length).fill(0);
  order.forEach((item, position) => {
    const fair = Math.floor(left / (order.length - position));
    shares[item.index] = Math.min(item.length, each, fair);
    left -= shares[item.index];
  });
  return local.map((observation, index) => {
    const result = (observation as { result?: { items?: unknown; truncated?: unknown } } | null)?.result;
    const items = Array.isArray(result?.items) ? result.items as Array<Record<string, unknown>> : null;
    const summary = items ? { elementos: items.length, conCorreo: items.filter(item => Boolean(item?.email)).length, truncado: result?.truncated === true } : null;
    const text = texts[index];
    const data = text.length > shares[index] ? `${text.slice(0, shares[index])}… [recortado]` : text;
    return summary ? { resumen: summary, datos: data } : data;
  });
}

/** The judge's input: the case and exactly what was shown, trimmed to a fair size. */
export function coworkJudgePrompt(input: {
  request: string;
  history?: Array<{ request: string; reply: string; observations?: unknown[] }>;
  userContext?: unknown;
  observations?: unknown[];
  shown: CoworkShownAnswer;
  /** The judge in the turn reads every read within a budget (coworkJudgeEvidence) and the work's
   * date; offline it keeps the first six reads, cut at 2,500 characters, as it was calibrated. */
  evidence?: { now: Date; timeZone?: string };
  /** The work's date alone, for the offline judge: its reads keep the calibrated budget, but «hoy» is the conversation's day and not the
   * day the judge runs (a world dated the 25th read on the 30th made every «today» list look stale). Pair it with COWORK_JUDGE_NOW_RULE. */
  now?: Date;
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
    ...(input.evidence ? { ahora: coworkLocalStamp(input.evidence.now, input.evidence.timeZone ?? coworkTimeZone()) }
      : input.now ? { ahora: coworkLocalStamp(input.now, coworkTimeZone()) } : {}),
    datosConsultados: input.evidence
      ? coworkJudgeEvidence(input.observations || [], { timeZone: input.evidence.timeZone })
      : (input.observations || []).slice(0, 6).map(observation => clip(observation, 2500)),
    loQueVioElUsuario: {
      respuesta: input.shown.failed ? `Error: ${input.shown.failed}` : clip(input.shown.reply, 6000),
      documento: input.shown.document ? { titulo: input.shown.document.title, contenido: clip(input.shown.document.content, 5000) } : null,
      tarjetas: input.shown.cards ? clip(input.shown.cards, 5000) : null,
      preguntaFinal: input.shown.question ?? null,
      botones: input.shown.quickReplies || [],
      ...(input.shown.choices ? { opciones: { variasALaVez: input.shown.choices.multiple, opciones: input.shown.choices.options, puedeEscribirOtra: true } } : {}),
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

/** What the person would see of a coordinator answer, for the judge in the turn. */
export function coworkShownFromAnswer(answer: {
  reply: string; document?: { title: string; content: string } | null; question?: string | null;
  blocks?: CoworkBlock[] | null; suggestions?: CoworkSuggestion[] | null; choices?: unknown;
}): CoworkShownAnswer {
  // Options only answer a closing question, as the chat shows them; with them, no quick replies show.
  const choices = answer.question ? coworkChoices(answer.choices) : null;
  return {
    reply: answer.reply,
    cards: answer.blocks?.length ? coworkBlocksText(answer.blocks) : null,
    question: answer.question ?? null,
    quickReplies: choices ? [] : (answer.suggestions || []).map(chip => chip.message),
    ...(choices ? { choices } : {}),
    document: answer.document ?? null,
  };
}

/** The judge's input in the turn: the same rubric and data as offline, with the answer as the person would see it. */
export function coworkJudgeTurnPrompt(input: {
  request: string;
  history?: Array<{ request: string; reply: string; observations?: unknown[] }>;
  userContext?: unknown;
  observations: unknown[];
  answer: Parameters<typeof coworkShownFromAnswer>[0];
  now?: Date;
}) {
  return coworkJudgePrompt({ request: input.request, history: input.history, userContext: input.userContext,
    observations: input.observations, shown: coworkShownFromAnswer(input.answer), evidence: { now: input.now ?? new Date() } });
}

/**
 * Whether a judgement is worth one correction before the answer is shown, and what the
 * coordinator reads. Only clear failures: a bad answer, or a dimension at 2 or less (friction
 * with a read left, typically a read offered instead of made; veracity; comprehension). A 3
 * («one avoidable step», «an imprecise figure») used to send half the answers back, and the
 * corrections were not clearly better (G2). The correction edits the answer it fixes
 * (answerToCorrect) instead of writing it again. Null when the answer stands.
 */
export function coworkJudgeFix(judgement: CoworkJudgement, turn: { canRead: boolean; question?: string | null } = { canRead: true }): string | null {
  const { scores, problemas, veredicto } = judgement;
  if (!problemas.length) return null;
  const worth = turn.canRead
    ? veredicto === 'mala' || scores.friccion <= 2 || scores.veracidad <= 2 || scores.comprension <= 2
    : scores.veracidad <= 2 || scores.comprension <= 2;
  if (!worth) return null;
  const question = turn.question?.trim();
  return [
    'Antes de mostrarla, una revisión de tu respuesta encontró:',
    ...problemas.map(problem => `- ${problem}`),
    ...(question ? [`Tu respuesta terminaba con «${question}».`] : []),
    turn.canRead
      ? 'Si ofrecía una consulta que el pedido necesitaba (contactos, envíos, respuestas, campañas, métricas o archivos), hazla en esta decisión, dentro de las lecturas que te quedan, y responde con lo que encuentres; si ofrecía preparar algo que el pedido necesitaba (una lista, un orden, un resumen o un texto), inclúyelo. No cambies el propósito de la respuesta ni la conviertas en un listado de cifras que no se pidió.'
      : 'En este turno ya no quedan consultas: corrígela con lo que ya tienes. Si ofrecía preparar algo que el pedido necesitaba (una lista, un orden, un resumen o un texto), inclúyelo.',
    'Si afirmaste algo que los datos no respaldan, quítalo o dilo tal como está en los datos.',
    `Cómo cerrar: ${COWORK_NEXT_STEP_RULE}`,
    'Edita tu respuesta anterior (answerToCorrect): cambia solo lo señalado y conserva el resto, con su pregunta final y sus respuestas sugeridas.',
  ].join('\n');
}
