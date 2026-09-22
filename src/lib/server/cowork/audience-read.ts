import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeStoredAudience, type AudienceLead, type AudienceTouch } from '@/lib/cowork/audience-analysis';

export async function readCoworkAudience(client: SupabaseClient, organizationId: string) {
  async function scan(table: string, columns: string) {
    const rows: unknown[] = [];
    for (let page = 0; page < 10; page++) {
      const { data, error } = await client.from(table).select(columns).eq('organization_id', organizationId)
        .order('id', { ascending: true }).range(page * 500, page * 500 + 499);
      if (error) throw new Error('No se pudo comprobar la cobertura de audiencia.');
      rows.push(...(data || []));
      if ((data || []).length < 500) return { rows, complete: true };
    }
    return { rows, complete: false };
  }
  const [leads, history] = await Promise.all([
    scan('leads', 'id,name,title,company,industry'),
    scan('contacted_leads', 'id,lead_id,company,sent_at'),
  ]);
  return { queriedAt: new Date().toISOString(), ...analyzeStoredAudience(leads.rows as AudienceLead[], history.rows as AudienceTouch[],
    { leadsComplete: leads.complete, historyComplete: history.complete }),
    consistency: 'Lectura paginada sin snapshot transaccional; cambios concurrentes pueden alterar la población.' };
}
