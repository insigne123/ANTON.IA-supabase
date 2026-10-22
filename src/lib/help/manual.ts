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
  feature?: 'opportunities' | 'admin' | 'cowork';
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
      'Al guardar, elige si buscar su correo o su correo y móvil, para todos o uno por uno. Quien tiene datos pasa directo a «Por escribir».',
      'En «Por escribir», investiga a cada contacto y pulsa «Contactar»: la IA prepara el correo inicial y sus seguimientos.',
      'Revisa el correo, pulsa «Confirmar revisión» y después «Enviar ahora». Nada sale sin que tú lo envíes o lo apruebes.',
      'Sigue las respuestas en «Conversaciones» y en «Hoy».',
    ],
    tips: [
      '«Hoy» muestra en «Prepara tu cuenta» qué te falta (perfil, correo conectado, primeros contactos y primer envío).',
      'El botón «?» de la barra superior explica la pantalla en la que estás, con su video, y el botón ▶ «Ver tutorial», junto a «Centro de ayuda» al final del menú, repite el recorrido.',
    ],
    faqs: [
      { q: '¿Por dónde empiezo?', a: 'Por «Perfil» y «Conexiones». Sin tu oferta la IA no puede redactar, y sin correo conectado no puedes enviar. «Hoy» te dice cuál de los dos te falta.' },
      { q: '¿La IA envía correos sola?', a: 'No. La IA prepara borradores. Un correo individual sale cuando pulsas «Enviar ahora», y una campaña cuando la apruebas.' },
      { q: '¿Cómo vuelvo a ver el tutorial?', a: 'Con el botón ▶ «Ver tutorial», junto a «Centro de ayuda» al final del menú. Lo puedes cerrar en cualquier paso con «Omitir». Cada módulo tiene además su video en el Centro de ayuda.' },
    ],
    related: ['perfil', 'conexiones', 'buscar', 'por-escribir'],
  },
  {
    id: 'hoy',
    title: 'Hoy',
    group: 'Empieza aquí',
    href: '/dashboard',
    routes: /^\/dashboard\/?$/,
    summary: 'Tu inicio: lo que toca ahora, tus llamadas y LinkedIn, a quién retomar y tu resumen del día.',
    steps: [
      '«Lo primero hoy» muestra una sola acción, en este orden: responder a quien te respondió, resolver lo que impide enviar, un compromiso que vence hoy, escribir a tus contactos con correo, completar correos o buscar prospectos.',
      '«Lo que te espera» lista hasta 6 pendientes, los urgentes primero. Cada uno abre la conversación exacta.',
      '«Prepara tu cuenta» tiene cuatro pasos comprobados: perfil con empresa y oferta, correo conectado, primeros contactos y primer envío, cada uno con su enlace.',
      '«Para retomar» aparece cuando alguien vale la pena de nuevo: una conversación cerrada «Sin acuerdo» hace 60 días, alguien que no respondió en 45 días o una empresa que ahora contrata o licita. «Retomar» prepara un correo con otro ángulo; con «…» lo pospones o lo descartas.',
      '«Llamadas y LinkedIn» te recuerda llamar o invitar por LinkedIn a quien no respondió tu primer correo, el día que elijas: por defecto, LinkedIn el día 1 y la llamada el día 3. Se enciende con «Activar» y se cambia con «Ajustar».',
      'En cada fila, el botón llama al número o abre su LinkedIn. «Guion y resultado» prepara qué decir, el mensaje si no contesta o la nota de la invitación; marca qué pasó y pulsa «Guardar». Si hablaron, «Subir grabación» deja el resumen, los acuerdos y el próximo paso en el CRM.',
      'Al lado, «Tu resumen de hoy» cuenta tus envíos, contactos, respuestas y guardados del día, y «Tu cupo de hoy» dice cuánto te queda; la semana está arriba, en «Tu semana».',
      '«Meta de la semana» muestra cuántas personas contactaste y cuántos contactos con correo sumaste, si vas al día y el paso siguiente. Bajo «Lo primero hoy», «Contacto del día» trae tu contacto del martes, miércoles o viernes.',
    ],
    faqs: [
      { q: '¿Por qué «Prepara tu cuenta» dice que mi correo no está conectado?', a: 'Mira si hay una conexión guardada de Gmail u Outlook. La sesión de Outlook abierta solo en el navegador no cuenta. Conéctalo en «Conexiones».' },
      { q: '¿Qué es el «Contacto del día»?', a: 'Martes, miércoles y viernes, un contacto nuevo que calza con tu cliente ideal, con correo verificado, una breve investigación y un correo sugerido. Llega por correo o en «Hoy» (sin cliente ideal, te lleva a «Perfil»). Guardarlo no gasta créditos; «Investigar y escribirle» lo investiga a fondo para enviarle desde la app.' },
      { q: '¿Qué es un compromiso?', a: 'Una fecha o próximo paso acordado con un contacto, como una reunión. Cuando vence hoy o ya venció, aparece en «Lo que te espera».' },
      { q: '¿Por qué no me toca llamar a alguien?', a: 'Solo se llama a quien tiene teléfono: pídelo al guardar el contacto, con «Correo + teléfono». Además, «Llamadas y LinkedIn» cuenta a quienes escribiste desde que lo activaste, hasta 45 días atrás, y cancela lo pendiente si la persona respondió, rebotó o pidió no recibir más correos.' },
      { q: '¿Se graba la llamada?', a: 'Solo si tú la grabas, con la grabadora del teléfono o del computador, y pidiendo permiso al empezar. Al subir el audio lo transcribimos y resumimos para el CRM; el audio no se guarda.' },
      { q: '¿Por qué hay un límite de LinkedIn al día?', a: 'LinkedIn restringe las cuentas que envían muchas invitaciones. Mostramos hasta 20 al día; las demás quedan para mañana. Una tarea que no haces se cierra sola una semana después de su día.' },
      { q: '¿Por qué no aparece alguien en «Para retomar»?', a: 'Nunca aparece quien cerraste como «No interesado» o «Ganado», quien pidió no recibir más correos, quien respondió que no o cuyo correo rebotó. Tampoco quien te respondió y espera tu respuesta: esa persona está en «Lo que te espera». Puedes cambiar los días de espera abajo en la tarjeta.' },
    ],
    related: ['informe-semanal', 'primeros-pasos', 'creditos'],
  },
  {
    id: 'cowork',
    title: 'Cowork',
    group: 'Empieza aquí',
    href: '/cowork',
    routes: /^\/cowork(\/.*)?$/,
    feature: 'cowork',
    summary: 'Tu asistente de ventas: le pides lo que necesitas con tus palabras y lo hace con tus contactos, tu oferta y tus correos. Lo que envía, guarda o gasta créditos espera tu aprobación.',
    steps: [
      'Escribe lo que necesitas, por ejemplo «¿Qué toca hoy?» o «Escribe a mis contactos de retail», o parte con una de las sugerencias de la portada. Con «/» ves los atajos y con «@» nombras a un contacto guardado.',
      'Cowork busca, lee y prepara a la vista: te muestra lo que va haciendo y deja el resultado en la conversación, como una tabla de contactos, un correo, un gráfico o un informe.',
      'Cuando propone algo que envía, guarda o gasta créditos, aparece una tarjeta con «Aprobar». Nada sale ni se guarda sin ese clic, y puedes editar antes de aprobar.',
      'Tus conversaciones quedan en la lista de la izquierda. Puedes adjuntar archivos, como un Excel con contactos, y bajar tablas en Excel o CSV e informes en Word o PDF.',
      'Si no sabes por dónde partir, pregunta «¿Qué puedes hacer?»: te muestra todo lo que hace, con ejemplos para probar.',
    ],
    tips: [
      'Dile qué vendes en «Perfil» antes de empezar: Cowork escribe y busca a partir de tu oferta.',
      'Una campaña que arma Cowork queda guardada sin enviar hasta que la actives.',
    ],
    faqs: [
      { q: '¿Cowork envía correos sin preguntarme?', a: 'No. Cada envío, campaña, invitación de LinkedIn o búsqueda de correo aparece como una tarjeta que apruebas tú.' },
      { q: '¿Cuánto puedo usarlo?', a: 'Hay un uso diario del asistente por persona. Si llegas al límite, Cowork te lo dice: se renueva a medianoche, hora de Chile, y lo hecho queda guardado.' },
      { q: '¿Quién ve mis conversaciones?', a: 'Solo tú. Cowork trabaja con los contactos y datos que puedes ver en el workspace activo.' },
    ],
    related: ['hoy', 'buscar', 'campanas'],
  },
  {
    id: 'informe-semanal',
    title: 'Informe semanal',
    group: 'Empieza aquí',
    href: '/weekly-report',
    routes: /^\/weekly-report\/?$/,
    summary: 'Tu semana en un vistazo, dentro de «Hoy»: cuánto escribiste, quién respondió, qué te espera y qué hacer en los próximos días. Puede llegarte por correo cada lunes.',
    steps: [
      'En «Hoy», pulsa «Tu semana» arriba a la derecha.',
      'Eliges «Esta semana» (de lunes a hoy) o «Semana pasada» (de lunes a domingo). Cada cifra se compara con los mismos días de la semana anterior.',
      '«Tu semana» trae una frase con lo importante, tus correos enviados, personas contactadas, respuestas y reuniones pedidas (sin cifras si no hubo actividad) y «Para esta semana»: hasta tres cosas para hacer.',
      'Si administras la organización, «Equipo» muestra lo mismo por persona, con quién tiene respuestas por atender. Quien no tuvo actividad en la semana queda contado en una línea, y «Ver» lo muestra; si nadie escribió, una frase lo dice.',
      '«Oportunidades» muestra lo que llegó en la semana, lo que cierra en los próximos 7 días y lo que nadie tiene asignado. Lo ven los gestores de oportunidades que elija un administrador; mientras no haya, los administradores.',
      'Abajo, «Recibirlo por correo cada lunes» te lo envía a las 8:00 con la semana anterior, a tu correo. Viene activado y lo apagas ahí mismo. «Enviármelo ahora» te manda el que estás viendo.',
      '«Avisos por correo» te escribe de martes a viernes en la mañana, solo cuando hay algo que hacer: alguien respondió, vence un compromiso, cierra una oportunidad o tu meta va atrasada. Se apaga ahí mismo.',
    ],
    faqs: [
      { q: '¿Desde dónde sale el correo del informe?', a: 'Desde una dirección de Yago, o desde tu Gmail u Outlook conectado si esa aún no está activa, hacia tu mismo correo. No lo recibe nadie más y no usa tu cupo de envíos.' },
      { q: '¿Quién pone las metas?', a: 'Un administrador, en «Equipo» → «Metas del equipo»: la del equipo y, si alguien necesita otra, la suya. Sin nada configurado, la meta es contactar a 10 personas y sumar 15 contactos con correo por semana.' },
      { q: '¿Cómo nombro a un gestor de oportunidades?', a: 'Si administras la organización, en «Informe semanal» pulsa «Gestores de oportunidades», marca a las personas y guarda. Desde el lunes siguiente reciben la sección «Oportunidades».' },
      { q: '¿Por qué mis cifras no coinciden con «Hoy»?', a: '«Hoy» cuenta solo el día. El informe cuenta la semana de lunes a domingo, en hora de Chile, y solo correos confirmados por tu proveedor.' },
    ],
    related: ['hoy', 'administracion', 'oportunidades'],
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
      'Con la extensión de LinkedIn (se descarga en el modo «Perfil») buscas el correo de varias personas de una búsqueda de LinkedIn en un clic.',
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
    summary: 'Licitaciones, Compra Ágil, empresas que están contratando y publicaciones de LinkedIn que calzan con tu oferta, con un informe de la IA para decidir, postular y ganar.',
    steps: [
      'La primera vez, quien administra pulsa «Confirmar oferta» y revisa qué vende la empresa: la IA prepara los criterios desde esa oferta, sin escribir palabras de búsqueda. Desde ahí buscamos cada mañana. En la misma ventana («Empresa del workspace») conectas tu ticket de Mercado Público.',
      '«Embudo» cuenta por etapa: Por revisar, Recomendadas, Asignadas, En preparación, Presentadas y Ganadas. Arriba buscas y eliges la fuente; «Cargar más» trae más. Las estrellas (1 a 5) dicen cuánto calza cada una; ordénalas por «Prioridad» o «Cierran antes». Avanzan solas según el trabajo, y «Sugerir próximos pasos» propone a qué etapa moverlas, con tu aceptación.',
      '«Lista» trae primero las recomendadas, con el motivo del calce, el cierre y el monto. «Por dónde empezar» ordena las de mejor calce que cierran pronto. «Cargar oportunidad» suma una que recibiste por otro lado, como una licitación privada: sube las bases (o su ZIP) y la IA completa el formulario.',
      '«Abrir y trabajar» abre el expediente. «Asignar equipo» elige quién la trabaja, e «Informe» dice si conviene postular, por qué y qué hacer ahora, con las fechas, los requisitos y los riesgos. Sube las bases en «Documentos»: la IA las lee y completa el informe. «Preguntar a la IA» responde con esas bases y cita de dónde lo sacó.',
      'Si te asignan oportunidades, ves «Mis oportunidades»: lo nuevo, lo que gestionas y lo bloqueado, con la próxima acción de cada una.',
      'Con el informe listo, en «Cómo postular» pulsa «Preparar borrador de oferta»: la IA arma la carta, la oferta técnica por criterio de evaluación, el cumplimiento de requisitos, las líneas a cotizar y los formularios de las bases (anexos). «Descargar Word para llenar» trae la oferta con campos amarillos que se llenan con un clic; cada anexo se baja también solo, en su fila de «Qué entregar». Los precios los escribes en la pantalla.',
      'En una licitación o Compra Ágil, «Cómo ganar» muestra lo que ese organismo compró antes que se parece, quién ganó, con cuántos oferentes y a qué precio frente al estimado, y lo que pagaron otros organismos. «Preparar estrategia» le pide a la IA un rango de precio apoyado en esos montos, qué destacar, los riesgos y a quién tendrás enfrente.',
      'Si administras Oportunidades, «Mercado público» reúne datos de ChileCompra: «Demanda futura» (lo que los organismos planean comprar este año), «Contratos por vencer» (los que calzan con tu oferta y terminan pronto, con quién los tiene) y «Competidores» (sigue a un proveedor y ve lo que gana). «Seguir» agrega lo que ves a tus oportunidades.',
      'Si administras Oportunidades, completa la «Ficha para licitaciones» (junto a «Qué buscamos»): razón social, RUT, regiones, experiencia, certificaciones y garantías. «Completar con IA» la llena desde tu Perfil y tu sitio web. Con ella la IA no descarta una licitación por algo que sí tienes, y el borrador de oferta trae tus datos.',
      'En el informe de una licitación, cada requisito dice si cumples (✓), si falta un dato (⚠) o si no cumples (✗) según tu ficha. Responde las preguntas de «Falta un dato» y de «Para armar tu oferta» con «Sí», «No» o en tus palabras (con cifras, el detalle): queda en la ficha y la IA revisa de nuevo. «Recordarme» agrega cada fecha a Google Calendar con el nombre y el ID de la licitación.',
      'En la ficha, «Documentos de la empresa» guarda el F30, la vigencia de la sociedad, los estados financieros y tus certificados con su vencimiento. Te avisamos 15 días antes de que venzan y la IA sabe cuáles tienes vigentes.',
      'En «Asistente» conversa con la IA sobre todas tus oportunidades: qué calza esta semana, qué cierra pronto o qué piden las bases. Responde con las oportunidades que puedes ver, te deja abrirlas y, si la pregunta es sobre una licitación, te ofrece seguir en su propia conversación, que lee sus bases. Tus conversaciones quedan en la lista de la izquierda.',
    ],
    faqs: [
      { q: '¿Para qué sirve saber que una empresa está contratando?', a: 'Es una razón concreta para escribirle: si busca personal, puede necesitar lo que ofreces.' },
      { q: '¿Cómo consigo mi ticket de Mercado Público?', a: 'En chilecompra.cl/api pulsa «Pide tu ticket», ingresa con tu Clave Única y completa el formulario eligiendo «Solicitud de Ticket». El ticket llega a tu correo: pégalo en Oportunidades → «Empresa del workspace» (o en Conexiones) y pulsa «Probar y guardar». Es gratis.' },
      { q: '¿Cómo elige la IA las licitaciones?', a: 'Lee todas las compras abiertas contra la oferta confirmada en «Empresa del workspace» y recomienda aquellas a las que podrías postular, con el porqué. Las demás quedan en «No recomendadas» con su motivo. Para cambiar lo que busca, actualiza esa oferta.' },
      { q: '¿La IA inventa datos en el borrador de oferta?', a: 'No debería: usa solo lo que dicen las bases y tu Perfil, y lo que falta lo deja entre corchetes, como [RUT] o [años de experiencia], para que lo completes. Revisa cada dato con las bases antes de enviar; los precios los escribes tú.' },
      { q: '¿Qué pasa si dejo preguntas de la ficha en blanco?', a: 'La IA lo toma como «no sé», nunca como un no: no descarta una licitación por eso y, si importa, te dice qué dato falta. Puedes completarla cuando quieras.' },
      { q: '¿El Asistente ve todas las oportunidades del equipo?', a: 'Ve las mismas que tú en Oportunidades: si administras, todas; si no, las que te asignaron. Tus conversaciones son privadas. Para preguntas sobre los documentos de una licitación, usa su conversación: el Asistente te lleva a ella con un botón.' },
      { q: '¿De dónde sale el historial de «Cómo ganar» y del radar de competidores?', a: 'De los datos abiertos de ChileCompra: cada licitación con sus ofertas y quién ganó. Guardamos todas las ofertas del último año, las ganadoras de los dos años anteriores y los contratos largos de hasta cuatro años, y los actualizamos cada mes. El precio lo decides tú.' },
      { q: '¿De dónde sale el resumen bajo el nombre de cada oportunidad?', a: 'Lo escribe la IA con lo que dice la oportunidad: en una licitación, su ficha oficial de Mercado Público (organismo, descripción y líneas); en las demás, los avisos, la publicación o la invitación. Las nuevas tardan unos minutos en tener el suyo.' },
      { q: '¿Qué documentos sirven para «Cargar oportunidad»?', a: 'La invitación, las bases o el correo en PDF, Word, Excel, texto, foto o un ZIP, hasta 20 MB cada uno. La IA lee los documentos principales y completa nombre, cliente, cierre y monto; lo que no encuentra queda vacío. Revisa antes de guardar.' },
      { q: '¿Por qué algunos competidores no muestran su RUT?', a: 'Cuando quien oferta es una persona natural, mostramos solo su nombre: su RUT es un dato personal, aunque ChileCompra lo publique. De las empresas sí ves el RUT.' },
      { q: '¿Qué hago si Mercado público dice que el historial tardó?', a: 'Es temporal: el historial de ChileCompra no respondió a tiempo. En «Competidores» pulsa «Reintentar» en unos minutos; los competidores que sigues se ven igual. Si «Contratos por vencer» no terminó, se reintenta sola en unas horas, o pulsa «Actualizar».' },
      { q: '¿Qué tan exacta es la fecha de «Contratos por vencer»?', a: 'Es estimada: la fecha de adjudicación más la duración del contrato que informó el organismo. Una prórroga, un trato directo o un contrato que empezó después pueden moverla. Úsala para preparar la conversación con tiempo, no como fecha de cierre. La lista también trae los que vencieron el último mes: el organismo suele estar licitándolos de nuevo.' },
      { q: '¿Qué tan seguro es lo que aparece en «Demanda futura»?', a: 'Es lo que cada organismo publicó en su Plan Anual de Compras, con el monto y el mes estimados. Es referencial: puede comprar menos, en otra fecha o por otro mecanismo. Sirve para presentarte antes de que publiquen la licitación.' },
      { q: '¿Por qué necesito mi propio ticket?', a: 'ChileCompra entrega un ticket por persona y cada uno tiene su límite diario de consultas. Con el tuyo, tus búsquedas no dependen de otra cuenta. Lo guardamos cifrado y solo mostramos sus últimos 4 caracteres.' },
    ],
    related: ['buscar', 'por-completar'],
  },
  {
    id: 'por-completar',
    title: 'Buscar el correo',
    group: 'Contactos',
    routes: /^\/saved\/leads\/?$/,
    summary: 'Al guardar contactos sin correo, eliges qué buscarles: solo el correo laboral, o el correo y el móvil. Quien tiene datos pasa directo a «Por escribir».',
    steps: [
      'En «Buscar prospectos», marca a quienes te interesan y pulsa «Guardar».',
      'Si alguno no tiene correo, se abre «Completa sus datos»: en «Para todos» eliges «Solo correo» o «Correo + teléfono», o lo cambias persona por persona.',
      'Pulsa «Buscar datos»: el botón dice cuántos créditos usa. Quien recibe correo o teléfono pasa a «Por escribir».',
      'Si prefieres esperar, «Guardar sin buscar» los deja al final de «Por escribir», con «Buscar sus datos» para cuando quieras.',
    ],
    tips: [
      'Buscar datos usa tu cupo diario de enriquecimiento: un crédito por contacto, pidas o no el teléfono.',
      'El teléfono puede tardar unos minutos: aparece solo en su fila.',
    ],
    faqs: [
      { q: '¿Dónde quedan los contactos guardados?', a: 'En «Por escribir». Los que aún no tienen correo aparecen arriba, en el aviso «aún no tienen correo», con «Buscar sus datos».' },
      { q: '¿Qué pasa si no se encuentra el correo?', a: 'El contacto queda guardado y marcado «Correo no encontrado», con la fecha. Puedes pulsar «Buscar sus datos» otro día o escribirle por LinkedIn.' },
      { q: '¿Cuánto cuesta pedir también el teléfono?', a: 'Lo mismo: un crédito por contacto, con o sin teléfono.' },
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
      'Arriba ves cuántos contactos están en cada etapa: «Por investigar», «Investigando», «Revisar informe» y «Listos para escribir». Cada una filtra la lista.',
      'Marca a quienes quieras (hasta 50 por vez). La barra de abajo dice qué hará: «Investigar», «Escribir» o ambas. La IA reúne evidencia de su empresa y su rol para que el correo no sea genérico.',
      'Con la investigación lista, «Ver investigación» muestra el informe y sus fuentes, y «Escribir» abre el contacto listo para preparar su secuencia.',
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
      { q: '¿Puedo borrar una investigación?', a: 'Sí: desde el informe («Eliminar investigación») o con «Más» en la barra de la selección.' },
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
      { q: '¿Puedo importar contactos?', a: 'Sí, tu propia lista en Excel (.xlsx) o CSV, tal como sale de Excel, Google Sheets o tu CRM: pulsa «Importar lista» en «Por escribir», o «¿Ya tienes tu lista? Impórtala» en Buscar prospectos. Si el Excel tiene varias hojas, eliges cuál. Todos quedan en «Por escribir»; a quienes no traen correo se lo buscas desde ahí.' },
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
      'Empieza por «Por responder»: quienes esperan tu respuesta. Cada vista muestra cuántas conversaciones tiene.',
      'Las otras vistas son «Esperando», «Programados» y «Todas».',
      'Abre una conversación: en pantallas anchas se ve al lado de la lista, con el hilo, la actividad del correo y los próximos pasos.',
      'Pulsa «Responder» para escribir tú, o «Sugerir con IA» para partir de un borrador. Se envía en el hilo original; revisa el texto antes de enviarlo.',
      '«Detener seguimientos» cancela los correos pendientes de esa secuencia; lo enviado y el historial se conservan.',
      'Cuando termine, toca «Cerrar conversación» y elige cómo terminó: Sin acuerdo, Ganado, No interesado o Lo retomo yo. Ganado, Sin acuerdo y No interesado también cambian la etapa en el pipeline.',
    ],
    tips: [
      'Las respuestas se revisan solas en segundo plano. «Traer respuestas» las trae en el momento desde tus cuentas.',
      'Activa «Solo mías» para ver solo tus conversaciones.',
      'La dirección guarda la vista y la conversación abierta: puedes compartirla, recargar o usar «atrás» sin perder el lugar.',
      'Una apertura no demuestra que la persona leyó el correo: los filtros de correo pueden generar o bloquear esas señales.',
    ],
    faqs: [
      { q: 'Alguien me respondió y no aparece. ¿Qué hago?', a: 'Pulsa «Traer respuestas». Si sigue sin aparecer, revisa en «Conexiones» que tu correo esté conectado.' },
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
      { q: '¿Aprobar envía todo al instante?', a: 'Aprobar autoriza los mensajes para toda la audiencia. Según la configuración de tu organización, los envíos parten solos o los inicias con «Enviar correos disponibles», que los envía desde el servidor por tandas.' },
      { q: '¿Por qué un contacto quedó en revisión?', a: 'Antes de cada envío se revisa que siga entre tus contactos, que no esté bloqueado, que no haya respondido (para los seguimientos) y que el primer correo siga cumpliendo los criterios aprobados. Si algo cambió, ese correo no sale y la persona queda en revisión; «Volver a comprobar» lo revisa de nuevo.' },
      { q: '¿Puedo usar contactos sin correo?', a: 'No. Las campañas usan tus contactos guardados con correo. Primero busca su correo: al guardarlos o desde «Por escribir».' },
    ],
    related: ['conversaciones', 'por-escribir', 'privacidad'],
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    group: 'Seguimiento',
    href: '/crm',
    routes: /^\/crm\/?$/,
    summary: 'Ordena a tus contactos por etapa de venta y por empresa, y prioriza a quién mover.',
    steps: [
      'Las etapas son: Nuevos, Calificado, Contactado, Interesado, Reunión, Negociación, Ganado y Perdido.',
      '«Panel» es tu tablero tipo CRM: cifras con su comparación contra el período anterior, el pipeline abierto por etapa, cuántos avanzan de una etapa a la siguiente, tus contactos por mes contra tu promedio y los leads nuevos de 13 meses. Arriba eliges el período, el responsable y el origen; toca una etapa para ver sus leads. Se actualiza solo.',
      'En «Tablero», arrastra cada tarjeta a su nueva etapa o usa «Cambiar etapa».',
      '«Empresas» agrupa a tus contactos por empresa y marca con ✓ si conoces a quien decide, a quien usa lo que vendes y a quien paga. Al abrir una, ves qué hace según su sitio; donde falta alguien, «Buscar» abre «Buscar prospectos» con los cargos escritos. «Dónde conoces gente» cruza área y nivel: «—» es donde aún no conoces a nadie.',
      'En una empresa, «Buscar empresas parecidas» encuentra empresas del mismo rubro y tamaño que aún no tienes, y la IA elige las más parecidas y dice por qué. Usa una búsqueda de tu cupo diario. «Ver personas» abre la búsqueda de esa empresa.',
      'Abre un contacto para ver su actividad, el responsable y la próxima acción registrada.',
      'Arriba aparecen las sugerencias de etapa: un envío propone Contactado; una respuesta con interés, Interesado; una reunión pedida, Reunión; un pedido de precio, Negociación; una compra, Ganado; un «no me interesa», Perdido. Acéptalas una por una o todas juntas.',
    ],
    faqs: [
      { q: '¿Cómo llegan los contactos al pipeline?', a: 'Aparecen cuando guardas o contactas leads.' },
      { q: '¿Qué compara cada cifra del «Panel»?', a: 'Los leads nuevos, los contactados y la tasa de respuesta se comparan con el período anterior del mismo largo (por ejemplo, los 30 días anteriores). Las etapas son una foto de hoy. La «Lectura» resume en frases lo más importante y te lleva a la etapa donde hay leads detenidos.' },
      { q: '¿Las etapas cambian solas?', a: 'No. Los envíos y las respuestas proponen el cambio y tú lo aceptas. Nunca se mueve un contacto hacia atrás ni uno ya cerrado.' },
      { q: '¿Puedo asignar un responsable?', a: 'Sí, en el detalle del contacto, en «Colaboración».' },
      { q: '¿Cómo sabe «Empresas» quién decide, quién usa y quién paga?', a: 'Por el cargo de cada contacto. Decide alguien de la alta dirección o un gerente de tu área; usa una jefatura o alguien del equipo de tu área; paga alguien de finanzas o compras, o el dueño en una empresa de menos de 200 personas. «Tu área» sale de «Cargos que buscas», en «Perfil».' },
      { q: '¿Por qué una persona aparece en otra área?', a: 'El área y el nivel salen de las palabras del cargo y, si se buscaron sus datos, de lo que informa el proveedor. Un cargo que dice poco, como «Product Owner», queda en «Otras áreas».' },
    ],
    related: ['conversaciones', 'hoy', 'buscar'],
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
    summary: 'Tu firma va al final de cada correo que envías, tus estilos le dicen a la IA cómo escribir tus borradores y tu agenda es el enlace para que te pidan una reunión.',
    steps: [
      'En «Firma», elige un diseño (Clásica, Con logo, Compacta o Imagen) y completa tus datos: vienen de tu perfil. La vista previa muestra cómo se ve en un correo.',
      '¿Ya tienes una firma? Elige «Tu firma actual» y pégala desde Gmail u Outlook, o sube el archivo .htm de tu firma de Outlook.',
      'Deja encendido «Usar al enviar» y pulsa «Guardar firma». Es una sola firma para Gmail y Outlook; apaga «Una firma para todas tus cuentas» si quieres una distinta en cada una.',
      'En «Estilos», pulsa «Crear estilo» y sigue los 3 pasos: punto de partida, tono y largo, y «En tus palabras». Puedes pedir un «Ajuste con IA».',
      'En el asunto y el cuerpo, «Insertar» agrega datos de cada contacto, como {Nombre} o {Empresa}. Se reemplazan solos en cada correo.',
      'Guárdalo y márcalo como predeterminado para usarlo siempre. Duplicar, publicar para el equipo o archivar están en «Más».',
      'En «Agenda», pega el enlace donde te piden una reunión (Calendly, Google Calendar, Microsoft Bookings, HubSpot u otro) y elige cuándo va: «Automático» lo agrega a la respuesta sugerida cuando alguien muestra interés o pide reunión; «Solo cuando lo pida» deja el botón «Insertar mi agenda» al escribir; «Nunca» no lo pone. Nunca va en un primer correo.',
      'En «Agenda» también eliges después de cuántos días «Hoy» te avisa para retomar una conversación (30, 60, 90 o nunca).',
    ],
    faqs: [
      { q: '¿Dónde se usa mi estilo?', a: 'El predeterminado se usa solo en Redactar, en tus campañas y en Cowork. En Redactar puedes elegir otro en «Perfil de estilo».' },
      { q: '¿Tengo que agregar la firma en cada correo?', a: 'No. Con «Usar al enviar» encendido, se agrega sola al final de cada correo que envías desde la app, antes del enlace para darse de baja.' },
      { q: '¿Puedo usar la firma que ya tengo en Gmail u Outlook?', a: 'Sí. Elige «Tu firma actual», cópiala desde tu correo y pégala en el recuadro, o sube su archivo .htm. Se conservan el formato, los enlaces y las imágenes publicadas; si una imagen está solo en tu computador, la pantalla te lo dice.' },
      { q: '¿Puedo usar la imagen de firma que ya tengo?', a: 'Sí. Elige el diseño «Imagen» y súbela en PNG o JPG, hasta 2 MB.' },
      { q: 'No tengo agenda en línea. ¿Cómo creo una?', a: 'En Google Calendar, en el computador: «Crear» → «Agenda de citas», elige duración y horarios, guarda y copia el enlace con «Compartir». Es gratis. Pégalo en «Agenda».' },
      { q: '¿Por qué mi agenda no va en el primer correo?', a: 'Pedir que agenden antes de que te conozcan suele bajar las respuestas. La IA la ofrece cuando la persona ya mostró interés; tú puedes insertarla cuando quieras con «Insertar mi agenda».' },
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
    summary: 'Para dueños y administradores: quién usa la app y para qué, qué necesita atención, el equipo y sus créditos.',
    steps: [
      'En «Uso y resultados», elige el período (hoy, 7, 30 o 90 días, o tus fechas) y el equipo.',
      '«Qué necesita atención» muestra señales concretas para revisar ahora, cada una con su evidencia.',
      'La pestaña «Personas» dice quién la usa, cuántos días y cuántos créditos; toca un nombre para ver su detalle.',
      'En «Personas» (arriba) invitas miembros y cambias su rol; en «Equipos» los agrupas.',
      'En «Créditos» revisas el uso y, si tienes permiso, fijas límites por equipo o por persona.',
    ],
    faqs: [
      { q: '¿Quién ve este panel?', a: 'Los dueños y administradores de la organización activa.' },
      { q: '¿Cómo invito a alguien?', a: 'En «Personas», con «Invitar miembro».' },
      { q: 'No puedo cambiar los créditos. ¿Por qué?', a: 'Cambiar créditos requiere un permiso adicional. Si lo necesitas, pídelo a quien administra la plataforma.' },
    ],
    related: ['creditos'],
  },
];

/** `cowork`: whether the person has Cowork; unknown (undefined) shows it, since it is open to every account. */
export type HelpVisibility = { opportunities: boolean; admin: boolean; cowork?: boolean };

/** The sections this person can see: same rules as the menu. */
export function visibleHelpSections(visibility: HelpVisibility, sections: HelpSection[] = HELP_SECTIONS): HelpSection[] {
  return sections.filter((section) => (
    (section.feature !== 'opportunities' || visibility.opportunities)
    && (section.feature !== 'admin' || visibility.admin)
    && (section.feature !== 'cowork' || visibility.cowork !== false)
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
export type HelpIconKey = 'start' | 'today' | 'report' | 'search' | 'opportunities' | 'contacts' | 'write' | 'mail' | 'companies' | 'table'
  | 'conversations' | 'campaigns' | 'pipeline' | 'profile' | 'connections' | 'signature' | 'privacy' | 'credits' | 'admin' | 'assistant';

export const HELP_ICONS: Record<string, HelpIconKey> = {
  'primeros-pasos': 'start', hoy: 'today', 'informe-semanal': 'report', cowork: 'assistant', buscar: 'search', oportunidades: 'opportunities', 'por-completar': 'contacts',
  'por-escribir': 'write', correo: 'mail', tabla: 'table', conversaciones: 'conversations',
  campanas: 'campaigns', pipeline: 'pipeline', perfil: 'profile', conexiones: 'connections', firmas: 'signature',
  privacidad: 'privacy', creditos: 'credits', administracion: 'admin',
};

/** «Tu camino al primer correo»: the order of the work, one step per section, in the words of the first visit. */
export const FIRST_EMAIL_PATH: Array<{ section: string; title: string; text: string }> = [
  { section: 'perfil', title: 'Cuenta qué vendes', text: 'Tu oferta y tu cliente ideal guían la búsqueda y los correos.' },
  { section: 'conexiones', title: 'Conecta tu correo', text: 'Gmail u Outlook: los correos salen desde tu cuenta.' },
  { section: 'buscar', title: 'Encuentra prospectos', text: 'Empresas afines y quién decide dentro de ellas.' },
  { section: 'por-completar', title: 'Consigue su correo', text: 'Al guardar: un crédito por persona, con o sin móvil.' },
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
