import { APOLLO_EMAIL_ENRICHMENT_CREDITS, APOLLO_PHONE_ENRICHMENT_CREDITS } from '@/lib/apollo-credit-costs';
import { allocationPrices, apolloAllocationEndLabel, type ApolloCreditAllocation } from '@/lib/apollo-credit-allocation';
import { isApolloCreditBalanceStale, loadLatestApolloCreditBalance, type ApolloCreditBalance } from '@/lib/server/apollo-credit-balance';

/** The organization's own share of the provider credits, when it has one for this window: it is what limits its lookups. An
 * organization that does not see its share in the panel reads here only what it used in the cycle. */
function organizationShare(allocation: ApolloCreditAllocation | null) {
  if (!allocation) return null;
  const used = allocation.usedBefore + Math.min(allocation.used, allocation.credits);
  const until = apolloAllocationEndLabel(allocation.endsAt);
  const prices = allocationPrices(allocation);
  const costs = { emailEnrichment: prices.email, phoneEnrichment: prices.phone };
  if (!allocation.showLimit) return { usedThisCycle: used, until, costs };
  return {
    usedThisCycle: used, remaining: allocation.remaining, until, costs,
    affords: {
      emailEnrichments: prices.email > 0 ? Math.floor(allocation.remaining / prices.email) : null,
      phoneReveals: prices.phone > 0 ? Math.floor(allocation.remaining / prices.phone) : null,
    },
  };
}

const SHARE_LIMITATION = ' La organización tiene créditos asignados hasta una fecha (organizationShare): esos limitan sus correos y teléfonos (lo que '
  + 'cuesta cada uno en esta organización está en organizationShare.costs), no el saldo compartido; cuando se acaban, los correos y teléfonos se pausan hasta esa fecha y las búsquedas siguen. '
  + 'Si organizationShare no dice cuántos quedan, no lo calcules ni lo supongas: di solo lo usado.';

/** What is left of the provider credits and what each kind of enrichment costs, so «¿me alcanzan para…?» is answered with the
 * balance and not with a guess. The balance is the shared provider account's last snapshot (the same the app shows), so it says
 * how old that snapshot is. Nothing is written and no provider is called; if the snapshot cannot be read, it says so and gives
 * the costs alone. */
export async function readCoworkCredits(
  load: () => Promise<ApolloCreditBalance | null> = () => loadLatestApolloCreditBalance(),
  now = Date.now(),
  loadAllocation: () => Promise<ApolloCreditAllocation | null> = async () => null,
) {
  let balance: ApolloCreditBalance | null = null;
  try { balance = await load(); } catch { balance = null; }
  let share: ReturnType<typeof organizationShare> = null;
  try { share = organizationShare(await loadAllocation()); } catch { share = null; }
  // The organization's own prices when it has a share (credit-prices.ts); otherwise the default ones.
  const costs = share?.costs ?? { emailEnrichment: APOLLO_EMAIL_ENRICHMENT_CREDITS, phoneEnrichment: APOLLO_PHONE_ENRICHMENT_CREDITS };
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
    affords: { emailEnrichments: costs.emailEnrichment > 0 ? Math.floor(balance.remaining / costs.emailEnrichment) : null,
      phoneReveals: costs.phoneEnrichment > 0 ? Math.floor(balance.remaining / costs.phoneEnrichment) : null },
    ...withShare,
    limitation: 'Saldo compartido de la cuenta de créditos, tomado de la última lectura: si tiene más de unas horas (stale), dilo y no lo presentes como exacto. Lo que cuesta el correo y el teléfono de un contacto está en costs.'
      + (share ? SHARE_LIMITATION : ''),
  };
}
