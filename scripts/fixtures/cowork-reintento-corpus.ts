// Retrying the sends of a campaign that failed (campaign.retry, COWORK_CAMPAIGN_RETRY_ENABLED): what the coordinator reads with
// campaigns.retry_review has the shape the app returns, and the person asks for the retry in the ways they ask it. The counts are the
// code's: what the retry review says is retryable, terminal or to reconcile first, and the reply may not add to them. The campaign and
// the people are made up (the app is for any company).
import { CORPUS_COMMON_CHECKS, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

export const RETRY_CAMPAIGN_ID = '00000000-0000-4000-8000-000000000071';
const item = (email: string, status: string, action: string, reason: string, error: string | null) => ({
  email, touchNumber: 1, status, error, retryAt: null, action, reason, reconcileAt: action === 'reconcile_first' ? 'Contactados' : null,
  idempotencyNote: 'Un correo nunca sale dos veces; si no se sabe si salió, primero se revisa en Contactados.' });

const reviewOf = (items: ReturnType<typeof item>[]) => ({ scope: 'own_campaign_retry_review', campaignId: RETRY_CAMPAIGN_ID,
  summary: { retryable: items.filter(entry => entry.action === 'retry').length, terminal: items.filter(entry => entry.action === 'terminal').length,
    reconcileFirst: items.filter(entry => entry.action === 'reconcile_first').length },
  items, limitation: 'De los envíos sin confirmar (reconcileFirst) no se sabe si salieron: antes de reintentarlos hay que ver en Contactados si se enviaron, para no mandar dos veces el mismo correo. Los que no se pueden reintentar (terminal) rebotaron, se dieron de baja, ya se enviaron o su empresa ya respondió.' });

const FAILED = reviewOf([
  item('paula@transportes.cl', 'failed', 'retry', 'daily_quota', 'Se alcanzó la cuota diaria'),
  item('hugo@transportes.cl', 'failed', 'retry', 'daily_quota', 'Se alcanzó la cuota diaria'),
  item('sara@minera.cl', 'deferred', 'retry', 'provider_unavailable', 'El proveedor no respondió'),
  item('tomas@servicios.cl', 'failed', 'terminal', 'mailbox_not_found', 'La casilla no existe'),
  item('lia@servicios.cl', 'failed', 'reconcile_first', 'unknown_outcome', 'No se confirmó si salió'),
]);
const NOTHING = reviewOf([
  item('tomas@servicios.cl', 'failed', 'terminal', 'mailbox_not_found', 'La casilla no existe'),
  item('lia@servicios.cl', 'failed', 'reconcile_first', 'unknown_outcome', 'No se confirmó si salió'),
]);

const world = (review: unknown): NonNullable<CorpusCase['world']> => ({
  read: (action, query) => action === 'campaigns.retry_review' ? review
    : action === 'campaigns.list' ? { scope: 'own', campaigns: [{ id: RETRY_CAMPAIGN_ID, name: 'Prospección transporte', status: 'approved', revision: 3, recipients: 40, createdAt: '2026-09-20T15:00:00Z' }] }
    : corpusRead(action, query),
  savedEmails: [],
});

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shown = (result: CorpusTurnResult) => normalize(corpusShown(result));
const says = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => pattern.test(shown(result))) });
const saysAny = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.some(pattern => pattern.test(shown(result))) });
const avoids = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => !pattern.test(shown(result))) });
const reads = (label: string, action: string) => ({ label, test: (result: CorpusTurnResult) => result.actions.includes(action) });
const proposes = { label: 'propone reintentar la campaña, con su tarjeta', test: (result: CorpusTurnResult) => result.proposal?.kind === 'campaign_retry' && result.proposal.targetId === RETRY_CAMPAIGN_ID };
const noProposal = { label: 'no propone nada', test: (result: CorpusTurnResult) => !result.proposal && !result.search };
/** The numbers the review gives: 3 retryable, 1 terminal, 1 to reconcile, the 5 with a problem in all and the 2 that do not go in (terminal and uncertain); any other figure is invented. */
const onlyKnownFigures = (known: number[]) => ({ label: 'no trae cifras que la revisión no da', test: (result: CorpusTurnResult) =>
  (result.reply.match(/\b\d+\b/g) || []).every(value => known.includes(Number(value))) });

export const REINTENTO_CORPUS: CorpusCase[] = [
  { id: 'reintento-envios', title: 'Reintentar los envíos que fallaron de una campaña', request: 'Reintenta los envíos que fallaron de la campaña «Prospección transporte»',
    origin: 'Brecha 8 del banco AXIS (D4): Cowork leía lo reintentable pero el reintento no estaba entre sus efectos; ahora lo propone con su tarjeta y dice lo que no entra.',
    campaignRetry: true, world: world(FAILED),
    checks: [...CORPUS_COMMON_CHECKS,
      reads('lee la revisión de reintentos de la campaña', 'campaigns.retry_review'),
      proposes,
      says('dice cuántos se reintentan (3)', /\b3\b|\btres\b/),
      says('dice aparte que lo terminal y lo incierto no entran', /(terminal|no existe|casilla|invalid|rebot|no entra|fuera)/, /(conciliar|incierto|no se confirm|sin confirm|no (esta|estan) confirmad|no se sabe si sali)/),
      avoids('no promete que salen hoy ni ya', /(salen hoy|salen ahora|se envian ahora|ya salieron|quedan enviados)/),
      onlyKnownFigures([1, 2, 3, 5])] },
  { id: 'reintento-nada-que-reintentar', title: 'No hay nada que reintentar', request: '¿Puedes reintentar los envíos fallidos de «Prospección transporte»?',
    origin: 'Solo hay envíos terminales y uno incierto: Cowork no propone un reintento vacío ni a ciegas, dice por qué y qué sigue.',
    campaignRetry: true, world: world(NOTHING),
    checks: [...CORPUS_COMMON_CHECKS,
      reads('lee la revisión de reintentos', 'campaigns.retry_review'),
      noProposal,
      saysAny('dice que no hay nada que se pueda reintentar', /(no hay|ninguno|nada)[^.]{0,60}(reintent)/, /(reintent)[^.]{0,60}(ninguno|nada)/),
      says('explica que uno es incierto y hay que conciliarlo en Contactados', /(conciliar|incierto|no se confirm|sin confirm|no (esta|estan) confirmad|no se sabe si sali)/, /contactados/),
      onlyKnownFigures([0, 1, 2])] },
  { id: 'reintento-sin-flag', title: 'Reintentar sin que el reintento esté disponible', request: 'Reintenta los envíos que fallaron de la campaña «Prospección transporte»',
    origin: 'Con el flag apagado (como está hoy) Cowork lee y explica, pero no propone: dice que el reintento se hace desde la campaña y que lo incierto no se reintenta a ciegas.',
    world: world(FAILED),
    checks: [...CORPUS_COMMON_CHECKS,
      reads('lee la revisión de reintentos', 'campaigns.retry_review'),
      noProposal,
      says('dice cuántos se pueden reintentar (3) y cuántos no', /\b3\b|\btres\b/, /(terminal|conciliar|incierto|sin confirm|no (esta|estan) confirmad|no se sabe si sali|no se pueden?|rebot)/),
      avoids('no promete que ya los reintentó', /(ya (los )?reintent|dej[eé] .*en la cola)/),
      onlyKnownFigures([1, 2, 3, 5])] },
];
