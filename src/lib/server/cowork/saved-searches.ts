import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeSavedSearchCriteria, normalizeSavedSearchName } from '@/lib/search/saved-search-criteria';

/** Service-role adapter mirrors own/shared visibility explicitly. Reading a
 * saved criterion never invokes Apollo, reveals data or consumes a quota. */
export async function readCoworkSavedSearches(client: SupabaseClient, scope: {
  userId: string; organizationId: string;
}, value: string) {
  z.literal('').parse(value);
  const userId = z.string().uuid().parse(scope.userId);
  const organizationId = z.string().uuid().parse(scope.organizationId);
  const { data, error } = await client.from('saved_searches')
    .select('id,user_id,organization_id,name,criteria,is_shared,created_at')
    .eq('organization_id', organizationId)
    .or(`user_id.eq.${userId},is_shared.eq.true`)
    .order('created_at', { ascending: false }).limit(21);
  if (error) throw new Error('No se pudieron consultar las búsquedas guardadas.');
  const rows = data || [];
  // Defense in depth: never forward a row outside the requested visibility.
  if (rows.some(row => row.organization_id !== organizationId || (row.user_id !== userId && row.is_shared !== true))) {
    throw new Error('La consulta devolvió búsquedas fuera del alcance permitido.');
  }
  const items = rows.slice(0, 20).map(row => {
    const criteria = normalizeSavedSearchCriteria(row.criteria);
    const bounded = Object.fromEntries(Object.entries(criteria).map(([key, entry]) => [key,
      typeof entry === 'string' ? entry.slice(0, 500)
        : Array.isArray(entry) ? entry.slice(0, 20).map(value => String(value).slice(0, 120)) : entry,
    ]));
    return {
      id: row.id, name: normalizeSavedSearchName(row.name).slice(0, 160),
      visibility: row.user_id === userId ? 'own' : 'shared', criteria: bounded,
      criteriaTruncated: JSON.stringify(criteria) !== JSON.stringify(bounded),
      createdAt: row.created_at,
    };
  });
  return { scope: 'own_and_shared_saved_searches', items, returned: items.length, limit: 20, truncated: rows.length > 20 };
}
