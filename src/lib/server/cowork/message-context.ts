import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { resolveEmailStyleProfile } from '@/lib/server/email-style-profiles';
import { coworkMessageContextPatchSchema, hashCoworkStoredMessageContextPatch, type CoworkMessageContextPatch } from '@/lib/cowork/message-context-proposal';

type Scope = { userId: string; organizationId: string };
type ContextRow = {
  organization_id: string; voice_examples: unknown; prohibited_terms: string[]; required_terms: string[];
  approved_claims: unknown; trial_offer: string | null; default_style_profile_id: string | null;
  role_cta: unknown; vertical_notes: unknown; updated_at: string;
};

const MESSAGE_CONTEXT_COLUMN_BY_FIELD: Record<string, string> = {
  voiceExamples: 'voice_examples', prohibitedTerms: 'prohibited_terms', requiredTerms: 'required_terms',
  approvedClaims: 'approved_claims', trialOffer: 'trial_offer', defaultStyleProfileId: 'default_style_profile_id',
  roleCta: 'role_cta', verticalNotes: 'vertical_notes',
};
const MESSAGE_CONTEXT_EMPTY_BY_FIELD: Record<string, unknown> = {
  voiceExamples: [], prohibitedTerms: [], requiredTerms: [], approvedClaims: [],
  trialOffer: null, defaultStyleProfileId: null, roleCta: {}, verticalNotes: [],
};

export function sanitizeMessageContextPatch(patch: CoworkMessageContextPatch) {
  const clean = (terms: string[] | null | undefined) => [...new Set(((terms || []) as string[]).map(term => term.trim()).filter(Boolean))].slice(0, 40);
  const present = (value: unknown) => value !== undefined && value !== null
    && (typeof value !== 'object' || Object.keys(value as Record<string, unknown>).length > 0);
  const cleared = new Set(patch.clear || []);
  const stored: Record<string, unknown> = {};
  if (present(patch.voiceExamples)) stored.voice_examples = (patch.voiceExamples || []).map(item => ({ label: item.label, text: item.text }));
  if (present(patch.prohibitedTerms)) stored.prohibited_terms = clean(patch.prohibitedTerms);
  if (present(patch.requiredTerms)) stored.required_terms = clean(patch.requiredTerms);
  if (present(patch.approvedClaims)) stored.approved_claims = (patch.approvedClaims || []).map(item => ({ claim: item.claim, evidence: item.evidence }));
  if (patch.trialOffer) stored.trial_offer = patch.trialOffer;
  if (patch.defaultStyleProfileId) stored.default_style_profile_id = patch.defaultStyleProfileId;
  if (present(patch.roleCta)) stored.role_cta = patch.roleCta;
  if (present(patch.verticalNotes)) stored.vertical_notes = patch.verticalNotes;
  for (const field of cleared) {
    stored[MESSAGE_CONTEXT_COLUMN_BY_FIELD[field]] = MESSAGE_CONTEXT_EMPTY_BY_FIELD[field];
  }
  return stored;
}

export async function readCoworkMessageContext(client: ReturnType<typeof getSupabaseAdminClient>, scope: Scope) {
  const row = await client.from('organization_messaging_context').select('*')
    .eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error) throw new Error('No se pudo consultar el contexto de redacción.');
  if (!row.data) return { scope: 'organization_messaging_context', configured: false as const, context: null };
  const data = row.data as ContextRow;
  return { scope: 'organization_messaging_context', configured: true as const,
    context: {
      voiceExamples: data.voice_examples, prohibitedTerms: data.prohibited_terms, requiredTerms: data.required_terms,
      approvedClaims: data.approved_claims, trialOffer: data.trial_offer,
      defaultStyleProfileId: data.default_style_profile_id, roleCta: data.role_cta,
      verticalNotes: data.vertical_notes, updatedAt: data.updated_at,
    },
    notice: 'Ejemplos y afirmaciones aprobadas por un humano; no verifican alcance ni vigencia por sí solos.' };
}

export function parseCoworkMessageContextTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'msgctx' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de contexto no es válida.');
  }
  return { hash: parts[1] };
}

export async function stageCoworkMessageContextUpdate(scope: Scope, runId: string, patch: CoworkMessageContextPatch) {
  const parsed = coworkMessageContextPatchSchema.parse(patch);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const current = await client.from('organization_messaging_context').select('*')
    .eq('organization_id', scope.organizationId).maybeSingle();
  if (current.error) throw new Error('No se pudo leer el contexto actual.');
  if (parsed.defaultStyleProfileId) {
    // A style that cannot be resolved now would silently change generation later.
    await resolveEmailStyleProfile({ organizationId: scope.organizationId, userId: scope.userId,
      styleProfileId: parsed.defaultStyleProfileId, client: client as never });
  }
  const sanitized = sanitizeMessageContextPatch(parsed);
  if (Object.keys(sanitized).length === 0) throw new Error('La propuesta no cambia el contexto actual.');
  // The hash binds the exact normalized values that are previewed, stored
  // and executed: reviewing one representation while applying another fails.
  const hash = hashCoworkStoredMessageContextPatch(sanitized);
  const staged = await client.from('cowork_message_context_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      patch: sanitized as Record<string, unknown>,
      base_updated_at: (current.data as ContextRow | null)?.updated_at || null, patch_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar la propuesta de contexto.');
  if (!staged.data) {
    const existing = await client.from('cowork_message_context_proposals').select('patch_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.patch_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de contexto.');
    }
  }
  return { changed: Object.keys(sanitized), hash };
}

export async function executeCoworkMessageContextUpdate(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkMessageContextTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const row = await client.from('cowork_message_context_proposals').select('patch,base_updated_at,patch_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('La propuesta aprobada ya no está disponible.');
  if (row.data.patch_hash !== target.hash) throw new Error('El contexto cambió desde tu revisión. Pide una nueva revisión.');
  const patch = row.data.patch as Record<string, unknown>;
  if (hashCoworkStoredMessageContextPatch(patch) !== target.hash) {
    throw new Error('La propuesta guardada no coincide con lo revisado. Pide una nueva revisión.');
  }
  const now = new Date().toISOString();
  // Atomic version check: the conditional write itself refuses concurrent
  // edits, including a row created between staging and execution.
  let appliedUpdatedAt: string | null = null;
  if (row.data.base_updated_at === null) {
    const inserted = await client.from('organization_messaging_context')
      .insert({ organization_id: scope.organizationId, ...patch, updated_at: now })
      .select('updated_at').maybeSingle();
    if (inserted.error || !inserted.data) {
      throw new Error('El contexto cambió desde la revisión (ya existe). Revísalo de nuevo.');
    }
    appliedUpdatedAt = inserted.data.updated_at;
  } else {
    const updated = await client.from('organization_messaging_context')
      .update({ ...patch, updated_at: now })
      .eq('organization_id', scope.organizationId).eq('updated_at', row.data.base_updated_at)
      .select('updated_at').maybeSingle();
    if (updated.error || !updated.data) {
      throw new Error('El contexto cambió desde la revisión. Revísalo de nuevo.');
    }
    appliedUpdatedAt = updated.data.updated_at;
  }
  return { reply: 'El contexto de redacción quedó actualizado con los valores aprobados. Los borradores existentes conservan su texto y revisión: vuelve a comprobarlos antes de enviar.',
    result: { updatedAt: appliedUpdatedAt, draftsNeedRecheck: true } };
}

/** Compact approved commercial context for generation (max 1000 chars).
 * Only human-approved values; never model prose. Distinguishes product
 * facts from buyer facts so the writer does not convert capabilities into
 * customer needs. */
export function buildMessagingGenerationInstruction(context: unknown, industry?: string | null) {
  const row = (context && typeof context === 'object' ? context : {}) as Record<string, unknown>;
  const parts: string[] = ['Contexto comercial aprobado: separa hechos del producto, hechos del comprador (solo informe observado) e hipótesis.'];
  const examples = Array.isArray(row.voiceExamples) ? row.voiceExamples as Array<{ label?: string }> : [];
  if (examples.length) parts.push(`Voz: ${examples.map(e => String(e.label || '').slice(0, 60)).filter(Boolean).slice(0, 3).join('; ')}.`);
  const prohibited = Array.isArray(row.prohibitedTerms) ? (row.prohibitedTerms as string[]).filter(t => typeof t === 'string') : [];
  if (prohibited.length) parts.push(`Prohibido: ${prohibited.slice(0, 10).join('; ')}.`);
  const required = Array.isArray(row.requiredTerms) ? (row.requiredTerms as string[]).filter(t => typeof t === 'string') : [];
  if (required.length) parts.push(`Obligatorio: ${required.slice(0, 10).join('; ')}.`);
  const claims = Array.isArray(row.approvedClaims) ? row.approvedClaims as Array<{ claim?: string }> : [];
  if (claims.length) parts.push(`Afirmaciones permitidas solo con su evidencia: ${claims.map(c => String(c.claim || '').slice(0, 120)).filter(Boolean).slice(0, 3).join(' | ')}.`);
  if (typeof row.trialOffer === 'string' && row.trialOffer) parts.push(`Oferta de prueba: ${row.trialOffer.slice(0, 200)}.`);
  else parts.push('No ofrezcas pruebas gratuitas: no hay oferta aprobada.');
  const cta = (row.roleCta && typeof row.roleCta === 'object' ? row.roleCta : {}) as Record<string, string>;
  const ctaParts = ['decisionMaker', 'user', 'referrer']
    .filter(k => typeof cta[k] === 'string' && cta[k]).map(k => `${k}: ${(cta[k] as string).slice(0, 160)}`);
  if (ctaParts.length) parts.push(`Pedidos: ${ctaParts.join(' | ')}.`);
  const notes = Array.isArray(row.verticalNotes) ? row.verticalNotes as Array<{ sector?: string; note?: string }> : [];
  const match = industry ? notes.find(n => typeof n.sector === 'string' && typeof n.note === 'string'
    && n.sector.toLowerCase() === String(industry).toLowerCase()) : null;
  if (match?.note) parts.push(`Sector ${match.sector}: ${match.note.slice(0, 200)}.`);
  return parts.join(' ').slice(0, 1000);
}

export function readCoworkMessageContextTerms(context: unknown) {
  const row = (context && typeof context === 'object' ? context : {}) as Record<string, unknown>;
  return {
    prohibitedTerms: Array.isArray(row.prohibitedTerms) ? row.prohibitedTerms.filter((t): t is string => typeof t === 'string') : [],
    requiredTerms: Array.isArray(row.requiredTerms) ? row.requiredTerms.filter((t): t is string => typeof t === 'string') : [],
  };
}
