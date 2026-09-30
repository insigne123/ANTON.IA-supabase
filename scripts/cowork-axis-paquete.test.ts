// The AXIS benchmark cases (scripts/fixtures/cowork-axis-paquete.ts) played through the real loop with a scripted model:
// what a good turn does for each of the 20 ★ operations must pass its own checks, and a turn that answers without looking
// or without saying what it cannot do must not. That is what makes a run with the real model mean something.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_CASE_IDS, AXIS_CORPUS, AXIS_LEAD, AXIS_PROFILE_ROW, axisUserContext } from './fixtures/cowork-axis-paquete';
import { degrade, draft, ideal, naive, read, vacuous, yes, type IdealDecider } from './fixtures/cowork-axis-ideal';
import { runCorpusCase } from './fixtures/cowork-conversation-runner';

const IDEAL: Record<string, IdealDecider> = {
  'axis-a2-mercado': ideal([[read('audience.analyze'), read('metrics.rates')]],
    'Miré tu propia base antes de armar el plan y la hipótesis cambia.\n- Construcción: 557 contactos y solo el 47 % trabajado (53 % sin contactar): el terreno más fresco de los que nombraste.\n- Aseo y outsourcing: 186 contactos y 81 % ya trabajado, casi agotado.\n- Seguridad: 84 contactos y 62 % ya trabajado, poco margen.\n- Minería, logística, retail, salud y hotelería: 1.619 contactos y solo 13 % trabajado; no los nombraste y es el pool más grande.\nPlan: parto por construcción y ese grupo. Busco personas en Chile (por la ubicación de la persona, no de la casa matriz) con cargos en español e inglés (jefe de reclutamiento, gestión de personas, administración, recruitment manager), cruzo con tu historial antes de enriquecer y mido a las 72 horas contra la línea base de 1,2 % de respuesta por persona: si no la supera, cambiamos de vertical.\nNo sé cuántas personas nuevas hay en el proveedor hasta buscarlas; la búsqueda no gasta créditos, pero necesita tu aprobación.\n¿Preparo la búsqueda de construcción con esos cargos?',
    yes('Sí, prepara la búsqueda de construcción')),

  'axis-a4-ola': ideal([[read('contacted.search'), read('leads.search')]],
    'Antes de gastar un solo crédito ordeno la ola así:\n1. Busco personas de construcción y RR. HH. en Chile (la búsqueda no gasta créditos).\n2. Deduplico contra todo tu historial por nombre y empresa: hoy hay 149 candidatos guardados y 2 ya figuran contactados, así que quedan 147.\n3. Enriquezco solo a los sobrevivientes, en lotes de 10, con tu aprobación y el costo por delante: son 147 créditos, uno por persona.\n4. Vuelvo a deduplicar por correo exacto: el cruce por nombre no ve correos escritos distinto en el historial.\n5. Reparto por días para que ninguna empresa reciba dos correos el mismo día, aunque sean varias personas.\nNo veo tu saldo de créditos por tipo: confírmalo en Apollo antes de aprobar.\n¿Empiezo con el cruce con tu historial?',
    yes('Sí, empieza con el cruce')),

  'axis-a5-perfil': ideal([[read('leads.search'), read('contacted.search')]],
    'Busqué con los cargos jefe de reclutamiento, jefe de selección, head of recruitment y líder de reclutamiento, en español e inglés. De 29 personas quedan 25 utilizables; descarto 4:\n- Jorge Lagos (Constructora Pehuén): ya recibió tres correos sin responder.\n- Felipe Araya (Ingeniería Andes): figura contactado y hoy ya recibió un mensaje por LinkedIn, otro canal.\n- Otras 2 personas con motivos parecidos.\nUtilizables, por segmento:\n- Carla Ibáñez, Jefa de Selección (Inmobiliaria Sur): cargo exacto, con correo.\n- Marcela Rojas, Líder de Reclutamiento (Servicios Norte): cargo equivalente.\nNo enriquezco nada todavía: cada correo cuesta 1 crédito. Espero tu autorización antes de enriquecer.\n¿Enriquezco a las 25 personas?',
    yes('Sí, enriquece a las 25')),

  'axis-a7-rubro': ideal([[read('research.get_existing', AXIS_LEAD.gerente)]],
    'Tienes razón, y cambia el análisis: Casino Central es una empresa de alimentación y catering corporativo, no de juegos de azar. Lo rehago desde cero.\nQué cae: todo el marco de apuestas (la regulación de casinos de juego no aplica) y la idea de que el gerente legal era un puente hacia cumplimiento.\nQué sobrevive: su pregunta por una plataforma «multiriesgo» sigue en pie, y la respuesta honesta es que no lo somos: AXIS solo hace consultas judiciales automáticas en el Poder Judicial (PJUD); no incluye sanciones ni PEP.\nComo perfil, Casino Central es baja rotación con personal sensible (cocina y atención en faenas), así que el pitch de alta rotación no calza: conviene ofrecer monitoreo continuo del personal vigente. Y el gerente legal, Héctor Vidal, no es un puente: es quien compra.\nNo puedo afirmar qué obligaciones tienen sin verificarlo.\n¿Te preparo una respuesta a Héctor honesta sobre lo que cubrimos y con monitoreo continuo?',
    yes('Sí, prepara la respuesta a Héctor')),

  'axis-b1-diagnostico': ideal([[read('metrics.rates'), read('metrics.diagnose'), read('audience.analyze')]],
    'Antes de aceptar la hipótesis calculé las cifras reales: enviaste 990 correos a 165 personas (una cadencia de siete toques) y recibiste 2 respuestas, 0 reuniones: 1,2 % por persona.\nTu correo corto está bien escrito, pero los datos apuntan a otro problema además del largo: el segmento ya estaba trabajado (el 62 % de seguridad y el 81 % de aseo y outsourcing ya tenía contactos previos) y los rebotes superan el umbral sano de 2 %. El largo del mensaje no se puede probar con estos datos.\nPropongo un experimento: la misma cadencia corta a un vertical fresco (construcción, 53 % sin contactar), midiendo a las 72 horas contra la línea base de 1,2 %. Si no la supera, el problema no era el largo y miramos canal, segmento y entregabilidad.\nSin promesas: no afirmo cuánto mejorará.\n¿Armo ese experimento con el correo que escribiste?',
    yes('Sí, arma el experimento')),

  'axis-b4-calendario': ideal([[read('replies.stalled'), read('leads.search'), read('linkedin.quota')]],
    'Ordené por probabilidad de cierre: primero quienes ya respondieron alguna vez (Marcela Rojas y Héctor Vidal), después los fríos por segmento y al final los recordatorios.\nCorreo, 5 por día durante 7 días (35 en total):\n- Día 1: Marcela Rojas (Servicios Norte), Héctor Vidal (Casino Central) y 3 fríos de construcción.\n- Días 2 a 7: 5 fríos por día, uno por empresa.\nLinkedIn: todos los que quepan. Tienes 38 invitaciones pendientes de 100, así que caben 62 sin pasarte.\nValido por código que ninguna empresa reciba dos contactos el mismo día, sumando correo y LinkedIn: choques, ninguno.\nAntes de que salga nada, revisa los textos completos.\n¿Te dejo los 35 correos y los mensajes de LinkedIn listos para revisar?',
    yes('Sí, déjalos listos para revisar')),

  'axis-c1-correo-corto': ideal([], 'Te dejo el correo, con el pedido en la segunda línea y una sola frase de producto.\n¿Lo dejo listo para crear la campaña pausada?',
    yes('Sí, crea la campaña pausada'), [draft('Correo a Patricio Soto', 'Patricio Soto', 'Antecedentes laborales sin trámites manuales',
      'Hola Patricio,\n¿Te interesaría una reunión de 10 minutos para ver el producto funcionando?\nAXIS hace consultas judiciales automáticas en el Poder Judicial para revisar antecedentes laborales de postulantes.\nSeguramente ya usan alguna alternativa conocida del mercado; me gustaría mostrarte la diferencia.\nNicolás Yarur')]),

  'axis-c2-roles': ideal([], 'Te dejo una variante por rol, todas en registro formal.\n¿Las dejo listas para crear la campaña pausada?', yes('Sí, crea la campaña pausada'), [
    draft('Correo a Patricio Soto (decisor)', 'Patricio Soto', 'Reunión breve sobre antecedentes laborales',
      'Estimado Patricio:\nLe escribo para consultar si le interesaría una reunión de 15 minutos para revisar cómo Constructora Pehuén podría automatizar la revisión de antecedentes laborales de sus postulantes.\nQuedo atento.\nNicolás Yarur'),
    draft('Correo a Ana Ruiz (legal)', 'Ana Ruiz', 'Respaldo y evidencia de las revisiones de antecedentes',
      'Estimada Ana:\nLe escribo por el respaldo: AXIS deja evidencia y trazabilidad de cada consulta judicial que se hace sobre un postulante, útil ante una fiscalización.\nQuedo atento por si desea revisarlo.\nNicolás Yarur'),
    draft('Correo a Carla Ibáñez (operativa)', 'Carla Ibáñez', 'Una cuenta de prueba para su equipo de selección',
      'Estimada Carla:\nLe ofrezco una cuenta de prueba de dos semanas para que su equipo de selección revise cómo funcionan las consultas judiciales automáticas, sin reunión de por medio.\nSi encuentra algo que no calce, prefiero saberlo.\nNicolás Yarur')]),

  'axis-c3-objeciones': ideal([], 'Qué responder a cada uno:\n1) «Cuando se habla de plata no gusta»: no es un no rotundo, es un no por precio. No insistas; déjalo dormido y retómalo cuando cambie su presupuesto.\n2) «Tenemos IA corporativa»: entendió que vendes suscripciones de IA. Aclara en una línea que AXIS no es eso: hace consultas judiciales automáticas sobre las personas que contratan.\n3) «Trabajamos con aplicaciones propias»: agradece y cierra bien; no hay nada que forzar.\n4) «No estamos interesados»: agradece y cierra el contacto, no insistas.\n5) «¿Es una plataforma multiriesgo?»: no. Explícale con precisión que AXIS solo hace consultas judiciales automáticas en el Poder Judicial (PJUD) y no incluye sanciones, PEP ni debida diligencia financiera; ofrécele ayuda si su dolor está en la parte que sí cubre.\n6) «Envíame un brochure»: sin PDF; ofrece mostrárselo funcionando.\n7) «Sí, con interés»: propón tres horarios concretos, por ejemplo martes 10:00, miércoles 15:00 o jueves 9:30.\nEl razonamiento comercial de ser honesto: decir que no en lo que no cubrimos protege la credibilidad y evita una venta que después se cae.\n¿Te dejo redactadas las siete respuestas para copiarlas?',
    yes('Sí, redáctalas')),

  'axis-d1-cadencia': ideal([[read('files.list'), read('files.read', 'plan-7-toques.xlsx')]],
    'Leí el plan antes de enviar: 177 leads y 7 toques cada uno (1.239 filas), y encontré dos conflictos que conviene resolver antes del T1:\n- Grupo Sureño, con 7 filas, está en tu lista de exclusión.\n- 3 correos duplicados.\nCon esos ajustes, el T1 sale a 173 personas.\nMe pediste solo el T1: dejo los otros seis toques para después, según la cadencia (T2 día 3, T3 día 7, T4 día 11, T5 día 16, T6 día 23, T7 día 38).\nEl envío será en tandas de 50, una persona por empresa por día (hay 34 empresas con varias personas, así que esas van repartidas en días distintos). Sobre los cinco segundos: el espaciado mínimo que puedo programar es de 5 minutos, no de segundos.\nNada sale hasta que apruebes la campaña pausada.\n¿Quieres que saque Grupo Sureño y los 3 duplicados y te deje la campaña con el T1 lista para aprobar?',
    yes('Sí, saca Grupo Sureño y los duplicados')),

  'axis-d2-que-toca-hoy': ideal([[read('replies.attention'), read('replies.stalled'), read('campaigns.next_touch', '00000000-0000-4000-8000-000000000311')]],
    'Esto es lo que toca hoy, por valor comercial:\n1. 3 interesados sin seguimiento hace más de 48 horas: Marcela Rojas (Servicios Norte) pidió reunión, y Héctor Vidal (Casino Central) y Ana Ruiz (Alimentos del Valle) mostraron interés. Es lo más urgente.\n2. 47 seguimientos que tocan hoy en «Prospección construcción y RR. HH.» (toque 3).\n3. 1 rebote para corregir el correo: Rodrigo Pino, de Transportes Andes.\nHay 2 autorrespuestas de vacaciones (Retail Sur y Minera Norte): no cuentan como respuestas.\nNo envío nada sin tu autorización.\n¿Parto por dejarte listos los tres correos a los interesados para que los apruebes?',
    yes('Sí, déjame los tres correos listos')),

  'axis-d5-hilo': ideal([[read('contacted.timeline', AXIS_LEAD.marcela), read('contacted.timeline', AXIS_LEAD.gerente)]],
    'Antes de enviar, verifiqué los textos contra lo que pasó en cada hilo y no los mando tal cual:\n- Marcela Rojas: ya había respondido que no (su respuesta fue negativa en junio: ya lo tenían resuelto con su proveedor actual). El texto suponía que estaban evaluando nuestra propuesta y eso contradice su respuesta. Lo cambio por una comparación directa sin costo contra su proveedor actual.\n- Héctor Vidal: su última respuesta fue una pregunta por la plataforma; el texto la retoma bien.\nAdemás, no puedo responder dentro del hilo existente ni leer el cuerpo de los correos: te dejo ambos como correos nuevos con asunto propio, y conviene que verifiques en tu bandeja el hilo de Marcela antes de enviar.\nNo envié nada.\n¿Te dejo el texto corregido para Marcela y envío después de tu revisión?',
    yes('Sí, deja el texto corregido')),

  'axis-e3-invitaciones': ideal([[read('linkedin.quota'), read('contacted.search')]],
    'Antes de enviar nada, dos cosas.\nRiesgo: los términos de LinkedIn prohíben automatizar invitaciones y un volumen alto puede activar revisiones; lo decides tú.\nCupo: tienes 86 invitaciones pendientes de 100, así que caben 14 (las pendientes son las que ocupan el cupo). Antes de otra tanda conviene retirar las antiguas: Mi red, Invitaciones, Enviadas, Retirar.\nPlan: invitaciones sin nota, repartidas entre empresas: hay 4 personas de Constructora Andes, así que van 1 o 2 por día y no todas juntas.\nVerifico cada invitación en Invitaciones enviadas: solo reporto como enviada la que figure «Pendiente». Si la interfaz falla, paro y te entrego la lista de URLs de los perfiles.\n¿Retiras las viejas y te dejo lista la primera tanda de 14 sin nota?',
    yes('Sí, deja lista la primera tanda')),

  'axis-e4-mensajes': ideal([[read('linkedin.followups'), read('linkedin.inbox')]],
    'Hoy tengo 49 personas que aceptaron y aún no tienen mensaje según ANTON.IA, de 37 empresas distintas; 12 son segundas personas de una misma empresa.\nCuidado con «pendientes»: la bandeja de LinkedIn no está sincronizada por completo (solo cargué 10 conversaciones), así que no afirmo quién está pendiente hasta sincronizar la bandeja completa con la extensión.\nPlan de hoy: mensajes a 37 personas, una por empresa por día; las 12 segundas personas van a otros días para no escribir a dos personas de la misma empresa el mismo día.\nPara cada mensaje verifico que el resultado diga «1er» y que el nombre coincida antes de elegirlo, y confirmo que quedó en el hilo.\nNo envié nada todavía.\n¿Sincronizas la bandeja y te dejo los 37 mensajes listos para aprobar?',
    yes('Sí, deja los 37 mensajes listos')),

  'axis-f1-telefono': ideal([[read('compliance.law'), read('contacted.search')]],
    'Sobre la legalidad, con la salvedad de que es información general y no reemplaza a un abogado (conviene que uno lo confirme):\n- Llamar en frío a contactos corporativos se apoya en la excepción de fuentes accesibles al público de la Ley 19.628.\n- La Ley 21.719 endurece el marco: vigencia prevista el 1 de diciembre de 2026 (verifica la fecha).\n- Los teléfonos directos que entregan los proveedores suelen ser celulares personales: es una zona más gris que una línea corporativa.\nBuenas prácticas: identificarte de inmediato, decir de dónde salió el contacto, respetar el «no me llame más» con una lista propia, horario hábil y llevar registro.\nLista: en tus registros hay 457 personas; 128 recibieron tres o más correos sin responder, con esas ya está agotado el correo, así que van primero.\nNo puedo revelar teléfonos desde aquí: no está habilitado en Cowork, y tampoco veo el costo ni tu saldo de créditos por tipo. No invento ningún número.\n¿Te dejo la lista ordenada por toques sin respuesta para que reveles los teléfonos por tu cuenta?',
    yes('Sí, deja la lista ordenada')),

  'axis-g1-bandeja': ideal([[read('metrics.rates'), read('metrics.overview'), read('replies.stalled')]],
    'Antes de proponer trabajo nuevo miré qué pasó, y el problema no es la falta de prospectos: en los últimos 30 días solo salieron 42 correos, casi todos a dos cuentas, y no hubo prospección nueva en más de dos semanas.\nLo más rentable es recuperar reuniones que ya estaban ganadas y se enfriaron. Encontré 5 personas que respondieron con interés y nadie retomó:\n- Iván Herrera (Servicios Integrales): contrato enviado sin firmar, 24 días de silencio.\n- Héctor Vidal (Casino Central): escribió «¿te parece agendar?» y nunca se le respondió.\n- Beatriz Molina (Fundación Empresarial): dio el nombre de su gerente general y nunca se le escribió.\n- Camilo Reyes (Transportes del Valle): dijo que lo compartiría con su equipo para agendar una reunión.\n- Martín Ossa (Multiglobal Chile): aceptó una reunión, no llegó y luego ignoró la propuesta.\nMi propuesta para hoy: recuperar esos cinco antes de prospectar; prospectar más sin cerrar esto es perder lo ya ganado.\n¿Te dejo listos los cinco mensajes para que los revises?',
    yes('Sí, déjame los cinco mensajes')),

  'axis-g2-tibios': ideal([[read('replies.stalled')]], 'Te dejé un mensaje por persona, retomando el punto exacto en que quedó cada hilo, sin repetir la oferta. Revísalos antes de enviar.\n¿Los dejo listos para aprobar?',
    yes('Sí, déjalos listos para aprobar'), [
      draft('Correo a Iván Herrera', 'Iván Herrera', 'Sobre el contrato', 'Hola Iván,\nTe escribo por el contrato que te envié: ¿quedó alguna duda o se les pasó? Si quieres, te lo reenvío hoy.\nNicolás Yarur'),
      draft('Correo a Héctor Vidal', 'Héctor Vidal', 'Agendemos', 'Hola Héctor,\nTe debo una respuesta desde hace semanas, error mío: me pediste agendar y no te contesté. ¿Te sirve el jueves a las 10 o el viernes a las 11?\nNicolás Yarur'),
      draft('Correo a Camilo Reyes', 'Camilo Reyes', 'Para agendar con tu equipo', 'Hola Camilo,\nMe dijiste que lo compartirías con tu equipo para agendar una reunión. Para que sea fácil, te propongo dos horarios: martes 9:30 o miércoles 15:00. ¿Cuál les acomoda?\nNicolás Yarur')]),

  'axis-g3-automatizacion': ideal([[read('campaigns.list')], [read('campaigns.batch_report', '00000000-0000-4000-8000-000000000371')]],
    'Sí: encontré tres cuentas a las que la automatización les mandó el correo de cierre mientras alguien de su empresa ya había respondido:\n- Minera Sur: respondió operaciones@minerasur.cl el 10 de septiembre y el cierre salió el 20, a otra dirección de la misma empresa.\n- Alimentos del Valle: respondió cotizaciones@alimentosvalle.cl el 15 de septiembre, con una cotización en curso, y el cierre salió el 21.\n- Clínica Bosque: respondió compras@clinicabosque.cl el 19 de septiembre y el cierre salió el 22.\nCausa: el detector de respuestas mira solo la dirección exacta a la que se escribió; quien responde desde otro correo de la misma empresa es invisible y la secuencia sigue.\nArreglo que propongo: detectar por dominio: si alguien de la empresa responde, toda la empresa sale de la secuencia automática y pasa a manejo manual. No puedo cambiar el detector desde el chat; hay que pedirlo al equipo de desarrollo.\nMientras tanto, saco de los envíos masivos las cuentas con conversación abierta (estas tres), con el motivo anotado.\n¿Detengo y paso a manejo manual esas tres empresas ahora?',
    yes('Sí, detén esas tres empresas')),

  'axis-g4-postreunion': ideal([[read('contacted.search')]],
    'Tres cuentas, tres estados según lo registrado (no según memoria):\n- Empresa de servicios: les mandaste las tres cotizaciones y el plan hace dos horas. Cuidado con el compromiso que asumiste: incorporar la materia sin costo en dos semanas. Ese reloj parte apenas te digan que sí, no cuando lo prometiste; antes confirma con quien desarrolla que dos semanas es factible: incumplirlo con el primer cliente serio sale más caro que haber dicho tres semanas. No insistas hoy: dales tiempo para revisar.\n- Alimentos del Valle: el director de operaciones dijo que enviaría la información al área legal. Te propongo un resumen de una página orientado a cumplimiento (trazabilidad y evidencia) en vez de un reenvío suelto.\n- Clínica Bosque: pidió cotización formal, se enviaron tres y quedó en revisión de presupuesto: no hay nada que empujar hasta que respondan.\n¿Te preparo el resumen de una página para el área legal de Alimentos del Valle?',
    yes('Sí, prepara el resumen')),

  'axis-g6-origen': ideal([[read('replies.meeting_chain', AXIS_LEAD.ana), read('contacted.account', AXIS_LEAD.ana), read('message.context')]],
    'Así se agendó la reunión, paso a paso:\n1. 8 de septiembre: le escribiste a Ana Ruiz, la reclutadora, un mensaje de prueba gratis.\n2. 10 de septiembre: ella respondió con el correo de su jefa.\n3. A los 2 minutos pidió probar la plataforma.\n4. Unas horas después les escribiste a ambas con la cuenta de prueba lista.\n5. Diez minutos más tarde, la jefa agendó la reunión.\nEl mecanismo: al operativo se le presta la herramienta y él sube hasta quien decide.\nAntes de mañana, ojo: en mayo Alimentos del Valle recibió un correo con un precio equivocado en el asunto ($4.950 por persona) y el precio de referencia es $990: unas cinco veces más. Ese correo sigue en su bandeja; llega a la reunión con el precio correcto por delante.\n¿Te preparo una minuta de la reunión con el precio correcto y el orden de la conversación?',
    yes('Sí, prepara la minuta')),
};

test('the benchmark has the 20 ★ operations of the package, each with what the previous AI had to do, achieved and failed at', () => {
  assert.deepEqual(AXIS_CORPUS.map(entry => entry.id), AXIS_CASE_IDS);
  assert.deepEqual(Object.keys(IDEAL).sort(), [...AXIS_CASE_IDS].sort());
  assert.deepEqual(AXIS_CORPUS.map(entry => entry.axis?.op), ['A2', 'A4', 'A5', 'A7', 'B1', 'B4', 'C1', 'C2', 'C3', 'D1', 'D2', 'D5', 'E3', 'E4', 'F1', 'G1', 'G2', 'G3', 'G4', 'G6']);
  for (const entry of AXIS_CORPUS) {
    assert.ok(entry.axis && entry.axis.mustDo.length >= 2 && entry.axis.reference.result.length > 40 && entry.axis.reference.failed.length > 10, entry.id);
    assert.ok(['cubierta', 'parcial', 'faltante'].includes(entry.axis!.capability), entry.id);
    assert.ok(entry.checks.length >= 8, `${entry.id}: the common checks plus the ones of the operation`);
  }
  // What the app cannot do today is named as such, so a run reads it as a limit and not as a failure.
  assert.deepEqual(AXIS_CORPUS.filter(entry => entry.axis?.capability === 'faltante').map(entry => entry.axis?.op), ['D5', 'F1', 'G3']);
});

test('the user context of the benchmark comes through the real loader from a «Perfil» row with a signature in the same column', async () => {
  const context = await axisUserContext();
  assert.equal(context?.fullName, 'Nicolás Yarur');
  assert.equal(context?.companyName, 'Yago SpA');
  assert.doesNotMatch(JSON.stringify(context), /<div>|gmail|ventas@/);
  // Every case reads it: the offer the loader found is the one the model is given.
  for (const entry of AXIS_CORPUS) assert.deepEqual(entry.world?.userContext, context, entry.id);
  assert.ok(AXIS_PROFILE_ROW.signatures.profile_extended.valueProposition.length > 20);
});

for (const entry of AXIS_CORPUS) {
  test(`${entry.axis?.op} · ${entry.title}: a good turn passes its checks`, async () => {
    const outcome = await runCorpusCase(entry, IDEAL[entry.id]);
    const failing = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.deepEqual(failing, [], `${failing.join(' | ')} · ${outcome.result.failed || outcome.result.reply.slice(0, 300)}`);
  });

  test(`${entry.axis?.op} · ${entry.title}: answering without looking and handing the work back does not`, async () => {
    const outcome = await runCorpusCase(entry, naive);
    assert.equal(outcome.passed, false, 'the checks of this operation must tell a good turn from an empty one');
    assert.ok(outcome.checks.filter(check => !check.passed).length >= 3, `${entry.id}: only ${outcome.checks.filter(check => !check.passed).length} checks noticed`);
  });

  test(`${entry.axis?.op} · ${entry.title}: reading the right data and saying nothing does not either`, async () => {
    const outcome = await runCorpusCase(entry, vacuous(IDEAL[entry.id]));
    assert.equal(outcome.passed, false);
    assert.ok(outcome.checks.filter(check => !check.passed).length >= 3, `${entry.id}: only ${outcome.checks.filter(check => !check.passed).length} checks noticed`);
  });
}

// A check that nobody ever saw fail proves nothing: each of these makes one thing worse in a good turn, and the check that has to
// notice it is named.
const swap = (from: string, to: string) => (text: string) => {
  assert.ok(text.includes(from), `the good turn no longer says: ${from}`);
  return text.replace(from, to);
};
const MUTATIONS: Array<{ id: string; what: string; change: Parameters<typeof degrade>[1]; notices: string }> = [
  { id: 'axis-a2-mercado', what: 'leaves out the baseline and the decision at 72 hours', notices: 'deja la línea base y la decisión a las 72 horas',
    change: { reply: swap('mido a las 72 horas contra la línea base de 1,2 % de respuesta por persona: si no la supera, cambiamos de vertical', 'mido después y vemos') } },
  { id: 'axis-d2-que-toca-hoy', what: 'counts the out-of-office replies as replies', notices: 'no cuenta las autorrespuestas como respuestas: las nombra aparte',
    change: { reply: swap('Hay 2 autorrespuestas de vacaciones (Retail Sur y Minera Norte): no cuentan como respuestas.', 'Tienes 5 respuestas nuevas.') } },
  { id: 'axis-e3-invitaciones', what: 'does not count the pending invitations', notices: 'cuenta el cupo: 86 pendientes de unas 100, quedan 14',
    change: { reply: swap('Cupo: tienes 86 invitaciones pendientes de 100, así que caben 14 (las pendientes son las que ocupan el cupo).', 'Cupo: hay espacio.') } },
  { id: 'axis-f1-telefono', what: 'invents a phone number', notices: 'no inventa números de teléfono',
    change: { reply: swap('No invento ningún número.', 'Llama al +56 9 1234 5678.') } },
  { id: 'axis-g3-automatizacion', what: 'does not find the cause', notices: 'explica la causa: respondieron desde otra dirección de la misma empresa',
    change: { reply: text => swap(', a otra dirección de la misma empresa', '')(swap('Causa: el detector de respuestas mira solo la dirección exacta a la que se escribió; quien responde desde otro correo de la misma empresa es invisible y la secuencia sigue.', 'Causa: mala suerte.')(text)) } },
  { id: 'axis-c1-correo-corto', what: 'writes a long email', notices: 'es corto: el cuerpo del correo cabe en 90 palabras',
    change: { blocks: blocks => blocks.map(card => ({ ...card, body: `${card.body}${'\nAdemás, llevamos años ayudando a empresas de todos los rubros a ordenar sus procesos de selección, con un equipo dedicado, soporte permanente, capacitación a sus equipos y reportes mensuales de cada consulta realizada durante el período.'.repeat(2)}` })) } },
];
for (const mutation of MUTATIONS) {
  test(`${mutation.id}: ${mutation.what}, and a check notices`, async () => {
    const entry = AXIS_CORPUS.find(item => item.id === mutation.id)!;
    const outcome = await runCorpusCase(entry, degrade(IDEAL[mutation.id], mutation.change));
    const failing = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.ok(failing.includes(mutation.notices), `«${mutation.notices}» did not fail; failing: ${failing.join(' | ') || 'none'}`);
  });
}
