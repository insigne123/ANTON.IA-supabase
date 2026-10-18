import type { SupabaseClient } from '@supabase/supabase-js';
import { readTenderProfile, type TenderProfile } from '@/lib/commercial-opportunities/tender-profile';

/**
 * The «Ficha para licitaciones» for a prompt, or null when there is none yet (or before its migration): the prompts then
 * go on without it. Apart from workspace-tender-profile.ts so the screening, the chat and the offer read it without its
 * download and AI dependencies.
 */
export async function loadTenderProfile(client: SupabaseClient, organizationId: string): Promise<TenderProfile | null> {
  const result = await client.from('opportunity_tender_profile').select('answers').eq('organization_id', organizationId).maybeSingle();
  if (result.error || !result.data) return null;
  return readTenderProfile(result.data.answers);
}
