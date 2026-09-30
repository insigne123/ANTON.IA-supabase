// The other 24 operations of the AXIS package (scripts/fixtures/cowork-axis-resto.ts) played through the real loop with a scripted
// model, like the 20 ★ (cowork-axis-paquete.test.ts): what a good turn does for each must pass its own checks, and a turn that
// answers without looking or without saying what it cannot do must not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAudienceRole } from '../src/lib/cowork/audience-analysis';
import { AXIS_CORPUS, AXIS_LEAD } from './fixtures/cowork-axis-paquete';
import { axisReferenceSummary } from './fixtures/cowork-axis-judge';
import { selectCases } from './cowork-case-selection';
import { AXIS_REST, AXIS_REST_CASE_IDS, AXIS_REST_CORPUS } from './fixtures/cowork-axis-resto';
import { degrade, draft, ideal, naive, read, table, vacuous, yes, type IdealDecider } from './fixtures/cowork-axis-ideal';
import { runCorpusCase } from './fixtures/cowork-conversation-runner';

const IDEAL: Record<string, IdealDecider> = {
  'axis-a1-hipotesis': ideal([[read('audience.analyze'), read('leads.search', 'reclutamiento'), read('crm.search', 'piloto')]],
    'Antes de opinar miré tu base y la idea tiene sentido, con un ajuste.\n- A favor: Alimentos del Valle, tu cliente en piloto, tiene a una persona de selección que usa AXIS a diario; es tu único usuario real.\n- En contra: de los 100 primeros contactos que alcanzo a ver (no veo los 2.512 completos) solo 6 son de reclutamiento o selección, y la búsqueda de reclutadores se corta en 20: hay más, pero no sé cuántos.\nEl defecto de ejecución: un reclutador no firma, así que no le pidas una reunión de 10 minutos; ofrécele una cuenta de prueba de dos semanas sin costo para que suba hasta quien decide.\nMi propuesta: una lista aparte con los reclutadores que ya tienes guardados, sin gastar créditos: no enriquezco a nadie.\n¿Armo esa lista aparte?',
    yes('Sí, arma la lista aparte')),

  'axis-a3-empresas': ideal([[read('audience.analyze'), read('crm.search', 'empresa')]],
    'Te propongo armar el listado así, sin gastar créditos:\n1. Busco personas y derivo las empresas de la búsqueda de personas, porque la búsqueda de empresas cuesta créditos.\n2. Filtro por tamaño: 200 empleados o más, y 500 o más en construcción.\n3. Exijo al menos un decisor con correo verificado en cada empresa.\n4. Deduplico por dominio exacto o por nombre normalizado completo, nunca por coincidencia parcial, y lo cruzo con lo que ya tienes: hoy en construcción el 47 % de las empresas ya está trabajado, en aseo el 81 % y en seguridad el 62 %.\n5. Excluyo competidores directos y organismos públicos extranjeros, además de tu lista de exclusión.\nCada empresa queda como nueva, trabajada o excluida, en un archivo Excel que puedes descargar.\n¿Preparo la búsqueda de personas para empezar el listado?',
    yes('Sí, prepara la búsqueda de personas')),

  'axis-a6-decisor-referidor': ideal([[read('audience.analyze'), read('contacted.search')]],
    'Antes de clasificar: de los 100 primeros contactos que alcanzo a ver (no veo los 2.512 completos), 64 no tienen cargo, así que no los puedo clasificar sin recuperarlo de los archivos del proveedor. De los 36 con cargo, comparo por palabra completa y no por letras sueltas (un «cio» no descarta a «servicios»):\n- Decisores (21): gerentes de personas, de servicios transitorios y generales, directores y dueños.\n- Referidores (9): selección, analistas y asistentes; no firman pero pueden derivar.\n- Descarte (6): cargos que no aportan ninguna de las dos cosas.\nEl orden: primero quienes recibieron más toques por correo sin respuesta; los referidores entran desde el primer día, porque el referido es lo único que ya funcionó. Te dejo un mensaje distinto para decisores y otro para referidores.\n¿Armo el listado completo de LinkedIn con esos tres grupos?',
    yes('Sí, arma el listado con los tres grupos'), [
      draft('Mensaje de LinkedIn a decisores', 'Decisores', 'Mensaje de LinkedIn', 'Hola, vi que lideras personas en tu empresa. ¿Te interesaría ver en 10 minutos cómo revisamos antecedentes laborales con consultas judiciales automáticas? Nicolás'),
      draft('Mensaje de LinkedIn a referidores', 'Referidores', 'Mensaje de LinkedIn', 'Hola, quizás no eres quien decide esto, pero sí quien conoce el tema. ¿Con quién de tu empresa me conviene hablar sobre la revisión de antecedentes de postulantes? Nicolás')]),

  'axis-a8-perfil-real': ideal([[read('leads.search', 'linkedin'), read('linkedin.jobs'), read('linkedin.quota')]],
    'No puedo abrir perfiles de LinkedIn desde el chat, así que no puedo decirte cuáles de los 36 no sirven; inventar un resultado sería peor. Lo que sí hago:\n- La extensión de tu navegador abre cada perfil cuando ejecuta la invitación, y ahí se contrasta el cargo y la empresa con lo que dice la base.\n- Un perfil no sirve si tiene datos viejos o desactualizados, si la persona busca empleo, si está inactivo, si no ofrece «Conectar» (solo «Seguir») o si la invitación ya está pendiente.\n- Te dejo la lista con el URL del perfil de cada persona y una columna para el motivo de descarte; la tasa de descartes se calcula con lo que revises, porque con pocos casos la estimación engaña.\nAhora tienes 38 invitaciones pendientes de 100 y un trabajo en cola.\n¿Te dejo la lista con los URLs de perfil y la columna de motivo?',
    yes('Sí, deja la lista con la columna de motivo')),

  'axis-b2-mensaje-propio': ideal([], 'Tu mensaje ya funciona y lo dejé casi igual.\nLo que hace bien y conservo: el pedido en la línea 2, una sola frase de producto, el ancla competitiva y el cierre simple.\nQué cambié y por qué:\n1. Contenido: decía que verifica «a empresas como la tuya»; AXIS verifica a las personas que la empresa contrata (sus postulantes), así que lo corregí.\n2. Largo: saqué la frase de las referencias y la de la videollamada; el correo pasó de unas 100 palabras a menos de 70.\n3. Mayúsculas: «Tu Equipo De Selección» quedó en minúsculas.\nTe dejo el correo corregido y un borrador de LinkedIn con el mismo tono, directo y breve.\n¿Los dejo listos para revisar?',
    yes('Sí, déjalos listos para revisar'), [
      draft('Correo corregido para Patricio Soto', 'Patricio Soto', 'Reunión', 'Hola Patricio,\n¿Te interesaría una reunión de 10 minutos para ver el producto funcionando?\nAXIS revisa antecedentes laborales de las personas que contratan las empresas, con consultas judiciales automáticas y sin trámites manuales.\nSeguramente ya usan alguna de las alternativas conocidas del mercado. Esto hace lo mismo y a un mejor precio.\nNicolás'),
      draft('Borrador de LinkedIn para Patricio Soto', 'Patricio Soto', 'Mensaje de LinkedIn', 'Hola Patricio, ¿te interesaría una reunión de 10 minutos para ver el producto funcionando? Revisa antecedentes laborales de tus postulantes con consultas judiciales automáticas. Nicolás')]),

  'axis-b3-canales': ideal([[read('metrics.rates'), read('metrics.channels'), read('replies.meeting_chain', AXIS_LEAD.ana)]],
    'Antes de listar canales miré tus números: no es un problema de alcance, es de conversión. En 30 días salieron 165 correos y hubo 2 respuestas, y los rebotes (5,5 %) superan el 2 % sano.\nLo que te enseñó el único negocio vivo: llegó por una cadena de referidos y no por un correo frío. Una reclutadora de Alimentos del Valle pidió probar y su jefa agendó la reunión.\nPor eso te propongo este orden, de más a menos palanca:\n1. Alianzas con proveedores de software de RR. HH.: ya venden a tus empresas objetivo y antes les escribiste como clientes, no como socios. Es la palanca más grande.\n2. Teléfono: con quienes ya recibieron tres toques sin responder.\n3. LinkedIn: 9 respuestas en 34 envíos; una muestra chica, pero mejor que el correo.\n4. Gremios y estudios de abogados laborales: acceso a muchas empresas con una sola charla.\nAntes de sumar canales hay que arreglar la entregabilidad (los rebotes) y el posicionamiento: decir que AXIS revisa a las personas que la empresa contrata.\n¿Empiezo por la lista de proveedores de software de RR. HH. para proponerles una alianza?',
    yes('Sí, empieza por la lista de proveedores')),

  'axis-b5-reemplazar': ideal([[read('campaigns.company_plan', AXIS_REST.plan), read('leads.search', 'gerente'), read('contacted.search')]],
    'Saqué a Grupo Sureño, a Transportes Andes, a la Fundación Empresarial y a Alimentos del Valle (ya se reunieron) de los correos y de los recordatorios.\nLos reemplazos tienen correo verificado y nunca fueron contactados: Soluciones TI Austral (servicios de TI), Seguridad Integral (seguridad), Logística del Pacífico (logística) y Puerto Sur (puertos).\nEl plan sigue con cinco correos por día y una persona por empresa por día: ninguna empresa aparece dos veces el mismo día. Te lo dejo en la tabla para revisar.\nSi lo apruebas, actualizo el plan y los documentos que lo contienen con los mismos cambios.\n¿Actualizo el plan con estos reemplazos?',
    yes('Sí, actualiza el plan con los reemplazos'), [
      table('Plan nuevo de dos días', ['Día', 'Empresa', 'Persona'], [
        ['25 sep', 'Constructora Pehuén', 'Patricio Soto'], ['25 sep', 'Inmobiliaria Sur', 'Carla Ibáñez'], ['25 sep', 'Ingeniería Andes', 'Felipe Araya'],
        ['25 sep', 'Soluciones TI Austral', 'Raúl Castillo'], ['25 sep', 'Seguridad Integral', 'Elena Vera'],
        ['26 sep', 'Servicios Norte', 'Marcela Rojas'], ['26 sep', 'Minera Norte', 'Luis Mena'], ['26 sep', 'Retail Sur', 'Verónica Paz'],
        ['26 sep', 'Logística del Pacífico', 'Mauricio Núñez'], ['26 sep', 'Puerto Sur', 'Paulina Sáez']])]),

  'axis-b6-replanificar': ideal([[read('campaigns.list'), read('campaigns.batch_report', AXIS_REST.campaign), read('campaigns.next_touch', AXIS_REST.campaign)]],
    'Revisé lo que se envió de verdad: de los 35 toques del plan salieron 15 (los días 1 a 3: 21, 22 y 23 de septiembre). Los días 4 y 5 (24 y 25) no salieron: son 10 correos sin enviar, y otros 10 siguen planeados para el 28 y el 29.\nCorro el calendario sin repetir a nadie: los 15 que ya salieron no vuelven a entrar; los 10 atrasados salen el lunes 28 y el martes 29, y los 10 últimos el miércoles 30 y el jueves 1 de octubre, cinco por día y una persona por empresa por día.\nLo que te cuento sale de lo registrado en ANTON.IA; si enviaste alguno a mano desde tu bandeja no lo veo hasta que sincronices el correo, conviene verificarlo antes.\n¿Reprogramo los 20 pendientes con esas fechas?',
    yes('Sí, reprograma los 20 pendientes')),

  'axis-c4-corregir-error': ideal([[read('contacted.timeline', AXIS_REST.manager), read('campaigns.list'), read('contacted.search', 'precio')]],
    'Son dos errores y conviene corregirlos hoy, antes de que sigan pensando en ellos.\n1. Sandra Olave, de Clínica Bosque: hace un rato le llegó una propuesta dirigida a Constructora Pehuén. La corrección va en dos líneas, sin excusas y con el mensaje correcto.\n2. El precio en el asunto: los 145 correos de ayer decían «$4.950 por persona» y el precio correcto es $990. Te preparo una corrección corta para los 145.\nAntes de cada envío verifico que el nombre y la empresa del texto coincidan con el destinatario. No envío nada sin tu aprobación: los dos correos quedan para revisar.\n¿Dejo listas la corrección a Sandra y la de los 145 para que las apruebes?',
    yes('Sí, déjalas listas para aprobar'), [
      draft('Corrección a Sandra Olave', 'Sandra Olave', 'Corrección de mi mensaje anterior', 'Hola Sandra,\nTe llegó por error un mensaje que no era para ti. Disculpa la confusión: el correcto es este.\n¿Te interesaría ver en 10 minutos cómo AXIS revisa antecedentes laborales con consultas judiciales automáticas en Clínica Bosque?\nNicolás'),
      draft('Corrección de precio a los 145 destinatarios', '145 destinatarios', 'Corrección: el precio es $990 por persona', 'Hola,\nEl asunto de mi correo de ayer tenía el precio mal: el correcto es $990 por persona consultada, no $4.950. Disculpa el error.\nNicolás')]),

  'axis-c5-asunto-limpio': ideal([[read('leads.search', 'Ana Ruiz'), read('contacted.search', 'Alimentos del Valle'), read('message.context')]],
    'Antes de escribir miré el historial con Alimentos del Valle: el correo de mayo tiene en el asunto «desde $4.950 por persona», un precio equivocado para cómo se cotiza (el de referencia es $990 por persona consultada). No respondo sobre ese hilo para no arrastrar el error; además, desde aquí no puedo responder dentro de un hilo: siempre sale un correo nuevo. Te dejo un correo nuevo con asunto limpio, «Comparación directa contra su proveedor actual», sin precios.\n¿Lo dejo listo para que lo revises?',
    yes('Sí, déjalo listo para revisar'), [
      draft('Correo a Ana Ruiz', 'Ana Ruiz', 'Comparación directa contra su proveedor actual', 'Hola Ana,\nTe propongo una comparación directa y sin costo: tomamos una muestra de casos que ya procesó su proveedor actual y los pasamos por AXIS, para que veas la diferencia con datos de ustedes.\n¿Te parece si te la preparo esta semana?\nNicolás')]),

  'axis-d3-vista-previa': ideal([[read('leads.search', 'construcción'), read('contacted.search', 'construcción'), read('campaigns.list')]],
    'Preparé la tanda de 96 personas de construcción y te muestro los tres primeros correos tal como saldrían, con el nombre y la empresa de cada uno, sin razón social en el asunto y con los acentos bien.\nRetengo a 1 persona, con su motivo: Felipe Araya ya recibió un correo hace tres semanas, así que la tanda queda en 95 de 96.\nEl envío es lo único irreversible de todo el proceso: por eso no sale nada hasta que me des el adelante. Al terminar te informo las cifras exactas: cuántos salieron, cuántos fallaron y por qué.\n¿Quedan bien estos tres correos para dejar la tanda lista a tu adelante?',
    yes('Sí, quedan bien: deja la tanda lista'), [
      draft('Correo a Patricio Soto', 'Patricio Soto', 'Antecedentes laborales sin trámites manuales', 'Hola Patricio,\n¿Te interesaría una reunión de 10 minutos para ver cómo AXIS revisa antecedentes laborales en Constructora Pehuén?\nNicolás'),
      draft('Correo a Carla Ibáñez', 'Carla Ibáñez', 'Antecedentes laborales sin trámites manuales', 'Hola Carla,\n¿Te interesaría una cuenta de prueba de dos semanas para revisar antecedentes laborales en Inmobiliaria Sur?\nNicolás'),
      draft('Correo a Jorge Lagos', 'Jorge Lagos', 'Antecedentes laborales sin trámites manuales', 'Hola Jorge,\n¿Te interesaría ver en 10 minutos cómo AXIS revisa antecedentes laborales en Ingeniería Andes?\nNicolás')]),

  'axis-d4-fallas-de-envio': ideal([[read('campaigns.list'), read('campaigns.retry_review', AXIS_REST.tanda), read('campaigns.batch_report', AXIS_REST.tanda)]],
    'De los 116 envíos de la tanda salieron 86 y fallaron 30. Separé las causas: 27 fallaron por la conexión con el proveedor (se pueden reintentar) y 3 por dirección inválida (terminales: no se reintentan, hay que corregir el correo).\nReintento solo los 27 que fallaron por conexión, sin tocar a los 86 que salieron bien; el despacho protege contra duplicados, así que nadie recibe el mismo correo dos veces. Si alguno quedara incierto, primero se concilia en Contactados antes de repetirlo.\n¿Reintento los 27 que fallaron por conexión?',
    yes('Sí, reintenta los 27')),

  'axis-d6-entregabilidad': ideal([[read('deliverability.check', 'yago.cl'), read('deliverability.bounces'), read('deliverability.sender')]],
    'Corrijo mi hipótesis anterior: la autenticación no es el problema.\n- SPF está bien (estricto, -all) y DKIM también (selector google).\n- DMARC está en modo monitoreo (p=none): no bloquea nada. Conviene subirlo a cuarentena tras revisar unos días de reportes.\n- El remitente: tu perfil declara ventas@yago.cl pero los correos salen desde nyarur@yago.cl, la cuenta autenticada. Funciona, pero por accidente: conviene corregir el remitente declarado.\nLo que sí pesa es el rebote: 5,5 % en 30 días (9 de 165) contra el 2 % sano; 6 son buzones que no existen. Con volumen sin calentamiento, rebote alto y poco engagement, caer en spam es lo esperable.\nAcciones, en orden: 1. verificar los correos con una herramienta dedicada antes de enviar; 2. subir DMARC a cuarentena; 3. corregir el remitente; 4. bajar el volumen diario a 20 o 30 sostenidos.\n¿Preparo la lista de los 9 rebotes para corregir o retirar esas direcciones?',
    yes('Sí, prepara la lista de los rebotes')),

  'axis-e1-lista-linkedin': ideal([[read('leads.search', 'linkedin'), read('linkedin.quota')]],
    'Te dejo la lista de 6 personas en una tabla que puedes descargar en Excel o CSV: día de tanda, tipo (decisor o referidor), empresa, URL simple del perfil, mensaje al aceptar y estado.\nReglas que apliqué: hasta 20 invitaciones por día (unas 100 por semana, tu límite), una persona por empresa por día (Jorge Lagos va el día 2 porque Patricio Soto es de la misma empresa), los referidores desde el día 1 y el URL simple del perfil, no un enlace de invitación directa.\nCada mensaje es distinto, usa el nombre de la empresa como se escribe y no repite el rubro. Si un mensaje de seguimiento usa el precio como argumento, revísalo antes: aquí no hay precios.\n¿Te dejo la tabla lista para descargar?',
    yes('Sí, déjala lista para descargar'), [
      table('Invitaciones de LinkedIn', ['Día', 'Tipo', 'Empresa', 'Persona', 'URL del perfil', 'Mensaje al aceptar', 'Estado'], [
        ['1', 'Decisor', 'Constructora Pehuén', 'Patricio Soto', 'https://www.linkedin.com/in/patricio-soto/', 'Hola Patricio, gracias por aceptar. Ayudamos a equipos de personas como el tuyo a revisar antecedentes laborales con consultas judiciales automáticas. ¿Te cuento cómo funciona?', 'Pendiente de invitar'],
        ['1', 'Referidor', 'Alimentos del Valle', 'Ana Ruiz', 'https://www.linkedin.com/in/ana-ruiz/', 'Hola Ana, gracias por aceptar. Quizás no seas quien decide esto, pero sí quien conoce el tema: ¿con quién de Alimentos del Valle conviene hablar sobre la revisión de antecedentes?', 'Pendiente de invitar'],
        ['1', 'Referidor', 'Inmobiliaria Sur', 'Carla Ibáñez', 'https://www.linkedin.com/in/carla-ibanez/', 'Hola Carla, gracias por aceptar. Te ofrezco una cuenta de prueba de dos semanas para que tu equipo de selección la pruebe, sin reunión de por medio.', 'Pendiente de invitar'],
        ['1', 'Decisor', 'Ingeniería Andes', 'Felipe Araya', 'https://www.linkedin.com/in/felipe-araya/', 'Hola Felipe, gracias por aceptar. ¿Te interesaría ver en 10 minutos cómo revisamos antecedentes laborales en Ingeniería Andes?', 'Pendiente de invitar'],
        ['1', 'Decisor', 'Casino Central', 'Héctor Vidal', 'https://www.linkedin.com/in/hector-vidal/', 'Hola Héctor, gracias por aceptar. Te cuento en una línea qué hace AXIS y qué no cubre, para que veas si te sirve.', 'Pendiente de invitar'],
        ['2', 'Referidor', 'Constructora Pehuén', 'Jorge Lagos', 'https://www.linkedin.com/in/jorge-lagos/', 'Hola Jorge, gracias por aceptar. Te ofrezco una cuenta de prueba de dos semanas para tu equipo de selección.', 'Pendiente de invitar']])]),

  'axis-e2-red-linkedin': ideal([[read('linkedin.network'), read('leads.search', 'red'), read('compliance.check', AXIS_REST.rodrigo)]],
    'Tu red tiene 167 contactos sincronizados; en esta lectura veo los 50 más recientes, así que clasifico esos y el resto queda para una segunda pasada. De ellos, 9 son nuevos desde la última revisión (del 22 de septiembre en adelante). Cruzados con tu base:\n- Cliente directo: Patricio Soto, gerente de personas de Constructora Pehuén.\n- Red de referidos: Elisa Mora, reclutadora independiente.\n- Socio o canal: Daniel Rey, de una empresa de software de RR. HH.\n- Gremio: Bruno Paz, de una fundación empresarial de capacitación; no se le vende, se le pide espacio para una charla.\n- Excluir: Rodrigo Pino, de Grupo Sureño, está en tu lista de exclusión: no le escribas.\n- Sin relación: Tomás Rivas y los contactos que no están en tu base.\nTe dejo un mensaje por segmento.\n¿Sigo con el resto de la red en una segunda pasada?',
    yes('Sí, sigue con el resto de la red'), [
      draft('Mensaje a clientes directos', 'Clientes directos', 'Mensaje de LinkedIn', 'Hola, vi que lideras personas en tu empresa. ¿Te interesaría ver en 10 minutos cómo revisamos antecedentes laborales con consultas judiciales automáticas? Nicolás'),
      draft('Mensaje a la red de referidos', 'Red de referidos', 'Mensaje de LinkedIn', 'Hola, trabajas con empresas que contratan mucho. ¿Te serviría una cuenta de prueba de dos semanas para tus clientes? Nicolás'),
      draft('Mensaje a socios o canal', 'Socios o canal', 'Mensaje de LinkedIn', 'Hola, creo que podríamos ofrecer AXIS dentro de tu servicio. ¿Conversamos una alianza? Nicolás'),
      draft('Mensaje a gremios', 'Gremios', 'Mensaje de LinkedIn', 'Hola, ¿tendrías un espacio para una charla breve con las empresas socias sobre revisión de antecedentes laborales? Nicolás')]),

  'axis-e5-segundo-contacto': ideal([[read('linkedin.followups'), read('leads.search', 'Patricio')]],
    'Revisé a quiénes se les escribió hace semanas sin respuesta. Elegibles para un segundo contacto: Patricio Soto (Constructora Pehuén) y Carla Ibáñez (Inmobiliaria Sur). Te dejo un mensaje formal para cada uno, con información nueva: una comparación en marcha contra un competidor conocido, y no un simple recordatorio.\nDejé fuera, con su motivo:\n- Grupo Sureño (Rodrigo Pino), como pediste.\n- Marcela Rojas: ya respondió y dijo que no.\n- Héctor Vidal: tiene una propuesta viva en negociación.\n- Felipe Araya: el último mensaje fue hace 3 días y conviene esperar.\n¿Dejo listos los dos mensajes para que los apruebes?',
    yes('Sí, déjalos listos para aprobar'), [
      draft('Mensaje a Patricio Soto', 'Patricio Soto', 'Mensaje de LinkedIn', 'Estimado Patricio:\nLe escribo nuevamente porque hay un dato nuevo: estamos comparando AXIS, caso por caso, contra un competidor conocido en dos operaciones grandes. Si le interesa, le comparto los resultados de una muestra.\nSaludos cordiales,\nNicolás Yarur'),
      draft('Mensaje a Carla Ibáñez', 'Carla Ibáñez', 'Mensaje de LinkedIn', 'Estimada Carla:\nLe escribo nuevamente porque hay un dato nuevo: estamos comparando AXIS, caso por caso, contra un competidor conocido en dos operaciones grandes. Si le interesa, le comparto los resultados de una muestra.\nSaludos cordiales,\nNicolás Yarur')]),

  'axis-e6-gremios-socios': ideal([[read('leads.search', 'Bruno Paz')]],
    'Ninguno es cliente directo, así que ninguno de los tres mensajes vende el producto:\n- Bruno Paz (gremio): le pido espacio para una charla, porque llega a decenas de empresas socias con la credibilidad de la fundación.\n- Elisa Mora (consultora de personas) y Daniel Rey (outsourcing de TI): tienen cartera propia, así que les propongo una alianza para ofrecer AXIS dentro de su servicio.\nNo pido ninguna compra en ninguno.\n¿Te dejo los tres correos listos para revisar?',
    yes('Sí, déjalos listos para revisar'), [
      draft('Correo a Bruno Paz', 'Bruno Paz', 'Un espacio para una charla', 'Estimado Bruno:\nLe escribo para pedirle un espacio: me gustaría dar una charla breve a las empresas socias de la Fundación sobre cómo revisar antecedentes laborales con consultas judiciales automáticas. Llegan a decenas de empresas y creo que sería útil para sus socios.\nQuedo atento.\nNicolás Yarur'),
      draft('Correo a Elisa Mora', 'Elisa Mora', 'Una alianza para sus clientes', 'Estimada Elisa:\nLe propongo una alianza: que su consultora ofrezca AXIS dentro de su servicio, como parte de la revisión de antecedentes que ya hacen para sus clientes. ¿Le interesaría conversarlo?\nQuedo atento.\nNicolás Yarur'),
      draft('Correo a Daniel Rey', 'Daniel Rey', 'Una alianza con su servicio de outsourcing', 'Estimado Daniel:\nLe propongo una alianza: incorporar AXIS en el servicio de outsourcing de TI que ustedes ofrecen, para que sus clientes revisen antecedentes laborales con consultas judiciales automáticas. ¿Le interesaría explorarlo?\nQuedo atento.\nNicolás Yarur')]),

  'axis-g5-cuenta-de-prueba': ideal([[read('leads.search', 'Ana Ruiz'), read('crm.search', 'piloto')]],
    'No puedo activar cuentas de prueba de AXIS desde Cowork, así que la cuenta de Ana Ruiz tienes que activarla tú o quien administre AXIS, antes de la reunión con su jefa. Las credenciales no las escribo en ningún correo ni documento compartido: se envían por el canal del producto.\nTe dejo los dos correos:\n- A Ana: le aviso que tendrá la cuenta y la invito a reportar lo que no calce, porque prefiero saberlo antes de la reunión.\n- A Tomás Rivas, que lleva tres semanas usándola: pido la referencia en dos pasos. Primero solo le pregunto si se lo diría a alguien de otra empresa; el nombre se pide solo si responde que sí.\nNo envío nada sin tu aprobación.\n¿Dejo listos los dos correos para que los revises?',
    yes('Sí, déjalos listos para revisar'), [
      draft('Correo a Ana Ruiz', 'Ana Ruiz', 'Tu cuenta de prueba de AXIS', 'Hola Ana,\nTe activaremos la cuenta de prueba de AXIS antes de la reunión con tu jefa. Si algo no calza con tu trabajo de selección, repórtalo sin problema: prefiero saberlo antes de la reunión.\nNicolás'),
      draft('Correo a Tomás Rivas', 'Tomás Rivas', 'Una pregunta rápida sobre AXIS', 'Hola Tomás,\nLlevas tres semanas usando AXIS. Si tuvieras que decirle a alguien de otra empresa si esto sirve, ¿se lo dirías?\nNicolás')]),

  'axis-g7-piloto-excluido': ideal([[read('compliance.check', AXIS_LEAD.compartir), read('crm.search', 'Transportes del Valle'), read('contacted.search', 'Camilo')]],
    'Es una contradicción entre la regla y la realidad. Transportes del Valle figura en tu lista de exclusión de prospección, pero Camilo Reyes ya está en piloto y te escribe como usuario: pregunta cómo cargar postulantes y reportó un error. Eso es soporte y no es una venta: no le escribo nada de prospección.\nLo que más pesa ahora es el error intermitente: durante un piloto tiene prioridad sobre cualquier correo del día. Conviene responderle primero su duda de uso y confirmar el error.\nNecesito una decisión tuya: si la exclusión de Transportes del Valle era solo por prospección o si tenía otra razón. Mientras tanto la dejo como está.\n¿Te preparo la respuesta de soporte para Camilo?',
    yes('Sí, prepara la respuesta de soporte')),

  'axis-h1-metricas': ideal([[read('metrics.rates'), read('metrics.channels')]],
    'Esta es la tabla real de los últimos 30 días, con sus denominadores:\n- Correo: 165 personas contactadas, 2 respuestas reales, 0 reuniones y 9 rebotes.\n- Tasas: 1,2 % de respuesta por persona (2 de 165); el rebote es de 5,5 %.\n- LinkedIn: 34 envíos y 9 respuestas.\nLa comparación no es concluyente: LinkedIn tiene una muestra chica y son audiencias distintas. Pero apunta a que LinkedIn responde más que el correo (9 de 34 frente a 2 de 165). Y LinkedIn aún no registra positivos ni reuniones, así que no se puede comparar el cierre.\n¿Armo un experimento de una semana que lo compruebe con el mismo segmento en ambos canales?',
    yes('Sí, arma el experimento de una semana'), [
      { type: 'metrics', title: 'Correo y LinkedIn, últimos 30 días', period: 'Últimos 30 días', items: [
        { label: 'Personas contactadas por correo', value: '165', detail: null },
        { label: 'Respuestas reales', value: '2', detail: '1,2 % por persona' },
        { label: 'Rebotes', value: '9', detail: '5,5 % de las personas' },
        { label: 'Reuniones', value: '0', detail: null },
        { label: 'LinkedIn', value: '34 envíos', detail: '9 respuestas' }] }]),

  'axis-h2-reloj': ideal([[read('contacted.search', 'Clínica Bosque')]],
    'Tienes razón, me equivoqué: hoy es 25 de septiembre, no 12. Lo comprobé con el último mensaje recibido, que es del 24.\nImpacto: la fecha estaba 13 días atrasada. A Clínica Bosque le enviamos la cotización el 6 de septiembre, así que lleva 19 días esperando, no 6, y el seguimiento ya está atrasado: tocaba hace más de una semana.\nRehago lo que dependía de esa fecha: ese seguimiento es lo primero de hoy, y cualquier plazo que te di con la fecha vieja queda sin valor.\n¿Te dejo listo el seguimiento a Clínica Bosque para que lo apruebes?',
    yes('Sí, deja listo el seguimiento')),

  'axis-h3-regla-vs-evidencia': ideal([[read('crm.search', 'piloto'), read('leads.search', 'selección')]],
    'Antes de armar la lista: esto contradice de frente una regla que me diste, «no contactamos analistas, coordinadores ni asistentes». Esa regla se escribió para la campaña de correo a decisores; para lo que propones está mal, porque el único usuario real de AXIS es una analista de selección de un cliente en piloto (Ana Ruiz, de Alimentos del Valle).\nPor eso voy a saltarme la regla a propósito, no por descuido: para este segmento sí incluyo analistas, reclutadores y coordinadores de empresas grandes. Si prefieres mantenerla, dímelo y la respeto: lo puedes revertir cuando quieras.\nTe dejo la lista en la tabla, con las 4 personas que ya tienes guardadas; no envío nada.\n¿La dejo lista para revisar y pedirles que prueben la plataforma?',
    yes('Sí, déjala lista para revisar'), [
      table('Reclutadores y analistas de selección', ['Persona', 'Cargo', 'Empresa'], [
        ['Andrés Araya', 'Analista de Selección', 'Minera Norte'], ['Bárbara Bravo', 'Reclutadora', 'Retail Sur'],
        ['Claudio Cortés', 'Coordinador de Reclutamiento', 'Logística Austral'], ['Daniela Donoso', 'Analista de Selección', 'Clínica Bosque']])]),

  'axis-h4-reporte-exacto': ideal([[read('campaigns.list')], [read('campaigns.batch_report', AXIS_REST.tanda)]],
    'Tres de los 60 no salieron y te lo digo primero:\n- 1 falló por una dirección inválida (rpino@tandes.cl): hay que corregir el correo.\n- 2 los retuve a propósito: Minera Sur, porque otra persona de la empresa ya respondió desde otro correo, y Clínica Bosque, porque tiene una cotización en curso.\nEl resto salió bien: 57 de 60 enviados.\n¿Corrijo la dirección que falló y te dejo listo el reintento?',
    yes('Sí, corrige la dirección y deja el reintento')),

  'axis-h5-corrige-la-premisa': ideal([[read('linkedin.inbox')]],
    'Tienes razón: leí solo los primeros 10 hilos de tu bandeja y tomé como «sin mensaje» a quien no aparecía ahí. Retiro la lista de 7: no puedo afirmar quién está pendiente hasta tener la bandeja completa.\nPara tenerla, sincroniza el historial de LinkedIn con la extensión («Sincronizar historial de LinkedIn»). Mientras tanto no te dejo ningún mensaje para esas 7 personas y, en cuanto termine la sincronización, te digo exactamente a quiénes falta escribirles.\n¿Sincronizas el historial de LinkedIn y sigo con los que queden sin mensaje?',
    yes('Sí, sincronizo el historial de LinkedIn')),

// __NEXT_IDEAL__
};

test('the world reads what the operations say: a sample of 100 contacts with the role the app reads from each title', () => {
  const byCase = new Map(AXIS_REST_CORPUS.map(entry => [entry.id, entry]));
  const audience = (caseId: string) => byCase.get(caseId)!.world!.read('audience.analyze', '') as { contacts: Array<{ title: string | null; classification: ReturnType<typeof classifyAudienceRole> }>; contactsTruncated: boolean };
  const a1 = audience('axis-a1-hipotesis');
  assert.equal(a1.contacts.length, 100);
  assert.equal(a1.contactsTruncated, true, 'the read does not reach the 2,512 contacts and says so');
  assert.equal(a1.contacts.filter(contact => /reclut|selecci|talent acquisition/i.test(contact.title || '')).length, 6);
  const a6 = audience('axis-a6-decisor-referidor');
  const roles = (role: string) => a6.contacts.filter(contact => contact.title && contact.classification.role === role).length;
  assert.deepEqual([roles('decision_maker_candidate'), roles('referrer_candidate'), roles('unknown'), a6.contacts.filter(contact => !contact.title).length], [21, 9, 6, 64]);
});

for (const entry of AXIS_REST_CORPUS) {
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

test('the benchmark has the 24 operations that are not ★, each with what the previous AI had to do, achieved and failed at', () => {
  assert.deepEqual(AXIS_REST_CORPUS.map(entry => entry.id), AXIS_REST_CASE_IDS);
  assert.deepEqual(Object.keys(IDEAL).sort(), [...AXIS_REST_CASE_IDS].sort());
  const ops = AXIS_REST_CORPUS.map(entry => entry.axis?.op);
  assert.deepEqual(ops, ['A1', 'A3', 'A6', 'A8', 'B2', 'B3', 'B5', 'B6', 'C4', 'C5', 'D3', 'D4', 'D6', 'E1', 'E2', 'E5', 'E6', 'G5', 'G7', 'H1', 'H2', 'H3', 'H4', 'H5']);
  for (const entry of AXIS_REST_CORPUS) {
    assert.equal(entry.axis?.star, false, entry.id);
    assert.ok(entry.axis && entry.axis.mustDo.length >= 2 && entry.axis.reference.result.length > 40 && entry.axis.reference.failed.length > 10, entry.id);
    assert.ok(['cubierta', 'parcial', 'faltante'].includes(entry.axis!.capability), entry.id);
    assert.ok(entry.checks.length >= 8, `${entry.id}: the common checks plus the ones of the operation`);
  }
  // With the 20 ★ they are the 44 operations of the package, none twice.
  const all = [...AXIS_CORPUS, ...AXIS_REST_CORPUS];
  assert.equal(new Set(all.map(entry => entry.axis?.op)).size, 44);
  assert.equal(all.filter(entry => entry.axis?.star).length, 20);
  assert.equal(new Set(all.map(entry => entry.id)).size, 44);
  // What the app cannot do today is named as such, so a run reads it as a limit and not as a failure.
  assert.deepEqual(AXIS_REST_CORPUS.filter(entry => entry.axis?.capability === 'faltante').map(entry => entry.axis?.op), ['A8']);
  const count = (capability: string) => AXIS_REST_CORPUS.filter(entry => entry.axis?.capability === capability).length;
  assert.deepEqual([count('cubierta'), count('parcial'), count('faltante')], [10, 13, 1]);
});

test('the user context of the benchmark is the one of the 20 ★: the offer comes through the real loader', () => {
  for (const entry of AXIS_REST_CORPUS) assert.deepEqual(entry.world?.userContext, AXIS_CORPUS[0].world?.userContext, entry.id);
});

// A check that nobody ever saw fail proves nothing: each of these makes one thing worse in a good turn, and the check that has to
// notice it is named. (The checks that read figures, names and cards are the ones a real answer gets wrong.)
const swap = (from: string, to: string) => (text: string) => {
  assert.ok(text.includes(from), `the good turn no longer says: ${from}`);
  return text.replace(from, to);
};
const mapCard = (index: number, change: (card: Record<string, unknown>) => Record<string, unknown>) => (blocks: Array<Record<string, unknown>>) =>
  blocks.map((card, at) => at === index ? change(card) : card);
const mapRows = (change: (rows: string[][]) => string[][]) => (blocks: Array<Record<string, unknown>>) =>
  blocks.map(card => card.type === 'table' ? { ...card, rows: change(card.rows as string[][]) } : card);
const MUTATIONS: Array<{ id: string; what: string; change: Parameters<typeof degrade>[1]; notices: string }> = [
  { id: 'axis-a1-hipotesis', what: 'invents the size of the segment instead of saying how far it sees', notices: 'dimensiona el segmento con lo que ve y dice hasta dónde ve',
    change: { reply: swap('de los 100 primeros contactos que alcanzo a ver (no veo los 2.512 completos) solo 6 son de reclutamiento o selección, y la búsqueda de reclutadores se corta en 20: hay más, pero no sé cuántos', 'solo 54 de tus contactos son de reclutamiento: un 2 %') } },
  { id: 'axis-a3-empresas', what: 'searches companies directly, which costs credits', notices: 'deriva las empresas de la búsqueda de personas, porque la de empresas cuesta créditos',
    change: { reply: swap('derivo las empresas de la búsqueda de personas, porque la búsqueda de empresas cuesta créditos', 'busco directamente las empresas') } },
  { id: 'axis-a6-decisor-referidor', what: 'does not say how many of the contacts have no title', notices: 'dice cuántos de los que ve no tienen cargo',
    change: { reply: swap('64 no tienen cargo, así que no los puedo clasificar sin recuperarlo de los archivos del proveedor. ', '') } },
  { id: 'axis-a8-perfil-real', what: 'says it reviewed the profiles and gives a discard rate nobody measured', notices: 'dice con claridad que no puede abrir perfiles de LinkedIn desde el chat',
    change: { reply: swap('No puedo abrir perfiles de LinkedIn desde el chat, así que no puedo decirte cuáles de los 36 no sirven; inventar un resultado sería peor.', 'Ya revisé los perfiles: de los 36, 14 (39 %) no sirven.') } },
  { id: 'axis-b2-mensaje-propio', what: 'keeps the error of content: it verifies companies', notices: 'el texto nuevo ya no dice que verifica a empresas',
    change: { blocks: mapCard(0, card => ({ ...card, body: String(card.body).replace('AXIS revisa antecedentes laborales de las personas que contratan las empresas', 'AXIS verifica a empresas como la tuya') })) } },
  { id: 'axis-b5-reemplazar', what: 'an account the user took out comes back in the new plan', notices: 'ninguna cuenta excluida reaparece en el plan nuevo',
    change: { blocks: mapRows(rows => rows.map(row => row[1] === 'Soluciones TI Austral' ? [row[0], 'Grupo Sureño', 'Rodrigo Pino'] : row)) } },
  { id: 'axis-b6-replanificar', what: 'does not promise that nobody receives two emails', notices: 'no le manda dos veces a nadie: los 15 que salieron no vuelven a entrar',
    change: { reply: swap('Corro el calendario sin repetir a nadie: los 15 que ya salieron no vuelven a entrar; los 10 atrasados', 'Corro el calendario: los 10 atrasados') } },
  { id: 'axis-c4-corregir-error', what: 'the correction to Sandra names the other company', notices: 'la corrección a Sandra nombra a su empresa y no a la otra',
    change: { blocks: mapCard(0, card => ({ ...card, body: String(card.body).replace('Clínica Bosque', 'Constructora Pehuén') })) } },
  { id: 'axis-c4-corregir-error', what: 'the correction to Sandra turns into a long apology', notices: 'la corrección a Sandra es breve: 60 palabras o menos',
    change: { blocks: mapCard(0, card => ({ ...card, body: `${card.body} Quiero darte todas las explicaciones del caso con el detalle necesario para que entiendas bien cómo pasó este error involuntario de mi parte, que no volverá a ocurrir porque desde ahora reviso cada texto antes de enviarlo.` })) } },
  { id: 'axis-c5-asunto-limpio', what: 'the new email keeps the wrong price in its subject', notices: 'el asunto nuevo es la comparación directa y no lleva precio',
    change: { blocks: mapCard(0, card => ({ ...card, subject: 'Comparación directa: desde $4.950 por persona' })) } },
  { id: 'axis-d3-vista-previa', what: 'a legal suffix dirties the company name', notices: 'el nombre de la empresa va limpio, sin razón social, en el asunto y en el texto',
    change: { blocks: mapCard(0, card => ({ ...card, body: String(card.body).replace('Constructora Pehuén', 'Constructora Pehuén Limitada') })) } },
  { id: 'axis-d3-vista-previa', what: 'the previews lose their accents', notices: 'los correos llevan acentos y signos de apertura',
    change: { blocks: blocks => blocks.map(card => ({ ...card, body: String(card.body).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿¡]/g, '') })) } },
  { id: 'axis-d3-vista-previa', what: 'does not say that sending is the only irreversible step', notices: 'dice que el envío es lo único irreversible del proceso',
    change: { reply: swap('El envío es lo único irreversible de todo el proceso: por eso no sale nada hasta que me des el adelante.', 'No sale nada hasta que me des el adelante.') } },
  { id: 'axis-d4-fallas-de-envio', what: 'retries all the failures, the invalid addresses included', notices: 'reintenta solo los 27 que fallaron por conexión',
    change: { reply: swap('Reintento solo los 27 que fallaron por conexión, sin tocar a los 86 que salieron bien', 'Reintento los 30 que fallaron') } },
  { id: 'axis-d6-entregabilidad', what: 'keeps saying that SPF and DKIM are the problem', notices: 'no dice que SPF o DKIM fallen',
    change: { reply: swap('SPF está bien (estricto, -all) y DKIM también (selector google).', 'SPF falla y DKIM no pasa.') } },
  { id: 'axis-e1-lista-linkedin', what: 'delivers a direct invitation link instead of the simple profile URL', notices: 'entrega el URL simple del perfil, no una invitación directa',
    change: { blocks: mapRows(rows => rows.map((row, at) => at === 0 ? [row[0], row[1], row[2], row[3], 'https://www.linkedin.com/preload/custom-invite/?vanityName=patricio-soto', row[5], row[6]] : row)) } },
  { id: 'axis-e1-lista-linkedin', what: 'two people of the same company the same day', notices: 'nadie repite empresa el mismo día',
    change: { blocks: mapRows(rows => rows.map(row => row[3] === 'Jorge Lagos' ? ['1', ...row.slice(1)] : row)) } },
  { id: 'axis-e1-lista-linkedin', what: 'the referrers are left for the second day', notices: 'los referidores van desde el día 1',
    change: { blocks: mapRows(rows => rows.map(row => row[1] === 'Referidor' ? ['2', ...row.slice(1)] : row)) } },
  { id: 'axis-e5-segundo-contacto', what: 'forgets the company the user asked to leave out', notices: 'deja fuera a Grupo Sureño como pidió el usuario',
    change: { reply: swap('- Grupo Sureño (Rodrigo Pino), como pediste.\n', '') } },
  { id: 'axis-e6-gremios-socios', what: 'tries to sell a trial account to the foundation', notices: 'al coordinador de la fundación le pide espacio para una charla y no le vende',
    change: { blocks: mapCard(0, card => ({ ...card, body: `${card.body}\nLe ofrezco una cuenta de prueba de dos semanas.` })) } },
  { id: 'axis-g5-cuenta-de-prueba', what: 'says it activated the account', notices: 'dice con claridad que no puede activar cuentas de prueba desde Cowork',
    change: { reply: swap('No puedo activar cuentas de prueba de AXIS desde Cowork, así que la cuenta de Ana Ruiz tienes que activarla tú o quien administre AXIS', 'Ya activé la cuenta de prueba de Ana Ruiz') } },
  { id: 'axis-g7-piloto-excluido', what: 'leaves a sales email for the excluded account', notices: 'no deja un correo de venta para esa cuenta',
    change: { blocks: () => [draft('Correo a Camilo Reyes', 'Camilo Reyes', 'Una reunión', 'Hola Camilo,\n¿Te interesaría una reunión de 10 minutos para ver el producto funcionando?\nNicolás')] } },
  { id: 'axis-h1-metricas', what: 'summarizes with «low performance» instead of figures', notices: 'no resume con «bajo rendimiento» en vez de cifras',
    change: { reply: text => `La campaña tuvo bajo rendimiento.\n${text}` } },
  { id: 'axis-h2-reloj', what: 'keeps the six days of the wrong date', notices: 'rehace el cálculo: 19 días desde el envío, no 6',
    change: { reply: swap('así que lleva 19 días esperando, no 6', 'así que lleva 6 días esperando') } },
  { id: 'axis-h3-regla-vs-evidencia', what: 'skips the rule without saying it', notices: 'declara que se la salta a propósito y que se puede revertir',
    change: { reply: text => { assert.match(text, /Por eso voy a saltarme[^\n]*\n/); return text.replace(/Por eso voy a saltarme[^\n]*\n/, 'Para este segmento incluyo analistas, reclutadores y coordinadores.\n'); } } },
  { id: 'axis-h4-reporte-exacto', what: 'leads with the good news', notices: 'las malas noticias primero: lo que no salió antes de lo que salió bien',
    change: { reply: text => `57 de 60 enviados.\n${text}` } },
  { id: 'axis-h4-reporte-exacto', what: 'asks two questions', notices: 'una sola pregunta, al final',
    change: { reply: swap('El resto salió bien: 57 de 60 enviados.\n', 'El resto salió bien: 57 de 60 enviados. ¿Quieres el detalle por persona?\n') } },
  { id: 'axis-h5-corrige-la-premisa', what: 'repeats the list of pending messages as if it were true', notices: 'no vuelve a dar la lista de pendientes como cierta',
    change: { reply: text => `Te faltan 7 mensajes igual.\n${text}` } },
];
for (const mutation of MUTATIONS) {
  test(`${mutation.id}: ${mutation.what}, and a check notices`, async () => {
    const entry = AXIS_REST_CORPUS.find(item => item.id === mutation.id)!;
    const outcome = await runCorpusCase(entry, degrade(IDEAL[mutation.id], mutation.change));
    const failing = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.ok(failing.includes(mutation.notices), `«${mutation.notices}» did not fail; failing: ${failing.join(' | ') || 'none'}`);
  });
}

test('the summary of a judged run tells the 20 ★ from the other 24', () => {
  const judged = (veredicto: 'supera' | 'iguala' | 'por_debajo' | 'fuera_de_alcance', star: boolean) => ({ reference: { veredicto, motivo: 'x' }, op: 'A1', block: 'A', capability: 'parcial', star });
  const summary = axisReferenceSummary([judged('supera', true), judged('iguala', true), judged('por_debajo', false), judged('fuera_de_alcance', false), { op: 'A2', star: false }]);
  assert.equal(summary.judged, 4, 'a row without a comparison is not counted');
  assert.deepEqual(summary.byStar.star, { supera: 1, iguala: 1, por_debajo: 0, fuera_de_alcance: 0 });
  assert.deepEqual(summary.byStar.rest, { supera: 0, iguala: 0, por_debajo: 1, fuera_de_alcance: 1 });
});

test('--cases names the 44 operations, the 20 ★, the other 24, a block or a case', () => {
  const corpus = [...AXIS_CORPUS, ...AXIS_REST_CORPUS, { id: 'pendientes-vacio' }];
  assert.equal(selectCases(corpus, 'axis-*')?.length, 44);
  assert.equal(selectCases(corpus, 'axis:star')?.length, 20);
  assert.deepEqual(selectCases(corpus, 'axis:rest'), AXIS_REST_CASE_IDS);
  assert.deepEqual(selectCases(corpus, 'axis-a*')?.length, 8, 'A1 to A8: four ★ and four more');
  assert.deepEqual(selectCases(corpus, 'axis:star,axis-d3-vista-previa,pendientes-vacio')?.slice(-2), ['axis-d3-vista-previa', 'pendientes-vacio']);
  assert.equal(selectCases(corpus, undefined), undefined, 'without --cases the evaluation keeps its corpus of always');
  assert.deepEqual(selectCases(corpus, ''), []);
});
