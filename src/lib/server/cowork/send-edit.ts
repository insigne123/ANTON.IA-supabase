import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCurrentNativeDraft, reviseNativeDraft } from '@/lib/server/native-drafts';
import { hashMessagingDraftContent } from '@/lib/messaging-contracts';
import { requireCoworkWorkerAccess } from './access';
import { parseCoworkSendTarget } from './send-email';

/**
 * «Editar» in «Aprobar y enviar» (COW-29): the person corrects the subject or the body in the card instead of asking for a whole
 * new version. The correction is a new human revision of the same draft (reviseNativeDraft, with its suppression check), and
 * cowork_edit_send_proposal moves the proposal to that revision in one transaction with the approval: only while it is pending,
 * only from the version the person saw, and only the version changes (same draft, mailbox and sender). The send checks it all
 * again before it goes. Without that function nothing is offered or written.
 */
export const coworkSendEditSchema = z.object({
  draftId: z.string().uuid(),
  expectedVersionId: z.string().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(10_000),
}).strict();

export class CoworkSendEditRefused extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const PENDING_ONLY = 'Esta propuesta ya no se puede editar: ya se aprobó, se descartó o cambió.';
const STALE = 'El correo cambió mientras lo editabas: vuelve a abrirlo y repite el cambio.';

type Scope = { userId: string; organizationId: string };
const scopeOf = (auth: AuthContext): Scope => ({ userId: auth.user.id, organizationId: auth.organizationId });

async function probe(scope: Scope, runId: string, expected: string) {
  const result = await getSupabaseAdminClient().rpc('cowork_edit_send_proposal', {
    p_run_id: runId, p_user_id: scope.userId, p_organization_id: scope.organizationId, p_expected: expected, p_target: null, p_label: null,
  });
  return result.error ? null : String(result.data || '');
}

/** Whether the card offers «Editar»: the proposal waits on the target it shows, and the function exists. */
export async function coworkSendEditable(auth: AuthContext, runId: string, targetId: string) {
  return (await probe(scopeOf(auth), runId, targetId).catch(() => null)) === 'ready';
}

/** The label of the proposal with the new subject: «Enviar «…» desde …». */
export function coworkSendLabel(label: string, subject: string) {
  const short = subject.replace(/\s+/g, ' ').trim().slice(0, 60) || 'sin asunto';
  return /^Enviar «[^»]*»/.test(label) ? label.replace(/^Enviar «[^»]*»/, `Enviar «${short}»`).slice(0, 280) : label;
}

export async function editCoworkSendProposal(auth: AuthContext, runId: string, input: z.infer<typeof coworkSendEditSchema>) {
  const scope = scopeOf(auth);
  const admin = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(admin, scope);
  const row = await admin.from('cowork_effect_proposals').select('status,kind,target_id,label')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data || row.data.kind !== 'send_email' || row.data.status !== 'proposed') throw new CoworkSendEditRefused(PENDING_ONLY, 409);
  const target = parseCoworkSendTarget(String(row.data.target_id));
  if (target.draftId !== input.draftId || target.versionId !== input.expectedVersionId) throw new CoworkSendEditRefused(STALE, 409);
  // Before writing a revision: the proposal can still move to it (and the function exists).
  const ready = await probe(scope, runId, String(row.data.target_id));
  if (ready === null) throw new CoworkSendEditRefused('Editar el correo aún no está disponible. Descarta la propuesta y pídele a Cowork otra versión.', 503);
  if (ready === 'stale') throw new CoworkSendEditRefused(STALE, 409);
  if (ready !== 'ready') throw new CoworkSendEditRefused(PENDING_ONLY, 409);
  const draft = await getCurrentNativeDraft({ ...scope, draftId: target.draftId });
  if (!draft || draft.channel !== 'email' || draft.versionId !== target.versionId || hashMessagingDraftContent(draft) !== target.contentHash) {
    throw new CoworkSendEditRefused(STALE, 409);
  }
  let revised;
  try {
    revised = await reviseNativeDraft({ ...scope, draft, expectedVersionId: target.versionId, subject: input.subject, text: input.text });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'NATIVE_DRAFT_PRIVACY_SUPPRESSED') throw new CoworkSendEditRefused('La persona pidió no recibir correos: este correo no se puede enviar.', 409);
    if (code === 'NATIVE_DRAFT_VERSION_CONFLICT') throw new CoworkSendEditRefused(STALE, 409);
    throw error;
  }
  if (revised.versionId === draft.versionId) return { changed: false };
  const next = [target.draftId, revised.versionId, hashMessagingDraftContent(revised), target.provider, target.senderHash].join(':');
  const moved = await admin.rpc('cowork_edit_send_proposal', {
    p_run_id: runId, p_user_id: scope.userId, p_organization_id: scope.organizationId,
    p_expected: String(row.data.target_id), p_target: next, p_label: coworkSendLabel(String(row.data.label || ''), revised.content.subject || ''),
  });
  if (moved.error) throw new Error('No se pudo guardar el cambio del correo.');
  // The revision stays in the draft's history; the proposal still points to the version the person saw, so the card says it changed.
  if (moved.data === 'stale') throw new CoworkSendEditRefused(STALE, 409);
  if (moved.data !== 'edited') throw new CoworkSendEditRefused(PENDING_ONLY, 409);
  return { changed: true };
}
