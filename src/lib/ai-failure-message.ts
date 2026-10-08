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
