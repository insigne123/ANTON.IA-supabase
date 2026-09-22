import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { assessListCandidate, type EmailEvidence } from '@/lib/cowork/list-quality';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

type Scope = { userId: string; organizationId: string };

/** Targeted per-contact review. Every check is an exact, bounded query; a
 * missing row is reported with its own scope instead of widening the search.
 * Canonical sources: leads (saved), contacted_leads (app send history),
 * enriched_leads (provider evidence), extension_profile_captures (immutable
 * extension observations), unified_crm_data (stage). */
export async function reviewCoworkListContact(client: SupabaseClient, scope: Scope, value: string,
  check: () => Promise<{ status?: string; reasons?: string[] }>) {
  const id = z.string().uuid().parse(value);
  const { data: lead, error } = await client.from('leads').select('id,email,title,company,linkedin_url')
    .eq('organization_id', scope.organizationId).eq('id', id).maybeSingle();
  if (error || !lead) throw new Error('Contacto no disponible en esta organización.');
  const email = String(lead.email || '').trim().toLowerCase();
  const canonicalUrl = normalizeLinkedinProfileUrl(lead.linkedin_url);

  const sentColumns = 'id,lead_id,email,company';
  const byId = client.from('contacted_leads').select(sentColumns)
    .eq('organization_id', scope.organizationId).eq('lead_id', id).not('sent_at', 'is', null).limit(500);
  const byEmail = email
    ? client.from('contacted_leads').select(sentColumns)
        .eq('organization_id', scope.organizationId).eq('email', email).not('sent_at', 'is', null).limit(500)
    : Promise.resolve({ data: [], error: null });
  const byCompany = lead.company
    ? client.from('contacted_leads').select(sentColumns)
        .eq('organization_id', scope.organizationId).eq('company', lead.company).not('sent_at', 'is', null).limit(500)
    : Promise.resolve({ data: [], error: null });
  const dupes = email
    ? client.from('leads').select('id').eq('organization_id', scope.organizationId)
        .eq('email', email).neq('id', id).limit(3)
    : Promise.resolve({ data: [], error: null });
  const evidenceQuery = email
    ? client.from('enriched_leads').select('email,email_status,source_provider,updated_at,data')
        .eq('organization_id', scope.organizationId).eq('email', email)
        .order('updated_at', { ascending: false }).limit(20)
    : Promise.resolve({ data: [], error: null });
  const captureQuery = canonicalUrl
    ? client.from('extension_profile_captures').select('title,company_name,captured_at')
        .eq('organization_id', scope.organizationId).eq('canonical_url', canonicalUrl)
        .order('captured_at', { ascending: false }).limit(3)
    : Promise.resolve({ data: [], error: null });

  const [sentById, sentByEmail, sentByCompany, dupeRows, contactability, evidence, records, captures] = await Promise.all([
    byId, byEmail, byCompany, dupes, check(), evidenceQuery,
    client.from('unified_crm_data').select('id,stage').eq('organization_id', scope.organizationId)
      .in('id', [`lead_saved|${id}`, `lead_enriched|${id}`]),
    captureQuery,
  ]);
  for (const result of [sentById, sentByEmail, sentByCompany, dupeRows, evidence, records, captures]) {
    if (result.error) throw new Error('No se pudo comprobar la lista; no se asume ausencia de historial.');
  }
  const sentRows = [...(sentById.data || []), ...(sentByEmail.data || []), ...(sentByCompany.data || [])] as Array<{
    id: string; lead_id?: string | null; email?: string | null; company?: string | null;
  }>;
  const history = [...new Map(sentRows.map(row => [row.id,
    { id: row.id, lead_id: row.lead_id, email: row.email, company: row.company, sent_at: 'observed' }])).values()];
  const now = new Date().toISOString();
  const capture = ((captures.data || []) as Array<{ title?: string | null; company_name?: string | null; capturedAt?: string | null; captured_at?: string | null }>)
    .map(row => ({ title: row.title, company: row.company_name, capturedAt: row.capturedAt || row.captured_at }))[0] || null;
  return { scope: 'organization_list_review', queriedAt: now,
    ...assessListCandidate(lead, {
      history, historyComplete: true,
      duplicates: ((dupeRows.data || []) as Array<{ id: string }>).map(row => ({ id: row.id, email })),
      duplicatesComplete: true,
      emailEvidence: ((evidence.data || []) as Array<{ email?: string | null; email_status?: string | null; source_provider?: string | null; updated_at?: string | null; data?: { providerObservedAt?: string } | null }>)
        .map(row => ({ email: row.email, email_status: row.email_status, source_provider: row.source_provider,
          observedAt: row.data?.providerObservedAt || row.updated_at })) as EmailEvidence[],
      blocked: contactability.status === 'blocked', blockReasons: contactability.reasons || [],
      stages: ((records.data || []) as Array<{ stage?: unknown }>).map(row => row.stage).filter((s): s is string => typeof s === 'string'),
      profileEvidence: capture ? { ...capture, source: 'linkedin_extension' } : null, now,
    }),
    limitation: 'Revisión sin escritura. Historial de envíos de la app con consultas exactas acotadas; variantes de empresa con distinta capitalización pueden no cruzarse. Sin snapshot transaccional.' };
}
