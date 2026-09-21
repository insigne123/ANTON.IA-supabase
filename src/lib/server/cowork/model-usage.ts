import type { SupabaseClient } from '@supabase/supabase-js';

type Telemetry = { modelName: string; durationMs: number; usage?: {
  prompt_tokens?: number; completion_tokens?: number; total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
} | null };

/** Prices are explicit configuration, never guessed from a model family.
 * Snapshot them with usage; unknown or incomplete usage has unknown cost. */
export function coworkModelUsage(telemetry: Telemetry, pricing = process.env.COWORK_MODEL_PRICING_JSON) {
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const inputTokens = count(telemetry.usage?.prompt_tokens);
  const outputTokens = count(telemetry.usage?.completion_tokens);
  const totalTokens = count(telemetry.usage?.total_tokens);
  const cachedInputTokens = count(telemetry.usage?.prompt_tokens_details?.cached_tokens);
  let price: { version: string; inputUsdPerMillion: number; outputUsdPerMillion: number; cachedInputUsdPerMillion: number } | null = null;
  try {
    const item = JSON.parse(pricing || '{}')[telemetry.modelName];
    if (item && typeof item.version === 'string' && item.version.length > 0 && item.version.length <= 80
      && ['inputUsdPerMillion','outputUsdPerMillion','cachedInputUsdPerMillion'].every(key =>
        typeof item[key] === 'number' && Number.isFinite(item[key]) && item[key] >= 0)) {
      price = { version: item.version, inputUsdPerMillion: item.inputUsdPerMillion,
        outputUsdPerMillion: item.outputUsdPerMillion, cachedInputUsdPerMillion: item.cachedInputUsdPerMillion };
    }
  } catch { /* Unknown pricing must not prevent recording real usage. */ }
  const costUsd = price && inputTokens !== null && outputTokens !== null && cachedInputTokens !== null && cachedInputTokens <= inputTokens
    ? ((inputTokens - cachedInputTokens) * price.inputUsdPerMillion + cachedInputTokens * price.cachedInputUsdPerMillion
      + outputTokens * price.outputUsdPerMillion) / 1_000_000 : null;
  return { model: telemetry.modelName.slice(0, 200), durationMs: count(telemetry.durationMs),
    inputTokens, outputTokens, totalTokens, cachedInputTokens, costUsd, pricing: price };
}

export async function recordCoworkModelUsage(client: SupabaseClient, reservationId: string | undefined,
  token: string, telemetry: Telemetry) {
  const usage = coworkModelUsage(telemetry);
  if (!reservationId || process.env.COWORK_MODEL_USAGE_ENABLED !== 'true') return usage;
  const result = await client.rpc('cowork_record_model_usage', {
    p_id: reservationId, p_token: token, p_usage: usage,
  });
  if (result.error || result.data !== true) throw new Error('No se pudo registrar el consumo de este trabajo.');
  return usage;
}
