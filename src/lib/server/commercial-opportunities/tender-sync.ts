import { matchScreenedTender, matchTender, type Tender, type TenderAiVerdict, type TenderProfile } from '@/lib/commercial-opportunities/tenders';
import { screenTenders, tenderProfileKey, type TenderOffer, type TenderVerdict } from './tender-ai';
import { tenderOpportunityRow, tenderSignalRow, type TenderOpportunityRow, type TenderSignalRow } from '@/lib/commercial-opportunities/records';
import { compraAgilQuery, searchCompraAgil } from './compra-agil';
import { getLicitacion, isMercadoPublicoBusy, listOpenLicitaciones } from './mercado-publico';
import { sleep, withRetries, type Wait } from './retry';
import { HiringSyncError, type HiringStore } from './sync';

/**
 * One search of public tenders (plan 8, phase 3, PR-3d; made reliable in Plan 10): the open Mercado Público tenders whose
 * name fits, with their detail, and then Compra Ágil by keyword. Free with MERCADO_PUBLICO_TICKET (a daily quota per
 * ticket). Each source run is recorded; saving keeps the status and owner the person set.
 *
 * One request at a time, with a short pause: two requests with the same ticket at once get code 10500 («peticiones
 * simultáneas»), which is waited out and asked again, never taken for the daily quota. Tenders saved with their detail
 * are not asked again, so a detail that fails never blanks what was saved. A time budget keeps the search inside the
 * route's limit: whatever is left over is asked in the next search.
 */
export type TenderSyncSource = 'compra_agil' | 'mercado_publico';
export type TenderSearchProfile = TenderProfile & { id: string; offer?: string };
type Sources = { compraAgil: typeof searchCompraAgil; listLicitaciones: typeof listOpenLicitaciones; getLicitacion: typeof getLicitacion };
export type TenderStore = Pick<HiringStore, 'closeStaleRuns' | 'hasRunningRun' | 'finishRun'> & {
  startRun(input: { source: TenderSyncSource; status: 'running' | 'skipped'; error?: string; finishedAt?: string }): Promise<string>;
  existingKeys(keys: string[], kinds: Array<'tender' | 'compra_agil'>): Promise<Set<string>>;
  /** Mercado Público tenders already saved with their detail, by code. */
  storedTenders(codes: string[]): Promise<Map<string, Tender>>;
  /** What the model said of the open tenders already saved (Plan 15), by code. */
  storedVerdicts(): Promise<Map<string, TenderAiVerdict>>;
  saveOpportunities(rows: TenderOpportunityRow[]): Promise<Map<string, string>>;
  saveSignals(rows: TenderSignalRow[]): Promise<void>;
};

const KEYWORDS = 12;
const DETAILS = 40;
/** The model reads Mercado Público for at most this long; what is left goes to the words. */
const SCREEN_MS = 80_000;
const STALE_RUN_MS = 15 * 60_000;
const DAY = 86_400_000;
/** Inside the 180 s of «Buscar licitaciones»; Mercado Público details stop at half of it so Compra Ágil gets its turn. */
const BUDGET_MS = 140_000;
const PAUSE_MS = 500;
const BUSY_WAITS = [2_000, 5_000, 10_000];
/** The slowest Compra Ágil page: the gateway cuts at 29 s. */
const COMPRA_AGIL_REQUEST_MS = 30_000;
const message = (error: unknown) => (error instanceof Error ? error.message : 'Error desconocido.').slice(0, 300);
const stopAsking = (error: string) => /ticket|cuota/i.test(error);
/** Closed, deserted or past-deadline tenders are not read: they can no longer be bid for. */
const isStillOpen = (tender: Tender, now: string) => (!tender.closesAt || Date.parse(tender.closesAt) >= Date.parse(now))
  && (!tender.status || ['publicada', 'publicado', 'activa'].includes(tender.status));
const closesFirst = (a: Tender, b: Tender) => (a.closesAt ? Date.parse(a.closesAt) : Infinity) - (b.closesAt ? Date.parse(b.closesAt) : Infinity);

export async function runTenderSync(input: {
  store: TenderStore; profile: TenderSearchProfile; ticket: string | undefined; organizationId: string; now?: string; sources?: Sources;
  wait?: Wait; clock?: () => number; budgetMs?: number; screen?: typeof screenTenders;
}) {
  const now = input.now ?? new Date().toISOString();
  const sources = input.sources ?? { compraAgil: searchCompraAgil, listLicitaciones: listOpenLicitaciones, getLicitacion };
  const wait = input.wait ?? sleep;
  const clock = input.clock ?? Date.now;
  const budget = input.budgetMs ?? BUDGET_MS;
  const screen = input.screen ?? screenTenders;
  const { store, profile } = input;
  const keywords = profile.keywords.slice(0, KEYWORDS);
  const offer: TenderOffer = { offer: (profile.offer || '').trim(), keywords: profile.keywords };
  if (!keywords.length && !profile.unspscCodes.length && !offer.offer) throw new HiringSyncError('Agrega al menos una palabra para buscar licitaciones.', 400);
  if (!input.ticket) throw new HiringSyncError('Falta el ticket de Mercado Público (MERCADO_PUBLICO_TICKET).', 503);
  const staleBefore = new Date(Date.parse(now) - STALE_RUN_MS).toISOString();
  await store.closeStaleRuns(staleBefore, now);
  if (await store.hasRunningRun(staleBefore)) throw new HiringSyncError('Ya hay una búsqueda en curso. Espera a que termine.', 409);
  const started = clock();
  const elapsed = () => clock() - started;
  const canWait = (ms: number) => elapsed() + ms < budget;
  const dependencies = { fetch: globalThis.fetch, ticket: input.ticket, wait, canWait };
  const profileKey = tenderProfileKey(offer);

  type Result = { source: TenderSyncSource; runId: string; found: number; tenders: Tender[]; error: string | null; failed: boolean; requests: number; costUsd: number };
  const run = async (source: TenderSyncSource, work: (count: () => void) => Promise<Omit<Result, 'source' | 'runId' | 'requests' | 'costUsd'>>): Promise<Result> => {
    const runId = await store.startRun({ source, status: 'running' });
    let requests = 0;
    try { return { source, runId, ...(await work(() => { requests++; })), requests, costUsd: 0 }; }
    catch (error) { return { source, runId, found: 0, tenders: [], error: message(error), failed: true, requests, costUsd: 0 }; }
  };

  // 1. Every open tender of Mercado Público, with name and deadline (one request), and the model reads them all (Plan 15).
  // The reading goes on while Compra Ágil is asked with the ticket: it needs the model, not the ticket.
  const mpRunId = await store.startRun({ source: 'mercado_publico', status: 'running' });
  let mpRequests = 0;
  const askMp = <T,>(work: () => Promise<T>) => withRetries(() => { mpRequests++; return work(); }, { waits: BUSY_WAITS, retryable: isMercadoPublicoBusy, wait, canWait });
  let open: Tender[] = [];
  let mpListError: string | null = null;
  try { open = await askMp(() => sources.listLicitaciones(dependencies)); } catch (error) { mpListError = message(error); }
  const live = open.filter(tender => isStillOpen(tender, now));
  // What the model already said of a tender for this same offer is reused; a new offer reads everything again.
  const saved = live.length ? await store.storedVerdicts() : new Map<string, TenderAiVerdict>();
  const reusable = (code: string) => { const verdict = saved.get(code); return verdict && verdict.profileKey === profileKey ? verdict : undefined; };
  const screening = screen(live.filter(tender => !reusable(tender.code)), offer, { deadline: started + SCREEN_MS, clock });

  // 2. Compra Ágil by the words of the offer, one question per distinct word.
  const results: Result[] = [];
  const compraAgil = await run('compra_agil', async count => {
    const byCode = new Map<string, Tender>();
    const failures: string[] = [];
    // The first word changes every day, so a search cut short by the budget does not always leave out the same ones.
    const distinct = [...new Set(keywords.map(compraAgilQuery))];
    const offset = distinct.length ? Math.floor(Date.parse(now) / DAY) % distinct.length : 0;
    const queries = [...distinct.slice(offset), ...distinct.slice(0, offset)];
    const publishedFrom = new Date(Date.parse(now) - 14 * DAY).toISOString().slice(0, 19) + 'Z';
    let answered = 0, left = 0;
    for (const [index, query] of queries.entries()) {
      // Half of the budget at most: the details of Mercado Público come after.
      if (elapsed() + COMPRA_AGIL_REQUEST_MS > budget * 0.6) { left = queries.length - index; break; }
      await wait(PAUSE_MS);
      try {
        const result = await sources.compraAgil({ keyword: query, publishedFrom, pages: 1 }, dependencies);
        for (let request = 0; request < result.requests; request++) count();
        answered++;
        for (const tender of result.tenders) byCode.set(tender.code, tender);
        if (result.error) failures.push(result.error);
      } catch (error) {
        for (let request = 0; request < ((error as { requests?: number }).requests ?? 1); request++) count();
        failures.push(message(error));
        if (stopAsking(failures[failures.length - 1])) { left = queries.length - index - 1; break; }
      }
    }
    const notes = [
      failures.length ? `${failures.length} de ${queries.length} búsquedas fallaron: ${[...new Set(failures)].slice(0, 2).join(' ')}` : '',
      left ? `${left} búsquedas quedan para la próxima vez.` : '',
    ].filter(Boolean);
    return { found: byCode.size, tenders: [...byCode.values()], failed: queries.length > 0 && answered === 0 && failures.length > 0, error: notes.length ? notes.join(' ') : null };
  });

  // 3. The model's reading of Mercado Público, and then of the Compra Ágil quotes (they come with their description).
  const mpScreening = await screening;
  const caScreening = compraAgil.tenders.length
    ? await screen(compraAgil.tenders, offer, { deadline: started + budget - 15_000, clock })
    : { verdicts: new Map<string, TenderVerdict>(), screened: new Set<string>(), batches: 0, failedBatches: 0, costUsd: 0 };
  compraAgil.costUsd = caScreening.costUsd ?? 0;
  const verdictOf = (tender: Tender) => tender.source === 'mercado_publico'
    ? mpScreening.verdicts.get(tender.code) ?? reusable(tender.code) : caScreening.verdicts.get(tender.code);
  const judged = (tender: Tender) => tender.source === 'mercado_publico'
    ? mpScreening.screened.has(tender.code) || Boolean(reusable(tender.code)) : caScreening.screened.has(tender.code);

  // 4. The detail (buyer, amount, region, items) of the ones the model kept, or that the words found where it could not read:
  // «alta» first, then the nearest deadline. Tenders saved with their detail are not asked again.
  const rank = (tender: Tender) => ({ alta: 0, media: 1 } as Record<string, number>)[verdictOf(tender)?.fit ?? ''] ?? 2;
  const candidates = live.filter(tender => verdictOf(tender) || (!judged(tender) && matchTender(tender, profile, now)))
    .sort((a, b) => rank(a) - rank(b) || closesFirst(a, b)).slice(0, DETAILS);
  const stored = candidates.length ? await store.storedTenders(candidates.map(tender => tender.code)) : new Map<string, Tender>();
  const detailed: Tender[] = [];
  const failures: string[] = [];
  let left = 0, asked = 0, stopped = false;
  for (const tender of candidates) {
    const known = stored.get(tender.code);
    // Saved with its detail: reused with today's name, deadline and status.
    if (known) { detailed.push({ ...known, name: tender.name, closesAt: tender.closesAt ?? known.closesAt, status: tender.status ?? known.status }); continue; }
    if (stopped || elapsed() >= budget) { detailed.push(tender); left++; continue; }
    await wait(PAUSE_MS);
    asked++;
    try {
      detailed.push((await askMp(() => sources.getLicitacion(tender.code, dependencies))) ?? tender);
    } catch (error) {
      failures.push(message(error));
      detailed.push(tender);
      if (stopAsking(failures[failures.length - 1])) stopped = true;
    }
  }
  const unread = live.length - [...live].filter(judged).length;
  const mpNotes = [
    mpListError,
    // Said only when the model was asked and could not read everything: then the words decided the rest.
    mpScreening.batches && unread ? `La IA revisó ${live.length - unread} de ${live.length} licitaciones abiertas; ${unread} se revisaron solo por palabras.` : '',
    failures.length ? `${failures.length} de ${asked} detalles no se pudieron leer: ${[...new Set(failures)].slice(0, 1).join(' ')}` : '',
    left ? `${left} detalles quedan para la próxima búsqueda.` : '',
  ].filter(Boolean);
  results.push({ source: 'mercado_publico', runId: mpRunId, found: open.length, tenders: detailed, failed: Boolean(mpListError),
    error: mpNotes.join(' ') || null, requests: mpRequests, costUsd: mpScreening.costUsd ?? 0 }, compraAgil);

  const finish = (result: Result, counts: { created: number; updated: number }, error = result.error) => store.finishRun(result.runId, {
    status: result.failed ? 'failed' : 'succeeded', fetched: result.found, ...counts, costUsd: Math.round(result.costUsd * 10_000) / 10_000, error, finishedAt: new Date().toISOString(),
  });
  try {
    const rows: TenderOpportunityRow[] = [];
    const matched: Tender[] = [];
    for (const tender of results.flatMap(result => result.tenders)) {
      // What the model read is decided by it; what it could not read, by the words as before.
      const byWords = judged(tender) ? null : matchTender(tender, profile, now);
      const match = judged(tender) ? matchScreenedTender(tender, profile, verdictOf(tender), now) : byWords && { ...byWords, ai: null };
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
      status: results.every(result => result.failed) ? 'failed' as const : results.some(result => result.error) ? 'partial' as const : 'done' as const,
      found: results.reduce((sum, result) => sum + result.found, 0),
      matched: rows.length,
      screened: live.length - unread + caScreening.screened.size,
      costUsd: Math.round(results.reduce((sum, result) => sum + result.costUsd, 0) * 10_000) / 10_000,
      created: rows.filter(row => !existing.has(row.dedupe_key)).length,
      sources: results.map(result => ({ source: result.source, found: result.found, requests: result.requests, error: result.error })),
    };
  } catch (error) {
    const failure = `No se pudo guardar: ${message(error)}`;
    for (const result of results) await finish({ ...result, failed: true }, { created: 0, updated: 0 }, failure).catch(() => undefined);
    throw error;
  }
}
