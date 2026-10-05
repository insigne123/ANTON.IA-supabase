import { GRUPOEXPRO_PILOT, GRUPOEXPRO_TENDER_KEYWORDS } from './pilot';
import { PILOT_SEIA_SECTORS } from './projects';

/**
 * What «Define qué buscas» starts with when an organization has no search profile yet (Plan 10). GrupoExpro, the pilot,
 * gets its own values, recognized by its organization name as in ORGANIZATION_STARTERS (src/lib/search/search-guidance.ts).
 * Anyone else gets their offer from «Perfil» and nothing invented: the person fills in the roles and words. Nothing is
 * saved until the person saves it.
 */
export type HiringProfileSuggestion = {
  name: string; offer: string; roles: string[]; regions: string[]; minAds: number; keywords: string[]; unspscCodes: string[];
  sectors: string[]; minInvestmentUsd: number | null; pilot: boolean;
};

const GRUPOEXPRO = /grupo\s*expro|grupoexpro/i;

export function suggestedHiringProfile(input: { organizationName: string | null | undefined; offer: string | null | undefined }): HiringProfileSuggestion {
  if (GRUPOEXPRO.test(input.organizationName || '')) {
    return {
      name: GRUPOEXPRO_PILOT.name, offer: GRUPOEXPRO_PILOT.offer, roles: [...GRUPOEXPRO_PILOT.roles], regions: [...GRUPOEXPRO_PILOT.regions],
      minAds: GRUPOEXPRO_PILOT.minAds, keywords: [...GRUPOEXPRO_TENDER_KEYWORDS], unspscCodes: [], sectors: [...PILOT_SEIA_SECTORS],
      minInvestmentUsd: 10_000_000, pilot: true,
    };
  }
  return {
    name: 'Qué buscamos', offer: (input.offer || '').replace(/\s+/g, ' ').trim().slice(0, 2000), roles: [], regions: [], minAds: 5,
    keywords: [], unspscCodes: [], sectors: [], minInvestmentUsd: null, pilot: false,
  };
}
