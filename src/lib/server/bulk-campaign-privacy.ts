import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type BulkCampaignSubjectRecord = {
  campaignId: string; organizationId: string; userId: string; status: string;
  createdAt: string; approvedAt: string | null; recipient: unknown;
};

/** Only the subject's row is exported, never the full batch, brief, overrides or other recipients. */
export function projectBulkCampaignSubject(rows: any[], email: string): BulkCampaignSubjectRecord[] {
  const normalized = email.trim().toLowerCase();
  return rows.flatMap(row => (Array.isArray(row.recipients) ? row.recipients : [])
    .filter((recipient: any) => typeof recipient.email === 'string' && recipient.email.trim().toLowerCase() === normalized)
    .map((recipient: unknown) => ({ campaignId: row.id, organizationId: row.organization_id,
      userId: row.user_id, status: row.status, createdAt: row.created_at, approvedAt: row.approved_at ?? null, recipient })));
}

export async function lookupBulkCampaignSubject(email: string, admin = getSupabaseAdminClient()): Promise<BulkCampaignSubjectRecord[]> {
  const result: BulkCampaignSubjectRecord[] = [];
  const normalized = email.trim().toLowerCase();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin.from('bulk_campaigns')
      .select('id,organization_id,user_id,status,created_at,approved_at,recipients')
      .contains('recipients', [{ email: normalized }]).order('id').range(offset, offset + 499);
    // Compatibility before the first migration. An outage/permission error must not silently truncate exports.
    if (error) {
      if (offset === 0 && ['42P01', '42p01', 'PGRST205'].includes(error.code)) return [];
      throw error;
    }
    result.push(...projectBulkCampaignSubject(data || [], normalized));
    if (!data || data.length < 500) return result;
  }
}
