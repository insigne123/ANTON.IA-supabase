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

/**
 * leads.recommend (plan 8, phase 2): the organization's saved contacts nobody wrote to yet, best first. `value` lists the
 * roles and industries of the offer asked about («RR. HH., selección, retail»); empty, the customer declared in «Perfil».
 */
export async function readCoworkLeadRecommendations(client: SupabaseClient, scope: Scope, value: string,
  dependencies: { locks: typeof readTeamLocks } = { locks: readTeamLocks }) {
  const requested = recommendTerms(z.string().max(300).parse(value));
  const userId = z.string().uuid().parse(scope.userId);
  const organizationId = z.string().uuid().parse(scope.organizationId);
  async function scan<T>(table: string, columns: string, sent = false) {
    const rows: T[] = [];
    for (let page = 0; page < PAGES; page++) {
      let query = client.from(table).select(columns).eq('organization_id', organizationId);
      if (sent) query = query.not('sent_at', 'is', null);
      const { data, error } = await query.order('id', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error('No se pudieron leer tus contactos para recomendarte a quién escribir.');
      rows.push(...((data || []) as T[]));
      if ((data || []).length < PAGE) return { rows, complete: true };
    }
    return { rows, complete: false };
  }
  const [profile, leads, touches] = await Promise.all([
    client.from('profiles').select('company_name,signatures').eq('id', userId).maybeSingle(),
    scan<Record<string, string | null>>('leads', 'id,name,title,company,industry,email,linkedin_url,last_investigated_at,last_contacted_at,city,country'),
    scan<{ lead_id: string | null }>('contacted_leads', 'lead_id', true),
  ]);
  if (profile.error) throw new Error('No se pudo leer tu perfil para recomendarte a quién escribir.');
  const declared = icpDeclaredFromProfile(profile.data);
  const criteria: RecommendCriteria = requested.length
    ? { terms: requested, locations: [], source: 'pedido' }
    : declared && (declared.roles.length || declared.industries.length)
      ? { terms: [...declared.roles, ...declared.industries], locations: declared.locations, source: 'perfil' }
      : { terms: [], locations: [], source: 'ninguno' };
  const rows: RecommendLead[] = leads.rows.map(row => ({
    id: String(row.id), name: row.name || null, title: row.title || null, company: row.company || null, industry: row.industry || null,
    email: row.email || null, linkedinUrl: row.linkedin_url || null, researchedAt: row.last_investigated_at || null,
    city: row.city || null, country: row.country || null,
  }));
  const contacted = new Set([
    ...touches.rows.flatMap(row => row.lead_id ? [row.lead_id] : []),
    ...leads.rows.flatMap(row => row.last_contacted_at ? [String(row.id)] : []),
  ]);
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
  return {
    scope: 'organization_lead_recommendations', ...result,
    ...(leads.complete && touches.complete ? {} : { partial: `Se leyeron los primeros ${PAGE * PAGES} contactos: el orden es de esa parte.` }),
  };
}
