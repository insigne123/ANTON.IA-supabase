// «Otra versión» that knows what did not work, and the 👎 that shapes the next answer (Plan 13). Each case is a turn the person
// asked again (or continued) after an answer they did not like, on the production world of the corpus. With
// COWORK_EVAL_VERSIONS=off the same cases run without the earlier versions and the feedback, as Cowork did before.
import { CORPUS_COMMON_CHECKS, corpusRead, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const at = '2026-09-25T13:00:00Z';
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const emailBodies = (result: CorpusTurnResult) => (result.blocks || []).flatMap(block => block.type === 'email_draft' ? [String((block as { body?: unknown }).body || '')] : []);
const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const LONG_EMAIL = 'Te dejo el correo para Jose:\n\n**Asunto:** AXIS: la revisión de antecedentes que GrupoExpro necesita para crecer\n\n'
  + 'Hola Jose, espero que estés muy bien. Te escribo porque en Yago desarrollamos AXIS, una plataforma que automatiza la revisión de antecedentes '
  + 'judiciales y penales de los postulantes consultando el PJUD por persona o por lote. Sabemos que en GrupoExpro reclutan para varios clientes a la vez '
  + 'y que cada proceso exige revisar a muchas personas en poco tiempo, con trazabilidad para el cliente final. AXIS consolida los resultados, deja la '
  + 'evidencia lista para auditoría y reduce horas de trabajo manual de tu equipo. Además se integra con tus planillas, permite cargar listas completas, '
  + 'entrega reportes por proceso y ayuda a cumplir la normativa de datos personales. Muchas consultoras ya lo usan para ganar velocidad y diferenciarse. '
  + 'Me encantaría mostrarte una demo de 30 minutos esta semana o la próxima para ver si calza con lo que necesitan en GrupoExpro, y también conversar '
  + 'sobre cómo lo podrían ofrecer a sus clientes como valor agregado.\n\nQuedo atento,\nNicolás';

const GENERIC_SUBJECTS = 'Tres asuntos que puedes probar:\n\n1. «Una solución para tu equipo»\n2. «¿Conversamos?»\n3. «Mejora tus procesos»';

export const VERSION_CORPUS: CorpusCase[] = [
  { id: 'ver-mas-corto', title: 'Otra versión tras «Demasiado largo»', request: 'escríbele un correo a Jose de GrupoExpro presentándole AXIS',
    previousVersions: [{ reply: LONG_EMAIL, feedback: { rating: 'down', reason: 'Demasiado largo', comment: null } }],
    origin: 'Plan 13: «Otra versión» después de un 👎 con motivo.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega el correo', test: r => emailBodies(r).length > 0 || /asunto/i.test(r.reply) },
      { label: 'el correo nuevo tiene menos de 110 palabras', test: r => { const body = emailBodies(r)[0] || r.reply; return words(body) < 110; } },
      { label: 'no repite el asunto anterior', test: r => !normalize(JSON.stringify(r.blocks || []) + r.reply).includes('la revision de antecedentes que grupoexpro necesita') }] },
  { id: 'ver-asuntos', title: 'Otra versión tras «Poco útil: muy genéricos»', request: 'dame ideas de asunto para escribirle a gerentes de RR. HH.',
    previousVersions: [{ reply: GENERIC_SUBJECTS, feedback: { rating: 'down', reason: 'Poco útil', comment: 'muy genéricos' } }],
    origin: 'Plan 13: el comentario del 👎 dice qué corregir.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'no repite los asuntos genéricos', test: r => !/una solucion para tu equipo|¿conversamos\?|mejora tus procesos/.test(normalize(r.reply)) },
      { label: 'los asuntos son concretos (antecedentes, PJUD, contratación o volumen)', test: r => /antecedente|pjud|contrata|masiv|volumen|postulante|reclut/.test(normalize(r.reply)) },
      { label: 'no propone acciones', test: r => !r.proposal && !r.search }] },
  { id: 'ver-hilo-breve', title: 'El 👎 «Demasiado largo» del turno anterior acorta el siguiente', request: '¿y cuántos de esos tienen correo?',
    history: [{ request: '¿cuántos contactos tengo?', at,
      reply: 'Tienes 256 contactos guardados en ANTON.IA. Revisé tu base completa y los agrupé por sector para que veas dónde tienes más volumen: '
        + 'la mayoría está en Servicios de RR. HH. y outsourcing (118), luego Minería y proveedores (41) y Retail (37); el resto se reparte en sectores '
        + 'más pequeños. Esto importa porque AXIS calza mejor con empresas que contratan en volumen, así que el grupo de RR. HH. es tu mejor punto de '
        + 'partida. También revisé cuántos ya contactaste: todavía ninguno, así que tienes espacio para empezar sin repetir personas. Te propongo '
        + 'priorizar a quienes tienen correo y cargo de decisión, armar una primera tanda de 20 y medir respuestas antes de escalar. ¿Quieres que lo prepare?',
      feedback: { rating: 'down', reason: 'Demasiado largo', comment: null },
      observations: [{ action: 'audience.analyze', input: '', result: corpusRead('audience.analyze', '') }] }],
    origin: 'Plan 13: la opinión de un turno anterior da forma al siguiente.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'da la cifra (21)', test: r => /\b21\b/.test(r.reply) },
      { label: 'responde breve (menos de 350 caracteres)', test: r => r.reply.length < 350 }] },
];
