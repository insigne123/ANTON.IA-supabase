import type { LeadSearchFilters } from '@/lib/search/saved-search-criteria';

/**
 * Guidance for the lead search: where to start, where saved people went, and which filter to drop when nothing comes back.
 * Pure, so the page only renders it (docs/busqueda-de-leads.md).
 */

export type SearchStarter = {
  id: string;
  label: string;
  /** One line: who it finds and why. */
  description: string;
  filters: Pick<LeadSearchFilters, 'companyKeywords' | 'location' | 'title' | 'sizeRange' | 'seniorities'>;
};

/** Starting points by what each organization sells. Draft for each organization to validate: they only prefill the form, and
 * the person can change everything before searching. Sources: docs/cowork-grupoexpro-public-commercial-proposal.md and
 * psol.cl (public sites). */
const ORGANIZATION_STARTERS: Array<{ matches: RegExp; starters: SearchStarter[] }> = [
  {
    matches: /grupo\s*expro|grupoexpro/i,
    starters: [
      { id: 'expro-transitorios', label: 'Servicios transitorios',
        description: 'RR. HH. y operaciones de empresas con temporadas altas y reemplazos.',
        filters: { companyKeywords: 'retail, logística, agroindustria, manufactura', location: 'Chile', title: 'Gerente de Recursos Humanos, Jefe de Personas, Gerente de Operaciones', sizeRange: '201-500', seniorities: ['director', 'manager', 'head'] } },
      { id: 'expro-outsourcing', label: 'Outsourcing y BPO',
        description: 'Operaciones, logística y servicio al cliente que pueden externalizar procesos.',
        filters: { companyKeywords: 'logística, centro de distribución, contact center, bodega', location: 'Chile', title: 'Gerente de Operaciones, Jefe de Logística, Gerente de Servicio al Cliente', sizeRange: '501-1000', seniorities: ['director', 'manager', 'head'] } },
      { id: 'expro-seleccion', label: 'Reclutamiento y selección',
        description: 'Quienes contratan perfiles difíciles o en volumen.',
        filters: { companyKeywords: 'tecnología, minería, retail, servicios', location: 'Chile', title: 'Gerente de Recursos Humanos, Jefe de Selección, Talent Acquisition', sizeRange: '201-500', seniorities: ['director', 'manager', 'head'] } },
      { id: 'expro-pay', label: 'ExproPay (nómina)',
        description: 'Finanzas y remuneraciones de empresas de 100 a 500 personas.',
        filters: { companyKeywords: '', location: 'Chile', title: 'Gerente de Administración y Finanzas, Jefe de Remuneraciones, Contralor', sizeRange: '201-500', seniorities: ['director', 'manager', 'head'] } },
    ],
  },
  {
    matches: /\bpsol\b/i,
    starters: [
      { id: 'psol-evaluaciones', label: 'Evaluaciones psicolaborales',
        description: 'Jefaturas de selección que evalúan candidatos con frecuencia.',
        filters: { companyKeywords: 'retail, servicios transitorios, contact center, seguridad', location: 'Chile', title: 'Jefe de Selección, Gerente de Recursos Humanos, Talent Acquisition', sizeRange: '201-500', seniorities: ['director', 'manager', 'head'] } },
      { id: 'psol-masiva', label: 'Selección masiva',
        description: 'Empresas que contratan en volumen y necesitan evaluar rápido.',
        filters: { companyKeywords: 'retail, logística, call center, supermercados', location: 'Chile', title: 'Jefe de Reclutamiento, Coordinador de Selección, Gerente de Personas', sizeRange: '1001-5000', seniorities: ['manager', 'head', 'lead'] } },
      { id: 'psol-comercial', label: 'Equipos comerciales',
        description: 'Gerencias comerciales que contratan vendedores (personalidad comercial).',
        filters: { companyKeywords: 'seguros, banca, telecomunicaciones, retail', location: 'Chile', title: 'Gerente Comercial, Gerente de Ventas, Jefe de Capacitación', sizeRange: '501-1000', seniorities: ['director', 'manager', 'head'] } },
    ],
  },
];

/** For any other organization: the buyers most B2B offers in Chile start with. */
const GENERIC_STARTERS: SearchStarter[] = [
  { id: 'generic-rrhh', label: 'Recursos Humanos', description: 'Gerencias y jefaturas de personas.',
    filters: { companyKeywords: '', location: 'Chile', title: 'Gerente de Recursos Humanos, Jefe de Personas', sizeRange: '201-500', seniorities: ['director', 'manager', 'head'] } },
  { id: 'generic-operaciones', label: 'Operaciones', description: 'Quienes deciden sobre procesos y proveedores.',
    filters: { companyKeywords: '', location: 'Chile', title: 'Gerente de Operaciones, Jefe de Operaciones', sizeRange: '201-500', seniorities: ['director', 'manager', 'head'] } },
  { id: 'generic-comercial', label: 'Comercial', description: 'Gerencias comerciales y de ventas.',
    filters: { companyKeywords: '', location: 'Chile', title: 'Gerente Comercial, Gerente de Ventas', sizeRange: '201-500', seniorities: ['director', 'manager', 'head'] } },
  { id: 'generic-finanzas', label: 'Finanzas', description: 'Administración, finanzas y compras.',
    filters: { companyKeywords: '', location: 'Chile', title: 'Gerente de Administración y Finanzas, Jefe de Compras', sizeRange: '201-500', seniorities: ['director', 'manager', 'head'] } },
];

export function searchStartersFor(organizationName?: string | null): SearchStarter[] {
  const name = String(organizationName || '');
  return ORGANIZATION_STARTERS.find((entry) => entry.matches.test(name))?.starters || GENERIC_STARTERS;
}

/** Where saved people went and the one button that continues: with an email or phone they can be written to now; without one
 * they wait in «Guardados» for their email. */
export function savedLeadsToast(input: { withContact: number; withoutContact: number; duplicates: number }) {
  const { withContact, withoutContact, duplicates } = input;
  const total = withContact + withoutContact;
  const people = (count: number) => `${count} contacto${count === 1 ? '' : 's'}`;
  const duplicateNote = duplicates > 0 ? ` ${duplicates} ya estaba${duplicates === 1 ? '' : 'n'} guardado${duplicates === 1 ? '' : 's'}.` : '';
  if (total === 0) {
    return { title: 'Ya tenías estos contactos', description: `No se agregó nadie nuevo.${duplicateNote}`.trim(), href: '/saved/leads', actionLabel: 'Ver guardados' };
  }
  const parts: string[] = [];
  if (withContact > 0) parts.push(`${people(withContact)} con correo o teléfono, listos para escribirles`);
  if (withoutContact > 0) parts.push(`${people(withoutContact)} sin correo: complétalos en «Guardados»`);
  return {
    title: `Guardaste ${people(total)}`,
    description: `${parts.join('. ')}.${duplicateNote}`,
    href: withContact > 0 ? '/saved/leads/enriched' : '/saved/leads',
    actionLabel: withContact > 0 ? 'Escribirles' : 'Completar correos',
  };
}

export type ActiveFilterChip = { field: keyof LeadSearchFilters; label: string; value: string };

/** The filters narrowing a search that came back empty, in the order worth dropping first. */
export function activeFilterChips(filters: LeadSearchFilters): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  const add = (field: keyof LeadSearchFilters, label: string, value: unknown) => {
    const text = Array.isArray(value) ? value.join(', ') : String(value || '').trim();
    if (text) chips.push({ field, label, value: text });
  };
  add('sizeRange', 'Tamaño', filters.sizeRange);
  add('seniorities', 'Nivel', filters.seniorities);
  add('personLocation', 'Ubicación del lead', filters.personLocation);
  add('companyKeywords', 'Palabras clave', filters.companyKeywords);
  add('companyNameFilter', 'Nombre de empresa', filters.companyNameFilter);
  add('title', 'Cargo', filters.title);
  add('location', 'Sede', filters.location);
  return chips;
}
