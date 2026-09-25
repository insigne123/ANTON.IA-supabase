import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { CORPUS, LEAD } from './fixtures/cowork-conversation-corpus';
import { runCorpusCase, scoreCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const read = (action: string, query: string | null = null, extra: Record<string, unknown> = {}) =>
  coworkDecisionSchema.parse({ action, query, leadId: null, answer: null, ...extra });
const parallel = (reads: Array<{ action: string; input: string }>) =>
  coworkDecisionSchema.parse({ action: 'reads.parallel', query: null, leadId: null, answer: null, reads });
const answer = (reply: string, document: { title: string; content: string } | null = null) =>
  coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null, answer: { reply, document } });

/** What a good turn looks like for each case, played through the real loop. */
const IDEAL: Record<string, CorpusDecider> = {
  'pendientes-vacio': async context => context.observations.length === 0
    ? parallel([{ action: 'contacted.search', input: '' }, { action: 'replies.attention', input: '' }, { action: 'campaigns.inbox', input: '' }])
    : answer('Hoy no tienes respuestas ni seguimientos pendientes en ANTON.IA.\nPara avanzar:\n- Hay 2 incidencias abiertas del equipo.\n- 3 de tus 4 contactos recientes no tienen correo.\n¿Reviso las incidencias primero?'),
  'recomendacion-hoy': async context => context.observations.length === 0
    ? parallel([{ action: 'app.context', input: '' }, { action: 'exceptions.list', input: '' }])
    : answer('Con 0 envíos este mes, lo que más mueve la aguja hoy es activar contactos.\n- Tienes 256 contactos guardados y 19 campañas, ninguna con envíos.\n- Hay 2 incidencias abiertas (una es la sincronización de Outlook).\n¿Busco el correo de tus 3 contactos más recientes para armar la primera campaña?'),
  'metricas-semana': async context => context.observations.length === 0
    ? parallel([{ action: 'metrics.rates', input: '' }])
    : answer('Esta semana no enviaste correos desde ANTON.IA: 0 envíos, 0 respuestas y 0 rebotes, igual que en los últimos 30 días.\n¿Armamos una campaña corta con tus contactos de Adecco para empezar a medir?'),
  'ultimos-guardados': async context => context.observations.length === 0
    ? read('leads.search', '')
    : answer('Tus últimos 4 contactos guardados:\n- Carlos Ah***a · Operations Manager · Minera Centinela\n- Nehal Pa***a · Recruitment Manager · Adecco\n- Jose Ca***o · Reclutador Junior · GrupoExpro (con correo)\n- Katherine Sa***o · Consultor de Selección · Adecco\nSolo Jose tiene correo. ¿Busco el correo de los otros tres?'),
  'vale-la-pena': async context => context.observations.length === 0
    ? read('leads.search', 'Nehal Adecco')
    : coworkDecisionSchema.parse({ action: 'lead.enrich', query: null, leadId: LEAD.nehal, answer: { reply: 'Sí vale la pena: como Recruitment Manager en Adecco revisa antecedentes de postulantes, justo lo que automatiza AXIS. Le falta el correo, así que propongo buscarlo (1 crédito).', document: null } }),
  dominio: async context => context.observations.length === 0
    ? read('profile.get')
    : context.observations.length === 1 ? read('deliverability.check', 'yago.cl')
      : answer('Revisé yago.cl (el dominio de tu correo): está bien encaminado, con dos ajustes pendientes.\n- MX y DKIM: correctos.\n- SPF: termina en ~all; conviene cerrarlo cuando confirmes que solo Google envía por ti.\n- DMARC: está en modo solo monitoreo; el siguiente paso es cuarentena.\n¿Te preparo el texto exacto de los registros para tu proveedor de DNS?'),
  'prospeccion-mineria': async () => coworkDecisionSchema.parse({ action: 'prospecting.propose_search', query: null, leadId: null,
    searchCriteria: { titles: ['Gerente de Operaciones', 'Operations Manager', 'Superintendente de Operaciones', 'Jefe de Operaciones'], industries: ['minería', 'mining'], locations: ['Antofagasta, Chile'], limit: 25 },
    answer: { reply: 'Busco hasta 25 personas en Antofagasta con cargos de operaciones en minería, incluidos superintendentes y jefes de área. Revisa los criterios y apruébalos.', document: null } }),
  'reintento-enriquecer': async context => context.observations.length === 0
    ? read('research.get_existing', null, { leadId: LEAD.carlos })
    : coworkDecisionSchema.parse({ action: 'research.start', query: null, leadId: LEAD.carlos, answer: { reply: 'El correo no apareció, así que lo investigo igual con su cargo y su empresa. Cuando esté lista (unos minutos) te preparo el correo.', document: null } }),
  'informe-jefe': async context => context.observations.length === 0
    ? parallel([{ action: 'metrics.rates', input: '' }, { action: 'leads.search', input: '' }, { action: 'campaigns.list', input: '' }])
    : answer('Te dejé el informe de septiembre listo para enviar: hubo preparación (contactos y una campaña en borrador) pero aún ningún envío.\n¿Activamos la campaña de prueba esta semana para tener resultados que mostrar?',
      { title: 'Prospección · septiembre 2026', content: 'Resumen: en septiembre preparamos la base y una campaña, pero todavía no hubo envíos.\n\n## Actividad\n- 4 contactos guardados (Adecco, GrupoExpro, Minera Centinela).\n- 1 campaña de prueba en borrador.\n\n## Resultados\n- 0 envíos en los últimos 30 días; sin envíos no hay tasas.\n\n## Próximos pasos\n- Activar la primera campaña esta semana (meta: 20 envíos al 2 oct).\n\nDatos de ANTON.IA, últimos 30 días.' }),
  'campana-no-guardado': async context => {
    if (context.observations.length === 0 && !context.rejectedDecisions) return read('campaigns.list');
    if (!context.rejectedDecisions) {
      return coworkDecisionSchema.parse({ action: 'campaign.create', query: null, leadId: null, answer: { reply: 'Propongo crear la campaña pausada con los 3 correos.', document: null },
        campaign: { name: 'Prueba AXIS', objective: 'Probar la secuencia', criteria: {}, emails: ['nicogun123@gmail.com'], provider: 'google',
          messages: [{ subject: 'Revisión de antecedentes', body: 'Hola,\nTe escribo por AXIS.', delayDays: 0 }] } });
    }
    return answer('No pude crear la campaña: nicogun123@gmail.com no está guardado como contacto, y las campañas solo pueden ir a contactos guardados.\n¿Lo guardas en Leads y la creo apenas esté?');
  },
  'agendar-reunion': async context => context.observations.length === 0
    ? read('leads.search', 'Carlos Minera Centinela')
    : answer('No puedo agendar reuniones desde Cowork. Lo más cercano: te redacto la invitación para el martes 29 a las 10:00, pero Carlos aún no tiene correo.\n¿Te preparo el mensaje para enviarlo por LinkedIn?'),
  'linkedin-seguimiento': async context => context.observations.length === 0
    ? read('linkedin.followups')
    : answer('Todavía no veo tus conversaciones de LinkedIn: falta sincronizarlas con la extensión de ANTON.IA (abre LinkedIn con la extensión y usa «Sincronizar historial de LinkedIn»).\n¿Mientras tanto reviso tus contactos guardados con perfil para invitarlos?'),
  'vender-mas': async context => context.observations.length === 0
    ? parallel([{ action: 'app.context', input: '' }, { action: 'audience.analyze', input: '' }])
    : answer('Parte por los reclutadores: 118 de tus 256 contactos son de RR. HH. y outsourcing, el público natural de AXIS, y a ninguno le has escrito.\nSolo 21 tienen correo, así que el primer paso es completar correos.\n¿Busco el correo de los 5 más relevantes?'),
  'ley-chile': async context => context.observations.length === 0
    ? read('compliance.law')
    : answer('En Chile no conviene escribir sin una base legal: la Ley 19.628 exige consentimiento o autorización, aunque admite datos de fuentes públicas y da derecho a oponerse a la publicidad. Desde el 1 dic 2026 rige la Ley 21.719, más estricta. Esto es información general, no asesoría legal.\n¿Reviso si tus contactos tienen bajas o bloqueos antes de tu próxima campaña?'),
};

test('every corpus case has an ideal turn that passes all its checks through the real loop', async () => {
  assert.deepEqual(Object.keys(IDEAL).sort(), CORPUS.map(entry => entry.id).sort());
  for (const entry of CORPUS) {
    const outcome = await runCorpusCase(entry, IDEAL[entry.id]);
    const failing = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.deepEqual(failing, [], `${entry.id}: ${failing.join(', ')} · ${outcome.result.failed || outcome.result.reply}`);
  }
});

test('the production baseline answers fail the checks the corpus was written for', () => {
  const baseline = (id: string, result: Partial<Parameters<typeof scoreCorpusCase>[1]>) => scoreCorpusCase(CORPUS.find(entry => entry.id === id)!,
    { actions: [], reply: '', document: null, proposal: null, search: null, note: null, failed: null, ...result });
  const failing = (outcome: ReturnType<typeof scoreCorpusCase>) => outcome.checks.filter(check => !check.passed).map(check => check.label);
  assert.ok(failing(baseline('dominio', { reply: 'Pásame el dominio desnudo (por ejemplo, ejemplo.cl) y revisaré sus registros MX, SPF, DKIM y DMARC.' }))
    .includes('revisa el dominio sin preguntarlo'));
  assert.ok(failing(baseline('pendientes-vacio', { actions: ['contacted.search', 'replies.attention'],
    reply: '¡Hola! En los registros de la app no aparecen contactos ni respuestas pendientes. Pero la cobertura de Gmail y Outlook no está verificada.' }))
    .includes('sin jerga, códigos, IDs ni horas UTC'));
  assert.ok(failing(baseline('reintento-enriquecer', { proposal: { kind: 'enrich_contact', label: 'Enriquecer contacto Carlos Ah***a (Minera Centinela)' } }))
    .includes('no vuelve a proponer buscar el correo'));
  assert.ok(failing(baseline('campana-no-guardado', { failed: 'No se pudo completar la respuesta. Tu solicitud sigue guardada.' })).includes('termina sin fallar'));
  assert.ok(failing(baseline('informe-jefe', { actions: ['metrics.overview', 'metrics.rates', 'metrics.diagnose'], reply: 'Preparé un informe.',
    document: { title: 'Informe de prospección — últimos 30 días', content: '**Alcance:** período *last_30_days*.\n## Interpretación\nNo calculables.' } }))
    .includes('usa actividad además de métricas'));
});
