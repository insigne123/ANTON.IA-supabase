'use server';
/**
 * @fileOverview Flow to generate a personalized outreach email based on a company research report.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateStructured, generateStructuredWithTelemetry } from '@/ai/openai-json';
import {
  DraftContextV2Schema,
  requiredReportAwareDraftPersonalizationV2,
  type DraftContextV2,
} from '@/lib/server/draft-context-v2';
import {
  GeneratedOutreachV2Schema,
  type GeneratedOutreachV2,
} from '@/lib/server/draft-preflight-v2';

const GenerateOutreachInputSchema = z.object({
  report: z.any().describe('The detailed research report for the lead and their company.'),
  companyProfile: z.any().describe('The profile of your own company to tailor the message.'),
  lead: z.any().describe('The person to contact.'),
  mode: z.enum(['services', 'vacancy']).optional().describe('The intent of the email.'),
});

const GenerateOutreachOutputSchema = z.object({
  subject: z.string().trim().min(1).max(80).describe('The generated email subject line.'),
  body: z.string().trim().min(1).describe('The generated email body.'),
});

const GenerateOutreachFromDraftContextV2InputSchema = z.object({
  context: DraftContextV2Schema,
  rewrite: z.object({
    previous: GeneratedOutreachV2Schema,
    errors: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
    instruction: z.string().trim().min(1).max(1_000).optional(),
  }).optional(),
});

const GeneratedOutreachModelV2Schema = GeneratedOutreachV2Schema.omit({
  personalization: true,
  hypothesisIds: true,
});

export type GenerateOutreachFromDraftContextV2Input = {
  context: DraftContextV2;
  rewrite?: {
    previous: GeneratedOutreachV2;
    errors: string[];
    instruction?: string;
  };
};

export type GeneratedOutreachFromDraftContextV2 = GeneratedOutreachV2 & {
  provider: 'openai';
  model: string;
  promptVersion: 'native-draft/v2';
};

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

    return { subject: output.subject, body: output.body };
  }
);

function modelForDraftPriority(priority: DraftContextV2['quality']['priority']) {
  if (priority === 'A') {
    return String(process.env.OPENAI_REASONING_MODEL || process.env.OPENAI_HIGH_QUALITY_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  }
  return String(process.env.OPENAI_BALANCED_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
}

function draftWordCount(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu)?.length || 0;
}

function draftContextPrompt(input: GenerateOutreachFromDraftContextV2Input) {
  const requiredPersonalization = requiredReportAwareDraftPersonalizationV2(input.context);
  const requiredEvidenceIds = new Set(requiredPersonalization.map((item) => item.evidenceId));
  const requiredEvidence = requiredPersonalization.map((provenance) => {
    const evidence = input.context.evidence.find((item) => item.evidenceId === provenance.evidenceId);
    return {
      ...provenance,
      statement: evidence?.statement || '',
      subjectScope: evidence?.subjectScope || 'company',
    };
  });
  const factualContext = {
    ...input.context,
    evidence: input.context.evidence.filter((evidence) => requiredEvidenceIds.has(evidence.evidenceId)),
    hypotheses: [],
  };
  const approvedCtaWords = draftWordCount(input.context.constraints.cta.exactText);
  const modelBodyWords = {
    min: Math.max(1, input.context.constraints.body.minWords - approvedCtaWords),
    max: Math.max(1, input.context.constraints.body.maxWords - approvedCtaWords),
  };
  const correction = input.rewrite
    ? `
BORRADOR ANTERIOR (solo referencia de redacción; no es evidencia):
${JSON.stringify({ subject: input.rewrite.previous.subject, body: input.rewrite.previous.body })}

AJUSTE SOLICITADO POR EL USUARIO:
${JSON.stringify(input.rewrite.instruction || null)}

CORRECCIONES DE VALIDACIÓN:
${JSON.stringify(input.rewrite.errors)}

El cuerpo anterior ya incluye el CTA agregado por el servidor. No lo reproduzcas en la nueva salida. Reescribe sin agregar información ausente de DRAFT_CONTEXT_V2. El ajuste solicitado puede cambiar voz, extensión o estructura, pero nunca relajar las reglas no negociables.
`
    : '';

  return `Idioma: Español (Chile). Redacta un único correo de prospección B2B, profesional y humano.

Usa exclusivamente este DraftContextV2 factual. La matriz evidence contiene la única evidencia autorizada para personalizar. No inventes datos, métricas, clientes, necesidades ni fuentes. No muestres URLs, IDs, nombres de herramientas ni el proceso de investigación dentro del correo.

REPORT_OUTREACH_BRIEF selecciona el enfoque del reporte validado. Sus IDs solo priorizan contexto canónico y doNotClaim solo agrega restricciones: ninguno de esos campos es evidencia ni una fuente de hechos.

Reglas no negociables:
- Asunto dentro de los límites definidos por constraints.subject.
- Devuelve entre ${modelBodyWords.min} y ${modelBodyWords.max} palabras de cuerpo. El servidor agregará después el CTA aprobado para que el correo completo quede dentro de los límites definidos por constraints.body.
- Sigue context.style.profile para el tono, la extensión y las instrucciones de escritura, salvo que contradiga estas reglas.
- Estructura el cuerpo en 4 a 6 párrafos breves separados por una línea en blanco. El saludo debe quedar solo y cada párrafo central debe tener como máximo dos frases.
- No incluyas constraints.cta.exactText en el cuerpo. El servidor lo agregará literalmente una sola vez al final.
- No agregues ninguna pregunta, invitación a actuar, enlace de agenda ni CTA alternativo.
- No dejes placeholders.
- Copia literalmente en el asunto o cuerpo el statement completo de REQUIRED_FACTUAL_PERSONALIZATION. No lo resumas ni lo parafrasees.
- No uses hipótesis, señales o afirmaciones del intento anterior que no aparezcan en DRAFT_CONTEXT_V2.
- El servidor vinculará la procedencia de REQUIRED_FACTUAL_PERSONALIZATION; no devuelvas IDs de evidencia ni claims dentro del correo o el JSON.

REQUIRED_FACTUAL_PERSONALIZATION:
${JSON.stringify(requiredEvidence)}

REPORT_OUTREACH_BRIEF:
${JSON.stringify(input.context.report)}

DRAFT CONTEXT V2:
${JSON.stringify(factualContext)}
${correction}
Devuelve SOLO JSON válido con esta forma exacta:
{"subject":"...","body":"..."}`;
}

/**
 * Native drafting bypasses the configurable provider route: this path must fail closed
 * when OpenAI is unavailable rather than falling back to generic copy from another source.
 */
export async function generateOutreachFromDraftContextV2(
  input: GenerateOutreachFromDraftContextV2Input,
): Promise<GeneratedOutreachFromDraftContextV2> {
  const parsed = GenerateOutreachFromDraftContextV2InputSchema.parse(input);
  const result = await generateStructuredWithTelemetry({
    prompt: draftContextPrompt(parsed),
    schema: GeneratedOutreachModelV2Schema,
    provider: 'openai',
    openAiModel: modelForDraftPriority(parsed.context.quality.priority),
    temperature: parsed.rewrite ? 0 : 0.2,
  });
  return {
    ...result.data,
    personalization: requiredReportAwareDraftPersonalizationV2(parsed.context),
    hypothesisIds: [],
    provider: 'openai',
    model: result.telemetry.modelName,
    promptVersion: 'native-draft/v2',
  };
}
