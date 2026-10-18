import type { SupabaseClient } from '@supabase/supabase-js';
import { readTenderProfile, tenderProfileForModel, type TenderProfile } from '@/lib/commercial-opportunities/tender-profile';
import { companyDocumentsForModel, type CompanyDocument } from '@/lib/commercial-opportunities/company-documents';

/**
 * The «Ficha para licitaciones» for a prompt, or null when there is none yet (or before its migration): the prompts then
 * go on without it. Apart from workspace-tender-profile.ts so the screening, the chat and the offer read it without its
 * download and AI dependencies.
 */
export async function loadTenderProfile(client: SupabaseClient, organizationId: string): Promise<TenderProfile | null> {
  const result = await client.from('opportunity_tender_profile').select('answers').eq('organization_id', organizationId).maybeSingle();
  if (result.error || !result.data) return null;
  return readTenderProfile(result.data.answers);
}

/** The company's folder of documents (kind, name, expiry), or none before its migration. */
export async function loadCompanyDocuments(client: SupabaseClient, organizationId: string): Promise<Array<Pick<CompanyDocument, 'kind' | 'label' | 'expiresAt'>>> {
  const result = await client.from('opportunity_company_documents').select('kind,label,expires_at').eq('organization_id', organizationId).limit(100);
  if (result.error || !Array.isArray(result.data)) return [];
  return result.data.map((row: any) => ({ kind: row.kind, label: row.label, expiresAt: row.expires_at ?? null }));
}

/** The profile and the folder as one object for a prompt, or null when the company has neither yet. */
export async function loadCompanyForModel(client: SupabaseClient, organizationId: string, options: { legal?: boolean } = {}) {
  const [profile, documents] = await Promise.all([loadTenderProfile(client, organizationId), loadCompanyDocuments(client, organizationId)]);
  if (!profile && !documents.length) return null;
  return { ...(profile ? tenderProfileForModel(profile, options) : {}), ...(documents.length ? { documentosDeLaEmpresa: companyDocumentsForModel(documents) } : {}) };
}
