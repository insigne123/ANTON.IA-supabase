import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { COWORK_SEARCH_MAX, coworkSearchCriteriaSchema, coworkSearchStrategy, type CoworkSearchCriteria } from '@/lib/cowork/search-proposal';
import { requireCoworkWorkerAccess } from './access';

/**
 * «Editar criterios» in the search card (COW-29): cargos, sectores, ubicación and how many, changed before approving instead of a
 * whole turn of the model for one word. Only a search that still waits on the person changes, and the approval runs what the
 * card shows: the claim reads the criteria from the same row. A profile search (one exact person) has nothing to edit.
 */
const list = z.array(z.string().trim().max(100)).max(5).transform(values => values.filter(Boolean));
export const coworkSearchEditSchema = z.object({
  titles: list.optional(),
  industries: list.optional(),
  locations: list.optional(),
  companyLocations: list.optional(),
  limit: z.number().int().min(1).max(COWORK_SEARCH_MAX).optional(),
}).strict();
export type CoworkSearchEdit = z.input<typeof coworkSearchEditSchema>;

export class CoworkSearchEditRefused extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The criteria after the edit, or why they cannot be: the same rules as a search Cowork proposes. */
export function coworkEditedSearchCriteria(current: unknown, input: CoworkSearchEdit): CoworkSearchCriteria {
  const parsed = coworkSearchCriteriaSchema.safeParse(current);
  if (!parsed.success) throw new CoworkSearchEditRefused('No se pudieron leer los criterios de la búsqueda. Descártala y pide una nueva.', 409);
  if (coworkSearchStrategy(parsed.data) === 'profile') throw new CoworkSearchEditRefused('Una consulta de un perfil exacto no tiene criterios que editar.', 409);
  const edit = coworkSearchEditSchema.parse(input);
  // Exactly what came in from the model, with the four fields the card edits replaced; «Traer más» (page, offset) starts over.
  const { page: _page, offset: _offset, ...rest } = current as Record<string, unknown>;
  const next = {
    ...rest,
    ...(edit.titles ? { titles: edit.titles } : {}),
    ...(edit.industries ? { industries: edit.industries } : {}),
    ...(edit.locations ? { locations: edit.locations } : {}),
    ...(edit.companyLocations ? { companyLocations: edit.companyLocations } : {}),
    ...(edit.limit ? { limit: edit.limit } : {}),
  };
  const checked = coworkSearchCriteriaSchema.safeParse(next);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    // The schema talks to the model («indica cargos (titles)»): the card says what to fill.
    const message = /al menos un criterio/i.test(issue?.message || '') ? 'Deja al menos un cargo, un sector o una ubicación.'
      : /cargos \(titles\) o niveles/.test(issue?.message || '') ? 'Para buscar personas dentro de esas empresas, deja al menos un cargo.'
        : /rubros \(industries\)/.test(issue?.message || '') ? 'Para buscar empresas primero, deja al menos un sector.'
          : 'Revisa los criterios: alguno no es válido.';
    throw new CoworkSearchEditRefused(message, 400);
  }
  return checked.data;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Saves the edit on the search that waits for approval and leaves a trace in the conversation the card reads. */
export async function editCoworkSearchProposal(auth: AuthContext, runId: string, input: CoworkSearchEdit, admin = getSupabaseAdminClient()) {
  z.string().uuid().parse(runId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  await requireCoworkWorkerAccess(admin, scope);
  const run = await admin.from('cowork_runs').select('id,status')
    .eq('id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (run.error) throw new Error('No se pudo leer la búsqueda.');
  if (!run.data) throw new CoworkSearchEditRefused('Esa búsqueda ya no está.', 404);
  const proposal = await admin.from('cowork_search_proposals').select('criteria,status')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (proposal.error) throw new Error('No se pudo leer la búsqueda.');
  if (run.data.status !== 'waiting_approval' || proposal.data?.status !== 'pending') {
    throw new CoworkSearchEditRefused('Esta búsqueda ya se aprobó o se descartó. Actualiza la conversación.', 409);
  }
  const criteria = coworkEditedSearchCriteria(proposal.data.criteria, input);
  if (same(criteria, proposal.data.criteria)) return { changed: false, criteria };
  // Only while it still waits: an approval that came first keeps what was approved.
  const updated = await admin.from('cowork_search_proposals').update({ criteria })
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).eq('status', 'pending')
    .select('run_id').maybeSingle();
  if (updated.error) throw new Error('No se pudo guardar el cambio de la búsqueda.');
  if (!updated.data) throw new CoworkSearchEditRefused('Esta búsqueda ya se aprobó o se descartó. Actualiza la conversación.', 409);
  const recorded = await admin.from('cowork_run_events').insert({ run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
    kind: 'proposal.edited', payload: { kind: 'search', criteria } });
  if (recorded.error) console.error('[cowork] search edit saved without its trace event');
  return { changed: true, criteria };
}
