// «Calcular el precio» on the server (OPP-23): the study of whoever sets the prices, kept for the team with its versions. A save goes
// over the newest version while it is the same person's and they keep working (a working session); otherwise it starts a new one, so
// the history says who worked out which numbers and when. Before its migration the table does not exist: the page then keeps the
// study in the browser, as before.
import type { SupabaseClient } from '@supabase/supabase-js';
import { canSetPrices } from '@/lib/commercial-opportunities/member-work';
import { cleanStudy, type PriceStudyVersion, type SavedPriceStudy } from '@/lib/commercial-opportunities/price-studio';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { AuthError } from '@/lib/server/auth-utils';
import { assertOpportunityRead } from './workspace-access';
import { opportunityDb } from './workspace-store';

const STUDIES = 'opportunity_price_studies';
/** Saves of the same person less than this apart go over the same version. */
export const PRICE_SESSION_MS = 30 * 60_000;

/** The prices are the company's commitment: whoever is in charge or an administrator works them out (member-work.ts). */
async function assertPricer(client: SupabaseClient, scope: WorkScope, id: string) {
  await assertOpportunityRead(client, scope, id);
  const work = opportunityDb(await client.from('opportunity_work').select('responsible_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).maybeSingle()) as { responsible_id: string | null } | null;
  if (!canSetPrices(scope.role, scope.userId, work?.responsible_id)) throw new AuthError('El precio lo calcula quien está a cargo de la oportunidad o un administrador.', 403);
}

/** The study in use and its versions, newest first; not available before the table exists. The caller checks who may read it. */
export async function readOpportunityPriceStudy(client: SupabaseClient, scope: WorkScope, id: string): Promise<{ available: boolean; latest: SavedPriceStudy | null; versions: PriceStudyVersion[] }> {
  const scoped = (columns: string) => client.from(STUDIES).select(columns).eq('organization_id', scope.organizationId).eq('opportunity_id', id).order('created_at', { ascending: false });
  const [versions, latest] = await Promise.all([scoped('id,created_by,created_at,updated_at').limit(12), scoped('id,study,created_by,created_at,updated_at').limit(1).maybeSingle()]);
  if (versions.error || latest.error) return { available: false, latest: null, versions: [] };
  const row = latest.data as (PriceStudyVersion & { study: unknown }) | null;
  return { available: true, latest: row ? { ...row, study: cleanStudy(row.study) } : null, versions: (versions.data || []) as unknown as PriceStudyVersion[] };
}

/**
 * Saves the study. `base` is the version the person started from (null: none yet). When someone else saved one since, nothing is
 * written and the person is told (409), unless they choose to keep theirs on top (`over`). `fresh` always starts a new version: a
 * version brought back from the history never writes over the session in course.
 */
export async function saveOpportunityPriceStudy(client: SupabaseClient, scope: WorkScope, id: string, input: { study: unknown; base: string | null; over?: boolean; fresh?: boolean },
  now = Date.now()): Promise<SavedPriceStudy> {
  await assertPricer(client, scope, id);
  const study = cleanStudy(input.study);
  const latest = opportunityDb(await client.from(STUDIES).select('id,created_by,created_at,updated_at').eq('organization_id', scope.organizationId).eq('opportunity_id', id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()) as PriceStudyVersion | null;
  if (latest && latest.id !== input.base && !input.over) throw new AuthError('Otra persona guardó un cálculo mientras trabajabas.', 409);
  const at = new Date(now).toISOString();
  if (latest && !input.fresh && latest.id === input.base && latest.created_by === scope.userId && now - Date.parse(latest.updated_at) < PRICE_SESSION_MS) {
    const saved = opportunityDb(await client.from(STUDIES).update({ study, updated_at: at }).eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', latest.id)
      .select('id,created_by,created_at,updated_at').maybeSingle()) as PriceStudyVersion | null;
    if (saved) return { ...saved, study };
  }
  const row = opportunityDb(await client.from(STUDIES).insert({ organization_id: scope.organizationId, opportunity_id: id, study, created_by: scope.userId, created_at: at, updated_at: at })
    .select('id,created_by,created_at,updated_at').single()) as PriceStudyVersion;
  return { ...row, study };
}

/** One version of the history, to bring it back. */
export async function readOpportunityPriceVersion(client: SupabaseClient, scope: WorkScope, id: string, versionId: string): Promise<SavedPriceStudy> {
  await assertPricer(client, scope, id);
  const row = opportunityDb(await client.from(STUDIES).select('id,study,created_by,created_at,updated_at').eq('organization_id', scope.organizationId).eq('opportunity_id', id)
    .eq('id', versionId).maybeSingle()) as (PriceStudyVersion & { study: unknown }) | null;
  if (!row) throw new AuthError('Esa versión del cálculo ya no está.', 404);
  return { ...row, study: cleanStudy(row.study) };
}
