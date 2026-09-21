import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import {
  coworkSavedSearchCreateSchema, coworkSavedSearchUpdateSchema, coworkSavedSearchDeleteSchema,
  hashCoworkSavedSearchProposal,
} from '@/lib/cowork/saved-search-proposal';
import {
  normalizeSavedSearchCriteria, normalizeSavedSearchName, savedSearchNamesMatch,
  serializeSavedSearchCriteria,
} from '@/lib/search/saved-search-criteria';

/** Fase 4: saved-search create/update/delete with human review. Only rows
 * owned by the owner (user_id = owner); shared rows are read-only. Proposals
 * pin exact values plus optimistic concurrency; execution refuses drift,
 * renames in conflict and foreign rows. Never executes a provider search. */

type Client = ReturnType<typeof getSupabaseAdminClient>;

async function readOwnedSearch(client: Client, scope: { userId: string; organizationId: string }, id: string) {
  const row = await client.from('saved_searches')
    .select('id,user_id,organization_id,name,criteria,is_shared,updated_at')
    .eq('id', id).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error) throw new Error('No se pudo leer la búsqueda guardada.');
  if (!row.data || row.data.user_id !== scope.userId) {
    throw new Error('Esa búsqueda no es tuya o ya no está disponible.');
  }
  return row.data as {
    id: string; user_id: string; organization_id: string; name: string;
    criteria: unknown; is_shared: boolean; updated_at: string;
  };
}

async function assertOwnNameFree(client: Client, scope: { userId: string; organizationId: string }, name: string, exceptId?: string) {
  const rows = await client.from('saved_searches').select('id,name')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  if (rows.error) throw new Error('No se pudo validar el nombre de la búsqueda.');
  if ((rows.data || []).some(row => row.id !== exceptId && savedSearchNamesMatch(row.name, name))) {
    throw new Error(`Ya tienes una búsqueda guardada llamada «${name}».`);
  }
}

async function stageProposal(
  client: Client, scope: { userId: string; organizationId: string }, runId: string,
  staged: { op: 'create' | 'update' | 'delete'; search_id: string | null; name: string | null;
    criteria: unknown; is_shared: boolean; base_updated_at: string | null; proposal_hash: string },
) {
  const inserted = await client.from('cowork_saved_search_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId, ...staged },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (inserted.error) throw new Error('No se pudo preparar la propuesta.');
  if (!inserted.data) {
    const existing = await client.from('cowork_saved_search_proposals').select('proposal_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.proposal_hash !== staged.proposal_hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de búsqueda.');
    }
  }
}

export async function stageCoworkSavedSearchCreate(
  scope: { userId: string; organizationId: string }, runId: string, input: unknown,
) {
  const parsed = coworkSavedSearchCreateSchema.parse(input);
  const name = normalizeSavedSearchName(parsed.name);
  if (!name) throw new Error('Escribe un nombre para la búsqueda.');
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  await assertOwnNameFree(client, scope, name);
  const criteria = serializeSavedSearchCriteria(parsed.criteria);
  const hash = hashCoworkSavedSearchProposal('create', { name, criteria, isShared: parsed.isShared });
  await stageProposal(client, scope, runId, {
    op: 'create', search_id: null, name, criteria: criteria as unknown,
    is_shared: parsed.isShared, base_updated_at: null, proposal_hash: hash,
  });
  return { hash };
}

export async function stageCoworkSavedSearchUpdate(
  scope: { userId: string; organizationId: string }, runId: string, input: unknown,
) {
  const parsed = coworkSavedSearchUpdateSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const current = await readOwnedSearch(client, scope, parsed.id);
  const name = parsed.name !== undefined ? normalizeSavedSearchName(parsed.name) : current.name;
  if (!name) throw new Error('Escribe un nombre para la búsqueda.');
  if (name !== current.name) await assertOwnNameFree(client, scope, name, current.id);
  const criteria = parsed.criteria !== undefined
    ? serializeSavedSearchCriteria(parsed.criteria) : current.criteria;
  const isShared = parsed.isShared ?? current.is_shared;
  const payload = { id: current.id, name, criteria, isShared };
  if (JSON.stringify({ ...payload, base: current.updated_at })
    === JSON.stringify({ id: current.id, name: current.name, criteria: current.criteria, isShared: current.is_shared, base: current.updated_at })) {
    throw new Error('La propuesta no cambia la búsqueda actual.');
  }
  const hash = hashCoworkSavedSearchProposal('update', payload);
  await stageProposal(client, scope, runId, {
    op: 'update', search_id: current.id, name, criteria: criteria as unknown,
    is_shared: isShared, base_updated_at: current.updated_at, proposal_hash: hash,
  });
  return { hash };
}

export async function stageCoworkSavedSearchDelete(scope: { userId: string; organizationId: string }, runId: string, input: unknown) {
  const parsed = coworkSavedSearchDeleteSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const current = await readOwnedSearch(client, scope, parsed.id);
  const hash = hashCoworkSavedSearchProposal('delete', { id: current.id, name: current.name,
    criteria: current.criteria, isShared: current.is_shared, updatedAt: current.updated_at });
  await stageProposal(client, scope, runId, { op: 'delete', search_id: current.id, name: current.name,
    criteria: current.criteria, is_shared: current.is_shared, base_updated_at: current.updated_at, proposal_hash: hash });
  return { hash };
}

function parseTarget(targetId: string, op: 'create' | 'update' | 'delete'): { hash: string } {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'savedsearch' || parts[1] !== op || !parts[2] || !/^[a-f0-9]{64}$/.test(parts[2])) {
    throw new Error('La propuesta de búsqueda no es válida.');
  }
  return { hash: parts[2] };
}

async function readStaged(client: Client, scope: { userId: string; organizationId: string },
  runId: string, auth: AuthContext) {
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const row = await client.from('cowork_saved_search_proposals')
    .select('op,search_id,name,criteria,is_shared,base_updated_at,proposal_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('La propuesta aprobada ya no está disponible.');
  return row.data as {
    op: 'create' | 'update' | 'delete'; search_id: string | null; name: string | null;
    criteria: unknown; is_shared: boolean; base_updated_at: string | null; proposal_hash: string;
  };
}

export async function executeCoworkSavedSearchCreate(auth: AuthContext, runId: string, targetId: string) {
  const target = parseTarget(targetId, 'create');
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const staged = await readStaged(client, scope, runId, auth);
  if (staged.op !== 'create' || staged.proposal_hash !== target.hash || !staged.name) {
    throw new Error('La búsqueda cambió desde tu revisión. Pide una nueva revisión.');
  }
  await assertOwnNameFree(client, scope, staged.name);
  const inserted = await client.from('saved_searches').insert({
    organization_id: scope.organizationId, user_id: scope.userId, name: staged.name,
    criteria: staged.criteria, is_shared: staged.is_shared,
  }).select('id,name').single();
  if (inserted.error || !inserted.data) throw new Error('No se pudo guardar la búsqueda.');
  return {
    reply: `La búsqueda «${staged.name}» quedó guardada. Úsala desde la pantalla de búsqueda.`,
    result: { searchId: inserted.data.id },
  };
}

export async function executeCoworkSavedSearchUpdate(auth: AuthContext, runId: string, targetId: string) {
  const target = parseTarget(targetId, 'update');
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const staged = await readStaged(client, scope, runId, auth);
  if (staged.op !== 'update' || staged.proposal_hash !== target.hash || !staged.search_id || !staged.name) {
    throw new Error('La búsqueda cambió desde tu revisión. Pide una nueva revisión.');
  }
  const current = await readOwnedSearch(client, scope, staged.search_id);
  if (current.updated_at !== staged.base_updated_at) {
    throw new Error('La búsqueda cambió desde tu revisión. Revísala de nuevo.');
  }
  if (!staged.base_updated_at) throw new Error('La propuesta no fijó la versión revisada.');
  if (staged.name !== current.name) await assertOwnNameFree(client, scope, staged.name, current.id);
  const updated = await client.from('saved_searches').update({
    name: staged.name, criteria: staged.criteria, is_shared: staged.is_shared,
    updated_at: new Date().toISOString(),
  }).eq('id', current.id).eq('updated_at', staged.base_updated_at)
    .select('id,updated_at').maybeSingle();
  if (updated.error || !updated.data) {
    throw new Error('La búsqueda cambió durante la aprobación. Revísala de nuevo.');
  }
  return {
    reply: `La búsqueda «${staged.name}» quedó actualizada.`,
    result: { searchId: current.id, updatedAt: updated.data.updated_at },
  };
}

export async function executeCoworkSavedSearchDelete(auth: AuthContext, runId: string, targetId: string) {
  const target = parseTarget(targetId, 'delete');
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const staged = await readStaged(client, scope, runId, auth);
  if (staged.op !== 'delete' || staged.proposal_hash !== target.hash || !staged.search_id || !staged.base_updated_at) {
    throw new Error('La propuesta de eliminación ya no está disponible. Pide una nueva revisión.');
  }
  const current = await readOwnedSearch(client, scope, staged.search_id);
  if (current.updated_at !== staged.base_updated_at) throw new Error('La búsqueda cambió desde tu revisión. Revísala de nuevo.');
  const deleted = await client.from('saved_searches').delete()
    .eq('id', current.id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
    .eq('updated_at', staged.base_updated_at).select('id').maybeSingle();
  if (deleted.error || !deleted.data) throw new Error('La búsqueda ya no está disponible.');
  return {
    reply: `La búsqueda «${current.name}» quedó eliminada.`,
    result: { searchId: current.id },
  };
}
