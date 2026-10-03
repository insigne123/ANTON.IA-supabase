/**
 * The user manual: one source for the «?» panel of each screen, the «Centro de ayuda» page (/ayuda) and the answers of
 * «Pregúntale a la IA». Every statement here describes what the app does today; check the screen before changing a line
 * (docs/ui-ux/ayuda-y-manual.md).
 */

export type HelpFaq = { q: string; a: string };

export type HelpGroup = 'Empieza aquí' | 'Prospectar' | 'Contactos' | 'Seguimiento' | 'Configuración' | 'Administración';

export type HelpSection = {
  id: string;
  /** The name of the screen, as the menu says it. */
  title: string;
  group: HelpGroup;
  /** Where the screen lives; none for topics that span the app (créditos, primeros pasos). */
  href?: string;
  /** Paths whose «?» opens this section. */
  routes?: RegExp;
  /** Hidden when the feature is off for the person (same rules as the menu). */
  feature?: 'opportunities' | 'admin';
  /** What the screen is for, in one or two sentences. */
  summary: string;
  /** How to use it, in the order of the work. */
  steps: string[];
  tips?: string[];
  faqs: HelpFaq[];
  /** Other sections worth reading next. */
  related?: string[];
};

export const HELP_GROUPS: HelpGroup[] = ['Empieza aquí', 'Prospectar', 'Contactos', 'Seguimiento', 'Configuración', 'Administración'];

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'primeros-pasos',
    title: 'Primeros pasos',
    group: 'Empieza aquí',
    summary: 'ANTON.IA te ayuda a encontrar prospectos, investigarlos y escribirles con correos que la IA prepara y tú apruebas. Este es el camino hasta tu primer correo.',
    steps: [
      'Completa «Perfil»: qué vendes, a quién y por qué elegirte. «Complétalo con IA» lo propone leyendo el sitio de tu empresa.',
      'Conecta tu correo en «Conexiones» (Gmail u Outlook). Los correos salen desde tu cuenta y las respuestas vuelven a la app.',
      'Busca prospectos en «Buscar prospectos» y guarda a quienes te interesen.',
      'En «Por completar», selecciona a tus guardados y pulsa «Buscar correo». Los que lo tienen pasan a «Por escribir».',
      'En «Por escribir», investiga a cada contacto y pulsa «Contactar»: la IA prepara el correo inicial y sus seguimientos.',
      'Revisa el correo, pulsa «Confirmar revisión» y después «Enviar ahora». Nada sale sin que tú lo envíes o lo apruebes.',
      'Sigue las respuestas en «Conversaciones» y en «Hoy».',
    ],
    tips: [
      '«Hoy» muestra en «Prepara tu cuenta» qué te falta (perfil, correo conectado, primeros contactos y primer envío).',
      'El botón «?» de la barra superior explica la pantalla en la que estás, y «Ver tutorial», al final del menú, repite el recorrido completo.',
    ],
    faqs: [
      { q: '¿Por dónde empiezo?', a: 'Por «Perfil» y «Conexiones». Sin tu oferta la IA no puede redactar, y sin correo conectado no puedes enviar. «Hoy» te dice cuál de los dos te falta.' },
      { q: '¿La IA envía correos sola?', a: 'No. La IA prepara borradores. Un correo individual sale cuando pulsas «Enviar ahora», y una campaña cuando la apruebas.' },
      { q: '¿Cómo vuelvo a ver el tutorial?', a: 'Con «Ver tutorial», al final del menú. Lo puedes cerrar en cualquier paso con «Omitir».' },
    ],
    related: ['perfil', 'conexiones', 'buscar', 'por-escribir'],
  },
  {
    id: 'hoy',
    title: 'Hoy',
    group: 'Empieza aquí',
    href: '/dashboard',
    routes: /^\/dashboard\/?$/,
    summary: 'Tu inicio: lo que toca ahora, lo que falta para enviar y cómo va tu semana.',
    steps: [
      '«Lo primero hoy» muestra una sola acción, en este orden: responder a quien te respondió, resolver lo que impide enviar, un compromiso que vence hoy, escribir a tus contactos con correo, completar correos o buscar prospectos.',
      '«Lo que te espera» lista hasta 6 pendientes, los urgentes primero. Cada uno abre la conversación exacta.',
      '«Prepara tu cuenta» tiene cuatro pasos comprobados: perfil con empresa y oferta, correo conectado, primeros contactos y primer envío. Cada paso pendiente trae su enlace.',
      'Abajo están «Tu semana» (cifras y gráfico) y «Créditos y uso diario».',
    ],
    faqs: [
      { q: '¿Por qué «Prepara tu cuenta» dice que mi correo no está conectado?', a: 'Mira si hay una conexión guardada de Gmail u Outlook. La sesión de Outlook abierta solo en el navegador no cuenta. Conéctalo en «Conexiones».' },
      { q: '¿Qué es un compromiso?', a: 'Una fecha o próximo paso acordado con un contacto, como una reunión. Cuando vence hoy o ya venció, aparece en «Lo que te espera».' },
    ],
    related: ['primeros-pasos', 'creditos', 'conversaciones'],
  },
  {
    id: 'buscar',
    title: 'Buscar prospectos',
    group: 'Prospectar',
    href: '/search',
    routes: /^\/search\/?$/,
    summary: 'Encuentra a las personas a quienes venderles y guárdalas para escribirles.',
    steps: [
      'Elige cómo buscar: «Filtros» (cargo, nivel, sector, tamaño y sede de la empresa), «Empresa» (las personas de una empresa en particular) o «Perfil» (pega la dirección de un perfil de LinkedIn).',
      'Si no sabes qué filtros usar, elige un punto de partida: rellena cargos e industrias según lo que vendes y «Tu cliente ideal» de «Perfil». Todo queda editable.',
      'Con «Filtros» primero ves empresas: selecciona las que te interesan y busca contactos en ellas.',
      'Marca a las personas que te interesan y pulsa «Guardar seleccionados». El aviso dice dónde quedó cada una y trae el botón para seguir.',
      'Guarda los criterios con «Guardar» para repetir la búsqueda otro día.',
    ],
    tips: [
      'Con cero resultados, la pantalla lista los filtros activos con un botón «Quitar» en cada uno.',
      'El correo laboral se pide al guardar o al buscar el correo. El teléfono es opcional: cuesta 10 créditos por persona y llega en 1 a 3 minutos, si el proveedor lo tiene.',
      'Los contactos ya contactados aparecen marcados como «Contactado».',
    ],
    faqs: [
      { q: 'La búsqueda por perfil de LinkedIn no encontró a la persona. ¿Qué hago?', a: 'Pulsa «Buscar en «Empresa»» y escribe su empresa y su cargo: el nombre se toma de la dirección del perfil. El proveedor de datos no tiene a todas las personas de LinkedIn.' },
      { q: 'Dice que encontró a otra persona. ¿Por qué?', a: 'Suele pasar cuando la persona cambió la dirección de su perfil. ANTON.IA nunca muestra datos de otra persona; busca por empresa y cargo.' },
      { q: '¿Sirve una dirección de Sales Navigator o de una empresa?', a: 'No. Copia la dirección del perfil público, la que empieza con linkedin.com/in/. Para una empresa usa el modo «Empresa».' },
      { q: 'El proveedor no respondió. ¿Perdí créditos?', a: 'Es un problema temporal que no depende de la dirección. Pulsa «Reintentar» en unos minutos.' },
      { q: '¿Cuántas búsquedas puedo hacer?', a: 'Hay un uso diario por persona que se reinicia a medianoche (UTC). Lo ves en «Hoy», en «Créditos y uso diario».' },
    ],
    related: ['por-completar', 'perfil', 'creditos'],
  },
  {
    id: 'oportunidades',
    title: 'Oportunidades',
    group: 'Prospectar',
    href: '/opportunities',
    routes: /^\/opportunities(\/.*)?$/,
    feature: 'opportunities',
    summary: 'Encuentra empresas que están contratando el perfil que ofreces y luego contacta a sus decisores.',
    steps: [
      'Busca ofertas de empleo por cargo y ubicación, y elige la antigüedad de la publicación (24 horas, 7 días o 30 días).',
      'Revisa las empresas y guarda las que quieras trabajar.',
      'Desde una empresa, busca a sus decisores: la búsqueda se abre lista y los guardas en «Por completar».',
    ],
    faqs: [
      { q: '¿Para qué sirve saber que una empresa está contratando?', a: 'Es una razón concreta para escribirle: si busca personal, puede necesitar lo que ofreces.' },
    ],
    related: ['buscar', 'por-completar'],
  },
  {
    id: 'por-completar',
    title: 'Por completar',
    group: 'Contactos',
    href: '/saved/leads',
    routes: /^\/saved\/leads\/?$/,
    summary: 'Contactos guardados que aún no tienen correo. Busca su correo: quien lo recibe pasa a «Por escribir» y quien no, queda aquí marcado.',
    steps: [
      'Arriba ves cuántos están «Sin buscar», «Sin correo» (se buscó y no apareció) y «Con correo». Cada uno filtra la lista.',
      'Pulsa «Buscar correo» en una fila, o selecciona varios: la barra de abajo dice cuántos créditos usa. Puedes pedir también el teléfono.',
      'Quien recibe correo pasa a «Por escribir». Quien no, queda aquí marcado «Sin correo», con la fecha de la búsqueda.',
      'Si alguien ya tiene correo, «Pasar a «Por escribir»» lo mueve sin buscar y sin usar créditos.',
    ],
    tips: [
      'Buscar el correo usa tu cupo diario de enriquecimiento: una unidad por contacto.',
      'Con «Exportar» descargas las filas visibles.',
    ],
    faqs: [
      { q: 'Busqué el correo y el contacto desapareció de la lista. ¿Dónde está?', a: 'En «Por escribir», porque ya tiene correo. El aviso de la búsqueda tiene «Ver» para ir directo.' },
      { q: '¿Qué pasa si no se encuentra el correo?', a: 'El contacto se queda aquí marcado «Sin correo», con la fecha. Puedes pulsar «Buscar de nuevo» otro día o escribirle por LinkedIn.' },
      { q: '¿Quién guardó este contacto?', a: 'La columna «Encontrado por» dice qué persona del equipo lo guardó.' },
    ],
    related: ['por-escribir', 'buscar', 'creditos'],
  },
  {
    id: 'por-escribir',
    title: 'Por escribir',
    group: 'Contactos',
    href: '/saved/leads/enriched',
    routes: /^\/saved\/leads\/enriched\/?$/,
    summary: 'Contactos con correo. Investígalos y escríbeles: la IA prepara el borrador y tú lo revisas.',
    steps: [
      'Marca en la columna «Investigar» a quienes quieras investigar (hasta 50 por vez) y pulsa «Investigar selección». La IA reúne evidencia de su empresa y su rol para que el correo no sea genérico.',
      'Cuando un contacto está «Investigado», abre «Ver investigación» para leer el informe y sus fuentes.',
      'Pulsa «Contactar» (uno o varios): se abre la investigación con el contacto listo para preparar su secuencia.',
      'La IA prepara un correo inicial y sus seguimientos como borradores. Preparar no envía nada.',
      'Pulsa «Revisar y editar correos» para revisarlos y enviarlos.',
    ],
    tips: [
      '«Información limitada» indica que se encontró poca evidencia: el correo será más general.',
      'Filtra por teléfono (disponible, en proceso o sin teléfono) y por empresa, nombre o cargo, incluyendo o excluyendo términos.',
    ],
    faqs: [
      { q: '¿Tengo que investigar antes de escribir?', a: 'Es lo recomendado: con evidencia de la empresa y del rol, el correo es más concreto.' },
      { q: '¿Cuánto tarda una investigación?', a: 'Unos minutos. Puedes seguir usando la app; el estado se actualiza en la lista.' },
      { q: 'La IA no puede redactar y dice que falta mi oferta. ¿Qué hago?', a: 'Completa «Lo que vendes» en «Perfil» (servicios o propuesta de valor). La IA solo afirma lo que está en tu perfil.' },
      { q: '¿Puedo borrar una investigación?', a: 'Sí: desde el informe («Eliminar investigación de este lead») o con «Más acciones» para los seleccionados.' },
    ],
    related: ['correo', 'perfil', 'conversaciones'],
  },
  {
    id: 'correo',
    title: 'Preparar y enviar un correo',
    group: 'Contactos',
    routes: /^\/contact\/(compose|sequence)\/?$/,
    summary: 'Dónde revisas la secuencia que preparó la IA, la ajustas y envías el correo inicial desde tu cuenta.',
    steps: [
      '«Tu secuencia de contacto» muestra el avance: tema, correo inicial, seguimientos y revisión. Puedes cerrar la página y volver: el progreso queda guardado.',
      'Con la secuencia lista, pulsa «Revisar y editar correos».',
      'Revisa la línea «De:»: dice desde qué correo saldrá. Si no hay correo conectado, aparece «Conectar Gmail» y el envío queda deshabilitado.',
      'Edita el texto o pide un ajuste a la IA («Qué quieres cambiar») sin perder la investigación.',
      'Pulsa «Guardar cambios», luego «Confirmar revisión» (no envía todavía) y por último «Enviar ahora».',
    ],
    tips: [
      '«Pedir otra versión a la IA» prepara una secuencia nueva con tus indicaciones y conserva la actual.',
      'Los seguimientos se detienen si la persona responde.',
    ],
    faqs: [
      { q: '¿Desde qué correo sale?', a: 'Desde tu cuenta conectada de Gmail u Outlook. La línea «De:» lo muestra antes de enviar.' },
      { q: '¿«Confirmar revisión» envía el correo?', a: 'No. Confirma que lo revisaste. El correo sale con «Enviar ahora».' },
      { q: 'Dice «La solicitud no obtuvo confirmación». ¿Se envió dos veces?', a: 'No. Puedes reintentar con seguridad: se usa la misma operación, así que no se duplica.' },
      { q: '¿Puedo cambiar el estilo de los correos?', a: 'Sí: elige un «Perfil de estilo» al preparar, o crea estilos en «Firmas y estilo».' },
    ],
    related: ['por-escribir', 'firmas', 'conexiones'],
  },
  {
    id: 'tabla',
    title: 'Tabla de datos',
    group: 'Contactos',
    href: '/sheet',
    routes: /^\/(sheet|leads\/import)\/?$/,
    summary: 'Tus contactos en una hoja tipo Excel para revisar, ordenar, filtrar y exportar.',
    steps: [
      'Busca en la hoja o filtra por estado (por ejemplo, enriquecido o respondido) e industria.',
      'Elige las columnas visibles: la selección y el orden también se usan al exportar.',
      'Exporta las filas visibles con «Exportar filas visibles» o elige otro formato.',
      'Desde una fila con correo, «Preparar correo» abre el editor de correo de ese contacto.',
    ],
    faqs: [
      { q: '¿Exporta todo o solo lo que veo?', a: 'Solo las filas visibles, con los filtros y columnas que elegiste.' },
      { q: '¿Puedo importar contactos?', a: 'Sí, desde un archivo CSV en «Importar leads» (/leads/import).' },
    ],
    related: ['por-escribir', 'por-completar'],
  },
  {
    id: 'conversaciones',
    title: 'Conversaciones',
    group: 'Seguimiento',
    href: '/contacted',
    routes: /^\/contacted(\/.*)?$/,
    summary: 'Cada conversación, su estado y el próximo paso. Aquí contestas a quien te respondió.',
    steps: [
      'Empieza por «Por responder»: quienes esperan tu respuesta.',
      'Las otras vistas son «Esperando respuesta», «Programados» y «Todos».',
      'Abre una conversación para ver el hilo, la actividad del correo y los próximos pasos.',
      'Escribe tu respuesta: se envía en el hilo original. Revisa el texto antes de enviarlo.',
      '«Detener seguimientos» cancela los correos pendientes de esa secuencia; lo enviado y el historial se conservan.',
      'Cuando termine, toca «Cerrar conversación» y elige cómo terminó: Sin acuerdo, Ganado, No interesado o Lo retomo yo. Ganado, Sin acuerdo y No interesado también cambian la etapa en el pipeline.',
    ],
    tips: [
      'Las respuestas se revisan solas en segundo plano. «Actualizar mis respuestas» las trae en el momento desde tus cuentas.',
      'Activa «Solo mis conversaciones» para ver solo las tuyas.',
      'Una apertura no demuestra que la persona leyó el correo: los filtros de correo pueden generar o bloquear esas señales.',
    ],
    faqs: [
      { q: 'Alguien me respondió y no aparece. ¿Qué hago?', a: 'Pulsa «Actualizar mis respuestas». Si sigue sin aparecer, revisa en «Conexiones» que tu correo esté conectado.' },
      { q: '¿Qué pasa con los seguimientos si la persona responde?', a: 'Se detienen solos.' },
      { q: '¿Qué pasa al cerrar una conversación si trabajo en equipo?', a: '«Sin acuerdo» la deja libre para que otra persona del equipo la retome; «Ganado» y «No interesado» hacen que nadie más vuelva a contactarla; «Lo retomo yo» la mantiene tuya. Si alguien no responde, queda libre 30 días después del último envío.' },
      { q: '¿Puedo responder desde mi bandeja de correo?', a: 'Sí. «Abrir en correo» abre el hilo en tu cuenta. Al responder desde la app, la respuesta queda en el mismo hilo.' },
    ],
    related: ['hoy', 'campanas', 'pipeline'],
  },
  {
    id: 'campanas',
    title: 'Campañas',
    group: 'Seguimiento',
    href: '/campaigns',
    routes: /^\/campaigns(\/.*)?$/,
    summary: 'Escribe a un grupo con una sola aprobación o revisa los seguimientos uno por uno.',
    steps: [
      'En «Campañas masivas», pulsa «Nueva campaña».',
      '1. Audiencia: describe tu lead ideal o filtra tus contactos con correo. Elige hasta 100 personas y si incluir a quienes ya contactaste.',
      '2. Correos: escribe o ajusta los mensajes. Puedes editar el correo de una persona en particular.',
      '3. Revisión: revisa la vista previa por destinatario y pulsa «Aprobar campaña».',
      'En «Seguimientos individuales» revisas los seguimientos de tus correos uno por uno.',
    ],
    tips: [
      'Cada envío incluye el enlace para darse de baja.',
      'Los seguimientos se detienen si la persona responde.',
      '«Excluir personas que ya respondieron» evita escribirles de nuevo.',
    ],
    faqs: [
      { q: '¿Cuántas personas puede tener una campaña?', a: 'Hasta 100 por campaña.' },
      { q: '¿Aprobar envía todo al instante?', a: 'Aprobar autoriza los mensajes para toda la audiencia. Según la configuración de tu organización, los envíos parten solos o los inicias desde la misma página.' },
      { q: '¿Puedo usar contactos sin correo?', a: 'No. Las campañas usan tus contactos guardados con correo. Primero busca su correo en «Por completar».' },
    ],
    related: ['conversaciones', 'por-escribir', 'privacidad'],
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    group: 'Seguimiento',
    href: '/crm',
    routes: /^\/crm\/?$/,
    summary: 'Ordena a tus contactos por etapa de venta y prioriza a quién mover.',
    steps: [
      'Las etapas son: Nuevos, Calificado, Contactado, Interesado, Reunión, Negociación, Ganado y Perdido.',
      '«Gráfico» muestra cuántos hay en cada etapa, qué parte pasa a la siguiente, tus cifras y los contactos nuevos por semana. Pasa el mouse por una etapa para ver sus 5 más recientes; tócala para verlos a todos.',
      'En «Tablero», arrastra cada tarjeta a su nueva etapa o usa «Cambiar etapa».',
      'Abre un contacto para ver su actividad, el responsable y la próxima acción registrada.',
      'Arriba aparecen las sugerencias de etapa: un envío propone Contactado; una respuesta con interés, Interesado; una reunión pedida, Reunión; un pedido de propuesta o precio, Negociación; una compra confirmada, Ganado; y un «no me interesa», Perdido. Acéptalas una por una o con «Aceptar todas». En «Gráfico», cada etapa marca cuántos cambios esperan tu confirmación.',
    ],
    faqs: [
      { q: '¿Cómo llegan los contactos al pipeline?', a: 'Aparecen cuando guardas o contactas leads.' },
      { q: '¿Las etapas cambian solas?', a: 'No. Los envíos y las respuestas proponen el cambio y tú lo aceptas. Nunca se mueve un contacto hacia atrás ni uno ya cerrado.' },
      { q: '¿Puedo asignar un responsable?', a: 'Sí, en el detalle del contacto, en «Colaboración».' },
    ],
    related: ['conversaciones', 'hoy'],
  },
  {
    id: 'perfil',
    title: 'Perfil',
    group: 'Configuración',
    href: '/profile',
    routes: /^\/profile\/?$/,
    summary: 'Lo que la IA sabe de ti y de tu empresa. Con eso busca prospectos, investiga y redacta.',
    steps: [
      '«Complétalo con IA»: escribe el sitio de tu empresa (si no, se usa el dominio de tu correo corporativo) y pulsa «Leer mi sitio».',
      'Revisa la propuesta: cada campo trae la página de donde salió. Marca lo que quieres usar y pulsa «Usar».',
      'Completa «Lo que vendes»: servicios, propuesta de valor, problemas que resuelves, por qué elegirte, pruebas y clientes que puedes nombrar.',
      'Completa «Tu cliente ideal»: cargos, industrias, tamaño de empresa y países.',
      'Pulsa «Guardar cambios». Nada se guarda antes.',
    ],
    tips: [
      'El medidor «Tu perfil: N de 10» dice primero lo que destraba la redacción.',
      'La IA solo afirma lo que está en tu perfil: mientras más concreto, mejores correos.',
      'Tu firma, tono y llamada a la acción están en «Firmas y estilo».',
    ],
    faqs: [
      { q: '¿Por qué la IA no puede redactar mis correos?', a: 'Falta lo que vendes: completa servicios o propuesta de valor en «Lo que vendes».' },
      { q: 'La IA no pudo leer mi sitio. ¿Qué hago?', a: 'Revisa que la dirección sea correcta o escribe el nombre de tu empresa. También puedes completar los campos a mano.' },
      { q: '¿«Leer mi sitio» guarda algo?', a: 'No. Revisas cada campo, y solo se guarda al pulsar «Guardar cambios».' },
      { q: '¿Para qué sirve «Tu cliente ideal»?', a: 'Es el primer punto de partida en «Buscar prospectos» y ayuda a la IA a ordenar la evidencia de cada contacto.' },
    ],
    related: ['buscar', 'firmas', 'primeros-pasos'],
  },
  {
    id: 'conexiones',
    title: 'Conexiones',
    group: 'Configuración',
    href: '/connections',
    routes: /^\/(connections|gmail|outlook)\/?$/,
    summary: 'Conecta Gmail u Outlook para enviar desde tu propia cuenta y recibir las respuestas en la app.',
    steps: [
      'En «Correo», pulsa «Conectar» en Gmail u Outlook.',
      'Acepta los permisos en la ventana del proveedor.',
      'Vuelve a la app: la cuenta aparece como «Conectado».',
      'Si conectas las dos, elige en «Remitente predeterminado» cuál envía.',
    ],
    tips: [
      'La conexión permite enviar correos desde la plataforma y leer los hilos para detectar respuestas.',
      'Las credenciales se guardan cifradas. Si el proveedor revocó el acceso, vuelve a conectar.',
    ],
    faqs: [
      { q: '¿Puedo conectar Gmail y Outlook a la vez?', a: 'Sí. Elige en «Remitente predeterminado» cuál envía: Cowork y tus campañas la usan sin preguntarte. En cada correo, la línea «De:» muestra desde qué cuenta saldrá.' },
      { q: '¿ANTON.IA lee todo mi correo?', a: 'Lee los hilos de los correos enviados desde la app para detectar respuestas cuando se sincroniza la bandeja.' },
      { q: 'Dice que hay credenciales guardadas pero no envía. ¿Qué hago?', a: 'Su vigencia se comprueba al usarlas. Si el proveedor revocó el acceso, pulsa «Reconectar» en la cuenta.' },
      { q: '¿Cómo desconecto una cuenta?', a: 'En «Conexiones», pulsa «Desconectar» en la cuenta y confírmalo. ANTON.IA deja de enviar desde ella y de leer sus respuestas. Si tienes la otra conectada, esa pasa a enviar; si no, los envíos pendientes esperan hasta que conectes una.' },
    ],
    related: ['correo', 'conversaciones'],
  },
  {
    id: 'firmas',
    title: 'Firmas y estilo',
    group: 'Configuración',
    href: '/settings/email-studio',
    routes: /^\/settings\/email-studio(\/.*)?$/,
    summary: 'Tu firma y el estilo de tus correos, listos antes de enviar.',
    steps: [
      'En «Firma de correo», sube tu firma para Gmail y para Outlook. Se añade sola a tus envíos.',
      'En el diseñador de estilo, crea un estilo: nombre, punto de partida, asunto, cuerpo y «Cómo debe sonar». También puedes pedir un «Ajuste con IA».',
      'Guárdalo en «Personal: solo yo» o para el equipo, y márcalo como predeterminado si quieres usarlo siempre.',
      'Las plantillas del equipo se pueden duplicar en tu espacio personal para editarlas.',
    ],
    faqs: [
      { q: '¿Dónde elijo el estilo de un correo?', a: 'Al preparar el correo, en «Perfil de estilo». Si marcaste uno como predeterminado, se usa ese.' },
      { q: '¿Tengo que configurar la firma en cada correo?', a: 'No. Súbela una vez por cuenta y se añade sola.' },
    ],
    related: ['correo', 'perfil'],
  },
  {
    id: 'privacidad',
    title: 'Privacidad',
    group: 'Configuración',
    href: '/settings/privacy',
    routes: /^\/settings\/(privacy|unsubscribes|privacy-requests|privacy-incidents)\/?$/,
    summary: 'Bajas, solicitudes de privacidad y controles de cumplimiento, en un solo lugar.',
    steps: [
      '«Bajas y exclusiones»: correos y dominios que no deben volver a ser contactados.',
      '«Solicitudes de privacidad»: solicitudes de acceso, rectificación o eliminación.',
      '«Incidentes de privacidad»: registro y seguimiento de incidentes.',
      '«Política de privacidad»: la política pública y los canales para ejercer derechos.',
    ],
    faqs: [
      { q: '¿Qué pasa cuando alguien se da de baja?', a: 'Queda registrado y la app bloquea los envíos a ese correo.' },
      { q: '¿Puedo excluir una empresa completa?', a: 'Sí, bloqueando su dominio en «Bajas y exclusiones». La app no envía a correos de un dominio bloqueado.' },
    ],
    related: ['campanas'],
  },
  {
    id: 'creditos',
    title: 'Créditos y uso diario',
    group: 'Configuración',
    summary: 'Algunas acciones usan créditos o un cupo diario: buscar prospectos, buscar correos, investigar y contactar.',
    steps: [
      'Tu uso del día está en «Hoy», en «Créditos y uso diario». Se reinicia a medianoche (UTC).',
      '«Mis créditos» muestra tu asignación personal, si tu administrador te dio una. Si no, usas los créditos compartidos del equipo.',
      'El teléfono es opcional y cuesta 10 créditos por persona.',
    ],
    faqs: [
      { q: 'Me quedé sin créditos. ¿Qué hago?', a: 'Pídele más a un administrador de tu organización. El cupo diario se reinicia a medianoche (UTC).' },
      { q: '¿Buscar el correo gasta créditos aunque no lo encuentre?', a: 'Cuenta en tu uso diario cada contacto enviado a buscar.' },
    ],
    related: ['hoy', 'buscar', 'administracion'],
  },
  {
    id: 'administracion',
    title: 'Administración',
    group: 'Administración',
    href: '/dashboard/admin',
    routes: /^\/dashboard\/admin(\/.*)?$/,
    feature: 'admin',
    summary: 'Para dueños y administradores: actividad y resultados del equipo, quién necesita ayuda, miembros y créditos.',
    steps: [
      'Elige el período (7, 30 o 90 días, o un rango personalizado), el equipo y la persona.',
      '«Requiere atención» muestra señales concretas para revisar ahora.',
      'En «Usuarios» invitas miembros y ves su actividad; en «Equipos» los agrupas.',
      'En «Créditos» revisas el uso y, si tienes permiso, asignas créditos por persona.',
    ],
    faqs: [
      { q: '¿Quién ve este panel?', a: 'Los dueños y administradores de la organización activa.' },
      { q: '¿Cómo invito a alguien?', a: 'En «Usuarios», con «Invitar».' },
      { q: 'No puedo cambiar los créditos. ¿Por qué?', a: 'Cambiar créditos requiere un permiso adicional. Si lo necesitas, pídelo a quien administra la plataforma.' },
    ],
    related: ['creditos'],
  },
];

export type HelpVisibility = { opportunities: boolean; admin: boolean };

/** The sections this person can see: same rules as the menu. */
export function visibleHelpSections(visibility: HelpVisibility, sections: HelpSection[] = HELP_SECTIONS): HelpSection[] {
  return sections.filter((section) => (
    (section.feature !== 'opportunities' || visibility.opportunities)
    && (section.feature !== 'admin' || visibility.admin)
  ));
}

export function helpSectionById(id: string | null | undefined): HelpSection | null {
  return HELP_SECTIONS.find((section) => section.id === id) || null;
}

/** The section of the screen on view, for the «?» of the top bar. */
export function helpSectionFor(pathname: string | null | undefined, sections: HelpSection[] = HELP_SECTIONS): HelpSection | null {
  const path = String(pathname || '').split(/[?#]/)[0];
  if (!path) return null;
  return sections.find((section) => section.routes?.test(path)) || null;
}

/** Where to read a section in the manual: its own page in the «Centro de ayuda». */
export function helpSectionHref(id: string) {
  return `/ayuda/${id}`;
}

/** A section id read from an address (/ayuda/perfil or an old /ayuda#perfil); a malformed one reads as none. */
export function helpSectionIdFrom(value: string | null | undefined) {
  try {
    return decodeURIComponent(String(value || '')).trim();
  } catch {
    return '';
  }
}

/** The icon of each section in the «Centro de ayuda» (keys of the help icon set, src/components/help/help-icons.tsx). */
export type HelpIconKey = 'start' | 'today' | 'search' | 'opportunities' | 'contacts' | 'write' | 'mail' | 'companies' | 'table'
  | 'conversations' | 'campaigns' | 'pipeline' | 'profile' | 'connections' | 'signature' | 'privacy' | 'credits' | 'admin';

export const HELP_ICONS: Record<string, HelpIconKey> = {
  'primeros-pasos': 'start', hoy: 'today', buscar: 'search', oportunidades: 'opportunities', 'por-completar': 'contacts',
  'por-escribir': 'write', correo: 'mail', tabla: 'table', conversaciones: 'conversations',
  campanas: 'campaigns', pipeline: 'pipeline', perfil: 'profile', conexiones: 'connections', firmas: 'signature',
  privacidad: 'privacy', creditos: 'credits', administracion: 'admin',
};

/** «Tu camino al primer correo»: the order of the work, one step per section, in the words of the first visit. */
export const FIRST_EMAIL_PATH: Array<{ section: string; title: string; text: string }> = [
  { section: 'perfil', title: 'Cuenta qué vendes', text: 'Tu oferta y tu cliente ideal guían la búsqueda y los correos.' },
  { section: 'conexiones', title: 'Conecta tu correo', text: 'Gmail u Outlook: los correos salen desde tu cuenta.' },
  { section: 'buscar', title: 'Encuentra prospectos', text: 'Empresas afines y quién decide dentro de ellas.' },
  { section: 'por-completar', title: 'Consigue su correo', text: 'Un crédito por persona, solo para quienes eliges.' },
  { section: 'por-escribir', title: 'Investiga y escribe', text: 'La IA prepara el borrador; tú lo revisas y lo envías.' },
  { section: 'conversaciones', title: 'Responde y cierra', text: 'Contesta en el mismo hilo y cierra cada conversación.' },
];

/** The questions people ask the most, as [section, question] of the manual. */
export const POPULAR_QUESTIONS: Array<[string, string]> = [
  ['creditos', 'Me quedé sin créditos. ¿Qué hago?'],
  ['correo', '¿Desde qué correo sale?'],
  ['conversaciones', 'Alguien me respondió y no aparece. ¿Qué hago?'],
  ['por-completar', '¿Qué pasa si no se encuentra el correo?'],
  ['campanas', '¿Aprobar envía todo al instante?'],
];

/** The popular questions that exist in the manual and the person can see. */
export function popularHelpQuestions(sections: HelpSection[] = HELP_SECTIONS): Array<{ section: HelpSection; faq: HelpFaq }> {
  return POPULAR_QUESTIONS.flatMap(([id, question]) => {
    const section = sections.find((item) => item.id === id);
    const faq = section?.faqs.find((item) => item.q === question);
    return section && faq ? [{ section, faq }] : [];
  });
}

export function normalizeHelpText(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const STOP_WORDS = new Set([
  'a', 'al', 'como', 'con', 'cual', 'cuando', 'de', 'del', 'donde', 'el', 'en', 'es', 'esta', 'este', 'hay', 'la', 'las', 'lo',
  'los', 'me', 'mi', 'mis', 'no', 'o', 'para', 'por', 'puedo', 'que', 'se', 'si', 'su', 'sus', 'un', 'una', 'y', 'yo', 'hago',
  'tengo', 'quiero', 'esto', 'eso', 'le', 'les', 'ya',
]);

function terms(query: string) {
  return [...new Set(normalizeHelpText(query).split(/[^a-z0-9ñ]+/).filter((term) => term.length > 1 && !STOP_WORDS.has(term)))];
}

export type HelpMatch = { section: HelpSection; faq?: HelpFaq; score: number };

/**
 * Plain search over the manual, without accents or case: FAQs first, then sections. Used by the manual's search box and as
 * the answer when the AI is not available.
 */
export function searchHelp(query: string, sections: HelpSection[] = HELP_SECTIONS, limit = 8): HelpMatch[] {
  const wanted = terms(query);
  if (!wanted.length) return [];
  const score = (text: string, weight: number) => {
    const haystack = normalizeHelpText(text);
    return wanted.reduce((total, term) => total + (haystack.includes(term) ? weight : 0), 0);
  };
  const matches: HelpMatch[] = [];
  for (const section of sections) {
    const base = score(section.title, 3);
    for (const faq of section.faqs) {
      const value = score(faq.q, 3) + score(faq.a, 1) + base;
      if (score(faq.q, 1) + score(faq.a, 1) > 0) matches.push({ section, faq, score: value + 1 });
    }
    const value = base + score(section.summary, 2) + score(section.steps.join(' '), 1) + score((section.tips || []).join(' '), 1);
    if (value > 0) matches.push({ section, score: value });
  }
  return matches
    .sort((a, b) => b.score - a.score || Number(Boolean(b.faq)) - Number(Boolean(a.faq)))
    .slice(0, limit);
}

/** The manual as plain text, for the AI that answers questions. Each section starts with its id. */
export function manualAsText(sections: HelpSection[] = HELP_SECTIONS) {
  return sections.map((section) => [
    `## [${section.id}] ${section.title}${section.href ? ` (${section.href})` : ''}`,
    section.summary,
    'Cómo se usa:',
    ...section.steps.map((step, index) => `${index + 1}. ${step}`),
    ...(section.tips?.length ? ['Consejos:', ...section.tips.map((tip) => `- ${tip}`)] : []),
    'Preguntas frecuentes:',
    ...section.faqs.map((faq) => `P: ${faq.q}\nR: ${faq.a}`),
  ].join('\n')).join('\n\n');
}
