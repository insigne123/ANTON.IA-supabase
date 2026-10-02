import { matchTender, type Tender, type TenderProfile } from '@/lib/commercial-opportunities/tenders';
import { tenderOpportunityRow, tenderSignalRow, type TenderOpportunityRow, type TenderSignalRow } from '@/lib/commercial-opportunities/records';
import { searchCompraAgil } from './compra-agil';
import { getLicitacion, listOpenLicitaciones } from './mercado-publico';
import { HiringSyncError, type HiringStore } from './sync';

/**
 * One search of public tenders (plan 8, phase 3, PR-3d): Compra Ágil by keyword and the open Mercado Público tenders
 * whose name fits, with their detail. Free with MERCADO_PUBLICO_TICKET (a daily quota per ticket). Each source run is
 * recorded; saving keeps the status and owner the person set.
 */
export type TenderSyncSource = 'compra_agil' | 'mercado_publico';
export type TenderSearchProfile = TenderProfile & { id: string };
type Sources = { compraAgil: typeof searchCompraAgil; listLicitaciones: typeof listOpenLicitaciones; getLicitacion: typeof getLicitacion };
export type TenderStore = Pick<HiringStore, 'closeStaleRuns' | 'hasRunningRun' | 'finishRun'> & {
  startRun(input: { source: TenderSyncSource; status: 'running' | 'skipped'; error?: string; finishedAt?: string }): Promise<string>;
  existingKeys(keys: string[], kinds: Array<'tender' | 'compra_agil'>): Promise<Set<string>>;
  saveOpportunities(rows: TenderOpportunityRow[]): Promise<Map<string, string>>;
  saveSignals(rows: TenderSignalRow[]): Promise<void>;
};

const KEYWORDS = 12;
const DETAILS = 40;
const STALE_RUN_MS = 15 * 60_000;
const DAY = 86_400_000;
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const message = (error: unknown) => (error instanceof Error ? error.message : 'Error desconocido.').slice(0, 300);
const stopAsking = (error: string) => /ticket|cuota/i.test(error);

export async function runTenderSync(input: {
  store: TenderStore; profile: TenderSearchProfile; ticket: string | undefined; organizationId: string; now?: string; sources?: Sources;
}) {
  const now = input.now ?? new Date().toISOString();
  const sources = input.sources ?? { compraAgil: searchCompraAgil, listLicitaciones: listOpenLicitaciones, getLicitacion };
  const { store, profile } = input;
  const keywords = profile.keywords.slice(0, KEYWORDS);
  if (!keywords.length && !profile.unspscCodes.length) throw new HiringSyncError('Agrega al menos una palabra para buscar licitaciones.', 400);
  if (!input.ticket) throw new HiringSyncError('Falta el ticket de Mercado Público (MERCADO_PUBLICO_TICKET).', 503);
  const staleBefore = new Date(Date.parse(now) - STALE_RUN_MS).toISOString();
  await store.closeStaleRuns(staleBefore, now);
  if (await store.hasRunningRun(staleBefore)) throw new HiringSyncError('Ya hay una búsqueda en curso. Espera a que termine.', 409);
  const dependencies = { fetch: globalThis.fetch, ticket: input.ticket };

  type Result = { source: TenderSyncSource; runId: string; found: number; tenders: Tender[]; error: string | null; failed: boolean; requests: number };
  const run = async (source: TenderSyncSource, work: () => Promise<Omit<Result, 'source' | 'runId'>>): Promise<Result> => {
    const runId = await store.startRun({ source, status: 'running' });
    try { return { source, runId, ...(await work()) }; }
    catch (error) { return { source, runId, found: 0, tenders: [], error: message(error), failed: true, requests: 0 }; }
  };

  const results = await Promise.all([
    run('compra_agil', async () => {
      const byCode = new Map<string, Tender>();
      const failures: string[] = [];
      let requests = 0, answered = 0;
      const publishedFrom = new Date(Date.parse(now) - 14 * DAY).toISOString().slice(0, 19) + 'Z';
      for (const keyword of keywords) {
        try {
          const result = await sources.compraAgil({ keyword, publishedFrom, pages: 2 }, dependencies);
          requests += result.requests; answered++;
          for (const tender of result.tenders) byCode.set(tender.code, tender);
        } catch (error) {
          failures.push(message(error));
          if (stopAsking(failures[failures.length - 1])) break;
        }
      }
      return { found: byCode.size, tenders: [...byCode.values()], requests, failed: answered === 0 && failures.length > 0,
        error: failures.length ? `${failures.length} de ${keywords.length} búsquedas fallaron: ${[...new Set(failures)].slice(0, 2).join(' ')}` : null };
    }),
    run('mercado_publico', async () => {
      const open = await sources.listLicitaciones(dependencies);
      // The listing brings name and deadline only: the detail is asked for the names that may fit.
      const candidates = open.filter(tender => keywords.some(keyword => fold(tender.name).includes(fold(keyword).trim()))).slice(0, DETAILS);
      const detailed: Tender[] = [];
      const failures: string[] = [];
      for (let index = 0; index < candidates.length; index += 4) {
        const batch = await Promise.allSettled(candidates.slice(index, index + 4).map(tender => sources.getLicitacion(tender.code, dependencies)));
        batch.forEach((result, offset) => {
          if (result.status === 'fulfilled') detailed.push(result.value ?? candidates[index + offset]);
          else { failures.push(message(result.reason)); detailed.push(candidates[index + offset]); }
        });
        if (failures.some(stopAsking)) break;
      }
      return { found: open.length, tenders: detailed, requests: 1 + candidates.length, failed: false,
        error: failures.length ? `${failures.length} detalles no se pudieron leer: ${[...new Set(failures)].slice(0, 1).join(' ')}` : null };
    }),
  ]);

  const finish = (result: Result, counts: { created: number; updated: number }, error = result.error) => store.finishRun(result.runId, {
    status: result.failed ? 'failed' : 'succeeded', fetched: result.found, ...counts, costUsd: 0, error, finishedAt: new Date().toISOString(),
  });
  try {
    const rows: TenderOpportunityRow[] = [];
    const matched: Tender[] = [];
    for (const tender of results.flatMap(result => result.tenders)) {
      const match = matchTender(tender, profile, now);
      if (!match) continue;
      matched.push(tender);
      rows.push(tenderOpportunityRow(tender, match, { organizationId: input.organizationId, profileId: profile.id }, now));
    }
    const existing = rows.length ? await store.existingKeys(rows.map(row => row.dedupe_key), ['tender', 'compra_agil']) : new Set<string>();
    const ids = rows.length ? await store.saveOpportunities(rows) : new Map<string, string>();
    const signals = matched.flatMap(tender => {
      const opportunityId = ids.get(tender.code.slice(0, 300));
      return opportunityId ? [tenderSignalRow(tender, { organizationId: input.organizationId, opportunityId }, now)] : [];
    });
    if (signals.length) await store.saveSignals(signals);
    for (const result of results) {
      const own = rows.filter(row => (row.kind === 'compra_agil') === (result.source === 'compra_agil'));
      const created = own.filter(row => !existing.has(row.dedupe_key)).length;
      await finish(result, { created, updated: own.length - created });
    }
    return {
      status: 'done' as const,
      found: results.reduce((sum, result) => sum + result.found, 0),
      matched: rows.length,
      created: rows.filter(row => !existing.has(row.dedupe_key)).length,
      sources: results.map(result => ({ source: result.source, found: result.found, requests: result.requests, error: result.error })),
    };
  } catch (error) {
    const failure = `No se pudo guardar: ${message(error)}`;
    for (const result of results) await finish({ ...result, failed: true }, { created: 0, updated: 0 }, failure).catch(() => undefined);
    throw error;
  }
}
