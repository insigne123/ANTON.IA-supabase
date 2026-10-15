import { joinComma, joinLines } from '@/lib/profile/profile-lists';
import type { AutofillSuggestion } from '@/lib/profile/autofill-suggestion';
import type { ProfileFormValues, ProfileSuggestionField } from '@/lib/profile/profile-mappings';

/** What an admin confirmed in «Oportunidades» (opportunity_company_context): the offer the whole team sells. */
export type WorkspaceOffer = { offer: string; services: string[]; territories: string[] };

export const WORKSPACE_OFFER_SOURCE = 'la oferta que tu empresa confirmó en Oportunidades';

/**
 * The confirmed offer as profile fields, for the same review as the website reading: nothing is saved until the person
 * checks it and presses «Guardar cambios». «Qué ofrece la empresa» is the result and how, so it becomes the value proposition.
 * Only the fields it would change: none, and there is nothing to offer.
 */
export function suggestionFromWorkspaceOffer(offer: WorkspaceOffer, profile: ProfileFormValues): AutofillSuggestion | null {
  const proposed: Partial<Record<ProfileSuggestionField, string>> = {
    services: joinLines(offer.services || []),
    valueProposition: String(offer.offer || '').trim(),
    targetLocations: joinComma(offer.territories || []),
  };
  const values = Object.fromEntries(Object.entries(proposed)
    .filter(([field, value]) => value && value !== String(profile[field as ProfileSuggestionField] || '').trim()));
  if (Object.keys(values).length === 0) return null;
  return { values, sources: {}, pagesRead: [], sourceLabel: WORKSPACE_OFFER_SOURCE };
}
