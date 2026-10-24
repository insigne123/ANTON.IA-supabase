import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { assertOpportunityRead } from './workspace-access';
import { addOpportunityActivity, opportunityDb } from './workspace-store';

export async function linkObservedOpportunityContacts(client: SupabaseClient, scope: WorkScope, id: string, providerIds: string[]) {
  await assertOpportunityRead(client, scope, id);
  const observations = opportunityDb(await client.from('opportunity_search_observations').select('provider,provider_id').eq('organization_id', scope.organizationId)
    .eq('opportunity_id', id).eq('user_id', scope.userId).in('provider_id', providerIds.slice(0, 100))) || [];
  let linked = 0;
  for (const table of ['leads', 'enriched_leads'] as const) {
    if (!observations.length) break;
    const rows = opportunityDb(await client.from(table).select('id,source_provider,source_provider_id').eq('organization_id', scope.organizationId).in('source_provider_id', observations.map(o => o.provider_id))) || [];
    for (const row of rows) {
      if (!observations.some(o => o.provider === row.source_provider && o.provider_id === row.source_provider_id)) continue;
      opportunityDb(await client.from('opportunity_contact_links').upsert({ organization_id: scope.organizationId, opportunity_id: id, contact_id: String(row.id), contact_table: table,
        source_provider: row.source_provider, source_provider_id: row.source_provider_id, linked_by: scope.userId }, { onConflict: 'opportunity_id,contact_id', ignoreDuplicates: true }));
      await addOpportunityActivity(client, scope, id, 'lead_linked', 'Contacto encontrado en la búsqueda y guardado en la organización', { contactId: row.id, table }, `${id}:lead:${row.source_provider}:${row.source_provider_id}`); linked++;
    }
  }
  return { linked };
}
/** Current contact history, explicitly separate from a claim that the send originated in this opportunity. */
export async function opportunityContactHistory(client: SupabaseClient, scope: WorkScope, id: string) {
  await assertOpportunityRead(client, scope, id);
  const links = opportunityDb(await client.from('opportunity_contact_links').select('*').eq('organization_id', scope.organizationId).eq('opportunity_id', id).limit(200)) || [];
  const out = [];
  for (const link of links) {
    const primary = link.contact_table === 'enriched_leads' ? 'enriched_leads' : 'leads';
    const columns = primary === 'leads' ? 'id,name,email,company,title' : 'id,full_name,email,company_name,title';
    let row = opportunityDb(await client.from(primary).select(columns).eq('organization_id', scope.organizationId).eq('id', link.contact_id).maybeSingle()) as any;
    if (!row && link.source_provider_id) row = opportunityDb(await client.from('enriched_leads').select('id,full_name,email,company_name,title').eq('organization_id', scope.organizationId)
      .eq('source_provider', link.source_provider).eq('source_provider_id', link.source_provider_id).limit(1).maybeSingle());
    const history = row?.email ? opportunityDb(await client.from('outbound_dispatches').select('id,channel,completed_at,user_id')
      .eq('organization_id', scope.organizationId).eq('status', 'sent').eq('metadata->recipient->>email', row.email).order('completed_at', { ascending: false }).limit(20)) || [] : [];
    const replies = row?.email ? opportunityDb(await client.from('contacted_leads').select('id,replied_at,reply_intent,user_id').eq('organization_id', scope.organizationId).eq('email', row.email).not('replied_at', 'is', null).limit(20)) || [] : [];
    out.push({ ...link, name: row?.name || row?.full_name || 'Contacto vinculado', company: row?.company || row?.company_name || '', title: row?.title || '',
      confirmedSends: history, replies, attribution: 'contact_history' });
  }
  return out;
}
