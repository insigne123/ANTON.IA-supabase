import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { isPrivacyAdminEmail } from '@/lib/server/privacy-admin';

export type PrivacySubjectLookupData = {
  email: string;
  summary: {
    profiles: number;
    leads: number;
    enrichedLeads: number;
    contactedLeads: number;
    unsubscribedEntries: number;
    researchReports: number;
    emailEvents: number;
    leadResponses: number;
  };
  records: {
    profiles: Array<{ id: string; email: string; full_name: string | null; updated_at: string | null }>;
    leads: Array<{ id: string; user_id?: string | null; organization_id?: string | null; name: string | null; title: string | null; company: string | null; email: string; status: string | null; created_at: string | null }>;
    enrichedLeads: Array<{ id: string; user_id?: string | null; organization_id?: string | null; full_name: string | null; title: string | null; company_name: string | null; email: string; created_at: string | null; updated_at: string | null }>;
    contactedLeads: Array<{ id: string; user_id?: string | null; organization_id?: string | null; lead_id?: string | null; name: string | null; role: string | null; company: string | null; email: string; status: string | null; sent_at: string | null; replied_at: string | null; evaluation_status?: string | null; campaign_followup_allowed?: boolean | null; campaign_followup_reason?: string | null }>;
    unsubscribedEntries: Array<{ id: string; email: string; user_id?: string | null; organization_id?: string | null; reason: string | null; created_at: string | null }>;
    researchReports: Array<{ id: string; email: string | null; user_id?: string | null; organization_id?: string | null; lead_ref?: string | null; company_name: string | null; company_domain: string | null; generated_at: string | null; updated_at: string | null }>;
    emailEvents: Array<{ id: string; contacted_id: string | null; event_type: string; provider: string | null; event_at: string; meta: any }>;
    leadResponses: Array<{ id: string; lead_id: string | null; contacted_id?: string | null; type: string; content: string | null; created_at: string }>;
  };
  warnings: string[];
};

export function normalizePrivacyEmail(value: string) {
  return String(value || '').trim().toLowerCase();
}

export async function lookupPrivacySubjectData(rawEmail: string): Promise<PrivacySubjectLookupData> {
  const email = normalizePrivacyEmail(rawEmail);
  const admin = getSupabaseAdminClient();

  const [profiles, leads, enriched, contacted, unsubscribed, researchReports] = await Promise.all([
    admin.from('profiles').select('id, email, full_name, updated_at').ilike('email', email).limit(5),
    admin.from('leads').select('id, user_id, organization_id, name, title, company, email, status, created_at').ilike('email', email).order('created_at', { ascending: false }).limit(50),
    admin.from('enriched_leads').select('id, user_id, organization_id, full_name, title, company_name, email, created_at, updated_at').ilike('email', email).order('updated_at', { ascending: false }).limit(50),
    admin.from('contacted_leads').select('id, user_id, organization_id, lead_id, name, role, company, email, status, sent_at, replied_at, evaluation_status, campaign_followup_allowed, campaign_followup_reason').ilike('email', email).order('sent_at', { ascending: false }).limit(100),
    admin.from('unsubscribed_emails').select('id, email, user_id, organization_id, reason, created_at').ilike('email', email).order('created_at', { ascending: false }).limit(50),
    admin.from('lead_research_reports').select('id, email, user_id, organization_id, lead_ref, company_name, company_domain, generated_at, updated_at').ilike('email', email).order('updated_at', { ascending: false }).limit(50),
  ]);

  const firstError = [profiles, leads, enriched, contacted, unsubscribed, researchReports].find((result) => result.error)?.error;
  if (firstError) {
    throw firstError;
  }

  const leadIds = Array.from(new Set([
    ...(leads.data || []).map((row: any) => String(row.id || '').trim()),
    ...(contacted.data || []).flatMap((row: any) => [String(row.lead_id || '').trim(), String(row.id || '').trim()]),
  ].filter(Boolean)));

  const contactedIds = Array.from(new Set((contacted.data || []).map((row: any) => String(row.id || '').trim()).filter(Boolean)));

  const [emailEvents, leadResponses] = await Promise.all([
    contactedIds.length > 0
      ? admin.from('email_events').select('id, contacted_id, event_type, provider, event_at, meta').in('contacted_id', contactedIds).order('event_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null } as any),
    leadIds.length > 0 && contactedIds.length > 0
      ? admin.from('lead_responses').select('id, lead_id, contacted_id, type, content, created_at').or(`lead_id.in.(${leadIds.join(',')}),contacted_id.in.(${contactedIds.join(',')})`).order('created_at', { ascending: false }).limit(200)
      : leadIds.length > 0
        ? admin.from('lead_responses').select('id, lead_id, contacted_id, type, content, created_at').in('lead_id', leadIds).order('created_at', { ascending: false }).limit(200)
        : contactedIds.length > 0
          ? admin.from('lead_responses').select('id, lead_id, contacted_id, type, content, created_at').in('contacted_id', contactedIds).order('created_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const secondError = [emailEvents, leadResponses].find((result: any) => result?.error)?.error;
  if (secondError) {
    throw secondError;
  }

  const warnings: string[] = [];
  if ((profiles.data || []).length > 0) {
    warnings.push('El correo coincide con un perfil de usuario de la plataforma. La eliminacion completa de cuenta requiere una decision operativa adicional.');
  }

  return {
    email,
    summary: {
      profiles: profiles.data?.length || 0,
      leads: leads.data?.length || 0,
      enrichedLeads: enriched.data?.length || 0,
      contactedLeads: contacted.data?.length || 0,
      unsubscribedEntries: unsubscribed.data?.length || 0,
      researchReports: researchReports.data?.length || 0,
      emailEvents: emailEvents.data?.length || 0,
      leadResponses: leadResponses.data?.length || 0,
    },
    records: {
      profiles: profiles.data || [],
      leads: leads.data || [],
      enrichedLeads: enriched.data || [],
      contactedLeads: contacted.data || [],
      unsubscribedEntries: unsubscribed.data || [],
      researchReports: researchReports.data || [],
      emailEvents: emailEvents.data || [],
      leadResponses: leadResponses.data || [],
    },
    warnings,
  };
}

export async function isEmailSuppressedForScope(rawEmail: string, scope: { userId?: string | null; organizationId?: string | null }) {
  const email = normalizePrivacyEmail(rawEmail);
  const userId = String(scope.userId || '').trim() || null;
  const organizationId = String(scope.organizationId || '').trim() || null;
  const admin = getSupabaseAdminClient();

  const { data, error } = await admin
    .from('unsubscribed_emails')
    .select('id, user_id, organization_id')
    .eq('email', email);

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

  const { data: updatedContacted, error: contactedError } = await admin
    .from('contacted_leads')
    .update({
      campaign_followup_allowed: false,
      campaign_followup_reason: 'privacy_request_block',
      evaluation_status: 'do_not_contact',
      last_update_at: new Date().toISOString(),
    } as any)
    .ilike('email', email)
    .select('id');
  if (contactedError) throw contactedError;

  const { data: updatedLeads, error: leadsError } = await admin
    .from('leads')
    .update({ status: 'do_not_contact' } as any)
    .ilike('email', email)
    .select('id');
  if (leadsError) throw leadsError;

  const { error: unsubError } = await admin
    .from('unsubscribed_emails')
    .insert({ email, reason });
  if (unsubError && unsubError.code !== '23505') throw unsubError;

  const summary = {
    email,
    blocked: true,
    updatedContactedCount: updatedContacted?.length || 0,
    updatedLeadsCount: updatedLeads?.length || 0,
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
  const lookup = await lookupPrivacySubjectData(email);

  const relatedLeadIds = Array.from(new Set([
    ...lookup.records.leads.map((row) => String(row.id || '').trim()),
    ...lookup.records.contactedLeads.flatMap((row) => [String(row.id || '').trim(), String(row.lead_id || '').trim()]),
  ].filter(Boolean)));

  const blockSummary = await applyPrivacyBlock(email, {
    reason: String(input.reason || '').trim() || 'privacy_request_delete_preserve_block',
  });

  if (lookup.records.unsubscribedEntries.length > 0) {
    const { error: deleteUnsubsError } = await admin
      .from('unsubscribed_emails')
      .delete()
      .ilike('email', email);
    if (deleteUnsubsError) throw deleteUnsubsError;

    const { error: reinsertGlobalError } = await admin
      .from('unsubscribed_emails')
      .insert({ email, reason: 'privacy_request_delete_preserve_block' });
    if (reinsertGlobalError && reinsertGlobalError.code !== '23505') throw reinsertGlobalError;
  }

  let deletedLeadResponsesCount = 0;
  if (relatedLeadIds.length > 0) {
    const { data: deletedResponses, error: deleteResponsesError } = await admin
      .from('lead_responses')
      .delete()
      .or(`lead_id.in.(${relatedLeadIds.join(',')}),contacted_id.in.(${relatedLeadIds.join(',')})`)
      .select('id');
    if (deleteResponsesError) throw deleteResponsesError;
    deletedLeadResponsesCount = deletedResponses?.length || 0;
  }

  const [{ data: deletedResearch, error: deleteResearchError }, { data: deletedEnriched, error: deleteEnrichedError }, { data: deletedContacted, error: deleteContactedError }, { data: deletedLeads, error: deleteLeadsError }] = await Promise.all([
    admin.from('lead_research_reports').delete().ilike('email', email).select('id'),
    admin.from('enriched_leads').delete().ilike('email', email).select('id'),
    admin.from('contacted_leads').delete().ilike('email', email).select('id'),
    admin.from('leads').delete().ilike('email', email).select('id'),
  ]);

  if (deleteResearchError) throw deleteResearchError;
  if (deleteEnrichedError) throw deleteEnrichedError;
  if (deleteContactedError) throw deleteContactedError;
  if (deleteLeadsError) throw deleteLeadsError;

  const summary = {
    email,
    blocked: blockSummary.blocked,
    deletedResearchReportsCount: deletedResearch?.length || 0,
    deletedEnrichedLeadsCount: deletedEnriched?.length || 0,
    deletedContactedLeadsCount: deletedContacted?.length || 0,
    deletedLeadsCount: deletedLeads?.length || 0,
    deletedLeadResponsesCount,
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
