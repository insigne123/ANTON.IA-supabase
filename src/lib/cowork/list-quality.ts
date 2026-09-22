import { z } from 'zod';
import { exactCompanyMatch, normalizeCompanyName } from './commercial-facts';
import { normalizeLinkedinProfileUrl } from '../linkedin-url';

/** Strict normalized equality for job titles. Partial overlaps
 * ("Gerente" inside "Asistente de gerente") never corroborate. */
export function equivalentJobTitles(left: string | null | undefined, right: string | null | undefined) {
  const clean = (value: string | null | undefined) => String(value || '')
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const a = clean(left), b = clean(right);
  return a.length > 0 && a === b;
}

export type ListCandidate = { id: string; email?: string | null; title?: string | null; company?: string | null; linkedin_url?: string | null };
export type ListHistory = { id: string; email?: string | null; company?: string | null; lead_id?: string | null; sent_at?: string | null };
export type EmailEvidence = { email?: string | null; email_status?: string | null; source_provider?: string | null; observedAt?: string | null };
export function verifiedEmailEvidence(email: unknown, status: unknown) {
  return typeof email === 'string' && z.string().email().safeParse(email.trim()).success
    && typeof status === 'string' && status.trim().toLowerCase() === 'verified';
}
const emailKey = (value?: string | null) => (value || '').trim().toLowerCase();

export type ProfileEvidence = { title?: string | null; company?: string | null; capturedAt?: string | null; source?: string | null } | null;
export function assessListCandidate(candidate: ListCandidate, input: {
  history: ListHistory[]; historyComplete: boolean; duplicates: ListCandidate[];
  duplicatesComplete: boolean; emailEvidence: EmailEvidence[];
  blocked: boolean; blockReasons: string[]; stages: string[];
  profileEvidence?: ProfileEvidence; now?: string;
}) {
  const email = emailKey(candidate.email), company = normalizeCompanyName(candidate.company || '');
  const duplicateIds = input.duplicates.filter(row => row.id !== candidate.id && email && emailKey(row.email) === email).map(row => row.id);
  const sent = input.history.filter(row => row.sent_at);
  const contactMatches = sent.filter(row => row.lead_id === candidate.id || (email && emailKey(row.email) === email));
  const accountMatches = sent.filter(row => company && normalizeCompanyName(row.company || '') === company);
  const latest = input.emailEvidence.filter(row => email && emailKey(row.email) === email && row.source_provider === 'apollo')
    .sort((a, b) => (Date.parse(b.observedAt || '') || 0) - (Date.parse(a.observedAt || '') || 0))[0];
  const evidence = latest && verifiedEmailEvidence(latest.email, latest.email_status) ? latest : null;
  const reasons = [...input.blockReasons];
  if (!email) reasons.push('missing_email');
  else if (!evidence) reasons.push('no_matching_provider_verified_email');
  if (duplicateIds.length) reasons.push('duplicate_saved_email');
  if (contactMatches.length) reasons.push('previous_contact');
  if (accountMatches.length) reasons.push('account_previously_contacted');
  if (!input.historyComplete) reasons.push('history_incomplete');
  if (!input.duplicatesComplete) reasons.push('duplicates_scan_incomplete');
  const stageConflict = new Set(input.stages).size > 1;
  const stage = stageConflict ? null : input.stages[0] || null;
  const priority = stage === 'negotiation' ? 1 : stage === 'meeting' ? 2 : stage === 'engaged' ? 3 : stage === 'qualified' ? 4 : 5;
  if (stageConflict) reasons.push('conflicting_crm_stages');
  if (stage === 'closed_won' || stage === 'closed_lost') reasons.push('closed_account_review');
  const profile = input.profileEvidence;
  const profileFresh = Boolean(profile?.capturedAt && input.now
    && Date.parse(profile.capturedAt) <= Date.parse(input.now)
    && Date.parse(input.now) - Date.parse(profile.capturedAt) <= 90 * 24 * 3600 * 1000);
  const companyMatch = Boolean(profileFresh && candidate.company && profile?.company
    && exactCompanyMatch(candidate.company, profile.company));
  const titleMatch = Boolean(profileFresh && equivalentJobTitles(candidate.title, profile?.title));
  const profileCheck = !profile ? { status: 'needs_current_source', expectedCompany: candidate.company || null }
    : !profileFresh ? { status: 'needs_current_source', expectedCompany: candidate.company || null, staleCaptureAt: profile.capturedAt }
    : companyMatch && titleMatch ? { status: 'corroborated', capturedAt: profile.capturedAt, source: profile.source }
    : { status: 'mismatch', expectedCompany: candidate.company || null, observedCompany: profile.company || null,
        observedTitle: profile.title || null, capturedAt: profile.capturedAt, source: profile.source };
  if (profileCheck.status === 'mismatch') reasons.push('profile_mismatch');
  else if (profileCheck.status !== 'corroborated') reasons.push('current_profile_not_verified');
  // Readiness for list inclusion is separate from the send approval, which
  // always stays human. A contact can be list-ready and still require review.
  const closedStage = stage === 'closed_won' || stage === 'closed_lost';
  const listReady = Boolean(evidence) && profileCheck.status === 'corroborated'
    && duplicateIds.length === 0 && input.historyComplete && input.duplicatesComplete
    && !input.blocked && stage !== null && !stageConflict && !closedStage;
  return { leadId: candidate.id, email: email || null,
    emailQuality: evidence ? { status: 'provider_verified_record', provider: 'apollo', observedAt: evidence.observedAt || null,
      notice: 'Estado histórico del proveedor; no comprueba existencia o entregabilidad actual.' } : { status: email ? 'unverified' : 'missing' },
    linkedinUrl: normalizeLinkedinProfileUrl(candidate.linkedin_url) || null,
    profileCheck,
    duplicates: { leadIds: duplicateIds, complete: input.duplicatesComplete },
    history: { contactMatches: contactMatches.length, accountMatches: accountMatches.length, complete: input.historyComplete },
    priority: { rank: priority, stage, conflict: stageConflict, basis: 'recorded_crm_stage',
      notice: 'Negociación no prueba contrato sin firmar; etapa guardada no confirma reunión.' },
    disposition: input.blocked ? 'blocked' : 'needs_review', reasons: [...new Set(reasons)],
    listReady, listReadyNotice: listReady
      ? 'Cumple los controles de esta revisión; la inclusión en lista y cualquier contacto siguen sujetos a revisión humana.'
      : 'No cumple todos los controles: resuelve los motivos indicados antes de incluirlo.',
    sendAuthorized: false,
  };
}
