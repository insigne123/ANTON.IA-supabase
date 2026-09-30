// The judge of the AXIS benchmark: besides the fixed rubric (src/lib/cowork/judge.ts) each answer is compared with what the
// previous AI had to do and achieved on the same operation (the package the user runs their marketing with), so a run says
// where Cowork is above, level with or below it, and where the app simply cannot do what the operation asks yet.
// Offline only: it is used by judge-cowork-conversations.ts with a model other than the one that writes.
import { z } from 'zod';
import { coworkJudgePrompt } from '../../src/lib/cowork/judge';
import { CORPUS_NOW, type CorpusCase } from './cowork-conversation-corpus';

export const AXIS_REFERENCE_VERDICTS = ['supera', 'iguala', 'por_debajo', 'fuera_de_alcance'] as const;
export type AxisReferenceVerdict = typeof AXIS_REFERENCE_VERDICTS[number];

export const axisReferenceSchema = z.object({
  veredicto: z.enum(AXIS_REFERENCE_VERDICTS),
  /** One sentence: what decided it, in the user's words. */
  motivo: z.string().max(400),
}).strict();
export type AxisReference = z.infer<typeof axisReferenceSchema>;

export const AXIS_REFERENCE_INSTRUCTIONS = [
  'Eres un evaluador estricto de Cowork, el asistente de ANTON.IA que ayuda a un vendedor B2B a prospectar por correo y LinkedIn. Comparas una respuesta de Cowork con lo que hizo antes la IA con la que el usuario trabajaba su marketing, en la misma operación.',
  'Recibes la operación (con su bloque), la fecha y hora de la conversación («ahora»: las fechas de los datos son relativas a ella), el pedido, lo que la IA anterior debía hacer («laIADebe»), lo que logró («resultadoDeLaIAAnterior») y en qué falló («fallosDeLaIAAnterior»), lo que la app puede hacer hoy («capacidadDeLaApp»), los datos que Cowork consultó y exactamente lo que el usuario vio. Evalúa solo eso: no premies lo que la respuesta pudo haber dicho.',
  'Veredicto:',
  '- supera: cumple lo que la IA anterior debía hacer y además evita su falla documentada o agrega algo que ella no hizo (una cifra propia, una advertencia, una verificación).',
  '- iguala: cumple lo esencial de «laIADebe» con datos que consultó, sin inventar, aunque con menos detalle que el resultado de la IA anterior.',
  '- por_debajo: se salta una parte de «laIADebe» que la app sí podía hacer, repite la falla documentada, inventa un dato, una persona o un resultado, o devuelve el trabajo al usuario sin mirar los datos.',
  '- fuera_de_alcance: la operación pide algo que la app no puede hacer hoy («capacidadDeLaApp» faltante o la parte que falta de una parcial) y la respuesta lo dice con claridad y entrega el paso útil más cercano. Decirlo no es una falla; fingir que lo hizo es «por_debajo».',
  'Reglas: las cifras solo valen si están en los datos consultados o en lo que dijo el usuario. Una respuesta que no consultó nada y afirma cifras de la cuenta es «por_debajo». Los efectos (enviar, invitar, enriquecer, crear campañas) siempre se proponen con una tarjeta de aprobación en Cowork: pedir aprobación no es quedarse corto. Cowork no lee el cuerpo de los correos ni responde dentro de un hilo: si la operación lo exige y la respuesta lo dice, es «fuera_de_alcance».',
  'motivo: una frase que diga qué decidió el veredicto, con el dato concreto.',
].join('\n');

/** The day of every case, as the person in Santiago reads it: the world's dates are relative to it (D2 asks «qué toca hoy»). */
const CORPUS_TODAY = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full', timeStyle: 'short' }).format(CORPUS_NOW);

/** What the reference judge reads for one case and the answer the person saw. */
export function axisReferencePrompt(entry: CorpusCase, input: { shown: Parameters<typeof coworkJudgePrompt>[0]['shown']; observations: unknown[]; userContext: unknown }) {
  const axis = entry.axis;
  if (!axis) throw new Error(`${entry.id} is not an AXIS case`);
  // The same case and answer the rubric judge reads, so both judgements are about the same thing.
  const base = JSON.parse(coworkJudgePrompt({ request: entry.request,
    history: (entry.history || []).map(turn => ({ request: turn.request, reply: turn.reply, observations: turn.observations })),
    userContext: input.userContext, observations: input.observations, shown: input.shown })) as Record<string, unknown>;
  return JSON.stringify({
    operacion: `${axis.op} · ${entry.title} (${axis.block})`,
    ahora: CORPUS_TODAY,
    laIADebe: axis.mustDo,
    resultadoDeLaIAAnterior: axis.reference.result,
    fallosDeLaIAAnterior: axis.reference.failed,
    capacidadDeLaApp: { cubierta: 'la app puede hacerlo', parcial: 'la app puede hacer una parte; lo demás lo dice o lo deja al usuario', faltante: 'la app no puede hacerlo hoy' }[axis.capability],
    ...base,
  });
}

/** Counts of verdicts, in the order of the scale. */
export function axisReferenceSummary(rows: Array<{ reference?: AxisReference | null; op?: string; block?: string; capability?: string; star?: boolean }>) {
  const count = (list: typeof rows) => Object.fromEntries(AXIS_REFERENCE_VERDICTS.map(verdict => [verdict, list.filter(row => row.reference?.veredicto === verdict).length]));
  const judged = rows.filter(row => row.reference);
  const groupBy = (key: 'block' | 'capability') => Object.fromEntries([...new Set(judged.map(row => String(row[key])))].map(name => [name, count(judged.filter(row => row[key] === name))]));
  return { judged: judged.length, verdicts: count(judged), byBlock: groupBy('block'), byCapability: groupBy('capability'),
    byStar: { star: count(judged.filter(row => row.star)), rest: count(judged.filter(row => !row.star)) } };
}
