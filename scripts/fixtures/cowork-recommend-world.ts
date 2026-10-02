// leads.recommend in the corpus worlds: the same function the app runs (src/lib/cowork/lead-recommend.ts) over each world's
// saved contacts, so a turn that asks «¿a quién le escribo?» this way reads the same people as with leads.search.
import { recommendLeads, recommendTerms, type RecommendLead } from '../../src/lib/cowork/lead-recommend';

type Row = { id: string; name?: string | null; title?: string | null; company?: string | null; email?: string | null;
  linkedin_url?: string | null; industry?: string | null; researched?: boolean; city?: string | null };

export function corpusRecommend(rows: Row[], contacted: Set<string>, input: string, lockedByOthers = new Map<string, string>()) {
  const terms = recommendTerms(input);
  const leads: RecommendLead[] = rows.map(row => ({ id: row.id, name: row.name ?? null, title: row.title ?? null, company: row.company ?? null,
    industry: row.industry ?? null, email: row.email ?? null, linkedinUrl: row.linkedin_url ?? null,
    researchedAt: row.researched ? '2026-09-20T12:00:00Z' : null, city: row.city ?? null, country: null }));
  return { scope: 'organization_lead_recommendations', ...recommendLeads({ leads, contacted, lockedByOthers,
    criteria: terms.length ? { terms, locations: [], source: 'pedido' } : { terms: [], locations: [], source: 'ninguno' } }) };
}
