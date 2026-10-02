import { titleContainsTerm } from './commercial-facts';
import { icpRoleArea, icpRoleLevel } from './icp';

/**
 * «¿A quién le escribo?» and «¿A quiénes les ofrezco X?» (plan 8, phase 2): the person's own saved contacts that nobody has
 * written to yet, ordered by how well they fit and how ready they are. The terms are the roles and industries of the offer
 * asked about, or else the customer declared in «Perfil». Pure arithmetic: the model explains it and proposes the next step.
 */

export type RecommendLead = {
  id: string; name: string | null; title: string | null; company: string | null; industry: string | null;
  email: string | null; linkedinUrl: string | null; researchedAt: string | null; city: string | null; country: string | null;
};
export type RecommendCriteria = { terms: string[]; locations: string[]; source: 'pedido' | 'perfil' | 'ninguno' };

export const RECOMMEND_SHOWN = 20;
const LEVEL_POINTS: Record<string, number> = { 'Dirección': 15, 'Jefatura': 10, 'Profesional': 3 };

/** «RR. HH., selección; retail» → ['RR. HH.', 'selección', 'retail']: commas, semicolons, «|» or line breaks separate terms. */
export function recommendTerms(value: string) {
  return [...new Set(value.split(/[,;|\n]/).map(term => term.replace(/\s+/g, ' ').trim()).filter(term => term.length >= 2 && term.length <= 60))].slice(0, 15);
}

export function scoreRecommendLead(lead: RecommendLead, criteria: RecommendCriteria) {
  const reasons: string[] = [];
  let score = 0;
  const titleHit = lead.title ? criteria.terms.find(term => titleContainsTerm(lead.title!, term)) : undefined;
  if (titleHit) { score += 40; reasons.push(`su cargo calza con «${titleHit}»`); }
  const companyText = [lead.industry, lead.company].filter(Boolean).join(' · ');
  const industryHit = companyText ? criteria.terms.find(term => term !== titleHit && titleContainsTerm(companyText, term)) : undefined;
  if (industryHit) { score += 25; reasons.push(`su empresa calza con «${industryHit}»`); }
  const level = icpRoleLevel(lead.title);
  if (LEVEL_POINTS[level]) { score += LEVEL_POINTS[level]; if (level !== 'Profesional') reasons.push(level === 'Dirección' ? 'decide (dirección)' : 'jefatura'); }
  const place = [lead.city, lead.country].filter(Boolean).join(' · ');
  const placeHit = place ? criteria.locations.find(term => titleContainsTerm(place, term)) : undefined;
  if (placeHit) { score += 5; reasons.push(`está en ${placeHit}`); }
  if (lead.email) { score += 10; reasons.push('tiene correo'); }
  if (lead.researchedAt) { score += 3; reasons.push('ya está investigada'); }
  if (lead.linkedinUrl) score += 2;
  const missing = [...(lead.email ? [] : ['buscar su correo']), ...(lead.researchedAt ? [] : ['investigarla'])];
  return { score: Math.min(100, score), reasons, missing, area: icpRoleArea(lead.title), fits: Boolean(titleHit || industryHit) };
}

/**
 * The ranking. `contacted` are the contacts that already got something; `lockedByOthers` the addresses another member is
 * working (team locks). Without terms the order is readiness and level only, and the answer says what is missing.
 */
export function recommendLeads(input: { leads: RecommendLead[]; contacted: Set<string>; lockedByOthers: Map<string, string>; criteria: RecommendCriteria }) {
  let excludedByTeam = 0;
  const notContacted = input.leads.filter(lead => !input.contacted.has(lead.id));
  const scored = notContacted.flatMap(lead => {
    const owner = lead.email ? input.lockedByOthers.get(lead.email.trim().toLowerCase()) : undefined;
    if (owner) { excludedByTeam++; return []; }
    return [{ lead, ...scoreRecommendLead(lead, input.criteria) }];
  }).sort((a, b) => b.score - a.score || (a.lead.name || '').localeCompare(b.lead.name || ''));
  const withTerms = input.criteria.terms.length > 0;
  const pool = withTerms ? scored.filter(item => item.fits) : scored;
  const byArea = new Map<string, number>();
  for (const item of pool) byArea.set(item.area, (byArea.get(item.area) || 0) + 1);
  return {
    criteria: input.criteria,
    savedContacts: input.leads.length,
    notContacted: notContacted.length,
    fitting: withTerms ? pool.length : null,
    excludedByTeam,
    readyToWrite: pool.filter(item => item.lead.email).length,
    needEmail: pool.filter(item => !item.lead.email).length,
    byArea: [...byArea].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([area, people]) => ({ area, people })),
    top: pool.slice(0, RECOMMEND_SHOWN).map(item => ({
      leadId: item.lead.id, name: item.lead.name, title: item.lead.title, company: item.lead.company,
      score: item.score, reasons: item.reasons, missing: item.missing,
    })),
    limitation: input.criteria.source === 'ninguno'
      ? 'Sin cargos ni industrias que buscar (ni en el pedido ni en «Perfil»): el orden es solo por nivel y preparación.'
      : 'El calce es por texto en el cargo, la industria y la empresa de tus contactos guardados; un cargo escrito de otra forma no calza.',
  };
}
