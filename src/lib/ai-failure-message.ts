import { isProviderQuotaExhausted } from '@/ai/openai-json';

/** What a person reads when an AI feature fails: never the provider's raw error («OPENAI_HTTP_429:{…}»). An account without
 * credits says so in plain words, because retrying does not help; anything else gets the feature's own fallback. */
export function aiFailureMessage(error: unknown, fallback: string) {
  return isProviderQuotaExhausted(error)
    ? 'El servicio de IA no está disponible por un problema de la cuenta de ANTON.IA con su proveedor, y reintentar ahora no lo resuelve. Avisa a soporte de ANTON.IA.'
    : fallback;
}

export function aiFailureStatus(error: unknown) {
  return isProviderQuotaExhausted(error) ? 503 : 500;
}

// What an AI call throws when it fails inside: the provider's status and body, a missing key, an output that did not parse.
const INTERNAL_AI_ERROR = /(?:OPENAI|GLM)_HTTP_\d+|Missing AI provider credentials|empty model response|no está permitido en ANTON\.IA|Structured generation|timed out|Unexpected token|JSON/i;

/** The error an AI route returns: the feature's own message for anything internal to the AI call, and the app's own words (a
 * missing field, a rule) as they were. Before, these routes returned the error as is, and the toast showed «OPENAI_HTTP_500:{…}». */
export function aiErrorForPerson(error: unknown, fallback: string) {
  if (isProviderQuotaExhausted(error)) return aiFailureMessage(error, fallback);
  const value = error as { name?: unknown; message?: unknown } | null;
  const message = typeof value?.message === 'string' ? value.message.trim() : '';
  if (!message || value?.name === 'ZodError' || value?.name === 'TimeoutError' || value?.name === 'AbortError'
    || message.startsWith('[') || message.startsWith('{') || INTERNAL_AI_ERROR.test(message)) return fallback;
  return message;
}
