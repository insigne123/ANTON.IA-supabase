type CampaignReferenceSource = {
  campaignId?: unknown;
  campaign_id?: unknown;
  campaignName?: unknown;
  campaign_name?: unknown;
  data?: Record<string, unknown> | null;
};

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return null;
}

export function getCampaignReference(input: {
  contactedLead?: CampaignReferenceSource | null;
  lead?: CampaignReferenceSource | null;
  taskPayload?: CampaignReferenceSource | null;
}) {
  const contactedLead = input.contactedLead || {};
  const lead = input.lead || {};
  const taskPayload = input.taskPayload || {};

  return {
    campaignId: firstText(
      contactedLead.campaign_id,
      contactedLead.campaignId,
      contactedLead.data?.campaign_id,
      contactedLead.data?.campaignId,
      lead.campaignId,
      lead.campaign_id,
      lead.data?.campaign_id,
      lead.data?.campaignId,
      taskPayload.campaignId,
      taskPayload.campaign_id,
    ),
    campaignName: firstText(
      contactedLead.campaign_name,
      contactedLead.campaignName,
      contactedLead.data?.campaign_name,
      contactedLead.data?.campaignName,
      lead.campaignName,
      lead.campaign_name,
      lead.data?.campaign_name,
      lead.data?.campaignName,
      taskPayload.campaignName,
      taskPayload.campaign_name,
    ),
  };
}

export function getCurrentCampaignFollowUp(input: {
  campaignId: string;
  contactedLeadId: string;
  leadId?: string | null;
  steps: any[];
  sentRecords?: Record<string, any> | null;
}) {
  const campaignId = String(input.campaignId || '').trim();
  const contactedLeadId = String(input.contactedLeadId || '').trim();
  const sentRecordKey = String(input.leadId || contactedLeadId).trim();

  if (!campaignId) throw new Error('campaignId is required');
  if (!contactedLeadId) throw new Error('contactedLeadId is required');
  if (!sentRecordKey) throw new Error('campaign sent-record key is required');

  const lastStepIndex = Number(input.sentRecords?.[sentRecordKey]?.lastStepIdx ?? -1);
  const stepIndex = Math.max(0, Number.isFinite(lastStepIndex) ? lastStepIndex + 1 : 0);

  return {
    sentRecordKey,
    stepIndex,
    step: input.steps[stepIndex] || null,
    idempotencyKey: `campaign:${campaignId}:${contactedLeadId}:step:${stepIndex}`,
  };
}
