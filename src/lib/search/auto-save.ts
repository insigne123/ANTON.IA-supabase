import type { Lead as UILaed } from '@/lib/types';
import { hasLeadPhone, hasVisibleLeadEmail, isPendingEnrichmentStatus } from '@/lib/search/lead-ui';

/**
 * Plan de uso U2 (2 Nov 2026): a contact paid for in «Buscar por perfil» is saved on its own, to whoever asked for it.
 * In October GrupoExpro paid 1,394 credits (60% of the month) for mobiles of 140 people that never reached a list: the
 * number was copied from the result and the app lost track of them. Saved, they wait in «Por escribir» («Por llamar» when
 * they have a mobile), count for the week, and nobody pays for them twice. A mobile Apollo delivers later reaches only the
 * search result, so a person is saved once what was asked has arrived or is known missing. Pure: the page and the tests
 * share it.
 */

/** One key per person: the provider's id when there is one, so a new search for the same profile is the same person. */
export const paidLeadKey = (lead: Pick<UILaed, 'id' | 'sourceProviderId' | 'apolloId'>) =>
  String(lead.sourceProviderId || lead.apolloId || lead.id || '').trim();

/** The results to save now: complete, with an email or a mobile, not saved, contacted or held by someone else, once each. */
export function paidLeadsToSave(leads: UILaed[], state: {
  revealed: boolean;
  isSaved: (lead: UILaed) => boolean;
  isContacted: (lead: UILaed) => boolean;
  isClaimed: (lead: UILaed) => boolean;
  done: ReadonlySet<string>;
}) {
  if (!state.revealed) return [];
  return leads.filter((lead) => {
    const key = paidLeadKey(lead);
    if (!key || state.done.has(key)) return false;
    if (isPendingEnrichmentStatus(lead.enrichmentStatus)) return false;
    if (!hasVisibleLeadEmail(lead) && !hasLeadPhone(lead)) return false;
    return !state.isSaved(lead) && !state.isContacted(lead) && !state.isClaimed(lead);
  });
}

/** What the person reads once they are saved, and where «Ver» takes them. */
export function autoSavedMessage(saved: UILaed[], added: number) {
  const withPhone = saved.some(hasLeadPhone);
  const one = saved.length === 1 ? saved[0] : null;
  return {
    title: one ? `${one.name || 'El contacto'} quedó guardado` : `${added.toLocaleString('es-CL')} contactos quedaron guardados`,
    description: withPhone
      ? 'Lo pagaste, así que queda a tu nombre en «Por escribir»: desde ahí lo llamas o le escribes por WhatsApp.'
      : 'Lo pagaste, así que queda a tu nombre en «Por escribir», listo para escribirle.',
    href: withPhone ? '/saved/leads/enriched?etapa=to_call' : '/saved/leads/enriched',
  };
}
