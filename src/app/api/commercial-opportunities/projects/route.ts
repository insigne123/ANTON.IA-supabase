import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { findHiringProfile, supabaseProjectStore } from '@/lib/server/commercial-opportunities/store';
import { importSeiaFile, PROJECT_FILE_LIMITS } from '@/lib/server/commercial-opportunities/project-import';
import { HiringSyncError } from '@/lib/server/commercial-opportunities/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The SEIA export of the month (CSV or .xlsx): read in memory, matched and saved. The file itself is never stored. */
export async function POST(request: Request) {
  try {
    const auth = await requireOpportunitiesAccess();
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new HiringSyncError('Adjunta el archivo del mapa del SEIA.', 400);
    if (file.size > PROJECT_FILE_LIMITS.bytes) throw new HiringSyncError('El archivo pasa de 10 MB: exporta solo las regiones o los sectores que te interesan.', 413);
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const profile = await findHiringProfile(auth.admin, scope);
    if (!profile) throw new HiringSyncError('Primero define qué buscas: la oferta, los cargos y las palabras de las licitaciones.', 409);
    const result = await importSeiaFile({
      store: supabaseProjectStore(auth.admin, { ...scope, profileId: profile.id }), organizationId: auth.organizationId,
      profile: { id: profile.id, sectors: profile.sectors, regions: profile.regions, minInvestmentUsd: profile.minInvestmentUsd },
      file: { name: file.name || 'seia.csv', bytes: new Uint8Array(await file.arrayBuffer()) },
    });
    return opportunitiesJson(result);
  } catch (error) {
    return opportunitiesError(error);
  }
}
