import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { isPrivacyAdminEmail } from '@/lib/server/privacy-admin';

export type PrivacySubjectLookupData = {
  email: string;
  summary: {
    profiles: number;
    leads: number;
    enrichedLeads: number;
    enrichedOpportunities: number;
    peopleSearchLeads: number;
    contactedLeads: number;
    unsubscribedEntries: number;
    researchReports: number;
    researchSnapshots: number;
    researchJobs: number;
    messagingDrafts: number;
    messagingDraftVersions: number;
    outboundDispatches: number;
    campaignV2Campaigns: number;
    campaignV2Enrollments: number;
    campaignV2SequenceSteps: number;
    campaignV2RecipientSteps: number;
    emailEvents: number;
    leadResponses: number;
  };
  records: {
    profiles: Array<{ id: string; email: string; full_name: string | null; updated_at: string | null }>;
    leads: Array<{ id: string; user_id?: string | null; organization_id?: string | null; name: string | null; title: string | null; company: string | null; email: string; status: string | null; created_at: string | null }>;
    enrichedLeads: Array<{ id: string; user_id?: string | null; organization_id?: string | null; full_name: string | null; title: string | null; company_name: string | null; email: string; created_at: string | null; updated_at: string | null }>;
    enrichedOpportunities: Array<{ id: string; user_id?: string | null; organization_id?: string | null; full_name: string | null; title: string | null; company_name: string | null; email: string; created_at: string | null; updated_at: string | null }>;
    peopleSearchLeads: Array<{ id: string; user_id?: string | null; organization_id?: string | null; name: string | null; title: string | null; organization_name: string | null; email: string; created_at: string | null; updated_at: string | null }>;
    contactedLeads: Array<{ id: string; user_id?: string | null; organization_id?: string | null; lead_id?: string | null; name: string | null; role: string | null; company: string | null; email: string; status: string | null; sent_at: string | null; replied_at: string | null; evaluation_status?: string | null; campaign_followup_allowed?: boolean | null; campaign_followup_reason?: string | null }>;
    unsubscribedEntries: Array<{ id: string; email: string; user_id?: string | null; organization_id?: string | null; reason: string | null; created_at: string | null }>;
    researchReports: Array<{ id: string; email: string | null; user_id?: string | null; organization_id?: string | null; lead_ref?: string | null; company_name: string | null; company_domain: string | null; generated_at: string | null; updated_at: string | null }>;
    researchSnapshots: Array<{ id: string; organization_id?: string | null; user_id: string; lead_ref: string; source: string; payload: any; captured_at: string; created_at: string }>;
    researchJobs: Array<{ id: string; organization_id?: string | null; user_id: string; provider_report_id: string; lead_ref: string; email: string | null; status: string; request_payload: any; result_payload: any; created_at: string; completed_at: string | null }>;
    messagingDrafts: Array<{ id: string; organization_id: string; user_id: string; research_snapshot_id: string | null; channel: string; lifecycle: string; current_revision: number; created_at: string; updated_at: string }>;
    messagingDraftVersions: Array<{ id: string; draft_id: string; organization_id: string; user_id: string; research_snapshot_id: string | null; revision: number; recipient: any; content: any; approval: any; preflight: any; payload: any; created_at: string }>;
    outboundDispatches: Array<{ id: string; organization_id: string; user_id: string; draft_id: string; version_id: string; channel: string; provider: string; status: string; metadata: any; provider_message_id: string | null; provider_response: any; error_code: string | null; error_message: string | null; requested_at: string; completed_at: string | null }>;
    campaignV2Campaigns: Array<{ id: string; organization_id: string; user_id: string; name: string; v2_status: string; initial_native_draft_id: string; settings: any; created_at: string; updated_at: string }>;
    campaignV2Enrollments: Array<{ id: string; campaign_id: string; sequence_version_id: string; organization_id: string; user_id: string; recipient_name: string | null; recipient_email: string; recipient_lead_ref: string | null; research_snapshot_id: string | null; status: string; initial_sent_at: string | null; stopped_at: string | null; completed_at: string | null; created_at: string; updated_at: string }>;
    campaignV2SequenceSteps: Array<{ id: string; sequence_version_id: string; organization_id: string; user_id: string; step_index: number; name: string; offset_days: number; instruction: string; created_at: string }>;
    campaignV2RecipientSteps: Array<{ id: string; enrollment_id: string; campaign_id: string; sequence_step_id: string; organization_id: string; user_id: string; step_index: number; state: string; due_at: string | null; native_draft_id: string | null; native_version_id: string | null; outbound_dispatch_id: string | null; contacted_id: string | null; sent_at: string | null; last_error: string | null; created_at: string; updated_at: string }>;
    emailEvents: Array<{ id: string; contacted_id: string | null; event_type: string; provider: string | null; event_at: string; meta: any }>;
    leadResponses: Array<{ id: string; lead_id: string | null; contacted_id?: string | null; type: string; content: string | null; created_at: string }>;
  };
  privacyReview: {
    required: boolean;
    reason: string | null;
    omittedCounts: {
      researchSnapshots: number;
      legacyResearchSnapshots: number;
      mismatchedResearchSnapshots: number;
      researchJobs: number;
      messagingDrafts: number;
      messagingDraftVersions: number;
      outboundDispatches: number;
    };
  };
  warnings: string[];
};

export function normalizePrivacyEmail(value: string) {
  return String(value || '').trim().toLowerCase();
}

function rows(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function exactIlikePattern(value: string) {
  return value.replace(/[\\%_*]/g, '\\$&');
}

export async function lookupPrivacySubjectData(rawEmail: string): Promise<PrivacySubjectLookupData> {
  const email = normalizePrivacyEmail(rawEmail);
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc('lookup_research_messaging_subject_v1', { p_email: email });
  if (error) throw error;

  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const campaignV2 = result.campaignV2 && typeof result.campaignV2 === 'object'
    ? result.campaignV2 as Record<string, unknown>
    : {};
  const campaignV2Campaigns = rows(campaignV2.campaigns);
  const campaignV2Enrollments = rows(campaignV2.enrollments);
  const campaignV2SequenceSteps = rows(campaignV2.sequenceSteps);
  const campaignV2RecipientSteps = rows(campaignV2.recipientSteps);
  const profiles = rows(result.profiles);
  const leads = rows(result.leads);
  const enrichedLeads = rows(result.enrichedLeads);
  const enrichedOpportunities = rows(result.enrichedOpportunities);
  const peopleSearchLeads = rows(result.peopleSearchLeads);
  const contactedLeads = rows(result.contactedLeads);
  const unsubscribedEntries = rows(result.unsubscribedEntries);
  const researchReports = rows(result.researchReports);
  const researchSnapshots = rows(result.researchSnapshots);
  const researchJobs = rows(result.researchJobs);
  const messagingDrafts = rows(result.messagingDrafts);
  const messagingDraftVersions = rows(result.messagingDraftVersions);
  const outboundDispatches = rows(result.outboundDispatches);
  const emailEvents = rows(result.emailEvents);
  const leadResponses = rows(result.leadResponses);
  const privacyReviewInput = result.privacyReview && typeof result.privacyReview === 'object'
    ? result.privacyReview as Record<string, unknown>
    : {};
  const omittedCountsInput = privacyReviewInput.omittedCounts && typeof privacyReviewInput.omittedCounts === 'object'
    ? privacyReviewInput.omittedCounts as Record<string, unknown>
    : {};
  const privacyReview = {
    required: privacyReviewInput.required === true,
    reason: typeof privacyReviewInput.reason === 'string' ? privacyReviewInput.reason : null,
    omittedCounts: {
      researchSnapshots: Number(omittedCountsInput.researchSnapshots || 0),
      legacyResearchSnapshots: Number(omittedCountsInput.legacyResearchSnapshots || 0),
      mismatchedResearchSnapshots: Number(omittedCountsInput.mismatchedResearchSnapshots || 0),
      researchJobs: Number(omittedCountsInput.researchJobs || 0),
      messagingDrafts: Number(omittedCountsInput.messagingDrafts || 0),
      messagingDraftVersions: Number(omittedCountsInput.messagingDraftVersions || 0),
      outboundDispatches: Number(omittedCountsInput.outboundDispatches || 0),
    },
  };
  const warnings: string[] = [];
  if (profiles.length > 0) {
    warnings.push('El correo coincide con un perfil de usuario de la plataforma. La eliminacion completa de cuenta requiere una decision operativa adicional.');
  }
  if (privacyReview.required) {
    warnings.push('Se omitieron registros enlazados cuyo correo no coincide exactamente con el sujeto. Requieren revision manual y no forman parte de esta exportacion.');
  }

  return {
    email,
    summary: {
      profiles: profiles.length,
      leads: leads.length,
      enrichedLeads: enrichedLeads.length,
      enrichedOpportunities: enrichedOpportunities.length,
      peopleSearchLeads: peopleSearchLeads.length,
      contactedLeads: contactedLeads.length,
      unsubscribedEntries: unsubscribedEntries.length,
      researchReports: researchReports.length,
      researchSnapshots: researchSnapshots.length,
      researchJobs: researchJobs.length,
      messagingDrafts: messagingDrafts.length,
      messagingDraftVersions: messagingDraftVersions.length,
      outboundDispatches: outboundDispatches.length,
      campaignV2Campaigns: campaignV2Campaigns.length,
      campaignV2Enrollments: campaignV2Enrollments.length,
      campaignV2SequenceSteps: campaignV2SequenceSteps.length,
      campaignV2RecipientSteps: campaignV2RecipientSteps.length,
      emailEvents: emailEvents.length,
      leadResponses: leadResponses.length,
    },
    records: {
      profiles,
      leads,
      enrichedLeads,
      enrichedOpportunities,
      peopleSearchLeads,
      contactedLeads,
      unsubscribedEntries,
      researchReports,
      researchSnapshots,
      researchJobs,
      messagingDrafts,
      messagingDraftVersions,
      outboundDispatches,
      campaignV2Campaigns,
      campaignV2Enrollments,
      campaignV2SequenceSteps,
      campaignV2RecipientSteps,
      emailEvents,
      leadResponses,
    },
    privacyReview,
    warnings,
  };
}

export async function isEmailSuppressedForScope(rawEmail: string, scope: { userId?: string | null; organizationId?: string | null }) {
  const email = normalizePrivacyEmail(rawEmail);
  const emailPattern = exactIlikePattern(email);
  const userId = String(scope.userId || '').trim() || null;
  const organizationId = String(scope.organizationId || '').trim() || null;
  const admin = getSupabaseAdminClient();

  const { data, error } = await admin
    .from('unsubscribed_emails')
    .select('id, user_id, organization_id')
    .ilike('email', emailPattern);

  if (error) throw error;

  return (data || []).some((row: any) => {
    const rowUserId = row.user_id ? String(row.user_id) : null;
    const rowOrgId = row.organization_id ? String(row.organization_id) : null;
    return (!rowUserId && !rowOrgId) || (userId && rowUserId === userId) || (organizationId && rowOrgId === organizationId);
  });
}

export async function recordPrivacyRequestAction(input: {
  requestId?: string | null;
  actorEmail?: string | null;
  actionType: 'export' | 'block' | 'delete' | 'suspend_account';
  summary: Record<string, unknown>;
}) {
  const requestId = String(input.requestId || '').trim();
  if (!requestId) return;

  const admin = getSupabaseAdminClient();
  const now = new Date().toISOString();
  try {
    await admin
      .from('privacy_requests')
      .update({
        reviewed_by_email: input.actorEmail || null,
        updated_at: now,
        last_action_type: input.actionType,
        last_action_at: now,
        last_action_summary: input.summary,
      })
      .eq('id', requestId);
  } catch (error) {
    console.warn('[privacy-request] failed to record action metadata', error);
  }
}

export async function applyPrivacyBlock(rawEmail: string, input: { reason?: string | null; requestId?: string | null; actorEmail?: string | null }) {
  const email = normalizePrivacyEmail(rawEmail);
  const admin = getSupabaseAdminClient();
  const reason = String(input.reason || '').trim() || 'privacy_request_block';

  const { data, error } = await admin.rpc('apply_privacy_suppression_v2', {
    p_email: email,
    p_reason: reason,
  });
  if (error) throw error;
  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};

  const summary = {
    email,
    blocked: true,
    updatedContactedCount: Number(result.updatedContactedCount || 0),
    updatedLeadsCount: Number(result.updatedLeadsCount || 0),
    updatedEnrichedOpportunitiesCount: Number(result.updatedEnrichedOpportunitiesCount || 0),
    updatedPeopleSearchLeadsCount: Number(result.updatedPeopleSearchLeadsCount || 0),
    campaignSafetyStop: result.campaignSafetyStop || null,
  };

  await recordPrivacyRequestAction({
    requestId: input.requestId,
    actorEmail: input.actorEmail,
    actionType: 'block',
    summary,
  });

  return summary;
}

export async function deletePrivacySubjectData(rawEmail: string, input: { reason?: string | null; requestId?: string | null; actorEmail?: string | null }) {
  const email = normalizePrivacyEmail(rawEmail);
  const admin = getSupabaseAdminClient();

  const { data: deletedResearchMessaging, error: deleteResearchMessagingError } = await admin.rpc(
    'delete_native_research_messaging_subject_v1',
    { p_email: email },
  );
  if (deleteResearchMessagingError) throw deleteResearchMessagingError;
  const lookup = await lookupPrivacySubjectData(email);

  if (deletedResearchMessaging?.outcome === 'manual_review') {
    const summary = {
      email,
      outcome: 'manual_review' as const,
      blocked: true,
      reason: String(deletedResearchMessaging.reason || 'cross_subject_reference'),
      preservedProfilesCount: lookup.records.profiles.length,
      warnings: [
        ...lookup.warnings,
        'La eliminacion requiere revision manual porque hay registros enlazados que no pueden atribuirse con seguridad al sujeto.',
      ],
    };
    await recordPrivacyRequestAction({
      requestId: input.requestId,
      actorEmail: input.actorEmail,
      actionType: 'delete',
      summary,
    });
    return summary;
  }

  if (deletedResearchMessaging?.outcome === 'pending') {
    const summary = {
      email,
      outcome: 'pending' as const,
      blocked: true,
      reason: String(deletedResearchMessaging.reason || 'native_research_in_progress'),
      preservedProfilesCount: lookup.records.profiles.length,
      warnings: [
        ...lookup.warnings,
        'El contacto quedó bloqueado. Vuelve a ejecutar la eliminación cuando termine el trabajo o envío que ya estaba en curso.',
      ],
    };
    await recordPrivacyRequestAction({
      requestId: input.requestId,
      actorEmail: input.actorEmail,
      actionType: 'delete',
      summary,
    });
    return summary;
  }

  const summary = {
    email,
    outcome: 'deleted' as const,
    blocked: true,
    deletedResearchReportsCount: Number(deletedResearchMessaging?.leadResearchReports || 0),
    deletedResearchSnapshotsCount: Number(deletedResearchMessaging?.researchSnapshots || 0),
    deletedResearchJobsCount: Number(deletedResearchMessaging?.researchJobs || 0),
    deletedMessagingDraftsCount: Number(deletedResearchMessaging?.messagingDrafts || 0),
    deletedMessagingDraftVersionsCount: Number(deletedResearchMessaging?.messagingDraftVersions || 0),
    deletedOutboundDispatchesCount: Number(deletedResearchMessaging?.outboundDispatches || 0),
    deletedEnrichedLeadsCount: Number(deletedResearchMessaging?.enrichedLeads || 0),
    deletedEnrichedOpportunitiesCount: Number(deletedResearchMessaging?.enrichedOpportunities || 0),
    deletedPeopleSearchLeadsCount: Number(deletedResearchMessaging?.peopleSearchLeads || 0),
    deletedContactedLeadsCount: Number(deletedResearchMessaging?.contactedLeads || 0),
    deletedLeadsCount: Number(deletedResearchMessaging?.leads || 0),
    deletedLeadResponsesCount: Number(deletedResearchMessaging?.leadResponses || 0),
    preservedProfilesCount: lookup.records.profiles.length,
    warnings: lookup.warnings,
  };

  await recordPrivacyRequestAction({
    requestId: input.requestId,
    actorEmail: input.actorEmail,
    actionType: 'delete',
    summary,
  });

  return summary;
}

export async function suspendPrivacyPlatformUsers(rawEmail: string, input: { requestId?: string | null; actorEmail?: string | null }) {
  const email = normalizePrivacyEmail(rawEmail);
  if (isPrivacyAdminEmail(email)) {
    throw new Error('No es seguro suspender un correo configurado como administrador de privacidad.');
  }

  const admin = getSupabaseAdminClient();
  const lookup = await lookupPrivacySubjectData(email);
  const profiles = lookup.records.profiles || [];

  for (const profile of profiles) {
    const { error } = await admin.auth.admin.updateUserById(profile.id, {
      ban_duration: '876000h',
    });

    if (error) {
      throw error;
    }
  }

  const summary = {
    email,
    suspendedUserCount: profiles.length,
    warnings: profiles.length === 0
      ? ['No se encontraron perfiles de usuario del SaaS para este correo.']
      : ['La suspension bloquea acceso al SaaS, pero no reemplaza una decision posterior sobre eliminacion completa de cuenta o datos compartidos.'],
  };

  await recordPrivacyRequestAction({
    requestId: input.requestId,
    actorEmail: input.actorEmail,
    actionType: 'suspend_account',
    summary,
  });

  return summary;
}
