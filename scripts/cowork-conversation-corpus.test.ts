import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { CORPUS, LEAD } from './fixtures/cowork-conversation-corpus';
import { MARKETING_CORPUS, MARKETING_LEAD, STARTER_CORPUS } from './fixtures/cowork-marketing-corpus';
import { runCorpusCase, scoreCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const read = (action: string, query: string | null = null, extra: Record<string, unknown> = {}) =>
  coworkDecisionSchema.parse({ action, query, leadId: null, answer: null, ...extra });
const parallel = (reads: Array<{ action: string; input: string }>) =>
  coworkDecisionSchema.parse({ action: 'reads.parallel', query: null, leadId: null, answer: null, reads });
const answer = (reply: string, document: { title: string; content: string } | null = null,
  suggestions: Array<{ label: string; message: string }> = [{ label: 'Sí, adelante', message: 'Sí, adelante con lo que propones' }],
  extra: { blocks?: unknown[]; question?: string } = {}) =>
  coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null, answer: { reply, document, suggestions, ...extra } });

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
    : answer('Esta semana no enviaste correos desde ANTON.IA, igual que en los últimos 30 días: sin envíos no hay tasas que comparar.', null, undefined, {
      question: '¿Armamos una campaña corta con tus contactos de Adecco para empezar a medir?',
      blocks: [{ type: 'metrics', title: 'Correos de la semana', period: 'Últimos 7 días', items: [
        { label: 'Envíos', value: '0', detail: null }, { label: 'Respuestas', value: '0', detail: null }, { label: 'Rebotes', value: '0', detail: null }] }] }),
  'ultimos-guardados': async context => context.observations.length === 0
    ? read('leads.search', '')
    : answer('Tus últimos 4 contactos guardados:\n- Carlos Ah***a · Operations Manager · Minera Centinela\n- Nehal Pa***a · Recruitment Manager · Adecco\n- Jose Ca***o · Reclutador Junior · GrupoExpro (con correo)\n- Katherine Sa***o · Consultor de Selección · Adecco\nSolo Jose tiene correo. ¿Busco el correo de los otros tres?'),
  'vale-la-pena': async context => context.observations.length === 0
    ? read('leads.search', 'Nehal Adecco')
    : coworkDecisionSchema.parse({ action: 'lead.enrich', query: null, leadId: LEAD.nehal, answer: { reply: 'Sí vale la pena: como Recruitment Manager en Adecco revisa antecedentes de postulantes, justo lo que automatiza AXIS. Le falta el correo, así que propongo buscarlo (1 crédito).', document: null } }),
  dominio: async context => context.observations.length === 0
    ? read('deliverability.check', context.userContext?.companyDomain || '')
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

const chip = (label: string, message: string) => [{ label, message }];
const seen = (context: Parameters<CorpusDecider>[0], action: string) => context.observations.some(item => (item as { action?: string }).action === action);

/** Marketing cases: what a good first turn does for a new user (email and LinkedIn). */
Object.assign(IDEAL, {
  'mkt-que-puedes-hacer': async context => context.observations.length === 0
    ? parallel([{ action: 'app.context', input: '' }, { action: 'leads.search', input: '' }])
    : answer('Te ayudo a conseguir reuniones con tus contactos, sin salir del chat:\n- Correos y campañas: redacto la secuencia y la dejo lista para aprobar. Tus 5 contactos guardados son el punto de partida; 4 tienen correo.\n- LinkedIn: invitaciones y mensajes que envía tu extensión.\n- Prospectos nuevos, informes y revisión de tu dominio.\n¿Te preparo un primer correo para Marcela, Felipe y Camila, tus contactos de RR. HH. con correo?',
      null, chip('Sí, prepara el correo', 'Sí, prepara un primer correo sobre AXIS para Marcela, Felipe y Camila')),
  'mkt-campana-rrhh': async context => {
    if (context.observations.length === 0) return parallel([{ action: 'leads.search', input: 'RR. HH.' }, { action: 'message.context', input: '' }]);
    if (!seen(context, 'campaigns.list')) return read('campaigns.list');
    return coworkDecisionSchema.parse({ action: 'campaign.create', query: null, leadId: null,
      answer: { reply: 'Tus contactos de RR. HH. con correo son 3: Marcela (Sodexo), Felipe (Securitas) y Camila (Adecco). Andrea no tiene correo y queda fuera. Te dejo la campaña pausada con un correo sobre AXIS para que la revises.', document: null },
      campaign: { name: 'AXIS · RR. HH.', objective: 'Conseguir una conversación sobre revisión de antecedentes',
        criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true },
        emails: ['mrojas@sodexo.cl', 'fmunoz@securitas.cl', 'cfuentes@adecco.cl'], provider: 'google',
        messages: [{ subject: 'Antecedentes laborales en minutos', body: 'Hola,\nEn Yago automatizamos la consulta de antecedentes laborales en el Poder Judicial con AXIS.\n¿Te sirve que lo revisemos 15 minutos esta semana?\nNicolás Y.\nYago SpA', delayDays: 0 }] } });
  },
  'mkt-secuencia': async context => context.observations.length === 0
    ? read('message.context')
    : answer('Te dejé la secuencia de 3 correos en tono cercano, firmada con tu nombre y sin ofertas que no estén aprobadas.', null,
      chip('Sí, crea la campaña', 'Sí, crea una campaña pausada con esta secuencia para mis contactos de RR. HH. con correo'), {
        question: '¿La convierto en una campaña pausada para tus contactos de RR. HH. con correo?',
        blocks: [{ type: 'sequence', title: 'Secuencia AXIS para gerentes de personas', steps: [
          { day: 1, subject: 'Antecedentes laborales en minutos', body: 'Hola,\nEn Yago automatizamos la consulta de antecedentes en el Poder Judicial.\n¿Lo vemos 15 minutos?\nNicolás Y.' },
          { day: 4, subject: '¿Cuánto tarda hoy una revisión?', body: 'Hola,\nQuería saber cómo revisan hoy los antecedentes de los postulantes.\nNicolás Y.' },
          { day: 8, subject: '¿Te lo muestro?', body: 'Hola,\nSi te sirve, te muestro AXIS con un caso real de tu área.\nNicolás Y.' }] }] }),
  'mkt-linkedin-mensaje': async context => context.observations.length === 0
    ? read('leads.search', 'Marcela')
    : coworkDecisionSchema.parse({ action: 'linkedin.message', query: null, leadId: MARKETING_LEAD.marcela,
      linkedinMessage: 'Hola Marcela, soy Nicolás de Yago. Ayudamos a equipos de personas a revisar antecedentes laborales en minutos con AXIS. ¿Te interesa conversarlo?',
      answer: { reply: 'Encontré a Marcela, Gerente de Personas en Sodexo. Te dejo un mensaje corto firmado con tu nombre; se envía desde tu extensión cuando lo apruebes.', document: null } }),
  'mkt-linkedin-invitar': async context => context.observations.length === 0
    ? parallel([{ action: 'leads.search', input: 'Felipe Securitas' }, { action: 'linkedin.quota', input: '' }])
    : coworkDecisionSchema.parse({ action: 'linkedin.invite', query: null, leadId: MARKETING_LEAD.felipe,
      answer: { reply: 'Felipe es Jefe de Reclutamiento en Securitas y tienes cupo esta semana (7 de 100 invitaciones usadas). Te dejo la invitación sin nota para aprobar.', document: null } }),
  'mkt-a-quien-escribo': async context => context.observations.length === 0
    ? parallel([{ action: 'leads.search', input: '' }, { action: 'contacted.search', input: '' }])
    : answer('Hoy le escribiría a Felipe (Securitas) y Camila (Adecco): tienen correo, trabajan en selección y aún no les has escrito. Marcela ya recibió tu correo hace 6 días.\n¿Te preparo el correo para los dos?',
      null, chip('Sí, prepáralo', 'Sí, prepara un correo sobre AXIS para Felipe y Camila')),
  'mkt-mejorar-correo': async () => answer('Así queda más creíble y fácil de responder. Quité «el mejor del mercado» y «80 %» porque no tenemos cómo respaldarlos.',
    null, chip('Sí, úsalo', 'Sí, usa este correo como primer mensaje de una campaña para mis contactos de RR. HH.'), {
      question: '¿Lo uso como primer correo de una campaña para tus contactos de RR. HH.?',
      blocks: [{ type: 'email_draft', title: 'Correo mejorado', to: null, subject: 'Antecedentes laborales sin trámites manuales',
        body: 'Hola,\nEn Yago ayudamos a equipos de RR. HH. a revisar antecedentes laborales de postulantes sin trámites manuales.\n¿Te sirve que lo veamos 15 minutos esta semana?\nSaludos,\nNicolás' }] }),
  'mkt-busqueda-y-campana': async () => coworkDecisionSchema.parse({ action: 'prospecting.propose_search', query: null, leadId: null,
    searchCriteria: { titles: ['Gerente de Recursos Humanos', 'Gerente de Personas', 'HR Manager', 'Head of People'], industries: ['retail'], locations: ['Santiago, Chile'], limit: 10 },
    answer: { reply: 'Primero busco 10 gerentes de RR. HH. en retail en Santiago. Cuando apruebes y veas los resultados, guardo a los que elijas, busco sus correos y armo la campaña para ellos.', document: null } }),
  'mkt-necesito-clientes': async context => context.observations.length === 0
    ? parallel([{ action: 'app.context', input: '' }, { action: 'audience.analyze', input: '' }])
    : answer('Parte por lo que ya tienes: 4 de tus 5 contactos tienen correo y 3 de ellos trabajan en RR. HH., el público de AXIS. Solo Marcela recibió un correo.\n¿Preparo una campaña corta para Felipe y Camila?',
      null, chip('Sí, prepárala', 'Sí, prepara una campaña corta sobre AXIS para Felipe y Camila')),
  'mkt-resultado-campana': async context => context.observations.length === 0
    ? parallel([{ action: 'campaigns.list', input: '' }, { action: 'contacted.search', input: '' }])
    : answer('Todavía no tienes campañas en ANTON.IA. Lo único enviado es un correo a Marcela (Sodexo) hace 6 días, sin respuesta por ahora.\n¿Armo tu primera campaña con Felipe y Camila, que ya tienen correo?',
      null, chip('Sí, ármala', 'Sí, arma mi primera campaña con Felipe y Camila')),
  'mkt-seguimiento': async context => context.observations.length === 0
    ? parallel([{ action: 'leads.search', input: 'Marcela' }, { action: 'contacted.search', input: 'Marcela' }])
    : answer('Le escribiste a Marcela el 19 sep sobre antecedentes laborales. Te dejo un seguimiento corto con otro ángulo.',
      null, chip('Sí, déjalo listo', 'Sí, deja listo el seguimiento para Marcela'), {
        question: '¿Lo dejo listo para enviar desde tu correo?',
        blocks: [{ type: 'email_draft', title: 'Seguimiento a Marcela', to: ['Marcela Rojas'], subject: '¿Cómo lo resuelven hoy?',
          body: 'Hola Marcela,\nMe quedé pensando en cómo revisan hoy los antecedentes en Sodexo. Si te sirve, te muestro en 15 minutos cómo lo hace AXIS.\nNicolás' }] }),
} satisfies Record<string, CorpusDecider>);

/** Home starters: what a good first turn looks like for each button. */
Object.assign(IDEAL, {
  'inicio-escribir': async context => context.observations.length === 0
    ? parallel([{ action: 'leads.search', input: '' }, { action: 'contacted.search', input: '' }])
    : answer('Iría a Felipe (Securitas), Rodrigo (Transportes Andes) y Camila (Adecco): tienen correo y aún no les escribes. Marcela ya recibió uno y Andrea no tiene correo.\n\nAsunto: Antecedentes laborales sin trámites manuales\nHola,\nEn Yago revisamos antecedentes laborales de postulantes en el Poder Judicial de forma automática con AXIS.\n¿Te sirve verlo 15 minutos esta semana?\nNicolás Y.\nGerente Comercial, Yago SpA\n\n¿Creo la campaña pausada con este correo para los tres?',
      null, chip('Sí, crea la campaña', 'Sí, crea la campaña pausada con este correo para Felipe, Rodrigo y Camila')),
  'inicio-a-quien': async context => context.observations.length === 0
    ? parallel([{ action: 'leads.search', input: '' }, { action: 'contacted.search', input: '' }])
    : answer('Hoy le escribiría a Felipe (Securitas), Rodrigo (Transportes Andes) y Camila (Adecco): tienen correo y aún no les escribes. A Marcela le toca un seguimiento: no responde hace 6 días.\n¿Te preparo el correo para los tres?',
      null, chip('Sí, prepáralo', 'Sí, prepara un correo sobre AXIS para Felipe, Rodrigo y Camila')),
  'inicio-linkedin': async context => context.observations.length === 0
    ? parallel([{ action: 'leads.search', input: '' }, { action: 'linkedin.quota', input: '' }])
    : coworkDecisionSchema.parse({ action: 'linkedin.invite', query: null, leadId: MARKETING_LEAD.felipe,
      answer: { reply: 'Tienes cupo esta semana (7 de 100 invitaciones). Parto por Felipe, Jefe de Reclutamiento en Securitas; después siguen Camila y Andrea. Rodrigo no tiene LinkedIn guardado.', document: null } }),
  'inicio-mejorar': async () => answer('Así queda más concreto y fácil de responder:\n\nHola,\nEn Yago ayudamos a equipos de RR. HH. a revisar antecedentes laborales de postulantes en el Poder Judicial, sin trámites manuales, con AXIS.\n¿Te sirve que lo veamos 15 minutos esta semana?\nSaludos,\nNicolás Y.\n\nCambié «ayuda mucho» por lo que hace AXIS y cerré con una pregunta simple.\n¿Lo uso como primer correo de una campaña para tus contactos de RR. HH.?',
    null, chip('Sí, úsalo', 'Sí, usa este correo como primer mensaje de una campaña para mis contactos de RR. HH.')),
  'inicio-prospectos': async () => coworkDecisionSchema.parse({ action: 'prospecting.propose_search', query: null, leadId: null,
    searchCriteria: { titles: ['Gerente de Recursos Humanos', 'Gerente de Personas', 'Jefe de Reclutamiento', 'HR Manager'], industries: [], locations: ['Chile'], limit: 10 },
    answer: { reply: 'AXIS le sirve a quien revisa antecedentes de postulantes, así que busco 10 personas de RR. HH. y reclutamiento en Chile. Revisa los criterios y apruébalos.', document: null } }),
  'inicio-como-voy': async context => context.observations.length === 0
    ? parallel([{ action: 'metrics.rates', input: '' }, { action: 'campaigns.list', input: '' }])
    : answer('Esta semana enviaste 1 correo (a Marcela, de Sodexo) y todavía no tiene respuesta. Aún no tienes campañas, así que no hay tasas que comparar.\n¿Armo tu primera campaña con Felipe, Rodrigo y Camila, que ya tienen correo?',
      null, chip('Sí, ármala', 'Sí, arma mi primera campaña con Felipe, Rodrigo y Camila')),
} satisfies Record<string, CorpusDecider>);

const ALL_CASES = [...CORPUS, ...MARKETING_CORPUS, ...STARTER_CORPUS];

test('every corpus case has an ideal turn that passes all its checks through the real loop', async () => {
  assert.deepEqual(Object.keys(IDEAL).sort(), ALL_CASES.map(entry => entry.id).sort());
  for (const entry of ALL_CASES) {
    const outcome = await runCorpusCase(entry, IDEAL[entry.id]);
    const failing = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.deepEqual(failing, [], `${entry.id}: ${failing.join(', ')} · ${outcome.result.failed || outcome.result.reply}`);
  }
});

test('the production baseline answers fail the checks the corpus was written for', () => {
  const baseline = (id: string, result: Partial<Parameters<typeof scoreCorpusCase>[1]>) => scoreCorpusCase(CORPUS.find(entry => entry.id === id)!,
    { actions: [], reply: '', document: null, proposal: null, search: null, note: null, failed: null, suggestions: [], ...result });
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
