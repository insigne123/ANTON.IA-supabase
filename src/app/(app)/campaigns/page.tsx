import { BulkCampaignWorkspace } from '@/components/campaigns/BulkCampaignWorkspace';
import CampaignsHistoryPage from './history/page';

// The flag is RUNTIME-only, so this route must render per request.
// Otherwise Next bakes the legacy view in at build time.
export const dynamic = 'force-dynamic';

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const requested = (await searchParams).campaign;
  const initialCampaignId = typeof requested === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requested) ? requested : undefined;
  return process.env.BULK_CAMPAIGNS_ENABLED === 'true' ? <BulkCampaignWorkspace key={initialCampaignId || 'list'} initialCampaignId={initialCampaignId} /> : <CampaignsHistoryPage />;
}
