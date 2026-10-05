import { SEIA_SECTORS } from './projects';
import type { HiringOpportunityData, OpportunityStatus, ProjectOpportunityData, TenderOpportunityData } from './records';
import { closesIn, formatClp, sourceLabel } from './view';

/**
 * What Cowork reads of «Oportunidades» (plan 8, phase 3, PR-3f): the best companies hiring, the open tenders and the SEIA
 * projects of the organization, a few of each, with why each one fits and its signal written as a fact with its source and
 * its date, ready to cite in an answer or an email («publicó 14 avisos de empleo en 30 días, según LinkedIn»). Pure: the
 * server read (server/cowork/opportunities-read.ts) brings the rows; nothing here asks for more.
 */
export type CoworkHiringItem = {
  id: string; company: string; domain: string | null; region: string | null; url: string | null; score: number; reasons: string[];
  status: OpportunityStatus; mine: boolean; ads: number; firstSeenAt: string; lastSeenAt: string; data: HiringOpportunityData;
};
export type CoworkTenderItem = {
  id: string; kind: 'tender' | 'compra_agil'; title: string; buyer: string | null; region: string | null; amount: number | null; currency: string | null;
  deadlineAt: string | null; publishedAt: string | null; url: string | null; score: number; reasons: string[]; status: OpportunityStatus; mine: boolean;
  firstSeenAt: string; data: TenderOpportunityData;
};
export type CoworkProjectItem = {
  id: string; title: string; owner: string | null; region: string | null; investmentUsd: number | null; presentedAt: string | null; url: string | null;
  score: number; reasons: string[]; status: OpportunityStatus; mine: boolean; firstSeenAt: string; data: ProjectOpportunityData;
};
export type CoworkOpportunityRun = { source: string; status: string; startedAt: string; fetched: number; created: number; error: string | null };
export type CoworkOpportunityProfile = {
  offer: string; roles: string[]; regions: string[]; minAds: number; keywords: string[]; sectors: string[]; minInvestmentUsd: number | null;
};

/** At most this many of each kind go to the model: the page has the rest. */
export const COWORK_OPPORTUNITIES_SHOWN = 5;
export const OPPORTUNITIES_PAGE = '/opportunities';
const DAY = 86_400_000;
const STATUS_LABELS: Record<OpportunityStatus, string> = { new: 'nueva', interested: 'te interesa', dismissed: 'descartada', converted: 'convertida' };
const RUN_SOURCE_LABELS: Record<string, string> = { seia: 'Archivo del SEIA' };
const dateFormat = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Santiago' });
/** «28 sept 2026», or null without a date. A date without time reads as that day in Chile. */
const day = (value: string | null | undefined) => {
  if (!value) return null;
  const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value);
  return Number.isFinite(time) ? dateFormat.format(new Date(time)).replace('.', '') : null;
};
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** «Walmart Chile S.A.» and «walmart chile» are the same company for a search. */
const plain = (value: string) => fold(value).replace(/\b(s\.?\s?a\.?|s\.?p\.?a\.?|ltda\.?|limitada|e\.?i\.?r\.?l\.?)(?=\s|$)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

/** A company, buyer or project named in the query (or its domain); an empty query matches everything. */
export function matchesOpportunityQuery(query: string, names: Array<string | null | undefined>) {
  const wanted = plain(query);
  if (!wanted) return true;
  return names.some(name => {
    const value = name ? plain(name) : '';
    return Boolean(value) && (value.includes(wanted) || (value.length >= 4 && wanted.includes(value)));
  });
}

function relation(data: HiringOpportunityData) {
  return data.isClient ? 'ya es cliente (está en «Perfil»)' : data.isContact ? 'ya tienes contactos guardados en esa empresa' : 'aún no es contacto';
}

/** «Falabella publicó 14 avisos de empleo en los últimos 30 días (6 de operario y 4 de bodeguero), el último el 28 sept 2026, según LinkedIn». */
export function hiringSignal(item: Pick<CoworkHiringItem, 'company' | 'ads' | 'data'>) {
  const roles = item.data.roles.slice(0, 2).map(role => `${role.ads} de ${role.role}`);
  const where = (item.data.publishers.length ? item.data.publishers : item.data.sources.map(sourceLabel)).slice(0, 3);
  const last = day(item.data.lastPostedAt);
  return `${item.company} publicó ${item.ads} ${item.ads === 1 ? 'aviso' : 'avisos'} de empleo en los últimos ${item.data.windowDays} días`
    + (roles.length ? ` (${list(roles)})` : '') + (last ? `, el último el ${last}` : '') + (where.length ? `, según ${list(where)}` : '') + '.';
}

/** «Hospital X publicó la licitación «Servicio de aseo» (1234-56-LE26) en Mercado Público el 22 sept 2026; cierra en 6 días». */
export function tenderSignal(item: Pick<CoworkTenderItem, 'kind' | 'title' | 'buyer' | 'publishedAt' | 'deadlineAt' | 'data'>, now: number) {
  const what = item.kind === 'compra_agil' ? 'la Compra Ágil' : 'la licitación';
  const where = item.kind === 'compra_agil' ? 'Compra Ágil' : 'Mercado Público';
  const published = day(item.publishedAt);
  return `${item.buyer || 'Un organismo público'} publicó ${what} «${item.title}» (${item.data.code}) en ${where}`
    + (published ? ` el ${published}` : '') + `; ${closesIn(item.deadlineAt, now)}.`;
}

/** «Minera X ingresó al SEIA el proyecto «Ampliación Y» (US$ 320 millones), presentado el 3 mar 2026; estado: En calificación». */
export function projectSignal(item: Pick<CoworkProjectItem, 'title' | 'owner' | 'presentedAt' | 'data'>) {
  const investment = item.data.investmentMusd === null ? '' : ` (US$ ${item.data.investmentMusd.toLocaleString('es-CL', { maximumFractionDigits: 1 })} millones)`;
  const presented = day(item.presentedAt);
  return `${item.owner || 'El titular'} ingresó al SEIA el proyecto «${item.title}»${investment}`
    + (presented ? `, presentado el ${presented}` : '') + (item.data.state ? `; estado: ${item.data.state}` : '') + '.';
}

const fresh = (firstSeenAt: string, now: number) => now - Date.parse(firstSeenAt) <= DAY;
const counts = (items: Array<{ status: OpportunityStatus; firstSeenAt: string }>, now: number) => ({
  total: items.filter(item => item.status !== 'dismissed').length,
  new: items.filter(item => item.status === 'new').length,
  interested: items.filter(item => item.status === 'interested' || item.status === 'converted').length,
  dismissed: items.filter(item => item.status === 'dismissed').length,
  seenLast24h: items.filter(item => item.status !== 'dismissed' && fresh(item.firstSeenAt, now)).length,
});
/** Best first, without the dismissed ones (unless the query names one). */
const top = <T extends { status: OpportunityStatus; score: number }>(items: T[], keepDismissed: boolean) =>
  items.filter(item => keepDismissed || item.status !== 'dismissed').sort((a, b) => b.score - a.score).slice(0, COWORK_OPPORTUNITIES_SHOWN);

export function coworkOpportunitiesSummary(input: {
  profile: CoworkOpportunityProfile | null; hiring: CoworkHiringItem[]; tenders: CoworkTenderItem[]; projects: CoworkProjectItem[];
  runs: CoworkOpportunityRun[]; query: string; now: string; ready: { hiring: boolean; tenders: boolean };
}) {
  const now = Date.parse(input.now);
  const query = input.query.replace(/\s+/g, ' ').trim();
  const hiring = input.hiring.filter(item => matchesOpportunityQuery(query, [item.company, item.domain]));
  const tenders = input.tenders.filter(item => matchesOpportunityQuery(query, [item.buyer, item.title, item.data.buyerUnit, item.data.code]));
  const projects = input.projects.filter(item => matchesOpportunityQuery(query, [item.owner, item.title]));
  // The runs come newest first: the first one of each source is its last search.
  const lastRuns = input.runs.filter((run, index, all) => all.findIndex(other => other.source === run.source) === index);
  const gaps: string[] = [];
  if (!input.profile) gaps.push('Aún no se abre «Oportunidades»: ahí se define qué buscar (la oferta, los cargos, las palabras de las licitaciones y los sectores del SEIA).');
  if (!input.ready.hiring) gaps.push('La búsqueda de empresas contratando aún no tiene sus claves (JSearch o LinkedIn): las agrega el administrador de la cuenta.');
  if (!input.ready.tenders) gaps.push('Para buscar licitaciones falta tu ticket de Mercado Público: es gratis, se pide una vez en chilecompra.cl/api con tu Clave Única, llega a tu correo y se pega en Oportunidades → «Licitaciones y Compra Ágil».');
  if (!input.runs.some(run => run.source === 'seia')) gaps.push('Aún no se sube un archivo del SEIA: los proyectos se cargan a mano desde la página, una vez al mes.');
  const failed = lastRuns.filter(run => run.status === 'failed');
  if (failed.length) gaps.push(`La última búsqueda falló en ${list(failed.map(run => RUN_SOURCE_LABELS[run.source] || sourceLabel(run.source)))}.`);

  return {
    scope: 'organization_commercial_opportunities',
    page: OPPORTUNITIES_PAGE,
    query: query || null,
    profile: input.profile ? {
      offer: input.profile.offer, roles: input.profile.roles.slice(0, 8), regions: input.profile.regions, minAds: input.profile.minAds,
      tenderKeywords: input.profile.keywords.slice(0, 8),
      seiaSectors: SEIA_SECTORS.filter(sector => input.profile!.sectors.includes(sector.id)).map(sector => sector.label),
      minInvestmentUsd: input.profile.minInvestmentUsd,
    } : null,
    counts: { hiring: counts(hiring, now), tenders: { ...counts(tenders, now),
      closingIn7Days: tenders.filter(item => item.status !== 'dismissed' && item.deadlineAt && Date.parse(item.deadlineAt) - now <= 7 * DAY).length },
    projects: counts(projects, now) },
    hiring: top(hiring, Boolean(query)).map(item => ({
      company: item.company, domain: item.domain, score: item.score, reasons: item.reasons, status: STATUS_LABELS[item.status], mine: item.mine,
      ads: item.ads, adsLastWeek: item.data.adsLastWeek, roles: item.data.roles.slice(0, 3), regions: item.data.regions.slice(0, 2).map(region => region.region),
      size: item.data.size, industry: item.data.industry, relation: relation(item.data), firstSeenAt: item.firstSeenAt,
      signal: hiringSignal(item),
      adExamples: item.data.evidence.slice(0, 3).map(ad => ({ title: ad.title, where: ad.location, portal: ad.publisher || sourceLabel(ad.source), postedAt: ad.postedAt, url: ad.url })),
    })),
    tenders: top(tenders, Boolean(query)).map(item => ({
      kind: item.kind === 'compra_agil' ? 'Compra Ágil' : 'Licitación', code: item.data.code, title: item.title, buyer: item.buyer, region: item.region,
      amount: formatClp(item.amount, item.currency), deadlineAt: item.deadlineAt, closes: closesIn(item.deadlineAt, now), score: item.score,
      reasons: item.reasons, status: STATUS_LABELS[item.status], mine: item.mine, url: item.url, firstSeenAt: item.firstSeenAt,
      signal: tenderSignal(item, now),
    })),
    projects: top(projects, Boolean(query)).map(item => ({
      title: item.title, owner: item.owner, region: item.region, investmentMusd: item.data.investmentMusd, state: item.data.state,
      presentation: item.data.presentation, presentedAt: item.presentedAt, score: item.score, reasons: item.reasons, status: STATUS_LABELS[item.status],
      mine: item.mine, url: item.url, firstSeenAt: item.firstSeenAt, signal: projectSignal(item),
    })),
    lastSearches: lastRuns.map(run => ({ source: RUN_SOURCE_LABELS[run.source] || sourceLabel(run.source), at: run.startedAt, status: run.status, read: run.fetched, new: run.created, error: run.error })),
    gaps,
    howToUse: 'Cada signal es un hecho público con su fuente y su fecha: cítalo así, sin agregar cifras ni deducir necesidades que no dice. Las empresas con status «te interesa» ya las tomó alguien del equipo (mine dice si eres tú). Las acciones (marcar, descartar, buscar decisores) se hacen en la página.',
  };
}
