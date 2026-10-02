// «¿Cuál es mi ICP?» (plan 8, phase 2): the analysis comes from the same function the app runs (src/lib/cowork/icp.ts) over a
// made-up account with the corpus offer (AXIS, test data: the app is for any company). 64 people contacted, 2 positive replies,
// both from people areas, and «Perfil» without the customer's roles or industries: the answer explains, delivers «Tu cliente
// ideal», says the sample is small and offers to keep the customer in «Perfil».
import { analyzeIcp, type IcpTouch } from '../../src/lib/cowork/icp';
import { CORPUS_COMMON_CHECKS, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

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

export const ICP_CORPUS: CorpusCase[] = [
  { id: 'icp-cual-es-mi-icp', title: '¿Cuál es mi cliente ideal?', request: '¿Cuál es mi ICP? ¿A qué tipo de empresas y personas debería apuntar?',
    origin: 'Plan 8, fase 2: el usuario pidió que Cowork razone su cliente ideal con su oferta, su Perfil y sus resultados.',
    world: world({ 'icp.analyze': ICP_ANALYSIS }),
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'lee el análisis del cliente ideal', test: result => result.actions.includes('icp.analyze') },
      { label: 'entrega el documento «Tu cliente ideal»', test: result => /(cliente ideal|\bicp\b)/.test(normalize(result.document?.title || '')) },
      says('el documento dice quién compra, a quién no y cómo probarlo', /quien(es)? (te )?compra/, /a quien no/, /(hipotesis|probar|prueba)/),
      says('nombra a RR. HH. o personas como de donde vinieron las respuestas positivas', /(rr\.? ?hh|recursos humanos|personas)/),
      says('dice que la muestra es chica para concluir', /(muestras? (es |son )?(chicas?|pequenas?)|ojo con la muestra|pocas (personas|respuestas)|pocos (datos|resultados)|no alcanza para (concluir|sacar)|no (se )?puede(s)? concluir|no permiten? concluir|no concluy|una pista|indicios?|no (es )?una conclusion|no (son )?conclusiones|no son concluyentes)/),
      says('ofrece guardar el cliente ideal en Perfil', /perfil/, /(guard|actualiz|complet)/),
      // A negation («no es prueba de que un grupo funciona mejor») is what the recipe asks for; only the claim fails.
      { label: 'no afirma que un grupo «funciona mejor» o «convierte mejor»', test: (result: CorpusTurnResult) => {
        const text = everything(result);
        // The sentence that says it: a negation or a doubt in it («no permiten concluir cuál funciona mejor») is not a claim.
        return [...text.matchAll(/(funciona|convierte|rinde)n? mejor/g)].every(match => {
          const sentence = text.slice(Math.max(0, match.index! - 140), match.index).split(/[.!?\n]/).pop() || '';
          return /(\bno\b|\bsin\b|\bni\b|nunca|pocos|pocas|afirmar|concluir|saber|cual|que segmento|\bsi\b)/.test(sentence);
        });
      } },
      { label: 'no envía ni propone otra cosa que guardar en Perfil', test: result => !result.search && (!result.proposal || result.proposal.kind === 'profile_update') }] },
];
