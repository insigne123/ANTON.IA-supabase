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

/** Who decides on temporary staffing in a company that hires: people, operations and general management. «Buscar decisores»
 * opens Búsqueda on the company with these roles. */
export const DECISION_MAKER_TITLES = ['Gerente de Recursos Humanos', 'Jefe de Recursos Humanos', 'Gerente de Personas',
  'Gerente de Operaciones', 'Jefe de Operaciones', 'Gerente General'];

/** What GrupoExpro sells, as public tenders name it (staffing, outsourcing, recruitment, payroll). Editable in the page. */
export const GRUPOEXPRO_TENDER_KEYWORDS = ['suministro de personal', 'servicios transitorios', 'personal transitorio', 'personal de reemplazo',
  'outsourcing', 'externalización', 'contact center', 'call center', 'reclutamiento', 'selección de personal', 'remuneraciones'];
