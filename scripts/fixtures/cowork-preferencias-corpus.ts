// Remembering preferences with a card (Plan 12, 5; COWORK_PREFERENCES_ENABLED): what the person asks Cowork to keep for the next
// turns becomes a «memory_save» card; a one-off instruction, or one already remembered, does not. Made up on the corpus world.
import { CORPUS_COMMON_CHECKS, CORPUS_USER_CONTEXT, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shown = (result: CorpusTurnResult) => normalize(`${corpusShown(result)}\n${(result.suggestions || []).map(chip => `${chip.label} ${chip.message}`).join('\n')}`);
const preference = (result: CorpusTurnResult) => (result.proposal?.kind === 'memory_save' ? result.proposal.preference : undefined);
const remembers = (label: string, scope: 'personal' | 'organization', ...patterns: RegExp[]) => [
  { label: 'propone recordarlo con una tarjeta', test: (result: CorpusTurnResult) => Boolean(preference(result)) },
  { label, test: (result: CorpusTurnResult) => patterns.every(pattern => pattern.test(normalize(preference(result)?.text || ''))) },
  { label: scope === 'personal' ? 'solo para la persona' : 'para todo el equipo', test: (result: CorpusTurnResult) => preference(result)?.scope === scope },
  { label: 'no busca ni lee otra cosa antes', test: (result: CorpusTurnResult) => !result.search && (result.reads || []).length <= 1 },
];
const noPreference = { label: 'no propone recordar nada', test: (result: CorpusTurnResult) => result.proposal?.kind !== 'memory_save' };

export const PREFERENCIAS_CORPUS: CorpusCase[] = [
  { id: 'pref-no-escribir', title: 'Recordar a quién no escribirle', preferences: true,
    request: 'recuerda que nunca le escribo a empresas de seguridad privada, son competencia',
    origin: 'Plan 12, 5: «recuerda que no le escribo a…» es una preferencia para los próximos trabajos.',
    checks: [...CORPUS_COMMON_CHECKS, ...remembers('la preferencia nombra a las empresas de seguridad privada', 'personal', /seguridad privada/)] },
  { id: 'pref-tono-equipo', title: 'Una preferencia para todo el equipo', preferences: true,
    request: 'de ahora en adelante, en todo el equipo le escribimos a los prospectos con tono cercano y los tuteamos',
    origin: 'Plan 12, 5: lo que vale para el equipo se recuerda para la organización.',
    checks: [...CORPUS_COMMON_CHECKS, ...remembers('la preferencia dice el tono y que se tutea', 'organization', /cercan/, /(tute|de tu\b|tratar\w* de tu)/)] },
  { id: 'pref-con-tarea', title: 'Una tarea y una preferencia en el mismo mensaje', preferences: true,
    request: 'escríbeme un correo corto para invitar a una reunión a los gerentes de personas de retail, y recuerda que siempre firmo como Nico',
    origin: 'Plan 12, 5: con otra tarea en el mismo pedido, hace la tarea y deja la preferencia como siguiente paso.',
    checks: [...CORPUS_COMMON_CHECKS, noPreference,
      { label: 'entrega el correo', test: result => (result.blocks || []).some(block => block.type === 'email_draft' || block.type === 'sequence') },
      { label: 'firma como Nico', test: result => /\bnico\b/.test(shown(result)) },
      { label: 'deja recordar la firma como siguiente paso', test: result => /(recuerd|record|guard)/.test(normalize((result.suggestions || []).map(chip => `${chip.label} ${chip.message}`).join(' '))) }] },
  { id: 'pref-ya-recordada', title: 'Algo que ya recuerda', preferences: true,
    request: 'recuerda que no le escribo a empresas de seguridad privada',
    origin: 'Plan 12, 5: lo que ya está en memories no se propone de nuevo.',
    world: { read: corpusRead, savedEmails: [], userContext: { ...CORPUS_USER_CONTEXT, memories: ['No le escribo a empresas de seguridad privada'] } },
    // Only asked to keep what is already kept: the answer is complete without a next step. The judge marked «mala» an answer that
    // asked the person to decide something they did not ask about, so the common next-step and quick-reply checks do not apply.
    checks: [...CORPUS_COMMON_CHECKS.filter(check => !['cierra con un siguiente paso o una propuesta', 'ofrece respuestas sugeridas u opciones para seguir'].includes(check.label)), noPreference,
      { label: 'dice que ya lo tiene presente', test: result => /(ya (lo )?(tengo|recuerdo|tenia|estaba|esta)|ya (lo )?tengo presente|ya lo recuerdo|ya esta guardad)/.test(shown(result)) }] },
  { id: 'pref-solo-esta-vez', title: 'Una instrucción de una sola vez', preferences: true,
    request: 'esta vez escríbele en tono formal a los gerentes de finanzas de minería: una invitación corta a conversar',
    origin: 'Plan 12, 5: «esta vez» no es una preferencia: no se propone recordarla.',
    checks: [...CORPUS_COMMON_CHECKS, noPreference,
      // Writing to people who are not saved yet may start by finding them: either is doing the task.
      { label: 'entrega el correo o propone encontrarlos', test: result => Boolean(result.search)
        || (result.blocks || []).some(block => block.type === 'email_draft' || block.type === 'sequence') }] },
];
