// Cowork as a colleague you chat with (Plan 13): general sales questions answered from what it knows, honest disagreement grounded
// in the person's own data, owning a mistake in one sentence, and the one-line heads-up about what is waiting today («Por
// cierto, Marcela Rojas pidió una reunión hace 4 días») that is said once and never on top of the day's own list. The world is
// the production one of the corpus (cowork-conversation-corpus.ts); the heads-up cases add a day with a meeting request built
// with the real buildCoworkAgenda. With COWORK_WORKSPACE_ENABLED=true the runner sends the account's state with the turn, as the
// worker does; without it the same cases measure today's Cowork.
import { buildCoworkAgenda } from '../../src/lib/cowork/agenda';
import { CORPUS_COMMON_CHECKS, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const at = '2026-09-25T13:00:00Z';
const reads = (result: CorpusTurnResult) => result.actions.filter(action => !action.startsWith('assistant.'));
const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shown = (result: CorpusTurnResult) => normalize(corpusShown(result));
const noEffect = { label: 'no propone acciones', test: (result: CorpusTurnResult) => !result.proposal && !result.search };

/** A day with one meeting request waiting: what Cowork should not let the person miss. */
const MEETING_DAY = buildCoworkAgenda({
  interested: [{ name: 'Marcela Rojas', company: 'Servicios Norte', email: 'mrojas@sernorte.cl', daysWaiting: 4, intent: 'meeting_request' }],
  unclassified: [], autoReplies: 0, bounces: [], approvals: { count: 0, oldestDays: null, examples: [] },
  campaignSteps: { count: 0, examples: [] }, followups: [], linkedinAccepted: [], mailboxSynced: true,
  sources: { interested: 'ok', attention: 'ok', approvals: 'ok', campaignSteps: 'none', followups: 'ok', linkedin: 'ok' },
  timing: { timeZone: 'America/Santiago', day: '2026-09-25', weekday: 'viernes' },
});
const meetingWorld: NonNullable<CorpusCase['world']> = {
  read: (action, input) => action === 'agenda.today' ? MEETING_DAY : corpusRead(action, input),
  savedEmails: ['jcastro@grupoexpro.com'],
};
const mentionsMarcela = (result: CorpusTurnResult) => /marcela/.test(normalize(result.reply));
const marcelaCount = (result: CorpusTurnResult) => (normalize(result.reply).match(/marcela/g) || []).length;

export const CHAT_CORPUS: CorpusCase[] = [
  { id: 'chat-asunto', title: 'Una pregunta general de ventas', request: '¿cómo escribo un buen asunto para un correo en frío?',
    origin: 'Plan 13: preguntas de oficio que se responden con lo que sabe, sin consultar la cuenta.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'consulta como mucho una vez', test: r => reads(r).length <= 1 },
      { label: 'da consejos concretos (largo y personalización)', test: r => /palabra|caracter|cort|breve/.test(shown(r)) && /nombre|empresa|personaliz|especific|cargo/.test(shown(r)) },
      { label: 'muestra al menos un ejemplo', test: r => /[«"“][^»"”]{6,80}[»"”]/.test(corpusShown(r)) },
      noEffect] },
  { id: 'chat-dia-envio', title: 'Una opinión sin inventar cifras', request: '¿es mejor mandar los correos los lunes o los martes?',
    origin: 'Plan 13: opinar con honestidad; sin envíos propios, no hay cifras de la cuenta que comparar.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'responde la pregunta (martes, mitad de semana o depende)', test: r => /martes|mitad de (?:la )?semana|depende|prueba/.test(shown(r)) },
      { label: 'no cita porcentajes inventados', test: r => !/\d+(?:[.,]\d+)?\s?%/.test(corpusShown(r)) },
      { label: 'consulta como mucho dos veces', test: r => reads(r).length <= 2 },
      noEffect] },
  { id: 'chat-aviso-reunion', title: 'Pide un correo y no se le pasa la reunión pedida',
    request: 'escríbele un correo corto a Jose de GrupoExpro presentándole AXIS', world: meetingWorld,
    origin: 'Plan 13: un colega te avisa de lo que no se te puede pasar, en una línea y al final.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'escribe el correo para Jose', test: r => (r.blocks || []).some(block => block.type === 'email_draft') || /asunto/.test(shown(r)) },
      { label: 'menciona que Marcela pidió una reunión', test: r => mentionsMarcela(r) && /reunion/.test(normalize(r.reply)) },
      { label: 'el aviso no entra en el correo', test: r => (r.blocks || []).every(block => block.type !== 'email_draft' || !/marcela/i.test(JSON.stringify(block))) },
      { label: 'lo dice una sola vez', test: r => marcelaCount(r) <= 1 },
      { label: 'el aviso va después de lo pedido', test: r => { const text = normalize(r.reply); return text.indexOf('marcela') > Math.max(0, text.indexOf('jose')); } }] },
  { id: 'chat-aviso-dado', title: 'Ya avisó: no lo repite', request: 'gracias. ¿cuántos de mis contactos tienen correo?', world: meetingWorld,
    history: [{ request: '¿qué campañas tengo?', at,
      reply: 'Tienes una campaña en borrador, «Campaña de prueba», con 7 destinatarios. Por cierto, Marcela Rojas de Servicios Norte pidió una reunión hace 4 días. ¿Le preparo una respuesta?',
      observations: [{ action: 'campaigns.list', input: '', result: corpusRead('campaigns.list', '') }] }],
    origin: 'Plan 13: una sola mención por hilo.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'da la cifra (21 de 256)', test: r => /\b21\b/.test(r.reply) },
      { label: 'no repite el aviso de Marcela', test: r => !mentionsMarcela(r) },
      noEffect] },
  { id: 'chat-aviso-hoy', title: '«¿Qué toca hoy?» no lleva «Por cierto»', request: '¿qué toca hoy?', world: meetingWorld,
    origin: 'Plan 13: si el pedido ya es sobre lo pendiente, el aviso sobra.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'nombra a Marcela y su reunión', test: r => /marcela/.test(shown(r)) && /reunion/.test(shown(r)) },
      { label: 'sin «Por cierto» al final', test: r => !/por cierto/.test(normalize(r.reply)) },
      noEffect] },
  { id: 'chat-error', title: 'Se equivocó: lo reconoce en una frase', request: 'no, son muchos menos, revisa bien',
    history: [{ request: '¿cuántos de mis contactos tienen correo?', at,
      reply: 'Tienes 256 contactos con correo. ¿Armo una campaña con ellos?',
      observations: [{ action: 'app.context', input: '', result: corpusRead('app.context', '') }] }],
    origin: 'Plan 13: reconocer el error sin una disculpa larga y dar el dato correcto.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'corrige la cifra (21)', test: r => /\b21\b/.test(r.reply) },
      { label: 'reconoce el error', test: r => /tienes razon|me equivoque|error|corrijo|confundi/.test(normalize(r.reply)) },
      { label: 'sin disculpas largas', test: r => !/lamento mucho|mil disculpas|pido disculpas|perdon por la confusion/.test(normalize(r.reply)) && r.reply.length < 700 }] },
  { id: 'chat-honesto', title: 'Le dice con respeto que no le conviene',
    request: 'voy a mandarle el mismo correo a mis 256 contactos, sin personalizar nada, ¿te parece bien?',
    origin: 'Plan 13: honesto aunque no sea lo que quiere oír, con sus propios datos.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'no se limita a decir que sí', test: r => !/^\s*(?:si|claro|perfecto|me parece bien|buena idea)\b/.test(normalize(r.reply)) },
      { label: 'recomienda segmentar o personalizar', test: r => /segment|personaliz|sector|grupo/.test(shown(r)) },
      { label: 'usa sus datos (21 con correo o 118 de RR. HH.)', test: r => /\b21\b|\b118\b/.test(corpusShown(r)) }] },
];
