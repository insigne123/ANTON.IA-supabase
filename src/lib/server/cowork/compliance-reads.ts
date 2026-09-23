import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CONTACT_POLICY, evaluateContactPolicy, evaluateFrequency, findObligations, OUTREACH_LAW } from '@/lib/compliance';
import { companyKeysFor } from '@/lib/cowork/send-cadence';
import { santiagoDayBounds } from '@/lib/cowork/send-cadence';

type Scope = { userId: string; organizationId: string };

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

/** 9.1 Marco chileno vigente con jurisdicción, fechas y fuentes. */
export async function readComplianceLaw() {
  return { scope: 'compliance_law', ...OUTREACH_LAW };
}

/** 9.2 Obligaciones del comprador por industria desambiguada. */
export async function readComplianceObligation(value: string) {
  const industry = z.string().max(120).parse(value).trim();
  if (!industry) throw new Error('Indica una industria, por ejemplo minería.');
  return { scope: 'compliance_obligation', ...findObligations(industry),
    limitation: 'Base curada de obligaciones patronales chilenas; sin industria desambiguada solo rige la base.' };
}

/** 9.3 Política transversal persona/cuenta/canal antes de contactar. */
export async function readComplianceCheck(client: SupabaseClient, scope: Scope, value: string) {
  const leadId = z.string().uuid().parse(value);
  const lead = await client.from('leads')
    .select('id,name,email,company').eq('organization_id', scope.organizationId).eq('id', leadId).maybeSingle();
  if (lead.error) throw new Error('No se pudo evaluar la política de contacto.');
  const row = (lead.data as { id: string; name?: string | null; email?: string | null; company?: string | null }) || null;
  if (!row) return { scope: 'organization_compliance', lead: null, verdict: 'block' as const, reasons: ['contact_not_found'], nextEligibleAt: null };
  const email = normalizeEmail(row.email);
  if (!email) return { scope: 'organization_compliance', lead: { id: row.id }, verdict: 'block' as const, reasons: ['missing_email'], nextEligibleAt: null };

  const [unsub, contacted, excluded] = await Promise.all([
    client.from('unsubscribed_emails').select('user_id,organization_id').ilike('email', email),
    client.from('contacted_leads').select('sent_at,replied_at,evaluation_status,company')
      .eq('organization_id', scope.organizationId).ilike('email', email).order('sent_at', { ascending: false }).limit(100),
    client.from('excluded_domains').select('domain').eq('organization_id', scope.organizationId).limit(200),
  ]);
  const failed = [unsub, contacted, excluded].find((result) => result.error)?.error;
  if (failed) throw new Error('No se pudo evaluar la política de contacto.');
  const suppressed = ((unsub.data as Array<{ user_id?: string | null; organization_id?: string | null }>) || [])
    .some((item) => (!item.user_id && !item.organization_id)
      || (scope.userId && item.user_id === scope.userId)
      || (scope.organizationId && item.organization_id === scope.organizationId));
  const touches = ((contacted.data as Array<{ sent_at?: string | null; replied_at?: string | null; evaluation_status?: string | null; company?: string | null }>) || []);
  if (touches.length >= 100) throw new Error('Historial de la persona incompleto; no se autoriza el contacto.');
  const frequency = evaluateFrequency(touches.map((touch) => touch.sent_at));
  const doNotContact = touches.some((touch) => touch.evaluation_status === 'do_not_contact');
  const replied = touches.some((touch) => touch.replied_at);
  const domain = email.split('@')[1] || '';
  const excludedDomain = ((excluded.data as Array<{ domain?: string | null }>) || [])
    .some((item) => String(item.domain || '').trim().toLowerCase().replace(/^@/, '') === domain);
  const dayStart = santiagoDayBounds(new Date()).start;
  const keys = new Set(companyKeysFor(email, row.company).keys);
  const companyDayCollision = touches.some((touch) =>
    (touch.sent_at || '') >= dayStart
    && companyKeysFor(email, touch.company).keys.some((key) => keys.has(key)));
  const policy = evaluateContactPolicy({ suppressed, doNotContact, excludedDomain, frequency, companyDayCollision, replied });
  return {
    scope: 'organization_compliance',
    lead: { id: row.id, name: row.name || null, email, company: row.company || null },
    policy: CONTACT_POLICY.version,
    touchesChecked: touches.length,
    ...policy,
    limitation: 'Foto al momento de la consulta; el preflight final ocurre antes del proveedor.',
  };
}
