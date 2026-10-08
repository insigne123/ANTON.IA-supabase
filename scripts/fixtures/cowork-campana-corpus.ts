// Cases for a sequence asked together with its campaign (Plan 12, 4a-2): with the Writer on, the turn writes the emails and
// proposes the campaign with that exact text, instead of closing with «¿Creo la campaña?». A plain email stays an email.
// They run on the production fixture world of the corpus, where Jose (GrupoExpro) is the saved contact with an email.
import { CORPUS_COMMON_CHECKS, CORPUS_SAVED_EMAILS, CORPUS_USER_CONTEXT, corpusRead, type CorpusCase, type CorpusTurnResult, type CorpusWorld } from './cowork-conversation-corpus';

type Campaign = { emails?: string[]; messages?: Array<{ subject: string; body: string }> };
const campaignOf = (result: CorpusTurnResult) => (result.proposal?.kind === 'campaign_create' ? result.proposal.campaign as Campaign : null);
/** The campaign carries what the Writer wrote, word for word. */
const writersText = (result: CorpusTurnResult) => {
  const campaign = campaignOf(result);
  return Boolean(campaign?.messages?.length) && Boolean(result.writer);
};

/** As in production for a person with Gmail connected: the worker puts the sender they chose in Conexiones in the context. */
const world: CorpusWorld = { read: corpusRead, savedEmails: CORPUS_SAVED_EMAILS, userContext: { ...CORPUS_USER_CONTEXT, sender: 'Gmail' } };

export const CAMPANA_CORPUS: CorpusCase[] = [
  { id: 'cmp-secuencia-y-campana', title: 'Secuencia y campaña en un pedido', world,
    request: 'escríbele una secuencia de 3 correos a Jose de GrupoExpro presentando AXIS y créala como campaña',
    origin: 'Plan 12, 4a-2: el turno con Redactora terminaba en «¿Creo la campaña pausada?» aunque el usuario ya la había pedido.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'propone la campaña en el mismo turno', test: r => Boolean(campaignOf(r)) },
      { label: 'la campaña lleva los 3 correos', test: r => campaignOf(r)?.messages?.length === 3 },
      { label: 'va a Jose', test: r => (campaignOf(r)?.emails || []).includes('jcastro@grupoexpro.com') },
      { label: 'el texto es el de la Redactora', test: writersText }] },
  { id: 'cmp-correo-y-campana', title: 'Un correo para mis contactos y su campaña', world,
    request: 'escribe un correo corto para mis contactos que tienen correo ofreciendo una demo de AXIS y arma la campaña pausada',
    origin: 'Plan 12, 4a-2.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'propone la campaña en el mismo turno', test: r => Boolean(campaignOf(r)) },
      { label: 'solo a contactos guardados con correo', test: r => (campaignOf(r)?.emails || []).every(email => CORPUS_SAVED_EMAILS.includes(email)) },
      // Plan 15: «con correo» lists the 21 of the account, not the one with an email among the 20 most recent.
      { label: 'va a sus contactos con correo, no solo a uno', test: r => (campaignOf(r)?.emails || []).length >= 20 }] },
  { id: 'cmp-solo-correo', title: 'Solo un correo (control)', world, request: 'escríbele un correo a Jose de GrupoExpro presentando AXIS',
    origin: 'Plan 12, 4a-2: sin campaña pedida, el correo es la respuesta y la campaña se ofrece, no se propone.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega el correo', test: r => (r.blocks || []).some(block => block.type === 'email_draft' || block.type === 'sequence') || Boolean(r.writer) },
      { label: 'no propone una campaña que no pidió', test: r => r.proposal?.kind !== 'campaign_create' }] },
];
