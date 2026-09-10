import { BulkCampaignWorkspace } from '@/components/campaigns/BulkCampaignWorkspace';
import CampaignsHistoryPage from './history/page';

// The flag is RUNTIME-only, so this route must render per request.
// Otherwise Next bakes the legacy view in at build time.
export const dynamic = 'force-dynamic';

export default function CampaignsPage() {
  return process.env.BULK_CAMPAIGNS_ENABLED === 'true' ? <BulkCampaignWorkspace /> : <CampaignsHistoryPage />;
}
