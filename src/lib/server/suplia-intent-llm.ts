import { z } from 'genkit';

import { getOpenAiModelsForTier } from '@/ai/model-router';
import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { classifySupliaIntent, type SupliaConversationIntent } from '@/lib/suplia/intent';

export type SupliaIntentSlots = {
  objetivo?: string | null;
  sector?: string | null;
  ciudad?: string | null;
  tamano?: string | null;
  rol?: string | null;
};

export type SupliaIntentHybridResult = {
  intent: SupliaConversationIntent;
  confidence: number;
  reason: string;
  slots: SupliaIntentSlots;
  source: 'regex' | 'model';
};

const IntentSchema = z.object({
  intent: z.enum([
    'smalltalk',
    'capabilities',
    'company_context',
    'out_of_scope',
    'direct_answer',
    'artifact_create',
    'artifact_update',
    'job_workflow',
    'pending_action',
    'clarification_needed',
  ]),
  confidence: z.number(),
  reason: z.string(),
  slots: z.object({
    objetivo: z.string().nullable().optional(),
    sector: z.string().nullable().optional(),
    ciudad: z.string().nullable().optional(),
    tamano: z.string().nullable().optional(),
    rol: z.string().nullable().optional(),
  }).default({}),
});

function clampConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.6;
  return Math.max(0, Math.min(1, number));
}

export async function classifySupliaIntentHybrid(
  message: string,
  opts: { recentText?: string; minConfidence?: number } = {},
): Promise<SupliaIntentHybridResult> {
  const regex = classifySupliaIntent(message);
  const threshold = opts.minConfidence ?? 0.8;

  if (regex.confidence >= threshold) {
    return { intent: regex.intent, confidence: regex.confidence, reason: regex.reason, slots: {}, source: 'regex' };
  }

  try {
    const prompt = `
Clasifica el mensaje de un usuario de SUPL.IA, una app B2B para prospeccion, investigacion, redaccion, contacto y seguimiento de leads.

Intents posibles:
smalltalk, capabilities, company_context, out_of_scope, direct_answer, artifact_create, artifact_update, job_workflow, pending_action, clarification_needed.

Extrae slots cuando aparezcan. Si no aparecen, usa null:
- objetivo: que quiere lograr el usuario.
- sector: industria objetivo.
- ciudad: ciudad o region.
- tamano: tamano o dotacion de empresa.
- rol: cargo o decisor objetivo.

Mensaje:
"${message}"
${opts.recentText ? `\nContexto reciente:\n${opts.recentText.slice(0, 800)}` : ''}

Devuelve JSON estricto: { "intent", "confidence", "reason", "slots" }.
`.trim();

    const { data } = await generateStructuredWithTelemetry({
      prompt,
      schema: IntentSchema,
      temperature: 0.1,
      openAiModels: getOpenAiModelsForTier('fast'),
    });

    return {
      intent: data.intent,
      confidence: clampConfidence(data.confidence),
      reason: `model:${data.reason}`,
      slots: data.slots || {},
      source: 'model',
    };
  } catch (error) {
    console.warn('[SUPLIA/intent-hybrid] fallback to regex:', error);
    return { intent: regex.intent, confidence: regex.confidence, reason: regex.reason, slots: {}, source: 'regex' };
  }
}
