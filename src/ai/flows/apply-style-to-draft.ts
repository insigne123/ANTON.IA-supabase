'use server';

import { z } from 'genkit';
import { generateStructured } from '@/ai/openai-json';

const ApplyStyleInputSchema = z.object({
  mode: z.enum(['leads', 'opportunities']).default('leads'),
  baseSubject: z.string(),
  baseBody: z.string(),
  styleProfile: z.any(),
  lead: z.any().optional(),
  report: z.any().optional(),
  companyProfile: z.any().optional(),
});

const ApplyStyleOutputSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export type ApplyStyleToDraftInput = z.infer<typeof ApplyStyleInputSchema>;
export type ApplyStyleToDraftOutput = z.infer<typeof ApplyStyleOutputSchema>;

export async function applyStyleToDraft(input: ApplyStyleToDraftInput): Promise<ApplyStyleToDraftOutput> {
  const prompt = `
Eres un editor experto de emails outbound B2B.
Tu trabajo NO es crear un correo desde cero. Tu trabajo es REESCRIBIR un borrador existente para ajustarlo al estilo solicitado.

# Modo
${input.mode}

# Borrador actual
Asunto:
${input.baseSubject}

Cuerpo:
${input.baseBody}

# Estilo solicitado
${JSON.stringify(input.styleProfile || {}, null, 2)}

# Contexto factual
Lead: ${JSON.stringify(input.lead || {})}
Reporte: ${JSON.stringify(input.report || {})}
Mi empresa: ${JSON.stringify(input.companyProfile || {})}

# Reglas estrictas
- Reescribe el borrador actual; no empieces desde cero.
- Conserva el objetivo, los hechos y la propuesta central del borrador base.
- Aplica el tono, longitud, CTA, idioma y restricciones del estilo.
- Si el estilo incluye subjectTemplate o bodyTemplate, usalos solo como guia de estilo, no como reemplazo total obligatorio.
- No inventes datos, logos, clientes, metricas ni afirmaciones no presentes.
- Mantiene el idioma original salvo que el estilo pida otro.
- Si el borrador ya tiene firma o cierre, preservalo en lo posible.
- Devuelve SOLO JSON valido con esta forma exacta:
{"subject":"...","body":"..."}
`;

  const output = await generateStructured({
    prompt,
    schema: ApplyStyleOutputSchema,
    temperature: 0.35,
  });

  return {
    subject: output.subject?.trim() || input.baseSubject,
    body: output.body?.trim() || input.baseBody,
  };
}
