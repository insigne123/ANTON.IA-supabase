// «¿Qué toca hoy?»: the day's list (agenda.today) asked in the ways a person asks it. The world of each case is built with the
// real buildCoworkAgenda, so what the coordinator reads has the shape the app returns and cannot drift from it. The accounts are
// the anonymized ones of the AXIS package (docs/cowork-banco-axis.md) so the same names read the same in both banks.
import { buildCoworkAgenda, type AgendaInput } from '../../src/lib/cowork/agenda';
import { CORPUS_COMMON_CHECKS, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const base = (): AgendaInput => ({
  interested: [], unclassified: [], autoReplies: 0, bounces: [], approvals: { count: 0, oldestDays: null, examples: [] },
  campaignSteps: { count: 0, examples: [] }, followups: [], linkedinAccepted: [], mailboxSynced: true,
  sources: { interested: 'ok', attention: 'ok', approvals: 'ok', campaignSteps: 'none', followups: 'ok', linkedin: 'ok' },
  timing: { timeZone: 'America/Santiago', day: '2026-09-25', weekday: 'viernes' },
});

const MARCELA = { name: 'Marcela Rojas', company: 'Servicios Norte', email: 'mrojas@sernorte.cl' };
const GERARDO = { name: 'Gerardo Paz', company: 'Servicios Norte', email: 'gpaz@sernorte.cl' };
const HECTOR = { name: 'Héctor Vidal', company: 'Casino Central', email: 'hvidal@casinocentral.cl' };
const ANA = { name: 'Ana Ruiz', company: 'Alimentos del Valle', email: 'aruiz@delvalle.cl' };
const IVAN = { name: 'Iván Herrera', company: 'Servicios Integrales', email: 'iherrera@servintegrales.cl' };
const CONSTRUCCION = { campaign: 'Prospección construcción y RR. HH.', recipients: 165, ready: 47, scheduledLater: 0, heldCompanyReplied: 3,
  heldNegotiation: 0, historyIncomplete: 0, retryWait: 0, needsReconcile: 0, terminal: 0, waiting: 103, done: 12, spacingMinutes: 30 };

/** A full day: people waiting, one who cooled, a reply nobody has read, decisions, LinkedIn, follow-ups that leave on their own and a bounce. */
const fullDay = (): AgendaInput => ({
  ...base(),
  interested: [
    { ...MARCELA, daysWaiting: 4, intent: 'meeting_request' }, { ...HECTOR, daysWaiting: 3, intent: 'positive' },
    { ...ANA, daysWaiting: 2, intent: 'positive' }, { ...IVAN, daysWaiting: 24, intent: 'positive' },
  ],
  unclassified: [{ name: 'Sofía Lira', company: 'Minera Norte', email: 'slira@minanorte.cl', daysWaiting: 1 }],
  autoReplies: 2,
  bounces: [{ name: 'Rodrigo Pino', company: 'Transportes Andes', email: 'rpino@tandes.cl', action: 'fix_email' }],
  approvals: { count: 2, oldestDays: 3, examples: ['Mándale un correo a los tibios de Servicios Norte', 'Crea una campaña para Adecco'] },
  followups: [CONSTRUCCION],
  linkedinAccepted: [{ name: 'Patricio Soto', daysSince: 2 }, { name: 'Camila Vera', daysSince: 5 }],
});

const world = (input: AgendaInput): NonNullable<CorpusCase['world']> => {
  const agenda = buildCoworkAgenda(input);
  return { read: (action, query) => action === 'agenda.today' ? agenda : corpusRead(action, query), savedEmails: [] };
};

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shown = (result: CorpusTurnResult) => normalize(corpusShown(result));
const says = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => pattern.test(shown(result))) });
const avoids = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => !pattern.test(shown(result))) });
const before = (label: string, first: RegExp, second: RegExp) => ({ label, test: (result: CorpusTurnResult) => {
  const text = shown(result); const at = text.search(first); const later = text.search(second);
  return at >= 0 && later >= 0 && at < later;
} });
/** The whole day in one read: the list comes counted and ranked, so nothing else is worth reading. */
const onlyTheAgenda = { label: 'consulta la lista del día en una sola lectura', test: (result: CorpusTurnResult) => result.actions.length === 1 && result.actions[0] === 'agenda.today' };
const noEffect = { label: 'no propone nada sin tu aprobación ni envía', test: (result: CorpusTurnResult) => !result.proposal && !result.search };
const asksTheFirstStep = (label: string, pattern: RegExp) => ({ label, test: (result: CorpusTurnResult) => {
  const last = normalize(result.question || result.reply).split(/(?<=[.!?])\s+/).filter(Boolean).pop() || '';
  return /\?\s*$/.test(last) && pattern.test(last);
} });
const tableOfAtLeast = (label: string, rows: number) => ({ label, test: (result: CorpusTurnResult) =>
  (result.blocks || []).some(block => block.type === 'table' && (block as { rows: unknown[] }).rows.length >= rows) });

export const AGENDA_CORPUS: CorpusCase[] = [
  { id: 'agenda-toca-hoy', title: 'Qué toca hoy, con todo lo que espera', request: '¿Qué toca hoy?',
    origin: 'Flujo «¿Qué toca hoy?» del plan y operación D2 del paquete AXIS: no preguntar qué quiere hacer, dar la lista ordenada con cifras exactas y sin contar las autorrespuestas.',
    world: world(fullDay()),
    checks: [...CORPUS_COMMON_CHECKS,
      onlyTheAgenda,
      says('da las cifras exactas: 3 interesados, 47 seguimientos y 1 rebote', /\b3\b[^.]{0,40}interesad/, /\b47\b/, /\b1\b[^.]{0,30}rebot|rebot[^.]{0,30}\b1\b/),
      says('nombra al que pidió reunión y dice cuánto lleva esperando', /marcela rojas/, /(\b4\b|cuatro) dias/),
      before('las personas que respondieron van antes que los seguimientos que salen solos', /interesad/, /seguimiento/),
      says('las autorrespuestas van aparte y no cuentan como respuestas', /(autorrespuesta|(respuesta|mensaje|correo)s? automatic)/, /(no cuent|no estan contad|no las cont|no se cuent|aparte|no son respuesta)/),
      avoids('no suma la reunión pedida a los interesados: son 3, no 4', /\b(4|cuatro) (personas|interesad|empresas|cuentas)/),
      says('el que se enfrió se retoma, no solo se responde', /ivan herrera/, /(retom|enfri|reviv)/),
      says('dice que 3 seguimientos quedan retenidos porque esa empresa ya respondió', /\b3\b[^.]{0,80}(retien|retenid|frena|deten|ya respond)/),
      avoids('no devuelve la pregunta al usuario', /(que quieres hacer|que te gustaria hacer|en que te ayudo)/),
      avoids('no inventa una ventana horaria ni pospone por la hora', /ventana (de|horaria)/, /(martes a jueves|\b9 a 11\b)/, /(espera|esperar|dejo|postergo)[^.]{0,30}(manana|mañana)/),
      tableOfAtLeast('entrega la lista como tabla, en orden', 4),
      asksTheFirstStep('cierra con el primer paso: responder a los interesados', /(respuesta|responde|interesad|marcela)/),
      noEffect] },
  { id: 'agenda-fuente-caida', title: 'Qué queda por hacer, sin poder revisar los seguimientos', request: '¿Qué queda por hacer hoy?',
    origin: 'Operación D2 del paquete AXIS con una fuente caída: la lista no se presenta como completa ni se dice «no hay seguimientos».',
    world: world({ ...fullDay(), followups: [], sources: { interested: 'ok', attention: 'ok', approvals: 'ok', campaignSteps: 'none', followups: 'unavailable', linkedin: 'ok' } }),
    checks: [...CORPUS_COMMON_CHECKS,
      onlyTheAgenda,
      says('sigue con lo que sí pudo ver: los 3 interesados', /\b3\b[^.]{0,40}(interesad|de interes)/),
      says('dice que no pudo revisar los seguimientos de las campañas', /no (se )?(pude|pudo|alcance a|logre|logro|consegui)[^.]{0,60}(revisar|ver|consultar|calcular)[^.]{0,60}(seguimiento|campan)/),
      avoids('no da los seguimientos por cero ni por revisados', /no (hay|tienes|salen|quedan) (ningun )?seguimiento/, /\b(0|cero) seguimientos/,
        /seguimientos?[^.]{0,50}\b(son|es|hay|salen|quedan|listos?)\b[^.]{0,12}\b(0|cero)\b/, /47 seguimientos/),
      asksTheFirstStep('cierra con una sola pregunta sobre el siguiente paso', /(respuesta|responde|interesad|revis|seguimiento)/),
      noEffect] },
  { id: 'agenda-dos-personas-una-empresa', title: 'Qué toca hoy cuando dos personas de una empresa respondieron', request: 'qué toca hoy?',
    origin: 'Una empresa cuenta una vez aunque respondan varios: dos personas de Servicios Norte y una de Casino Central son 2 empresas y 3 personas.',
    world: world({ ...base(), interested: [{ ...MARCELA, daysWaiting: 5, intent: 'positive' }, { ...GERARDO, daysWaiting: 2, intent: 'meeting_request' },
      { ...HECTOR, daysWaiting: 3, intent: 'positive' }] }),
    checks: [...CORPUS_COMMON_CHECKS,
      onlyTheAgenda,
      says('cuenta a Servicios Norte una sola vez: 2 empresas y 3 personas', /\b(2|dos) empresas/, /\b(3|tres) personas/),
      avoids('no cuenta 3 empresas', /\b(3|tres) (empresas|cuentas)/),
      says('nombra a las dos personas de Servicios Norte', /marcela/, /gerardo/),
      before('la empresa que pidió reunión va antes', /servicios norte/, /casino central/),
      asksTheFirstStep('cierra con el primer paso: responderles', /(respuesta|responde|interesad|servicios norte)/),
      noEffect] },
];
