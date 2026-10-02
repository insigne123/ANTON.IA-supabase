// «¿Cuál es mi ICP?» (plan 8, phase 2): the analysis comes from the same function the app runs (src/lib/cowork/icp.ts) over a
// made-up account with the corpus offer (AXIS, test data: the app is for any company). 64 people contacted, 2 positive replies,
// both from people areas, and «Perfil» without the customer's roles or industries: the answer explains, delivers «Tu cliente
// ideal», says the sample is small and offers to keep the customer in «Perfil».
import { analyzeIcp, type IcpTouch } from '../../src/lib/cowork/icp';
import { CORPUS_COMMON_CHECKS, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';
import { corpusRecommend } from './cowork-recommend-world';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const everything = (result: CorpusTurnResult) => normalize([corpusShown(result), result.document?.title || '', result.document?.content || '', result.question || ''].join('\n'));
const says = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => pattern.test(everything(result))) });
const avoids = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => !pattern.test(everything(result))) });
const world = (reads: Record<string, unknown>): NonNullable<CorpusCase['world']> => ({
  read: (action, query) => action in reads ? reads[action] : corpusRead(action, query), savedEmails: [] });

type Group = { role: string; industry: string; count: number; replies?: number; positive?: number };
const GROUPS: Group[] = [
  { role: 'Jefa de RR. HH.', industry: 'Seguridad privada', count: 14, replies: 2, positive: 1 },
  { role: 'Gerente de Personas', industry: 'Retail', count: 12, replies: 1, positive: 1 },
  { role: 'Analista de Remuneraciones', industry: 'Retail', count: 8 },
  { role: 'Gerente de Operaciones', industry: 'Minería', count: 12 },
  { role: 'Gerente General', industry: 'Minería', count: 10, replies: 1 },
  { role: 'Contador General', industry: 'Seguridad privada', count: 8 },
];
const TOUCHES: IcpTouch[] = GROUPS.flatMap((group, groupIndex) => Array.from({ length: group.count }, (_, index): IcpTouch => {
  const replied = index < (group.replies || 0);
  return {
    id: `t${groupIndex}-${index}`, leadId: `00000000-0000-4000-8000-${String(groupIndex * 100 + index).padStart(12, '0')}`, email: null,
    role: group.role, industry: group.industry, country: 'Chile', city: index % 3 ? 'Santiago' : 'Antofagasta',
    sentAt: `2026-08-${String(4 + (index % 20)).padStart(2, '0')}T13:00:00Z`, repliedAt: replied ? '2026-08-28T15:00:00Z' : null,
    replyIntent: replied ? (index < (group.positive || 0) ? 'positive' : 'neutral') : null, bouncedAt: null,
  };
}));

export const ICP_ANALYSIS = { scope: 'organization_icp', offer: null, ...analyzeIcp({
  declared: null, touches: TOUCHES, leads: [], stages: new Map([[`lead_saved|${TOUCHES[0].leadId}`, 'meeting']]), now: '2026-09-25T12:00:00Z',
}) };

// «¿A quiénes les ofrezco AXIS?»: six saved contacts, one already written to and one that Ana (another member) is working.
const RECOMMEND_ROWS = [
  { id: '00000000-0000-4000-8000-00000000e101', name: 'Valentina Fuentes', title: 'Jefa de RR. HH.', company: 'Retail Andes', industry: 'Retail', email: 'vfuentes@retailandes.cl', researched: true },
  { id: '00000000-0000-4000-8000-00000000e102', name: 'Matías Soto', title: 'Gerente de Personas', company: 'Seguridad Austral', industry: 'Seguridad privada', email: null },
  { id: '00000000-0000-4000-8000-00000000e103', name: 'Carla Núñez', title: 'Analista de Selección', company: 'Retail Andes', industry: 'Retail', email: 'cnunez@retailandes.cl' },
  { id: '00000000-0000-4000-8000-00000000e104', name: 'Pedro Díaz', title: 'Gerente de Finanzas', company: 'Minera Norte', industry: 'Minería', email: 'pdiaz@mineranorte.cl' },
  { id: '00000000-0000-4000-8000-00000000e105', name: 'Lucía Vera', title: 'Jefa de Reclutamiento', company: 'Seguridad Austral', industry: 'Seguridad privada', email: 'lvera@segaustral.cl' },
  { id: '00000000-0000-4000-8000-00000000e106', name: 'Ignacio Pérez', title: 'Gerente de RR. HH.', company: 'Transportes Sur', industry: 'Transporte', email: 'iperez@tsur.cl' },
];
export const RECOMMEND_WORLD_READ = (action: string, query: string) => action === 'leads.recommend'
  ? corpusRecommend(RECOMMEND_ROWS, new Set(['00000000-0000-4000-8000-00000000e106']), query, new Map([['lvera@segaustral.cl', 'Ana']]))
  : corpusRead(action, query);

export const ICP_CORPUS: CorpusCase[] = [
  { id: 'icp-cual-es-mi-icp', title: '¿Cuál es mi cliente ideal?', request: '¿Cuál es mi ICP? ¿A qué tipo de empresas y personas debería apuntar?',
    origin: 'Plan 8, fase 2: el usuario pidió que Cowork razone su cliente ideal con su oferta, su Perfil y sus resultados.',
    world: world({ 'icp.analyze': ICP_ANALYSIS }),
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el análisis del cliente ideal', test: result => result.actions.includes('icp.analyze') },
      { label: 'entrega el documento «Tu cliente ideal»', test: result => /(cliente ideal|\bicp\b)/.test(normalize(result.document?.title || '')) },
      says('el documento dice quién compra, a quién no y cómo probarlo', /quien(es)? (te )?compra/, /a quien no/, /(hipotesis|probar|prueba)/),
      says('nombra a RR. HH. o personas como de donde vinieron las respuestas positivas', /(rr\.? ?hh|recursos humanos|personas)/),
      says('dice que la muestra es chica para concluir', /(muestra (es )?(chica|pequena)|ojo con la muestra|pocas (personas|respuestas)|no alcanza para (concluir|sacar)|no (se )?puede(s)? concluir|pocos datos|no concluy|una pista|no (es )?una conclusion|no son concluyentes)/),
      says('ofrece guardar el cliente ideal en Perfil', /perfil/, /(guard|actualiz|complet)/),
      // A negation («no es prueba de que un grupo funciona mejor») is what the recipe asks for; only the claim fails.
      { label: 'no afirma que un grupo «funciona mejor» o «convierte mejor»', test: (result: CorpusTurnResult) => {
        const text = everything(result);
        return [...text.matchAll(/(funciona|convierte|rinde)n? mejor/g)].every(match => /\b(no|sin|ni|nunca)\b/.test(text.slice(Math.max(0, match.index! - 60), match.index)));
      } },
      { label: 'no envía ni propone otra cosa que guardar en Perfil', test: result => !result.search && (!result.proposal || result.proposal.kind === 'profile_update') }] },
  { id: 'icp-a-quien-ofrezco', title: '¿A quiénes les ofrezco mi producto?', request: '¿A quiénes de mis contactos les ofrezco AXIS?',
    origin: 'Plan 8, fase 2: «¿a qué leads les ofrezco este servicio?». leads.recommend con los cargos e industrias que la oferta apunta.',
    world: { read: RECOMMEND_WORLD_READ, savedEmails: [] },
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'pide la recomendación con los cargos o industrias de la oferta', test: result => result.reads
        ?.some(read => read.action === 'leads.recommend' && read.input.trim().length > 0) ?? false },
      says('nombra a Valentina y a Matías, los que mejor calzan', /valentina/, /matias/),
      says('dice que a Matías le falta el correo', /matias[^\n]{0,160}(correo|email)|(sin correo|falta[^\n]{0,30}correo|buscar (su|el) correo)[^\n]{0,160}matias/),
      { label: 'no recomienda a Pedro, de finanzas', test: result => !/pedro/.test(everything(result)) || /pedro[^.\n]{0,80}(no calza|fuera|no es|descart|finanzas)/.test(everything(result)) },
      { label: 'no recomienda a Lucía, que trabaja otra persona del equipo, ni a Ignacio, ya contactado', test: result => !/(lucia|ignacio)/.test(normalize(corpusShown(result))) },
      { label: 'cierra ofreciendo prepararlos o una campaña', test: result => Boolean(result.proposal) || /(prepar|campana|busc\w* (su |el )?correo|investig)/.test(normalize(result.question || '')) }] },
];
