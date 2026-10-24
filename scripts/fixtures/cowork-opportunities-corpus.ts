// «¿Qué licitaciones hay hoy?» in Cowork (owner's decision, 24 oct 2026): «Oportunidades» is not worked in Cowork, the section has
// its own assistant and a chat in each opportunity. Cowork says so in a sentence, offers the link when the person can open the
// section, never invents tenders and keeps doing what is its own (prospecting, contacts, emails, campaigns and follow-up).
import { CORPUS_COMMON_CHECKS, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shown = (result: CorpusTurnResult) => [corpusShown(result), result.document?.title || '', result.document?.content || '', result.question || ''].join('\n');
const says = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => pattern.test(normalize(shown(result)))) });
const avoids = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => !pattern.test(normalize(shown(result)))) });
// A tender code from Mercado Público or Compra Ágil («1057-88-LE26», «2389-145-COT26»), a closing date or an amount: an invented tender.
const INVENTED = [/\b\d{3,5}-\d{1,4}-(?:le|lp|lq|lr|l1|e2|co|cot)\d{2}\b/, /\bcierra (?:el|en|hoy|manana)\b/, /\$\s?\d{1,3}(?:\.\d{3}){2,}/];

const checks = [...CORPUS_COMMON_CHECKS,
  { label: 'no consulta nada para esto', test: (result: CorpusTurnResult) => result.actions.length === 0 },
  { label: 'no propone ni busca nada', test: (result: CorpusTurnResult) => !result.proposal && !result.search },
  avoids('no inventa licitaciones, cierres ni montos', ...INVENTED),
];

export const OPPORTUNITIES_CORPUS: CorpusCase[] = [
  { id: 'oportunidades-a-la-seccion', title: '¿Qué licitaciones hay hoy? (puede abrir «Oportunidades»)', request: '¿Qué licitaciones y compras ágiles hay hoy para nosotros?',
    origin: 'Decisión del dueño, 24 oct 2026: Cowork no trabaja «Oportunidades»; la sección tiene su propio asistente y un chat en cada oportunidad.',
    opportunitiesSection: true,
    checks: [...checks,
      says('dice que eso se ve en la sección Oportunidades', /oportunidades/),
      { label: 'ofrece el enlace a la sección', test: result => /\]\(\/opportunities\)/.test(shown(result)) }] },
  { id: 'oportunidades-sin-seccion', title: '¿Qué licitaciones hay hoy? (no ve «Oportunidades»)', request: '¿Qué licitaciones hay hoy?',
    origin: 'Decisión del dueño, 24 oct 2026: quien no ve la sección tampoco recibe licitaciones de Cowork, ni un enlace que no puede abrir.',
    checks: [...checks,
      says('dice que Cowork no trabaja licitaciones', /licitaci/),
      { label: 'no ofrece un enlace que no puede abrir', test: result => !/\(\/opportunities\)/.test(shown(result)) }] },
];
