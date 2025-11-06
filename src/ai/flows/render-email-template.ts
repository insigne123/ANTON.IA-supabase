'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {
  EmailLength,
  EmailScope,
  EmailTone,
  AiIntensity,
} from '@/lib/email-studio/types';

type Input = {
  mode: EmailScope;
  aiIntensity: AiIntensity;
  tone: EmailTone;
  length: EmailLength;
  // texto ya resuelto por tokens (subject/body) como punto de partida (puede venir vacío en rewrite)
  baseSubject?: string;
  baseBody?: string;
  data: {
    companyProfile: any;
    report?: any;
    lead?: any;
    job?: any;
  };
};

const renderEmailTemplateFlow = ai.defineFlow(
  {name: 'renderEmailTemplate', inputSchema: z.any(), outputSchema: z.any()},
  async (input: Input) => {
    const {
      mode,
      aiIntensity,
      tone,
      length,
      baseSubject = '',
      baseBody = '',
      data,
    } = input;

    const constraints = `
- Idioma: español (Chile).
- No inventes información: usa SOLO companyProfile, report, lead/job.
- Si falta un dato, omite o usa formulación genérica (no fabules).
- “Leads”: NO mencionar vacantes. “Oportunidades”: se puede mencionar la vacante.
- Correo: 120–160 palabras aprox., humano y profesional, 1 CTA a breve llamada.
- Asunto: ≤ 8 palabras, sin spam ni mayúsculas agresivas.
`;

    const intent =
      aiIntensity === 'light'
        ? 'Reescribe suavemente para claridad y tono, preservando hechos.'
        : aiIntensity === 'medium'
        ? 'Mejora estructura, tono y concisión, preservando hechos.'
        : 'Redacta desde cero usando solo los datos entregados, sin añadir hechos no presentes.';

    const lengthHint =
      length === 'short'
        ? 'concreta y breve'
        : length === 'long'
        ? 'un poco más detallada (sin exceder 180 palabras)'
        : 'de longitud media';

    const prompt = `
Eres un redactor de outbound B2B con guardrails estrictos.

Modo: ${mode}
Intensidad IA: ${aiIntensity} → ${intent}
Tono: ${tone}. Longitud: ${lengthHint}.
${constraints}

Datos:
- companyProfile: ${JSON.stringify(data.companyProfile)}
- report: ${JSON.stringify(data.report || {})}
- lead: ${JSON.stringify(data.lead || {})}
- job: ${JSON.stringify(data.job || {})}

Base (puede estar vacía si "rewrite"):
SUBJECT_BASE: ${JSON.stringify(baseSubject)}
BODY_BASE:
${baseBody}

Objetivo:
Devuelve SOLO JSON válido: { "subject": "...", "body": "..." }
`;

    const {output} = await ai.generate({
      prompt,
      model: 'googleai/gemini-1.5-pro',
      config: {temperature: 0.4},
      output: {
        format: 'json',
        schema: z.object({subject: z.string(), body: z.string()}),
      },
    });

    let out: any = output;
    if (!out.subject || !out.body) {
      // fallback: si no parseó
      out = {
        subject: baseSubject || 'Propuesta',
        body: baseBody || 'Hola, ¿conversamos esta semana?',
      };
    }
    return out;
  }
);

export async function renderEmailTemplate(input: Input) {
  return renderEmailTemplateFlow(input);
}
