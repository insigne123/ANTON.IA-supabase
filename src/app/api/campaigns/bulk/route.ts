import { NextRequest, NextResponse } from 'next/server';
import { requireBulkCampaignAuth as requireAuth } from '@/lib/server/bulk-campaigns';
import { bulkCampaignError, saveBulkCampaign } from '@/lib/server/bulk-campaigns';
import { campaignListStats, type BulkCampaign, type CampaignListStats } from '@/lib/bulk-campaigns';
import type { AuthContext } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** The ten most recent launched campaigns: which first e-mails went out, and who answered after the launch. */
async function launchedCampaignStats(auth: AuthContext, rows: BulkCampaign[]) {
  const launched = rows.filter(row => (row.status === 'approved' || row.status === 'paused') && row.approved_at).slice(0, 10);
  const stats = new Map<string, CampaignListStats>();
  if (!launched.length) return stats;
  const draftIds = launched.flatMap(row => (row.recipients || []).flatMap(person => person.messages.map(message => message.draftId)));
  const since = launched.map(row => row.approved_at as string).sort()[0];
  const sent = new Set<string>();
  for (let index = 0; index < draftIds.length; index += 200) {
    const result = await auth.supabase.from('outbound_dispatches').select('draft_id').eq('organization_id', auth.organizationId)
      .eq('user_id', auth.user.id).eq('status', 'sent').in('draft_id', draftIds.slice(index, index + 200)).limit(1000);
    if (result.error) throw result.error;
    for (const row of result.data || []) sent.add(String((row as { draft_id: string }).draft_id));
  }
  const replies = await auth.supabase.from('contacted_leads').select('email,replied_at').eq('organization_id', auth.organizationId)
    .eq('user_id', auth.user.id).gte('replied_at', since).limit(2000);
  if (replies.error) throw replies.error;
  for (const row of launched) stats.set(row.id, campaignListStats(row, sent, replies.data || []));
  return stats;
}

export async function GET() {
  try {
    const auth = await requireAuth();
    const { data, error } = await auth.supabase.from('bulk_campaigns')
      .select('id,revision,status,definition,recipients,approved_at,created_at,updated_at').eq('organization_id', auth.organizationId)
      .eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const rows = (data || []) as BulkCampaign[];
    // The launched ones say how they go (APP-10). Best effort: without these reads the rows stay as they were.
    const stats = await launchedCampaignStats(auth, rows).catch(() => new Map<string, CampaignListStats>());
    const campaigns = rows.map(({ recipients: _recipients, ...row }) => ({ ...row, ...(stats.has(row.id) ? { stats: stats.get(row.id) } : {}) }));
    return NextResponse.json({ campaigns, automationEnabled: process.env.BULK_CAMPAIGNS_AUTOMATION_ENABLED === 'true' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return bulkCampaignError(error); }
}
export async function POST(req: NextRequest) {
  try { return NextResponse.json({ campaign: await saveBulkCampaign(await requireAuth(), await req.json()) }, { status: 201 }); }
  catch (error) { return bulkCampaignError(error); }
}
