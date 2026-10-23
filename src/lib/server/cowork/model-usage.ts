import type { SupabaseClient } from '@supabase/supabase-js';

type Telemetry = { modelName: string; durationMs: number; usage?: {
  prompt_tokens?: number; completion_tokens?: number; total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  /** Claude's 5-minute cache writes: already inside prompt_tokens, billed at 1.25 times the input price. */
  cache_creation_input_tokens?: number;
  /** Web searches the API made in the call: each is billed on top of the tokens, at the price the configuration gives (webSearchUsdPerThousand). */
  web_search_requests?: number;
} | null };

/** Prices are explicit configuration, never guessed from a model family.
 * Snapshot them with usage; unknown or incomplete usage has unknown cost. */
export function coworkModelUsage(telemetry: Telemetry, pricing = process.env.COWORK_MODEL_PRICING_JSON) {
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const inputTokens = count(telemetry.usage?.prompt_tokens);
  const outputTokens = count(telemetry.usage?.completion_tokens);
  const totalTokens = count(telemetry.usage?.total_tokens);
  const cachedInputTokens = count(telemetry.usage?.prompt_tokens_details?.cached_tokens);
  const cacheWriteTokens = telemetry.usage?.cache_creation_input_tokens === undefined ? 0 : count(telemetry.usage.cache_creation_input_tokens);
  const searches = telemetry.usage?.web_search_requests === undefined ? 0 : count(telemetry.usage.web_search_requests);
  let price: { version: string; inputUsdPerMillion: number; outputUsdPerMillion: number; cachedInputUsdPerMillion: number; webSearchUsdPerThousand?: number } | null = null;
  try {
    const item = JSON.parse(pricing || '{}')[telemetry.modelName];
    if (item && typeof item.version === 'string' && item.version.length > 0 && item.version.length <= 80
      && ['inputUsdPerMillion','outputUsdPerMillion','cachedInputUsdPerMillion'].every(key =>
        typeof item[key] === 'number' && Number.isFinite(item[key]) && item[key] >= 0)) {
      price = { version: item.version, inputUsdPerMillion: item.inputUsdPerMillion,
        outputUsdPerMillion: item.outputUsdPerMillion, cachedInputUsdPerMillion: item.cachedInputUsdPerMillion,
        ...(typeof item.webSearchUsdPerThousand === 'number' && Number.isFinite(item.webSearchUsdPerThousand) && item.webSearchUsdPerThousand >= 0
          ? { webSearchUsdPerThousand: item.webSearchUsdPerThousand } : {}) };
    }
  } catch { /* Unknown pricing must not prevent recording real usage. */ }
  // A call that searched the web with no price for the searches has an unknown cost, like any other quantity the configuration does not give.
  const searchCost = searches === null ? null : searches === 0 ? 0 : price?.webSearchUsdPerThousand === undefined ? null : searches * price.webSearchUsdPerThousand / 1_000;
  const costUsd = price && inputTokens !== null && outputTokens !== null && cachedInputTokens !== null && cacheWriteTokens !== null && searchCost !== null
    && cachedInputTokens + cacheWriteTokens <= inputTokens
    ? ((inputTokens - cachedInputTokens + cacheWriteTokens * 0.25) * price.inputUsdPerMillion
      + cachedInputTokens * price.cachedInputUsdPerMillion + outputTokens * price.outputUsdPerMillion) / 1_000_000 + searchCost : null;
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
