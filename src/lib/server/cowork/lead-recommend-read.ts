import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recommendLeads, recommendTerms, type RecommendCriteria, type RecommendLead } from '@/lib/cowork/lead-recommend';
import { readTeamLocks } from '@/lib/server/team-locks';
import { icpDeclaredFromProfile } from './icp-read';

type Scope = { userId: string; organizationId: string };
const PAGE = 500;
const PAGES = 10;
/** The statuses in which another member is working the person (src/lib/server/team-locks.ts); «saved» is only a notice. */
const LOCKED = new Set(['reserved', 'active', 'closed', 'suppressed']);
const lower = (value: unknown) => String(value || '').trim().toLowerCase();

/**
 * leads.recommend (plan 8, phase 2): the organization's own contacts nobody wrote to yet, best first. Both lists count:
 * «Por escribir» (enriched_leads, usually with an email) and «Por completar» (leads); a person in both is one, the enriched
 * copy. `value` lists the roles and industries of the offer asked about («RR. HH., selección, retail»); empty, the customer
 * declared in «Perfil».
 */
export async function readCoworkLeadRecommendations(client: SupabaseClient, scope: Scope, value: string,
  dependencies: { locks: typeof readTeamLocks } = { locks: readTeamLocks }) {
  const requested = recommendTerms(z.string().max(300).parse(value));
  const userId = z.string().uuid().parse(scope.userId);
  const organizationId = z.string().uuid().parse(scope.organizationId);
  async function scan<T>(table: string, columns: string, filter?: 'sent' | 'completed') {
    const rows: T[] = [];
    for (let page = 0; page < PAGES; page++) {
      let query = client.from(table).select(columns).eq('organization_id', organizationId);
      if (filter === 'sent') query = query.not('sent_at', 'is', null);
      if (filter === 'completed') query = query.not('completed_at', 'is', null);
      const { data, error } = await query.order('id', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error('No se pudieron leer tus contactos para recomendarte a quién escribir.');
      rows.push(...((data || []) as T[]));
      if ((data || []).length < PAGE) return { rows, complete: true };
    }
    return { rows, complete: false };
  }
  type SavedRow = Record<string, string | null>;
  type EnrichedRow = SavedRow & { contacted_count: number | null };
  const [profile, leads, enriched, touches, research] = await Promise.all([
    client.from('profiles').select('company_name,signatures').eq('id', userId).maybeSingle(),
    scan<SavedRow>('leads', 'id,name,title,company,industry,email,linkedin_url,last_investigated_at,last_contacted_at,city,country'),
    scan<EnrichedRow>('enriched_leads', 'id,full_name,title,company_name,organization_name,organization_industry,email,linkedin_url,city,country,contacted_count,source_saved_lead_id:data->>sourceSavedLeadId'),
    scan<{ lead_id: string | null; email: string | null }>('contacted_leads', 'lead_id,email', 'sent'),
    // Research is private to whoever ran it (row security): what the person researched counts; the rest is not known.
    scan<{ lead_id: string | null; email: string | null; completed_at: string | null }>('lead_research_reports', 'lead_id,email,completed_at', 'completed'),
  ]);
  if (profile.error) throw new Error('No se pudo leer tu perfil para recomendarte a quién escribir.');
  const declared = icpDeclaredFromProfile(profile.data);
  const criteria: RecommendCriteria = requested.length
    ? { terms: requested, locations: [], source: 'pedido' }
    : declared && (declared.roles.length || declared.industries.length)
      ? { terms: [...declared.roles, ...declared.industries], locations: declared.locations, source: 'perfil' }
      : { terms: [], locations: [], source: 'ninguno' };

  const researchedAt = new Map<string, string>();
  for (const row of research.rows) {
    for (const key of [row.lead_id, lower(row.email)]) if (key && row.completed_at && !researchedAt.has(key)) researchedAt.set(key, row.completed_at);
  }
  const researched = (...keys: Array<string | null | undefined>) => keys.map(key => key && researchedAt.get(key)).find(Boolean) || null;
  const contactedIds = new Set(touches.rows.flatMap(row => row.lead_id ? [row.lead_id] : []));
  const contactedEmails = new Set(touches.rows.map(row => lower(row.email)).filter(Boolean));

  // A person enriched from a saved contact keeps that contact's id: the enriched copy (with its email) stands for both.
  const covered = new Set<string>();
  const rows: RecommendLead[] = [];
  const contacted = new Set<string>();
  for (const row of enriched.rows) {
    const id = String(row.id);
    const email = row.email || null;
    for (const key of [row.source_saved_lead_id, lower(email), lower(row.linkedin_url)]) if (key) covered.add(key);
    rows.push({
      id, name: row.full_name || null, title: row.title || null, company: row.company_name || row.organization_name || null,
      industry: row.organization_industry || null, email, linkedinUrl: row.linkedin_url || null,
      researchedAt: researched(id, row.source_saved_lead_id, lower(email)), city: row.city || null, country: row.country || null, list: 'por_escribir',
    });
    if (contactedIds.has(id) || (row.source_saved_lead_id && contactedIds.has(row.source_saved_lead_id))
      || (email && contactedEmails.has(lower(email))) || Number(row.contacted_count) > 0) contacted.add(id);
  }
  for (const row of leads.rows) {
    const id = String(row.id);
    if (covered.has(id) || (row.email && covered.has(lower(row.email))) || (row.linkedin_url && covered.has(lower(row.linkedin_url)))) continue;
    rows.push({
      id, name: row.name || null, title: row.title || null, company: row.company || null, industry: row.industry || null,
      email: row.email || null, linkedinUrl: row.linkedin_url || null, researchedAt: row.last_investigated_at || researched(id, lower(row.email)),
      city: row.city || null, country: row.country || null, list: 'por_completar',
    });
    if (contactedIds.has(id) || row.last_contacted_at || (row.email && contactedEmails.has(lower(row.email)))) contacted.add(id);
  }

  // Team locks are read for the best candidates with an address (the reader takes up to 200 at a time).
  const first = recommendLeads({ leads: rows, contacted, lockedByOthers: new Map(), criteria });
  const emails = rows.filter(lead => lead.email && first.top.some(item => item.leadId === lead.id)).map(lead => lead.email!.trim().toLowerCase());
  const lockedByOthers = new Map<string, string>();
  if (emails.length) {
    const locks = await dependencies.locks(client, { userId, organizationId }, { emails });
    for (const [email, lock] of Object.entries(locks.byEmail)) {
      if (LOCKED.has(lock.status) && !lock.mine) lockedByOthers.set(email, lock.ownerName || 'Miembro del equipo');
    }
  }
  const result = lockedByOthers.size ? recommendLeads({ leads: rows, contacted, lockedByOthers, criteria }) : first;
  const complete = leads.complete && enriched.complete && touches.complete;
  return {
    scope: 'organization_lead_recommendations', ...result,
    ...(complete ? {} : { partial: `Se leyeron los primeros ${PAGE * PAGES} contactos de cada lista: el orden es de esa parte.` }),
  };
}
