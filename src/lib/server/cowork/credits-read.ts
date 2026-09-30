import { APOLLO_EMAIL_ENRICHMENT_CREDITS, APOLLO_PHONE_ENRICHMENT_CREDITS } from '@/lib/apollo-credit-costs';
import { isApolloCreditBalanceStale, loadLatestApolloCreditBalance, type ApolloCreditBalance } from '@/lib/server/apollo-credit-balance';

/** What is left of the provider credits and what each kind of enrichment costs, so «¿me alcanzan para…?» is answered with the
 * balance and not with a guess. The balance is the shared provider account's last snapshot (the same the app shows), so it says
 * how old that snapshot is. Nothing is written and no provider is called; if the snapshot cannot be read, it says so and gives
 * the costs alone. */
export async function readCoworkCredits(load: () => Promise<ApolloCreditBalance | null> = () => loadLatestApolloCreditBalance(), now = Date.now()) {
  const costs = { emailEnrichment: APOLLO_EMAIL_ENRICHMENT_CREDITS, phoneEnrichment: APOLLO_PHONE_ENRICHMENT_CREDITS };
  let balance: ApolloCreditBalance | null = null;
  try { balance = await load(); } catch { balance = null; }
  if (!balance) {
    return { scope: 'shared_provider_credits', available: false as const, costs,
      limitation: 'No pude leer el saldo ahora; los costos valen igual. No afirmes cuántos créditos quedan.' };
  }
  const ageHours = Math.max(0, Math.floor((now - Date.parse(balance.capturedAt)) / 3_600_000));
  return {
    scope: 'shared_provider_credits', available: true as const,
    remaining: balance.remaining, used: balance.used, limit: balance.limit, cycleEnd: balance.cycleEnd, capturedAt: balance.capturedAt,
    stale: isApolloCreditBalanceStale(balance, now), ageHours, costs,
    affords: { emailEnrichments: Math.floor(balance.remaining / costs.emailEnrichment), phoneReveals: Math.floor(balance.remaining / costs.phoneEnrichment) },
    limitation: 'Saldo compartido de la cuenta de créditos, tomado de la última lectura: si tiene más de unas horas (stale), dilo y no lo presentes como exacto. Un crédito alcanza para el correo de un contacto; revelar un teléfono cuesta diez.',
  };
}
