// «¿Qué oportunidades hay hoy?» (plan 8, phase 3, PR-3f): what Cowork reads of «Oportunidades» comes from the same function the
// app runs (src/lib/commercial-opportunities/cowork.ts) over a made-up account (test data: the app is for any company). Two
// companies hiring, one dismissed; two open tenders and one SEIA project. The answer explains, shows the best ones with their
// signal (source and date) and proposes the next step without marking anything for the person.
import { coworkOpportunitiesSummary, type CoworkHiringItem, type CoworkProjectItem, type CoworkTenderItem } from '../../src/lib/commercial-opportunities/cowork';
import { CORPUS_COMMON_CHECKS, CORPUS_NOW, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const everything = (result: CorpusTurnResult) => normalize([corpusShown(result), result.document?.title || '', result.document?.content || '', result.question || ''].join('\n'));
const says = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => pattern.test(everything(result))) });
const avoids = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => !pattern.test(everything(result))) });

const now = CORPUS_NOW.toISOString();
const ad = (title: string, publisher: string, postedAt: string) => ({ source: 'linkedin' as const, title, location: 'Santiago, Región Metropolitana', publisher, url: null, postedAt });
const hiring = (company: string, domain: string | null, ads: number, roles: Array<[string, number]>,
  { isContact = false, ...extra }: Partial<CoworkHiringItem> & { isContact?: boolean } = {}): CoworkHiringItem => ({
  id: `h-${company}`, company, domain, region: 'Región Metropolitana', url: null, score: 0, reasons: [], status: 'new', mine: false, ads,
  firstSeenAt: '2026-09-25T11:20:00Z', lastSeenAt: '2026-09-25T11:20:00Z', ...extra,
  data: {
    ads, adsLastWeek: Math.ceil(ads / 2), roles: roles.map(([role, count]) => ({ role, ads: count })), regions: [{ region: 'Región Metropolitana', ads }],
    publishers: ['LinkedIn', 'Laborum'], sources: ['linkedin', 'jsearch'], size: '501-1000', industry: 'Retail', isClient: false, isContact,
    firstPostedAt: '2026-09-02T12:00:00Z', lastPostedAt: '2026-09-24T12:00:00Z', windowDays: 30,
    evidence: [ad(`${roles[0][0]} turno noche`, 'LinkedIn', '2026-09-24T12:00:00Z'), ad(roles[1]?.[0] || roles[0][0], 'Laborum', '2026-09-20T12:00:00Z')],
  },
});
export const OPPORTUNITY_HIRING: CoworkHiringItem[] = [
  hiring('Retail Andes', 'retailandes.cl', 14, [['Operario de bodega', 6], ['Reponedor', 4], ['Cajero', 4]],
    { score: 82, reasons: ['14 avisos en 30 días', 'cargos de tu búsqueda: operario, reponedor y cajero', 'en Región Metropolitana', 'aún no es contacto'] }),
  hiring('Logística Sur', 'logisticasur.cl', 9, [['Conductor', 5], ['Bodeguero', 4]],
    { score: 70, reasons: ['9 avisos en 30 días', 'cargos de tu búsqueda: conductor y bodeguero', 'ya tienes contactos ahí'], isContact: true }),
  hiring('Seguridad Austral', 'segaustral.cl', 7, [['Guardia de seguridad', 7]], { score: 65, status: 'dismissed', reasons: ['7 avisos en 30 días'] }),
];
const tender = (kind: 'tender' | 'compra_agil', code: string, title: string, buyer: string, amount: number, deadlineAt: string, score: number): CoworkTenderItem => ({
  id: `t-${code}`, kind, title, buyer, region: 'Región de Antofagasta', amount, currency: 'CLP', deadlineAt, publishedAt: '2026-09-22T13:00:00Z', url: null,
  score, reasons: ['nombra «personal transitorio»', 'cierra pronto'], status: 'new', mine: false, firstSeenAt: '2026-09-23T11:20:00Z',
  data: { source: kind === 'compra_agil' ? 'compra_agil' : 'mercado_publico', code, buyerUnit: null, status: 'Publicada', keywords: ['personal transitorio'], description: null, items: [] },
});
export const OPPORTUNITY_TENDERS: CoworkTenderItem[] = [
  tender('compra_agil', '2389-145-COT26', 'Personal transitorio para bodega de insumos', 'Hospital Regional de Antofagasta', 4_800_000, '2026-09-28T18:00:00Z', 74),
  tender('tender', '1057-88-LE26', 'Suministro de personal de aseo', 'Municipalidad de Calama', 96_000_000, '2026-10-07T15:00:00Z', 61),
];
export const OPPORTUNITY_PROJECTS: CoworkProjectItem[] = [{
  id: 'p-1', title: 'Ampliación Planta Desaladora Norte', owner: 'Aguas del Norte S.A.', region: 'Región de Antofagasta', investmentUsd: 320_000_000,
  presentedAt: '2026-03-03', url: null, score: 78, reasons: ['US$ 320 millones', 'en calificación: aún no se construye'], status: 'new', mine: false,
  firstSeenAt: '2026-09-15T14:00:00Z',
  data: { owner: 'Aguas del Norte S.A.', presentation: 'EIA', typology: 'Plantas de tratamiento de agua', sector: 'saneamiento', state: 'En calificación',
    communes: 'Antofagasta', presentedAt: '2026-03-03', qualifiedAt: null, investmentMusd: 320 },
}];
const RUNS = [
  { source: 'jsearch', status: 'succeeded', startedAt: '2026-09-25T11:15:00Z', fetched: 180, created: 3, error: null },
  { source: 'compra_agil', status: 'succeeded', startedAt: '2026-09-25T11:15:00Z', fetched: 46, created: 1, error: null },
  { source: 'mercado_publico', status: 'succeeded', startedAt: '2026-09-25T11:15:00Z', fetched: 812, created: 1, error: null },
  { source: 'linkedin', status: 'succeeded', startedAt: '2026-09-24T15:02:00Z', fetched: 200, created: 2, error: null },
  { source: 'seia', status: 'succeeded', startedAt: '2026-09-15T14:00:00Z', fetched: 1240, created: 1, error: null },
];
export const OPPORTUNITIES_READ = (query: string) => coworkOpportunitiesSummary({
  profile: { offer: 'Personal transitorio y outsourcing para operaciones', roles: ['Operario de bodega', 'Reponedor', 'Cajero', 'Conductor', 'Bodeguero', 'Guardia de seguridad'],
    regions: ['Región Metropolitana', 'Región de Antofagasta'], minAds: 5, keywords: ['personal transitorio', 'suministro de personal'], sectors: ['mineria', 'saneamiento'], minInvestmentUsd: 10_000_000 },
  hiring: OPPORTUNITY_HIRING, tenders: OPPORTUNITY_TENDERS, projects: OPPORTUNITY_PROJECTS, runs: RUNS, query, now, ready: { hiring: true, tenders: true },
});

export const OPPORTUNITIES_CORPUS: CorpusCase[] = [
  { id: 'oportunidades-hoy', title: '¿Qué oportunidades hay hoy?', request: '¿Qué oportunidades comerciales hay hoy?',
    origin: 'Plan 8, fase 3: Cowork lee «Oportunidades» (empresas contratando, licitaciones y proyectos del SEIA) y explica cuál mirar primero.',
    opportunities: true,
    world: { read: (action, query) => action === 'opportunities.list' ? OPPORTUNITIES_READ(query) : corpusRead(action, query), savedEmails: [] },
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee las oportunidades', test: result => result.actions.includes('opportunities.list') },
      says('nombra a Retail Andes, la mejor empresa contratando', /retail andes/),
      says('cita la señal con su fuente o su cantidad de avisos', /(14 avisos|linkedin|laborum)/),
      says('menciona las licitaciones o la Compra Ágil y su cierre', /(licitaci|compra agil)/, /(cierra|cierre|plazo)/),
      avoids('no recomienda a la empresa descartada', /seguridad austral/),
      // Marking or dismissing is done in the page: the only thing Cowork may propose here is to look for the decision makers of
      // a company hiring, by its domain.
      { label: 'si propone algo, es buscar decisores de una empresa contratando por su dominio', test: result => !result.proposal && !result.note
        && (!result.search || JSON.stringify(result.search).includes('retailandes.cl') || JSON.stringify(result.search).includes('logisticasur.cl')) }] },
];
