'use server';
/**
 * @fileOverview Flow to generate a personalized outreach email based on a company research report.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateStructured } from '@/ai/openai-json';

const GenerateOutreachInputSchema = z.object({
  report: z.any().describe('The detailed research report for the lead and their company.'),
  companyProfile: z.any().describe('The profile of your own company to tailor the message.'),
  lead: z.any().describe('The person to contact.'),
  mode: z.enum(['services', 'vacancy']).optional().describe('The intent of the email.'),
});

const GenerateOutreachOutputSchema = z.object({
  subject: z.string().describe('The generated email subject line.'),
  body: z.string().describe('The generated email body.'),
});

export async function generateOutreachFromReport(
  input: z.infer<typeof GenerateOutreachInputSchema>
): Promise<z.infer<typeof GenerateOutreachOutputSchema>> {
  return generateOutreachFromReportFlow(input);
}

const generateOutreachFromReportFlow = ai.defineFlow(
  {
    name: 'generateOutreachFromReportFlow',
    inputSchema: GenerateOutreachInputSchema,
    outputSchema: GenerateOutreachOutputSchema,
  },
  async (input) => {
    const intentInstruction = input.mode === 'vacancy'
      ? 'Escribe un correo para postular/ayudar respecto a una vacante puntual.'
      : 'Escribe un correo de prospección ofreciendo los SERVICIOS de mi empresa al lead. No menciones vacantes.';

    const prompt = `Idioma: Español (Chile). Tono profesional, claro y humano.
Objetivo: ${intentInstruction}

Crea:
1) 3 bullets de contexto cruzando la empresa objetivo y mi empresa (pain -> solucion).
2) Asunto (max 8 palabras).
3) Email (120-160 palabras), con CTA claro a una breve llamada.

MI EMPRESA:
${JSON.stringify(input.companyProfile)}

REPORTE OBJETIVO (resumen n8n):
${JSON.stringify(input.report)}

LEAD:
${JSON.stringify(input.lead)}

Devuelve SOLO JSON valido con esta forma:
{"subject":"...","body":"..."}
`;

    const output = await generateStructured({
      prompt,
      schema: GenerateOutreachOutputSchema,
      temperature: 0.4,
    });

    if (!output) {
      throw new Error('Failed to generate outreach email.');
    }

    const { body, subject } = output;

    // Heurística simple para el asunto si no viene separado
    const finalSubject =
      subject ||
      body
        .split('\n')
        .find((l: string) => l.toLowerCase().startsWith('asunto'))
        ?.split(':')
        .slice(1)
        .join(':')
        .trim() ||
      body.split('\n')[0]?.slice(0, 80) ||
      'Propuesta';

    return { subject: finalSubject, body };
  }
);
