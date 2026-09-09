import { BulkCampaignWorkspace } from '@/components/campaigns/BulkCampaignWorkspace';
import CampaignsHistoryPage from './history/page';

export default function CampaignsPage() {
  return process.env.BULK_CAMPAIGNS_ENABLED === 'true' ? <BulkCampaignWorkspace /> : <CampaignsHistoryPage />;
}
