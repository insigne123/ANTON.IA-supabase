import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import type { DuplicateMatch } from '@/lib/commercial-opportunities/duplicates';
import { opportunityDb } from './workspace-store';
import { readableOpportunityIds } from './workspace-access';

/**
 * The opportunities of the workspace that already have some of these files (duplicates.ts), the one with most of them first, at most
 * three. A member hears of one they do not take part in without its title: whether it exists, not what it is.
 */
export async function findOpportunityDuplicates(client: SupabaseClient, scope: WorkScope, hashes: readonly string[]): Promise<DuplicateMatch[]> {
  const wanted = [...new Set(hashes)];
  if (!wanted.length) return [];
  const documents = (opportunityDb(await client.from('opportunity_documents').select('opportunity_id,sha256').eq('organization_id', scope.organizationId)
    .in('sha256', wanted).limit(500)) || []) as Array<{ opportunity_id: string; sha256: string }>;
  const files = new Map<string, Set<string>>();
  for (const row of documents) {
    if (!files.has(row.opportunity_id)) files.set(row.opportunity_id, new Set());
    files.get(row.opportunity_id)!.add(row.sha256);
  }
  if (!files.size) return [];
  const [items, readable] = await Promise.all([
    client.from('commercial_opportunities').select('id,title,created_at').eq('organization_id', scope.organizationId).in('id', [...files.keys()]).then(opportunityDb),
    readableOpportunityIds(client, scope),
  ]);
  const mine = readable === null ? null : new Set(readable);
  return ((items || []) as Array<{ id: string; title: string; created_at: string }>).map(item => {
    const open = mine === null || mine.has(String(item.id));
    return { id: String(item.id), title: open ? String(item.title || '') : null, createdAt: String(item.created_at), matched: files.get(String(item.id))?.size ?? 0, readable: open };
  }).sort((a, b) => b.matched - a.matched || b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
}
