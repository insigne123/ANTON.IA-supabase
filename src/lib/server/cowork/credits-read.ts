import { APOLLO_EMAIL_ENRICHMENT_CREDITS, APOLLO_PHONE_ENRICHMENT_CREDITS } from '@/lib/apollo-credit-costs';
import {
  APOLLO_ALLOCATION_EMAIL_CREDITS, APOLLO_ALLOCATION_PHONE_CREDITS, apolloAllocationEndLabel, type ApolloCreditAllocation,
} from '@/lib/apollo-credit-allocation';
import { isApolloCreditBalanceStale, loadLatestApolloCreditBalance, type ApolloCreditBalance } from '@/lib/server/apollo-credit-balance';

/** The organization's own share of the provider credits, when it has one for this window: it is what limits its lookups. */
function organizationShare(allocation: ApolloCreditAllocation | null) {
  if (!allocation) return null;
  return {
    credits: allocation.credits, used: Math.min(allocation.used, allocation.credits), remaining: allocation.remaining,
    until: apolloAllocationEndLabel(allocation.endsAt),
    costs: { emailEnrichment: APOLLO_ALLOCATION_EMAIL_CREDITS, phoneEnrichment: APOLLO_ALLOCATION_PHONE_CREDITS },
    affords: {
      emailEnrichments: Math.floor(allocation.remaining / APOLLO_ALLOCATION_EMAIL_CREDITS),
      phoneReveals: Math.floor(allocation.remaining / APOLLO_ALLOCATION_PHONE_CREDITS),
    },
  };
}

const SHARE_LIMITATION = ' La organización tiene créditos asignados hasta una fecha (organizationShare): esos limitan sus correos (1 crédito '
  + 'cada uno) y teléfonos (8), no el saldo compartido; cuando se acaban, los correos y teléfonos se pausan hasta esa fecha y las búsquedas siguen.';

/** What is left of the provider credits and what each kind of enrichment costs, so «¿me alcanzan para…?» is answered with the
 * balance and not with a guess. The balance is the shared provider account's last snapshot (the same the app shows), so it says
 * how old that snapshot is. Nothing is written and no provider is called; if the snapshot cannot be read, it says so and gives
 * the costs alone. */
export async function readCoworkCredits(
  load: () => Promise<ApolloCreditBalance | null> = () => loadLatestApolloCreditBalance(),
  now = Date.now(),
  loadAllocation: () => Promise<ApolloCreditAllocation | null> = async () => null,
) {
  const costs = { emailEnrichment: APOLLO_EMAIL_ENRICHMENT_CREDITS, phoneEnrichment: APOLLO_PHONE_ENRICHMENT_CREDITS };
  let balance: ApolloCreditBalance | null = null;
  try { balance = await load(); } catch { balance = null; }
  let share: ReturnType<typeof organizationShare> = null;
  try { share = organizationShare(await loadAllocation()); } catch { share = null; }
  const withShare = share ? { organizationShare: share } : {};
  if (!balance) {
    return { scope: 'shared_provider_credits', available: false as const, costs, ...withShare,
      limitation: 'No pude leer el saldo ahora; los costos valen igual. No afirmes cuántos créditos quedan.' + (share ? SHARE_LIMITATION : '') };
  }
  const ageHours = Math.max(0, Math.floor((now - Date.parse(balance.capturedAt)) / 3_600_000));
  return {
    scope: 'shared_provider_credits', available: true as const,
    remaining: balance.remaining, used: balance.used, limit: balance.limit, cycleEnd: balance.cycleEnd, capturedAt: balance.capturedAt,
    stale: isApolloCreditBalanceStale(balance, now), ageHours, costs,
    affords: { emailEnrichments: Math.floor(balance.remaining / costs.emailEnrichment), phoneReveals: Math.floor(balance.remaining / costs.phoneEnrichment) },
    ...withShare,
    limitation: 'Saldo compartido de la cuenta de créditos, tomado de la última lectura: si tiene más de unas horas (stale), dilo y no lo presentes como exacto. Un crédito alcanza para el correo de un contacto; revelar un teléfono cuesta diez.'
      + (share ? SHARE_LIMITATION : ''),
  };
}
