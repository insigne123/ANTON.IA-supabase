import { normalizeCompanyName, titleContainsTerm } from './commercial-facts';
import { z } from 'zod';

const roleTerms = z.array(z.string().trim().min(1).max(80)).max(10);
export const audienceRolePolicySchema = z.object({
  decisionTerms: roleTerms, userTerms: roleTerms, referralTerms: roleTerms, excludeTerms: roleTerms,
}).strict();
export type AudienceRolePolicy = z.infer<typeof audienceRolePolicySchema>;

export function classifyAudienceRole(title: string | null | undefined, policy?: AudienceRolePolicy | null) {
  if (!title?.trim()) return { role: 'unknown', persona: 'unknown', confidence: 'unknown', reason: 'missing_title' };
  const match = (terms: string[]) => terms.some(term => titleContainsTerm(title, term));
  if (policy) {
    const validated = audienceRolePolicySchema.parse(policy);
    const decision = match(validated.decisionTerms), user = match(validated.userTerms), referral = match(validated.referralTerms);
    const excluded = match(validated.excludeTerms);
    const conflict = excluded && (decision || user || referral);
    return { role: conflict ? 'needs_review' : excluded ? 'excluded_by_criteria' : decision ? 'decision_maker_candidate' : referral || user ? 'referrer_candidate' : 'unknown',
      persona: conflict || excluded ? 'unknown' : decision && user ? 'buyer_and_user_candidate' : decision ? 'buyer_candidate' : user ? 'user_candidate' : 'unknown',
      confidence: 'explicit_title_criteria', matchedTerms: Object.fromEntries(Object.entries(validated).map(([key, terms]) => [key, terms.filter(term => titleContainsTerm(title, term))])),
      reason: conflict ? 'Criterios de inclusión y exclusión contradictorios: revisar, no descartar.' : 'Criterios revisados para esta búsqueda, no autoridad de compra comprobada. No elimina registros ni autoriza contacto.' };
  }
  const decision = match(['owner', 'founder', 'fundador', 'dueño', 'CEO', 'CFO', 'CHRO', 'director', 'directora', 'gerente', 'head', 'VP', 'manager']);
  const operational = match(['recruiter', 'reclutador', 'reclutadora', 'reclutamiento', 'talent acquisition', 'selección', 'operaciones', 'operations']);
  const referral = operational || match(['analista', 'analyst', 'coordinador', 'coordinadora', 'coordinator', 'asistente', 'assistant', 'manager']);
  return { role: decision ? 'decision_maker_candidate' : referral ? 'referrer_candidate' : 'unknown',
    persona: decision && operational ? 'buyer_and_user_candidate' : decision ? 'buyer_candidate' : operational ? 'user_candidate' : 'unknown',
    confidence: 'title_only', reason: 'El cargo sugiere un rol; no demuestra autoridad, uso, presupuesto ni permiso de contacto. No descartar automáticamente.' };
}

export type AudienceLead = { id: string; name?: string | null; title?: string | null; company?: string | null; industry?: string | null };
export type AudienceTouch = { company?: string | null; lead_id?: string | null; sent_at?: string | null };

/** Exact normalized account names; no substring matches or model arithmetic. */
export function analyzeStoredAudience(leads: AudienceLead[], touches: AudienceTouch[], coverage: { leadsComplete: boolean; historyComplete: boolean }) {
  const touchedCompanies = new Set(touches.filter(t => t.sent_at && t.company).map(t => normalizeCompanyName(t.company!)).filter(Boolean));
  const touchedIds = new Set(touches.filter(t => t.sent_at && t.lead_id).map(t => t.lead_id));
  const groups = new Map<string, Map<string, boolean>>();
  let missingCompany = 0;
  for (const lead of leads) {
    const company = normalizeCompanyName(lead.company || '');
    if (!company) { missingCompany++; continue; }
    const vertical = (lead.industry || '').trim() || 'Sin sector';
    const companies = groups.get(vertical) || new Map<string, boolean>();
    companies.set(company, Boolean(companies.get(company)) || touchedCompanies.has(company) || touchedIds.has(lead.id));
    groups.set(vertical, companies);
  }
  const complete = coverage.leadsComplete && coverage.historyComplete;
  return { scope: 'organization_stored_audience', coverage, missingCompany,
    verticals: [...groups].map(([industry, companies]) => {
      const contacted = [...companies.values()].filter(Boolean).length;
      return { industry, companiesObserved: companies.size, companiesWithRecordedSend: contacted,
        companiesWithoutObservedSend: companies.size - contacted,
        newCompanyPercent: complete ? (companies.size - contacted) / companies.size * 100 : null,
        denominator: 'distinct_normalized_company_names_in_stored_leads',
      };
    }),
    contacts: leads.slice(0, 100).map(lead => ({ id: lead.id, name: lead.name, title: lead.title, company: lead.company,
      classification: classifyAudienceRole(lead.title) })),
    contactsTruncated: leads.length > 100,
    limitation: 'Frescura respecto a envíos registrados en la app, no al mercado completo ni a LinkedIn no sincronizado. Nombres equivalentes por alias/dominio requieren conciliación. Los roles son hipótesis; no autorizan envíos ni descarte.',
  };
}
