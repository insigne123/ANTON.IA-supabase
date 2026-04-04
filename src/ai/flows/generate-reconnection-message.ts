'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateStructured } from '@/ai/openai-json';

const ReconnectionMessageInputSchema = z.object({
  brief: z.object({
    offerName: z.string(),
    offerSummary: z.string(),
    audienceHint: z.string().optional(),
    valuePoints: z.array(z.string()).optional(),
    cta: z.string().optional(),
    tone: z.string().optional(),
  }),
  lead: z.any(),
  report: z.any().nullable().optional(),
  senderProfile: z.any().nullable().optional(),
  step: z.object({
    name: z.string(),
    offsetDays: z.number(),
    stepIndex: z.number(),
    totalSteps: z.number(),
    subjectGuide: z.string().optional(),
    bodyGuide: z.string().optional(),
  }),
  interaction: z.object({
    lastContactAt: z.string().nullable().optional(),
    daysSinceLastContact: z.number().optional(),
    matchReason: z.string().optional(),
    openedAt: z.string().nullable().optional(),
    clickedAt: z.string().nullable().optional(),
    repliedAt: z.string().nullable().optional(),
  }).optional(),
});

const ReconnectionMessageOutputSchema = z.object({
  subject: z.string(),
  bodyHtml: z.string(),
});

export async function generateReconnectionMessage(
  input: z.infer<typeof ReconnectionMessageInputSchema>
): Promise<z.infer<typeof ReconnectionMessageOutputSchema>> {
  return generateReconnectionMessageFlow(input);
}

const generateReconnectionMessageFlow = ai.defineFlow(
  {
    name: 'generateReconnectionMessageFlow',
    inputSchema: ReconnectionMessageInputSchema,
    outputSchema: ReconnectionMessageOutputSchema,
  },
  async (input) => {
    const prompt = `
Escribe un correo de reconexion B2B altamente personalizado en espanol (Chile).

Objetivo:
- Reactivar un lead ya contactado anteriormente para presentar un nuevo servicio, producto o iniciativa.
- Debe sonar humano, especifico y relevante para ese lead.
- Nunca digas que investigaste con IA ni inventes datos.
- Si el contexto es insuficiente, usa solo lo que esta respaldado por los datos disponibles.

Oferta a promocionar:
${JSON.stringify(input.brief)}

Lead y empresa:
${JSON.stringify(input.lead)}

Investigacion disponible:
${JSON.stringify(input.report || null)}

Perfil del remitente:
${JSON.stringify(input.senderProfile || null)}

Contexto de la secuencia:
${JSON.stringify(input.step)}

Historial de interaccion:
${JSON.stringify(input.interaction || null)}

Instrucciones:
- El asunto debe tener maximo 8 palabras y no usar mayusculas exageradas.
- El cuerpo debe ser HTML simple usando solo <p>, <br>, <strong> y <ul><li> si realmente ayuda.
- 90 a 170 palabras.
- Debe conectar la nueva oferta con al menos un dolor, prioridad o contexto del lead/empresa si existe evidencia.
- Debe incluir un CTA claro y simple.
- Si hay una guia previa de asunto o cuerpo, usala como direccion, no como copia literal.
- Evita sonar como spam, newsletter o mensaje masivo.
- No uses placeholders en la salida final.

Devuelve solo JSON valido con esta forma exacta:
{"subject":"...","bodyHtml":"..."}
`;

    const output = await generateStructured({
      prompt,
      schema: ReconnectionMessageOutputSchema,
      temperature: 0.5,
    });

    if (!output) {
      throw new Error('Failed to generate reconnection message');
    }

    return output;
  }
);
