import { extensionLeadId, type ExtensionProfile } from '@/lib/extension-contracts';
import type { AuthContext } from '@/lib/server/auth-utils';

export async function findExtensionLead(auth: AuthContext, profile: ExtensionProfile) {
  const url = profile.linkedinUrl;
  const { data, error } = await auth.supabase.from('enriched_leads').select('*')
    .eq('organization_id', auth.organizationId)
    .in('linkedin_url', [url, `${url}/`, url.replace('www.', ''), `${url.replace('www.', '')}/`])
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const result = await auth.supabase.from('enriched_leads').select('*')
    .eq('organization_id', auth.organizationId).eq('id', extensionLeadId(auth.organizationId, url)).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

export async function saveExtensionLead(auth: AuthContext, profile: ExtensionProfile) {
  const existing = await findExtensionLead(auth, profile);
  const fields = {
    ...(profile.fullName ? { full_name: profile.fullName } : {}),
    ...(profile.title ? { title: profile.title } : {}),
    ...(profile.companyName ? { company_name: profile.companyName } : {}),
    ...(profile.email ? { email: profile.email } : {}),
    ...(profile.email ? { email_status: profile.emailStatus } : {}),
    ...(profile.primaryPhone ? { primary_phone: profile.primaryPhone } : {}),
    ...(profile.companyDomain ? { organization_domain: profile.companyDomain } : {}),
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    const { data, error } = await auth.supabase.from('enriched_leads').update(fields)
      .eq('organization_id', auth.organizationId).eq('id', existing.id).select('*').single();
    if (error) throw error;
    return { lead: data, disposition: 'updated' };
  }
  const id = extensionLeadId(auth.organizationId, profile.linkedinUrl);
  const { error } = await auth.supabase.from('enriched_leads').upsert({
    id, organization_id: auth.organizationId, user_id: auth.user.id,
    full_name: profile.fullName || 'Perfil de LinkedIn', company_name: profile.companyName,
    title: profile.title, linkedin_url: profile.linkedinUrl,
    email_status: 'unknown', enrichment_status: 'pending',
    data: { captureSource: 'linkedin_extension', capturedAt: new Date().toISOString() },
    ...fields,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
  const lead = await findExtensionLead(auth, profile);
  if (!lead) throw new Error('EXTENSION_SAVE_NOT_CONFIRMED');
  return { lead, disposition: 'saved' };
}

export function extensionResearchSubject(row: any) {
  return {
    id: row.id, fullName: row.full_name || undefined,
    email: row.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ? row.email : undefined,
    title: row.title || undefined, linkedinUrl: row.linkedin_url,
    companyName: row.company_name || undefined,
    companyDomain: row.organization_domain || row.data?.companyDomain || undefined,
  };
}
