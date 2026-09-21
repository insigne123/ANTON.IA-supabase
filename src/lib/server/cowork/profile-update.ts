import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { coworkProfilePatchSchema, hashCoworkProfilePatch, type CoworkProfilePatch } from '@/lib/cowork/profile-proposal';
import { buildProfileUpdate, mapProfileToForm, normalizeCompanyWebsite } from '@/lib/profile/profile-mappings';
import { sanitizeCoworkSignature } from './signature';

/** Fase 4: owner profile update with human review. The proposal pins the exact
 * field values plus the profile's updated_at; execution refuses drift. Only
 * commercial identity fields; never email, avatar, roles or tokens. */

export function parseCoworkProfileTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'profile' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de perfil no es válida.');
  }
  return { hash: parts[1] };
}

async function readOwnProfile(client: ReturnType<typeof getSupabaseAdminClient>, userId: string) {
  const row = await client.from('profiles')
    .select('id,full_name,job_title,company_name,company_domain,signatures,updated_at')
    .eq('id', userId).maybeSingle();
  if (row.error) throw new Error('No se pudo leer tu perfil.');
  if (!row.data || row.data.id !== userId) throw new Error('Tu perfil no está disponible.');
  return row.data as {
    id: string; full_name: string | null; job_title: string | null; company_name: string | null;
    company_domain: string | null; signatures: unknown; updated_at: string;
  };
}

export async function stageCoworkProfileUpdate(
  scope: { userId: string; organizationId: string },
  runId: string,
  patch: CoworkProfilePatch,
): Promise<{ changed: string[]; hash: string }> {
  const parsed = coworkProfilePatchSchema.parse(patch);
  const signature = parsed.signature ? sanitizeCoworkSignature(parsed.signature.html) : null;
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const current = await readOwnProfile(client, scope.userId);
  const form = mapProfileToForm(current);
  const next = { ...form };
  const set = (key: keyof typeof next, value: string | undefined) => {
    if (value !== undefined && value !== '') next[key] = value;
  };
  set('name', parsed.name); set('role', parsed.role); set('companyName', parsed.companyName);
  set('sector', parsed.sector); set('website', parsed.website); set('description', parsed.description);
  set('services', parsed.services); set('valueProposition', parsed.valueProposition);
  set('proofPoints', parsed.proofPoints);
  if (parsed.website !== undefined && parsed.website !== ''
    && !normalizeCompanyWebsite(parsed.website).domain) {
    throw new Error('El sitio web no es un dominio público válido.');
  }
  const update = buildProfileUpdate(next, current);
  if (parsed.signature && signature) {
    update.signatures[parsed.signature.channel] = {
      ...parsed.signature, ...signature, updatedAt: new Date().toISOString(),
    };
  }
  // Reuse the stored signatures object when the extended content is
  // identical, so the diff (and label) only names real changes.
  const currentExtended = ((current.signatures ?? {}) as Record<string, unknown>).profile_extended ?? {};
  const nextExtended = ((update.signatures ?? {}) as Record<string, unknown>).profile_extended ?? {};
  const finalUpdate = !parsed.signature && JSON.stringify(nextExtended) === JSON.stringify(currentExtended)
    ? { ...update, signatures: current.signatures }
    : update;
  const scalarChanged = (['full_name', 'job_title', 'company_name', 'company_domain'] as const)
    .filter(key => JSON.stringify(finalUpdate[key]) !== JSON.stringify(current[key]));
  const signaturesChanged = JSON.stringify(finalUpdate.signatures) !== JSON.stringify(current.signatures ?? null);
  const changed = [...scalarChanged, ...(signaturesChanged ? ['signatures' as const] : [])];
  if (changed.length === 0) throw new Error('La propuesta no cambia tu perfil actual.');
  const hash = hashCoworkProfilePatch(parsed);
  const staged = await client.from('cowork_profile_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      patch: finalUpdate as unknown as Record<string, unknown>,
      base_updated_at: current.updated_at, patch_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar la propuesta de perfil.');
  if (!staged.data) {
    const existing = await client.from('cowork_profile_proposals').select('patch_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.patch_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de perfil.');
    }
  }
  return { changed, hash };
}

export async function executeCoworkProfileUpdate(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkProfileTarget(targetId);
  const userId = auth.user.id;
  const scope = { userId, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const row = await client.from('cowork_profile_proposals').select('patch,base_updated_at,patch_hash')
    .eq('run_id', runId).eq('user_id', userId).eq('organization_id', auth.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('La propuesta aprobada ya no está disponible.');
  if (row.data.patch_hash !== target.hash) {
    throw new Error('El perfil cambió desde tu revisión. Pide una nueva revisión.');
  }
  const current = await readOwnProfile(client, userId);
  if (current.updated_at !== row.data.base_updated_at) {
    throw new Error('Tu perfil cambió desde la revisión. Revísalo de nuevo.');
  }
  const patch = row.data.patch as Record<string, unknown>;
  const applied = await client.from('profiles').update({
    full_name: patch.full_name, job_title: patch.job_title, company_name: patch.company_name,
    company_domain: patch.company_domain, signatures: patch.signatures,
    updated_at: new Date().toISOString(),
  }).eq('id', userId).eq('updated_at', row.data.base_updated_at).select('id,updated_at').maybeSingle();
  if (applied.error || !applied.data) {
    throw new Error('Tu perfil cambió durante la aprobación. Revísalo de nuevo.');
  }
  return {
    reply: 'Tu perfil comercial quedó actualizado con los valores aprobados.',
    result: { updatedAt: applied.data.updated_at },
  };
}
