import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

// Email is searchable too: people often look a contact up by the address they know.
const SEARCH_FIELDS = ['name', 'title', 'company', 'email', 'location', 'city', 'country'] as const;

function searchTerms(raw: string) {
  return raw.replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(term => term.length >= 2).slice(0, 6);
}

/** Conservative first scope: only records owned by this user in this org. */
export async function queryCoworkLeads(
  client: SupabaseClient,
  scope: { userId: string; organizationId: string },
  action: 'leads.search' | 'leads.get',
  value: string,
) {
  let query = client.from('leads')
    .select('id,name,title,company,email,status,industry,location,city,country,created_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('created_at', { ascending: false });
  let terms: string[] = [];
  if (action === 'leads.get') {
    query = query.eq('id', z.string().uuid().parse(value)).limit(1);
  } else {
    // Multi-term queries match by ranked overlap, never by whole-phrase
    // substring: every term counts where it appears, so «reclutador junior
    // GrupoExpro Santiago» still finds a recruiter even when the city is
    // unknown. PostgREST OR grammar must never receive raw model-supplied
    // punctuation.
    const raw = z.string().max(120).parse(value);
    terms = searchTerms(raw);
    if (raw.trim() && terms.length === 0) throw new Error('Invalid search term');
    if (terms.length > 0) {
      const ors = terms.flatMap(term => SEARCH_FIELDS.map(field => `${field}.ilike.%${term}%`));
      query = query.or(ors.join(','));
    }
    query = query.limit(60);
  }
  const { data, error } = await query;
  if (error) throw new Error('No se pudieron consultar los contactos guardados.');
  if (action === 'leads.get' || !data) {
    return { items: data || [], returned: data?.length || 0, limit: action === 'leads.get' ? 1 : 20, scope: 'own_saved_contacts', truncated: action === 'leads.search' && data?.length === 20 };
  }
  const ranked = data.map(row => {
    const haystack = SEARCH_FIELDS.map(field => String((row as Record<string, unknown>)[field] || '')).join(' ').toLocaleLowerCase('es');
    const matched = terms.filter(term => haystack.includes(term.toLocaleLowerCase('es'))).length;
    return { row, matched };
  }).sort((left, right) => right.matched - left.matched);
  const best = ranked[0]?.matched || 0;
  const items = ranked.slice(0, 20).map(entry => entry.row);
  return {
    items, returned: items.length, limit: 20, scope: 'own_saved_contacts',
    truncated: ranked.length > 20,
    partial: items.length > 0 && best < terms.length,
    terms: terms.length,
  };
}
