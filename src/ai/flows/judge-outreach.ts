'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateStructuredWithTelemetry } from '@/ai/openai-json';

export const OUTREACH_JUDGE_PROMPT_VERSION = 'outreach-judge/v1';

const ScoreSchema = z.number().int().min(1).max(5);

const OutreachJudgeOutputSchema = z.object({
  suena_humano: ScoreSchema.describe('5 si lo podría haber escrito a mano un ejecutivo chileno para una sola persona; 1 si se nota plantilla o IA.'),
  especificidad: ScoreSchema.describe('5 si usa un detalle verdadero y relevante del destinatario o su industria; 1 si serviría para cualquiera. Correcto pero genérico: máximo 3.'),
  un_solo_pedido: ScoreSchema.describe('5 si hay un solo pedido claro y fácil de responder; 1 si hay varios o ninguno.'),
  tono_y_tratamiento: ScoreSchema.describe('5 si el registro calza con industria y cargo y el tratamiento (tú/usted) es consistente.'),
  veracidad: ScoreSchema.describe('5 si todos los hechos, cifras y nombres están en los datos de entrada; 1 si hay algo inventado. Un solo hecho sin respaldo: 1 o 2.'),
  frase_mas_artificial: z.string().max(500).describe('Copia textual de la frase que más delata a una IA o plantilla. Vacío si no hay.'),
  hechos_sin_respaldo: z.array(z.string().max(500)).max(10).describe('Afirmaciones que no están en los datos de entrada.'),
  motivo: z.string().max(500).describe('Una o dos frases con lo más importante que habría que cambiar.'),
}).strict();

export type OutreachJudgeScore = z.infer<typeof OutreachJudgeOutputSchema>;
export type OutreachJudgeVerdict = 'enviar' | 'corregir' | 'revision_humana';

// El veredicto lo calcula el código, no el juez, para que sea estable.
export function judgeVerdict(score: OutreachJudgeScore): OutreachJudgeVerdict {
  if (score.veracidad < 5 || score.hechos_sin_respaldo.length > 0) return 'revision_humana';
  const style = [score.suena_humano, score.especificidad, score.un_solo_pedido, score.tono_y_tratamiento];
  return Math.min(...style) >= 4 ? 'enviar' : 'corregir';
}

const BEFORE_AFTER = [
  {
    antes: 'Te escribo por una posible aplicación de dotación temporal en Tiendas Ejemplo, cadena de retail con 40 tiendas en la zona sur.',
    despues: 'El 10 de septiembre se informó que Tiendas Ejemplo abrirá dos tiendas nuevas en la zona sur antes de diciembre.',
  },
  {
    antes: 'Le escribo por una posible aplicación de dotación temporal en la faena minera de Minera Cascada, con más de 2.000 trabajadores.',
    despues: 'La Dirección del Trabajo anunció una fiscalización de la acreditación de contratistas en la región.',
  },
];

export async function judgeOutreach(input: { datos: unknown; asunto: string; cuerpo: string }): Promise<OutreachJudgeScore & { model: string }> {
  const prompt = `Evalúas correos comerciales que escribió una IA para una empresa de outsourcing en Chile. Tu trabajo es detectar lo que un lector notaría como artificial, genérico o falso.

Recibes los datos de entrada del correo, el correo (asunto y cuerpo) y pares de ejemplos ANTES (ficha corporativa, genérico) y DESPUÉS (motivo concreto, humano).

Puntúa de 1 a 5:
- suena_humano: 5 si lo podría haber escrito a mano un ejecutivo chileno para una sola persona; 1 si se nota plantilla o IA.
- especificidad: 5 si usa un detalle verdadero y relevante del destinatario o de su industria; 1 si se podría enviar a cualquiera. Un correo correcto pero genérico no pasa de 3.
- un_solo_pedido: 5 si hay un solo pedido, claro y fácil de responder; 1 si hay varios o ninguno.
- tono_y_tratamiento: 5 si el registro calza con la industria y el cargo, y usa el tratamiento indicado (tú o usted) en todo el correo.
- veracidad: 5 si todos los hechos, cifras y nombres están en los datos de entrada; 1 si hay algo inventado. Con un solo hecho sin respaldo, pon 1 o 2.

Además:
- frase_mas_artificial: copia textual de la frase que más delata a una IA o a una plantilla. Vacío si no hay.
- hechos_sin_respaldo: cada afirmación que no está en los datos de entrada.
- motivo: una o dos frases con lo más importante que habría que cambiar.

Sé estricto y concreto. No reescribas el correo.

PARES ANTES/DESPUÉS:
${JSON.stringify(BEFORE_AFTER)}

DATOS DE ENTRADA:
${JSON.stringify(input.datos)}

CORREO:
Asunto: ${input.asunto}
${input.cuerpo}

Devuelve JSON con esta forma exacta:
{"suena_humano":5,"especificidad":5,"un_solo_pedido":5,"tono_y_tratamiento":5,"veracidad":5,"frase_mas_artificial":"","hechos_sin_respaldo":[],"motivo":""}`;

  const result = await generateStructuredWithTelemetry({
    provider: 'openai',
    openAiModel: String(process.env.OPENAI_EMAIL_MODEL || process.env.OPENAI_BALANCED_MODEL || 'gpt-6-luna').trim(),
    schema: OutreachJudgeOutputSchema,
    temperature: 0.2,
    prompt,
  });
  return { ...result.data, model: result.telemetry.modelName };
}

export const judgeOutreachFlow = ai.defineFlow(
  {
    name: 'judgeOutreach',
    inputSchema: z.object({ datos: z.any(), asunto: z.string(), cuerpo: z.string() }),
    outputSchema: OutreachJudgeOutputSchema,
  },
  async (input) => {
    const { model: _model, ...score } = await judgeOutreach({ datos: input.datos ?? null, asunto: input.asunto, cuerpo: input.cuerpo });
    return score;
  },
);
