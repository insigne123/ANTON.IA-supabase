/* =====================================================================
   suplia-intent-llm.ts  —  Fase 1: intent híbrido (GLM) con extracción de slots
   Server-only. Mantiene el regex `classifySupliaIntent` como prefiltro barato
   y solo llama a GLM cuando hay duda. Todo corre en GLM (vía openai-json).

   Ubícalo en: src/lib/server/suplia-intent-llm.ts
   ===================================================================== */
import { z } from 'genkit';

import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { getOpenAiModelsForTier } from '@/ai/model-router';
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
  source: 'regex' | 'glm';
};

const IntentSchema = z.object({
  intent: z.enum([
    'smalltalk', 'capabilities', 'company_context', 'out_of_scope', 'direct_answer',
    'artifact_create', 'artifact_update', 'job_workflow', 'pending_action', 'clarification_needed',
  ]),
  confidence: z.number(),
  reason: z.string(),
  slots: z.object({
    objetivo: z.string().nullable().optional(),
    sector: z.string().nullable().optional(),
    ciudad: z.string().nullable().optional(),
    tamano: z.string().nullable().optional(),
    rol: z.string().nullable().optional(),
  }),
});

/**
 * Resuelve la intención del usuario. Usa el regex como prefiltro: si está seguro,
 * no gasta tokens. Si hay duda, usa GLM (tier `fast`) y además extrae slots
 * (objetivo, sector, ciudad, tamaño, rol) para prellenar el workflow/ICP.
 */
export async function classifySupliaIntentHybrid(
  message: string,
  opts?: { recentText?: string; minConfidence?: number },
): Promise<SupliaIntentHybridResult> {
  const regex = classifySupliaIntent(message);
  const threshold = opts?.minConfidence ?? 0.8;

  // Caso claro → respondemos con el regex, gratis.
  if (regex.confidence >= threshold) {
    return { intent: regex.intent, confidence: regex.confidence, reason: regex.reason, slots: {}, source: 'regex' };
  }

  try {
    const prompt = `
Clasifica el mensaje de un usuario de una app B2B de prospeccion, investigacion, contacto y seguimiento de leads (SUPL.IA) y extrae parametros.

Intents posibles:
smalltalk, capabilities, company_context, out_of_scope, direct_answer, artifact_create, artifact_update, job_workflow, pending_action, clarification_needed.

Extrae slots cuando aparezcan (si no, null):
- objetivo: que quiere lograr el usuario.
- sector: industria objetivo.
- ciudad: ciudad o region.
- tamano: tamano/dotacion de empresa.
- rol: cargo o decisor objetivo.

Mensaje del usuario:
"${message}"
${opts?.recentText ? `\nContexto reciente:\n${opts.recentText.slice(0, 800)}` : ''}

Devuelve JSON estricto: { "intent", "confidence" (0 a 1), "reason", "slots" }.
`.trim();

    const { data } = await generateStructuredWithTelemetry({
      prompt,
      schema: IntentSchema,
      temperature: 0.1,
      openAiModels: getOpenAiModelsForTier('fast'),
    });

    return {
      intent: data.intent,
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.6,
      reason: `glm:${data.reason}`,
      slots: data.slots || {},
      source: 'glm',
    };
  } catch (error) {
    console.warn('[SUPLIA/intent-llm] fallback a regex:', error);
    return { intent: regex.intent, confidence: regex.confidence, reason: regex.reason, slots: {}, source: 'regex' };
  }
}
