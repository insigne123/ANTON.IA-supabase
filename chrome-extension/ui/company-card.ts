/**
 * The company card of the panel (plan 8, phase 4, PR-4d), computed apart so the panel and its tests read the same thing. The page
 * says what LinkedIn shows of the company; the server says what the organization has of it.
 */
export type CompanyPage = {
  linkedinUrl: string; name: string; industry?: string; size?: string; headquarters?: string; website?: string; people?: boolean; tabId?: number;
};
type Presence = { label: string; tone: 'success' | 'info' | 'warning'; blocks: boolean };
export type CompanyContact = { name: string; title: string; linkedinUrl: string; hasEmail: boolean; presence: Presence | null };
export type CompanyOpportunity = { company: string; ads: number; score: number; status: string; signal: string; page: string };
export type CompanyView = { contacts: CompanyContact[]; total: number; truncated: boolean; searchHref: string; opportunity: CompanyOpportunity | null };

/** The line under the company's name: «Minería · 1.001-5.000 empleados · Antofagasta». */
export const companyFacts = (page: CompanyPage) =>
  [page.industry, page.size, page.headquarters].map(value => (value || '').trim()).filter(Boolean).join(' · ');

/** The company as the server reads it; empty until its name is on screen, so the same company is asked for once. */
export function companyRequest(page: CompanyPage | null) {
  if (!page?.linkedinUrl || !page.name?.trim()) return null;
  return { linkedinUrl: page.linkedinUrl, name: page.name.trim(), domain: page.website || '', industry: page.industry || '',
    size: page.size || '', headquarters: page.headquarters || '' };
}

/** «3 contactos guardados», with how many are shown when there are more. */
export function contactsHeading(view: Pick<CompanyView, 'contacts' | 'total' | 'truncated'>) {
  if (!view.total) return 'Sin contactos guardados';
  const count = `${view.total}${view.truncated ? '+' : ''} ${view.total === 1 && !view.truncated ? 'contacto guardado' : 'contactos guardados'}`;
  return view.contacts.length < view.total ? `${count} · se muestran ${view.contacts.length}` : count;
}

/** What to do when the organization has nobody there yet: look for them, or save the ones LinkedIn shows. */
export function emptyCompanyText(page: CompanyPage) {
  return page.people
    ? `Todavía no tienes contactos de ${page.name}. Elige abajo a quienes ves en LinkedIn o busca a sus decisores en Anton.IA.`
    : `Todavía no tienes contactos de ${page.name}. Busca a sus decisores en Anton.IA o abre sus personas en LinkedIn para guardar a quienes veas.`;
}
