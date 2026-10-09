import { CORPUS_COMMON_CHECKS, CORPUS_USER_CONTEXT, CORPUS_NOW, corpusRead, corpusShown, type CorpusCase, type CorpusWorld } from './cowork-conversation-corpus';
import { coworkMetricQuery, coworkMetricSpan } from '../../src/lib/cowork/metric-period';
const id = (i: number) => `00000000-0000-4000-8000-${String(700 + i).padStart(12, '0')}`;
const people = [
  { id: id(1), name: 'Ana Demo', title: 'Gerente de Operaciones', company: 'Hotel Demo', email: 'ana@example.test' },
  { id: id(2), name: 'Javier Demo', title: 'Jefe de Personas', company: 'Retail Demo', email: 'javier@example.test' },
  { id: id(3), name: 'Mateo Demo', title: 'Dueño', company: 'Restaurante Demo', email: 'mateo@example.test' },
];
const world: CorpusWorld = { userContext: { ...CORPUS_USER_CONTEXT, fullName: 'María Demo', companyName: 'Equipo de demostración' }, savedEmails: people.map(person => person.email),
  read: (action, input) => {
    if (action === 'leads.search') return { scope: 'own_saved_contacts', items: people.filter(person => !input || /correo|contacto|persona/i.test(input)
      || input.toLowerCase().split(/\s+/).filter(word => !['de','del','la','el'].includes(word)).every(word => `${person.name} ${person.title} ${person.company}`.toLowerCase().includes(word))), truncated: false };
    if (action === 'leads.get') return { scope: 'own_saved_contacts', items: people.filter(person => person.id === input) };
    if (action === 'metrics.rates' && input.trim().startsWith('{')) {
      const requested = coworkMetricQuery(input)!;
      return { scope: requested.scope === 'own' ? 'own_metrics' : 'organization_metrics', period: coworkMetricSpan(requested, CORPUS_NOW),
        counts: { sentHistoryRows: requested.scope === 'own' ? 4 : 12, repliesReceived: requested.scope === 'own' ? 2 : 5, positiveRepliesReceived: 1 },
        rates: { reply: { numerator: requested.scope === 'own' ? 1 : 3, denominator: requested.scope === 'own' ? 4 : 12, value: 0.25,
          unit: 'per_sent_history_row_in_period', source: 'contacted_leads' } }, completeness: 'exact_counts_not_preview_rows' };
    }
    if (action === 'message.context') return { configured: false, context: null };
    if (action === 'contacted.search') return { scope: 'organization_contacted', items: [], coverage: null };
    return corpusRead(action, input);
  } };
const brief = 'Caso ficticio de demostración: para este encargo ofrece cubrir reemplazos de personal por turno. Es un servicio distinto de AXIS: no ofrezcas software ni consultas judiciales. Prueba autorizada para este encargo: en un piloto de dos semanas cubrimos 9 de 10 turnos solicitados; conserva la condición de piloto y no lo presentes como garantía.';
export const INTEGRAL_CORPUS: CorpusCase[] = [
  { id: 'integral-revision-analista', title: 'Revisión especializada explícita', world,
    request: 'Compara mis números de este mes calendario con los del equipo. Lee ambas cifras exactas con metrics.rates y pide al especialista analyst que revise si sus tasas usan una base comparable; después dame la conclusión. No redactes correos ni prepares acciones.',
    checks: [...CORPUS_COMMON_CHECKS, { label: 'ambos alcances fueron observados', test: result => (result.reads || []).filter(read => read.action === 'metrics.rates').length >= 2 },
      { label: 'la revisión especializada se ejecutó', test: result => result.actions.includes('specialists.review') }] },
  { id: 'integral-cambio-oferta', title: 'Oferta explícita distinta del perfil', world,
    request: `${brief} Redacta un primer correo para Ana de Hotel Demo y firma como María Demo.`,
    checks: [...CORPUS_COMMON_CHECKS, { label: 'ofrece reemplazos, no el software anterior', test: result => /reemplaz/i.test(corpusShown(result)) && !/PJUD|automatiza.*consulta/i.test(corpusShown(result)) },
      { label: 'conserva condiciones del piloto', test: result => /piloto/i.test(corpusShown(result)) && /9|nueve/i.test(corpusShown(result)) }] },
  { id: 'integral-tres-roles', title: 'Tres correos específicos por rol', world,
    request: `${brief} Prepara tres correos distintos para Ana de Hotel Demo, Javier de Retail Demo y Mateo de Restaurante Demo, uno por persona. No crees ninguna campaña.`,
    checks: [...CORPUS_COMMON_CHECKS, { label: 'entrega tres borradores individuales', test: result => result.blocks?.filter(block => block.type === 'email_draft').length === 3 },
      { label: 'no traslada el producto anterior', test: result => !/PJUD|1[.,]000 personas/i.test(corpusShown(result)) }] },
  { id: 'integral-edicion-local', title: 'Edición preserva relación y prueba', world,
    request: 'Acorta solo la apertura del siguiente correo y conserva la prueba, las condiciones y la pregunta exacta; no prepares una campaña. "Hola Ana,\n\nRetomo lo que conversamos la semana pasada sobre cubrir los turnos de tu hotel con reemplazos. En un piloto de dos semanas cubrimos 9 de 10 turnos solicitados.\n\n¿Te envío el alcance por correo?\n\nMaría Demo"',
    checks: [...CORPUS_COMMON_CHECKS.filter(check => !/respuestas sugeridas/.test(check.label)), { label: 'preserva prueba y CTA exacto', test: result => /9 de 10/.test(corpusShown(result)) && /¿Te envío el alcance por correo\?/.test(corpusShown(result)) },
      { label: 'no fuerza una campaña', test: result => !result.proposal && !/campaña/i.test(result.question || '') }] },
  { id: 'integral-mes-propio', title: 'Mes calendario propio', world,
    request: 'Dame mis números de este mes calendario, no los del equipo ni los últimos 30 días. Explica la base de la tasa de respuesta.',
    checks: [...CORPUS_COMMON_CHECKS, { label: 'consulta período y alcance propios explícitos', test: result => (result.reads || []).some(read => read.action === 'metrics.rates' && /calendar_month/.test(read.input) && /own/.test(read.input)) },
      { label: 'cita el conteo personal correcto', test: result => /4/.test(corpusShown(result)) && !/12 envíos/.test(corpusShown(result)) }] },
  { id: 'integral-semana-equipo', title: 'Semana calendario del equipo', world,
    request: '¿Cuántos envíos lleva el equipo esta semana desde el lunes? Usa las cifras contadas por la app, no una muestra.',
    checks: [...CORPUS_COMMON_CHECKS, { label: 'consulta la semana calendario del equipo', test: result => (result.reads || []).some(read => read.action === 'metrics.rates' && /calendar_week/.test(read.input) && /organization/.test(read.input)) },
      { label: 'cita doce envíos', test: result => /12/.test(corpusShown(result)) }] },
];
