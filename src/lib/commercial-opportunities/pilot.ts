import type { HiringProfile } from './hiring';

/**
 * The first search profile of the pilot (plan 8, phase 3): GrupoExpro sells temporary staffing, outsourcing, recruitment
 * and payroll (src/lib/search/search-guidance.ts). Companies that publish many operational job ads are the ones that may
 * need them. Editable in the page; this is only the starting point.
 */
export const GRUPOEXPRO_PILOT = {
  name: 'Contratación operativa',
  offer: 'Servicios transitorios, outsourcing, reclutamiento y selección, y nómina (ExproPay) para empresas que contratan personal operativo en volumen.',
  roles: ['operario', 'bodeguero', 'reponedor', 'cajero', 'vendedor', 'guardia', 'conductor', 'auxiliar de aseo', 'temporero',
    'peoneta', 'grúa horquilla', 'ayudante de bodega', 'packing', 'manipulador de alimentos'],
  regions: [] as string[],
  minAds: 5,
} as const;

export function pilotHiringProfile(extra: Partial<Pick<HiringProfile, 'clients' | 'contactsCompanies' | 'regions' | 'minAds'>> = {}): HiringProfile {
  return {
    roles: [...GRUPOEXPRO_PILOT.roles], regions: extra.regions ?? [...GRUPOEXPRO_PILOT.regions], minAds: extra.minAds ?? GRUPOEXPRO_PILOT.minAds,
    clients: extra.clients ?? [], contactsCompanies: extra.contactsCompanies ?? [],
  };
}
