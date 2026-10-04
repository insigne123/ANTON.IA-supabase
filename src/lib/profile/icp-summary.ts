/**
 * «Tu cliente ideal» at the top of Perfil (Plan 9, PR-19): the four fields the search starts from, read the same way as
 * the starting point in Búsqueda (src/lib/search/search-guidance.ts) — comma separated, and defined once there are roles
 * or industries.
 */
export type IcpSummaryRow = { id: 'roles' | 'industries' | 'size' | 'locations'; label: string; values: string[]; empty: string };

const split = (value?: string | null) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);

export function icpSummary(profile: {
  targetRoles?: string | null;
  targetIndustries?: string | null;
  targetCompanySize?: string | null;
  targetLocations?: string | null;
}): { defined: boolean; rows: IcpSummaryRow[] } {
  const roles = split(profile.targetRoles);
  const industries = split(profile.targetIndustries);
  const size = String(profile.targetCompanySize || '').trim();
  return {
    defined: roles.length > 0 || industries.length > 0,
    rows: [
      { id: 'roles', label: 'Cargos', values: roles, empty: 'Sin cargos' },
      { id: 'industries', label: 'Industrias', values: industries, empty: 'Cualquier industria' },
      { id: 'size', label: 'Tamaño', values: size ? [`${size.replace('+', ' o más')} personas`] : [], empty: 'Cualquier tamaño' },
      // The search takes the first place and starts in Chile when there is none.
      { id: 'locations', label: 'Dónde', values: split(profile.targetLocations), empty: 'Chile (por defecto)' },
    ],
  };
}
