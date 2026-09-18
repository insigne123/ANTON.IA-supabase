import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Conservative first scope: only records owned by this user in this org. */
export async function queryCoworkLeads(
  client: SupabaseClient,
  scope: { userId: string; organizationId: string },
  action: 'leads.search' | 'leads.get',
  value: string,
) {
  let query = client.from('leads')
    .select('id,name,title,company,email,status,industry,location,created_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('created_at', { ascending: false });
  if (action === 'leads.get') {
    query = query.eq('id', z.string().uuid().parse(value)).limit(1);
  } else {
    // PostgREST OR grammar must never receive raw model-supplied punctuation.
    const term = z.string().max(120).parse(value).replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (value.trim() && !term) throw new Error('Invalid search term');
    if (term) query = query.or(`name.ilike.%${term}%,company.ilike.%${term}%,title.ilike.%${term}%`);
    query = query.limit(20);
  }
  const { data, error } = await query;
  if (error) throw new Error('No se pudieron consultar los contactos guardados.');
  return { items: data || [], returned: data?.length || 0, limit: action === 'leads.get' ? 1 : 20, scope: 'own_saved_contacts', truncated: action === 'leads.search' && data?.length === 20 };
}
