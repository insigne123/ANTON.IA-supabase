import { generate } from '@genkit-ai/ai';
import { defineFlow } from '@genkit-ai/flow';
import { z } from 'zod';
import { CompanyProfile, Lead, Report } from '../../lib/types';

export const enhanceCompanyReportFlow = defineFlow(
  {
    name: 'enhanceCompanyReportFlow',
    inputSchema: z.object({
      companyProfile: CompanyProfile,
      lead: Lead,
      report: Report,
      myCompany: z.object({
        name: z.string(),
        description: z.string(),
      }),
    }),
    outputSchema: Report,
  },
  async ({ companyProfile, lead, report, myCompany }) => {
    const llmResponse = await generate(
      {
        prompt: `
      Actúa como un experto en ventas B2B. Tu tarea es enriquecer un reporte de investigación sobre una empresa y un lead para facilitar la prospección.

      MI EMPRESA (la que represento):
      Nombre: ${myCompany.name}
      Descripción: ${myCompany.description}
      
      EMPRESA OBJETIVO (a la que prospecto):
      {{json companyProfile}}
      
      Lead objetivo:
      {{json lead}}
      
      Instrucciones:
      - No inventes información: usa SOLO los datos de la empresa y el lead.
      - "overview": síntesis ejecutiva (3-5 frases).
      - "pains": lista concreta de pains/hipótesis detectadas en la empresa objetivo (máx 7).
      - "opportunities": triggers/ventanas (máx 6).
      - "risks": objeciones probables (máx 5).
      - "valueProps": conecta pains con cómo ayuda MI EMPRESA (máx 6).
      - "useCases": 3-5 casos de uso específicos.
      - "suggestedContacts": roles a los que apuntar (ej: Head of Ops).
      - "talkTracks": 5 bullets de conversación personalizados.
      - "subjectLines": 5 asuntos (≤8 palabras, sin spam).
      - "emailDraft": correo de prospección para OFRECER SERVICIOS (no hablar de vacantes), 120–160 palabras, español (Chile), tono humano/profesional, CTA a una breve llamada.
      - Responde SOLO el JSON sin comentarios.`,
        config: {
          model: 'googleai/gemini-1.5-pro',
          temperature: 0.3,
        },
        output: {
          schema: Report,
        },
      },
      {
        context: {
          companyProfile,
          lead,
        },
      }
    );

    const data = llmResponse.output();
    if (!data) {
      throw new Error('Could not generate report');
    }

    // TODO: use Zod to validate the data?

    // Clean up the response from any markdown backticks.
    return data;
  }
);
