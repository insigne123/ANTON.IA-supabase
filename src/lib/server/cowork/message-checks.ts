import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentNativeDraft } from '@/lib/server/native-drafts';
import { checkMessageTerms, extractDraftAssertions, pairAssertionsWithEvidence } from '@/lib/cowork/message-checks';
import { readCoworkMessageContext, readCoworkMessageContextTerms } from './message-context';

type Scope = { userId: string; organizationId: string };

async function observedOwnDraft(client: SupabaseClient, scope: Scope, draftId: string) {
  const draft = await getCurrentNativeDraft({ userId: scope.userId, organizationId: scope.organizationId, draftId });
  if (!draft) throw new Error('Borrador no disponible en esta organización.');
  return draft;
}

type SnapshotClaim = { statement?: unknown; claim?: unknown; text?: unknown; supportingEvidenceIds?: unknown; evidenceIds?: unknown };
function snapshotClaims(payload: unknown): Array<{ statement: string | null; evidence: string[] | null }> {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const raw = Array.isArray(root.claims) ? root.claims as SnapshotClaim[] : [];
  return raw.slice(0, 60).map(item => ({
    statement: typeof item.statement === 'string' ? item.statement.slice(0, 500)
      : typeof item.claim === 'string' ? item.claim.slice(0, 500)
      : typeof item.text === 'string' ? item.text.slice(0, 500) : null,
    evidence: Array.isArray(item.supportingEvidenceIds) ? item.supportingEvidenceIds.filter((id): id is string => typeof id === 'string').slice(0, 10)
      : Array.isArray(item.evidenceIds) ? item.evidenceIds.filter((id): id is string => typeof id === 'string').slice(0, 10) : null,
  }));
}

/** Terms configured by a human, checked literally against the approved draft text. */
export async function checkCoworkDraftTerms(client: SupabaseClient, scope: Scope, value: string) {
  const draftId = z.string().uuid().parse(value);
  const draft = await observedOwnDraft(client, scope, draftId);
  const context = await readCoworkMessageContext(client, scope);
  const terms = readCoworkMessageContextTerms(context.context);
  const result = checkMessageTerms(`${draft.content.subject || ''}\n${draft.content.text || ''}`,
    { prohibitedTerms: terms.prohibitedTerms, requiredTerms: terms.requiredTerms });
  return { scope: 'own_draft_terms', draftId, versionId: draft.versionId,
    termsConfigured: terms.prohibitedTerms.length + terms.requiredTerms.length, ...result,
    sendAuthorized: false };
}

/** Pairs numeric/comparative/guarantee assertions with observed research claims.
 * Semantic judgment stays with the human reviewer; nothing is auto-approved. */
export async function checkCoworkDraftEvidence(client: SupabaseClient, scope: Scope, value: string) {
  const draftId = z.string().uuid().parse(value);
  const draft = await observedOwnDraft(client, scope, draftId);
  const meta = await client.from('messaging_drafts').select('research_snapshot_id')
    .eq('id', draftId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (meta.error) throw new Error('No se pudo comprobar el origen del borrador.');
  const snapshotId = typeof meta.data?.research_snapshot_id === 'string' ? meta.data.research_snapshot_id : null;
  let claims: Array<{ statement: string | null; evidence: string[] | null }> = [];
  let snapshotObserved = false;
  if (snapshotId) {
    const snap = await client.from('research_snapshots').select('payload')
      .eq('id', snapshotId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (snap.error) throw new Error('No se pudo leer la investigación del borrador.');
    if (snap.data) { claims = snapshotClaims((snap.data as { payload?: unknown }).payload); snapshotObserved = true; }
  }
  const context = await readCoworkMessageContext(client, scope);
  const approved = Array.isArray((context.context as { approvedClaims?: unknown } | null)?.approvedClaims)
    ? ((context.context as { approvedClaims: Array<{ claim?: string | null; evidence?: string | null }> }).approvedClaims) : [];
  const assertions = extractDraftAssertions(draft.content.subject || null, draft.content.text || '');
  return { scope: 'own_draft_evidence', draftId, versionId: draft.versionId, snapshotId,
    snapshotObserved, assertions: pairAssertionsWithEvidence(assertions, claims, approved),
    researchClaims: claims, approvedClaims: approved.slice(0, 30), sendAuthorized: false,
    notice: snapshotObserved
      ? 'Cada afirmación listada debe vincularse a una evidencia observada o retirarse antes de aprobar el envío.'
      : 'Borrador sin investigación vinculada: ninguna afirmación comercial está respaldada por evidencia observada.' };
}
