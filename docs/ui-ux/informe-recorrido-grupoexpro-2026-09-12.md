# Revisión del recorrido comercial de GrupoExpro

Fecha: 12 de septiembre de 2026.

## 1. Conclusión ejecutiva

ANTON.IA tiene capacidades valiosas para buscar contactos, investigar empresas, preparar mensajes y seguir oportunidades. La principal oportunidad de mejora es convertir esas capacidades en un recorrido continuo: hoy el ejecutivo debe entender demasiados módulos, estados y dependencias para conseguir una conversación comercial.

El objetivo de producto debería ser: **“Sé a quién contactar hoy, por qué le puede interesar un servicio de GrupoExpro, qué le voy a decir y qué ocurrirá después”.**

Las cinco prioridades son:

1. Unificar el contacto en una ficha persistente, con estados y una siguiente acción clara.
2. Orientar el inicio a trabajo comercial pendiente, especialmente respuestas y compromisos.
3. Hacer inequívocos el remitente, la aprobación, el envío y los seguimientos.
4. Completar el ciclo de respuesta hasta reunión o siguiente compromiso.
5. Ofrecer un punto de partida comercial de GrupoExpro, en lugar de pedir al ejecutivo que configure la estrategia desde cero.

## 2. Alcance y nivel de certeza

Revisión heurística basada en las pantallas, textos, condiciones de interacción y transiciones implementadas en el repositorio local. Se revisaron acceso, inicio, navegación, perfil, conexiones, búsqueda, guardados, enriquecimiento, investigación, composición, campañas, contactados, respuestas, CRM e importación; también la entrada del agente y la preparación de secuencias en desarrollo.

**No es una prueba de usabilidad con usuarios ni una navegación autenticada en producción.** No se midieron tiempos, tasas de abandono, rendimiento real, contraste renderizado ni frecuencia de incidentes. Los dolores descritos son consecuencias probables de comportamientos observables, no testimonios de clientes.

El repositorio está en `main` y contiene cambios locales preexistentes, entre ellos búsqueda, investigación y secuencias. Su presencia no confirma que estén desplegados. Campañas depende de `BULK_CAMPAIGNS_ENABLED`; la ejecución automática también tiene una condición propia. Los hallazgos de esas superficies requieren confirmar su activación real.

No se modificó la aplicación ni se ejecutaron envíos, operaciones con créditos o escrituras en producción. Esta revisión no evalúa integralmente administración, privacidad, Suplia o el DOM real de LinkedIn.

Convenciones:

- **Observado:** texto, condición o transición visible en el código revisado.
- **Inferencia:** consecuencia probable para el ejecutivo; requiere validación con usuarios.
- **P1:** atender primero por bloqueo, confianza o impacto en una conversación comercial.
- **P2:** simplificación y productividad después de resolver los puntos críticos.
- Las prioridades no representan frecuencia medida ni incidentes confirmados.

## 3. Recorrido actual y momentos de fricción

| Momento | Recorrido implementado | Pregunta probable del ejecutivo |
|---|---|---|
| Entrar | Login o registro → Dashboard; perfil y conexiones separados | ¿Ya puedo trabajar o me falta configurar algo? |
| Encontrar | Filtros → empresas → contactos; también empresa o perfil de LinkedIn | ¿Qué cargos y empresas conviene buscar para mi servicio? |
| Preparar datos | Guardar → Guardados → completar datos → Enriquecidos | ¿Dónde quedó mi contacto? ¿Por qué cambió de lista? |
| Entender la cuenta | Seleccionar investigación → esperar → revisar informe | ¿Qué dato importa para vender y qué es solo una hipótesis? |
| Redactar | Crear borrador; en el flujo local nuevo, preparar secuencia → revisar correo | ¿Necesito todos estos pasos para escribir a una persona? |
| Enviar | Guardar cambios → aprobar → enviar; campañas puede enviar tras aprobar | ¿Este botón solo guarda o ya contacta al cliente? |
| Seguir | Contactados, Respondidos, Campañas y CRM | ¿Quién debe hacer qué y cuándo? |
| Convertir | Ver respuesta → generar sugerencia → copiar o abrir original | ¿Cómo cierro la tarea y dejo registrada la reunión? |

No se asigna un número total de clics: cambia según entrada, datos disponibles y funciones habilitadas.

## 4. Hallazgos priorizados

### H01 · P1 · El contacto cambia de lugar cuando avanza

**Observado.** La navegación separa Guardados, Contactados, Sheet y CRM. Al enriquecer, los contactos procesados se añaden a Enriquecidos y se retiran de Guardados. El aviso informa el traslado, pero la persona debe continuar en otra vista.

**Dolor probable:** “Lo guardé y ahora no lo encuentro”. La organización técnica del dato se convierte en una tarea del ejecutivo.

**Mejora:** una sección Contactos con vistas por estado, identidad y ficha persistentes. Completar datos debe actualizar el contacto, no parecer que lo mueve a otra herramienta. Mantener selección, filtros e historial al avanzar.

**Aceptación:** tras completar datos, la persona sigue visible y ofrece la siguiente acción; se puede volver a ella desde búsqueda, actividad o campaña.

Evidencia: `src/components/app-sidebar.tsx:40-85`; `src/app/(app)/saved/leads/page.tsx:350-400`.

### H02 · P1 · El inicio promete prioridad, pero ofrece destinos genéricos

**Observado.** Próximos pasos siempre devuelve CRM, campaña y leads en ese orden. Con cero actividad propone organizar pipeline y preparar campaña. Una tarea vencida enlaza a `/crm`, sin abrir la tarea ni un filtro específico. El CTA principal del Dashboard siempre es buscar leads.

**Dolor probable:** el usuario recibe una recomendación, pero debe buscar nuevamente el trabajo; un principiante entra a pantallas todavía vacías.

**Mejora:** inicio “Hoy”, sensible al estado: primera configuración, primera búsqueda o cola de trabajo. Priorizar respuestas que requieren acción, compromisos vencidos y borradores pendientes antes de nueva prospección. Enlaces directos al elemento recomendado.

**Aceptación:** “Responder a Ana” abre su conversación; “3 tareas vencidas” abre esas tres tareas. Una cuenta nueva recibe una única siguiente acción útil.

Evidencia: `src/components/dashboard/NextStepsWidget.tsx:101-158`; `src/app/(app)/dashboard/page.tsx:18-46`.

### H03 · P1 · “Listo para contactar” tiene criterios diferentes

**Observado.** El inicio cuenta leads enriquecidos con email o `hasEmail` como listos. En Enriquecidos, crear borrador también depende de investigación y del estado de su informe.

**Dolor probable:** el ejecutivo entra esperando enviar y encuentra nuevas tareas o controles deshabilitados.

**Mejora:** vocabulario y criterio compartidos: “Con correo”, “Por investigar”, “Borrador por revisar”, “Listo para enviar”. Separar disponibilidad de datos de autorización para enviar.

**Aceptación:** un contador y su destino muestran la misma población y el mismo siguiente paso.

Evidencia: `NextStepsWidget.tsx:74-77,144-149`; `src/app/(app)/saved/leads/enriched/Client.tsx:608-631`.

### H04 · P1 · La puesta en marcha está distribuida entre pantallas

**Observado.** El login dirige por defecto a Dashboard; el perfil y las conexiones son destinos separados. El inicio revisado no verifica en conjunto identidad comercial, correo y preparación para el primer contacto. Conexiones obliga a entrar al proveedor para conocer su estado.

**Dolor probable:** descubrir un requisito cuando ya se invirtió tiempo en buscar y redactar.

**Mejora:** preparación breve y retomable: confirmar equipo, identidad/firma, correo y objetivo comercial. Mostrar “Puedes enviar” o el requisito concreto con enlace de resolución. Permitir explorar mientras se completa la configuración.

**Aceptación:** antes de preparar el primer envío se conoce qué cuenta se usará y qué requisito falta; completarlo devuelve al trabajo pendiente.

Evidencia: `src/app/login/page.tsx:21-34`; `src/app/(app)/connections/page.tsx:15-32`; Dashboard y Próximos pasos.

### H05 · P1 · Falta un punto de partida visible adaptado a la venta de GrupoExpro

**Observado.** Búsqueda pide al usuario definir palabras clave, cargo, responsabilidad y ubicación; sus ejemplos incluyen Marketing Director y Microsoft. Perfil permite editar servicios y propuesta de valor. El agente pide además perfil de cliente ideal y propuesta de valor.

**Inferencia:** el ejecutivo debe traducir por su cuenta un servicio comercial a filtros y argumentos. No se comprobó qué información de GrupoExpro ya está precargada en las cuentas reales.

**Mejora:** entrada “¿Qué servicio quieres ofrecer?” usando el catálogo aprobado por GrupoExpro. Proponer audiencia, cargos equivalentes, señales útiles, exclusiones y mensajes; el ejecutivo confirma o adapta. Compartir criterios de equipo, con ajustes personales explícitos.

**Aceptación:** se puede iniciar una búsqueda útil desde un servicio sin escribir un ICP ni una propuesta de valor desde cero. Los ejemplos y argumentos se validan con la jefatura comercial.

Evidencia: `src/app/(app)/search/page.tsx:1797-1917`; `src/app/(app)/profile/page.tsx:40-45`; `src/app/(app)/antonia/page.tsx:125-148`.

### H06 · P1 · La identidad real del remitente queda ambigua

**Observado.** El editor informa el perfil remitente, pero advierte que la cuenta conectada puede ser diferente. La cabecera permite alternar Outlook/Gmail; no muestra ahí una dirección confirmada del proveedor.

**Dolor probable:** “¿Esto saldrá con mi correo corporativo y mi firma?”. La incertidumbre aparece justo antes del contacto externo.

**Mejora:** campo De con nombre y dirección reales de la cuenta conectada; firma visible en la revisión. Si difiere del perfil, explicar la discrepancia y ofrecer corrección concreta.

**Aceptación:** antes de enviar, el usuario identifica sin inferencias remitente, destinatario, firma y canal.

Evidencia: `src/app/(app)/contact/compose/page.tsx:1190-1210`.

### H07 · P1 · Aprobar no tiene una consecuencia consistente

**Observado.** En correo individual, “Revisar y aprobar” precede a “Enviar correo”. En campañas masivas, aprobar inicia envíos automáticamente cuando la automatización está habilitada; en el otro modo requiere iniciarlos después. La pantalla explica la diferencia, pero el CTA sigue siendo “Aprobar campaña”.

**Dolor probable:** creer que solo se aprobó un borrador cuando se activó un envío, o creer que salió cuando falta ejecutarlo.

**Mejora:** nombrar por consecuencia: “Guardar aprobación”, “Aprobar y activar envíos” o “Enviar ahora”. Resumen junto al CTA: destinatarios, remitente, momento de salida y seguimientos.

**Aceptación:** el usuario puede explicar qué ocurrirá al pulsar antes de hacerlo; editar texto invalida la revisión correspondiente sin borrar el trabajo.

Evidencia: `src/app/(app)/contact/compose/page.tsx:1540-1575`; `src/components/campaigns/BulkCampaignWorkspace.tsx:225-228`. Hallazgo de campañas condicionado a su activación.

### H08 · P1 · El circuito de respuesta asistida queda incompleto

**Observado.** En Respondidos, la IA genera una sugerencia que se presenta como texto y ofrece Copiar; también existe Abrir original. Ese diálogo no permite editar y enviar la respuesta en el hilo ni registrar una reunión.

**Dolor probable:** volver al correo, pegar, corregir y recordar actualizar el CRM cuando el lead ya mostró interés.

**Mejora:** conversación → propuesta editable → responder en el hilo → siguiente compromiso. Si el envío continúa en Outlook, abrir el hilo correcto y facilitar confirmación/sincronización del resultado.

**Aceptación:** desde una respuesta positiva se puede contestar y dejar registrada la siguiente acción con fecha y responsable, sin volver a localizar al contacto.

Evidencia: `src/app/(app)/contacted/replied/page.tsx:233-258`.

### H09 · P1 · Las respuestas no ocupan un lugar proporcional a su valor

**Observado.** La lista de Contactados excluye respondidos; estos tienen una ruta propia sin entrada directa en el menú principal. Respondidos ordena por fecha, mezclando solicitudes de reunión, positivas, automáticas y negativas. La recomendación principal del inicio no contempla una cola específica de respuestas.

**Dolor probable:** una solicitud comercial importante compite con ruido y navegación secundaria.

**Mejora:** bandeja “Por responder”, con interés/solicitud de reunión primero, responsable y antigüedad. Separar respuestas automáticas y casos resueltos. Mostrar última sincronización y errores de actualización sin confundirlos con ausencia de respuestas.

**Aceptación:** una solicitud de reunión pendiente es visible desde Hoy; atenderla la retira de la cola pendiente, conservando el historial.

Evidencia: `src/app/(app)/contacted/page.tsx:99-120`; `src/app/(app)/contacted/replied/page.tsx:33-54,150-178`; `app-sidebar.tsx`.

### H10 · P1 · “Verificado” puede representar solo “importado con email”

**Observado.** La importación asigna `emailStatus: 'verified'` cuando existe un email en la fila. Esa asignación no depende de una comprobación de entregabilidad en el manejador revisado.

**Dolor probable:** confiar en una certeza mayor que la evidencia disponible y contactar direcciones antiguas o incorrectas.

**Mejora:** distinguir “Importado”, “Formato válido” y “Verificado por proveedor”, con origen y fecha cuando existan. No equiparar formato con existencia del buzón.

**Aceptación:** un CSV con email no adquiere estado verificado por el mero hecho de importarse. La UI muestra la calidad real conocida.

Evidencia: `src/app/(app)/leads/import/page.tsx:40-58`. Confirmar además cómo persiste y presenta este estado el servicio.

### H11 · P1 · Investigar depende de tener email en la lista de enriquecidos

**Observado.** La elegibilidad para investigar y los botones por contacto requieren email. Un perfil con empresa, LinkedIn o teléfono pero sin correo queda bloqueado en esa entrada.

**Dolor probable:** no poder preparar una llamada o un acercamiento por LinkedIn a una cuenta valiosa.

**Mejora:** separar requisitos por tarea: investigar requiere una identidad suficiente de persona/empresa; enviar email requiere correo; llamar requiere teléfono. Ante falta de datos ofrecer una ruta alternativa útil.

**Aceptación:** un contacto identificable sin email puede investigarse cuando hay fuentes suficientes; la falta de correo bloquea solo las tareas que realmente lo necesitan.

Evidencia: `src/app/(app)/saved/leads/enriched/Client.tsx:743-755,1604,1629`.

### H12 · P1 · El siguiente paso comercial se sugiere, pero no se completa desde la ficha

**Observado.** El drawer de CRM muestra próxima acción, fecha y enlace de reunión si existen. Las sugerencias piden llamar/agendar, pero la acción ofrecida en ese bloque es Preparar correo. No contiene edición de próxima tarea en ese bloque.

**Dolor probable:** registrar y ejecutar compromisos exige encontrar otra superficie. La sugerencia no reduce el trabajo operativo.

**Mejora:** acciones contextuales “Agendar reunión”, “Registrar llamada”, “Crear recordatorio” y “Marcar realizado”, con fecha, responsable y resultado.

**Aceptación:** una recomendación se convierte en una acción registrada desde la misma ficha. “Reunión agendada” requiere fecha o una confirmación, no solo un cambio visual de etapa.

Evidencia: `src/components/crm/LeadDetailDrawer.tsx:54-92,644-688`. No se afirma que estas capacidades no existan en otras vistas.

### H13 · P1 · Eliminar un hilo implica más de lo que su etiqueta sugiere

**Observado.** En Respondidos, Eliminar está junto a Ver respuesta. El confirm habla de “todo su rastro local”; la operación usa borrado en cascada y el resultado enumera guardados, enriquecidos y reportes, entre otros.

**Dolor probable:** querer despejar una bandeja y perder contexto comercial en varias superficies.

**Mejora:** Archivar/Resolver como acción cotidiana. Desplazar eliminación a acciones secundarias y explicar en lenguaje de usuario el alcance real antes de confirmar. Recuperación cuando el modelo de datos lo permita.

**Aceptación:** resolver una conversación no borra la investigación ni la relación comercial; la eliminación describe objetos afectados con precisión.

Evidencia: `src/app/(app)/contacted/replied/page.tsx:137-147,212-216`.

### H14 · P2 · Hay demasiados conceptos de navegación para una tarea comercial

**Observado.** Menú y pantallas mezclan Dashboard, Sheet, Pipeline, Email Studio, Workspace, lead, enriquecimiento, misión y modos Full Auto/Semi Auto/Manual Assist.

**Dolor probable:** aprender el modelo de la herramienta antes de trabajar. “Oportunidades” puede además confundirse con una oportunidad comercial del CRM cuando esa función está habilitada.

**Mejora:** navegación por objetivo: Hoy, Prospectar, Contactos, Conversaciones y Seguimiento; automatización como capacidad contextual. Configuración agrupa perfil, conexiones y estilo. Validar los nombres con ejecutivos antes de renombrar.

**Aceptación:** un ejecutivo nuevo encuentra dónde buscar, responder y revisar pendientes sin explicación de módulos.

Evidencia: `app-sidebar.tsx:40-85`; `src/app/(app)/antonia/page.tsx:87-106`.

### H15 · P2 · Los mensajes de recuperación exponen mecanismos internos

**Observado.** Hay textos como “el navegador marcaba… el servidor confirma”, “Dispatch”, “confirmación durable”, “Policy”, “Exception Queue” y “Refresh Token”.

**Dolor probable:** no saber si debe esperar, reintentar, contactar soporte o corregir un dato.

**Mejora:** estado + efecto sobre el trabajo + siguiente acción. Ejemplo: “Estamos comprobando si salió. Conservamos tu borrador y evitaremos otro envío”. Los identificadores quedan en Detalles para soporte.

**Aceptación:** cada error permite responder “¿qué pasó?, ¿se guardó/se envió?, ¿qué hago?”.

Evidencia: `saved/leads/page.tsx:245-252`; `contact/compose/page.tsx:1245-1255,1500-1507`; `contacted/replied/page.tsx:100-105,255`; `outlook/page.tsx:138-142`.

### H16 · P2 · Los trabajos largos carecen de una entrada global evidente para retomarlos

**Observado.** Investigación y enriquecimiento tienen estados y actualización en sus propias superficies. La nueva preparación de secuencias dice que se puede cerrar y volver “a esta dirección”. El shell revisado no muestra una bandeja global de trabajos.

**Dolor probable:** conservar pestañas, recordar dónde comenzó el proceso o confundir una espera con un bloqueo.

**Mejora:** “Trabajo en curso” accesible desde Hoy: progreso real, completados, pendientes, error y enlace de retorno. Aviso persistente al terminar. No inventar estimaciones temporales sin datos históricos.

**Aceptación:** cerrar una pestaña no obliga a conservar su URL para recuperar el trabajo.

Evidencia: `src/components/research/ResearchWorkspace.tsx:980-994`; `src/app/(app)/contact/sequence/page.tsx:85-97`; `src/components/app-shell.tsx`. La secuencia está en cambios locales.

### H17 · P2 · Dos selecciones distintas complican la operación por lotes

**Observado.** En Enriquecidos hay selecciones separadas para investigar y crear borradores, incluso dos columnas de checkbox en escritorio, con criterios de elegibilidad diferentes.

**Dolor probable:** marcar la columna equivocada, no entender por qué una persona se puede seleccionar para una tarea y no para otra.

**Mejora:** una selección de contactos y una barra contextual que explique: “8 seleccionados: 5 por investigar, 3 con borrador disponible”. Las acciones informan a quiénes aplican antes de comenzar.

**Aceptación:** el usuario selecciona personas una sola vez y entiende los elegibles/excluidos de cada operación.

Evidencia: `src/app/(app)/saved/leads/enriched/Client.tsx:1540-1549,1648-1701`.

### H18 · P2 · Outlook obliga a interpretar dos estados de conexión

**Observado.** Conexión para automatización y sesión del navegador se muestran por separado, con botones para conectar y activar sesión. Las credenciales guardadas no equivalen a vigencia comprobada.

**Dolor probable:** “Dice conectado, pero me pide conectar otra vez”.

**Mejora:** estado principal expresado como capacidad comprobada: “Puedes enviar desde tu cuenta” o “Microsoft necesita renovar el acceso”. Resolver el mecanismo técnico en contexto y volver al borrador. Mostrar última comprobación.

**Aceptación:** la persona sabe si puede completar la tarea actual sin interpretar tokens, navegador y automatización.

Evidencia: `src/app/(app)/outlook/page.tsx:108-143`.

### H19 · P2 · La recuperación de acceso no es visible en login

**Observado.** Login ofrece contraseña, registro y Google, pero no un enlace de recuperación de contraseña en el formulario revisado. Se muestran errores del proveedor mediante `error.message`.

**Dolor probable:** recurrir a un administrador por un olvido; no comprender errores en otro idioma. La conveniencia de entrada Microsoft depende del esquema corporativo real y debe validarse.

**Mejora:** recuperación accesible, errores humanos y continuidad de la invitación/destino. Evaluar acceso corporativo Microsoft solo tras confirmar cómo trabajan las cuentas de GrupoExpro.

**Aceptación:** el ejecutivo recupera acceso sin abrir una cuenta duplicada y regresa al destino pendiente.

Evidencia: `src/app/login/page.tsx:29-40,109-155,243-248`.

### H20 · P2 · El resumen del inicio mide actividad más que resultados comerciales

**Observado.** Las cuatro métricas destacadas son contactados, respuestas, campañas y enriquecidos. Consultan totales por organización sin filtro temporal en ese componente, mientras el encabezado habla del avance de esta semana.

**Dolor probable:** confundir actividad acumulada con productividad semanal o resultado individual.

**Mejora:** alcance visible “Mi actividad / Equipo” y período explícito. Destacar respuestas positivas, reuniones confirmadas y próximos compromisos; volumen y créditos como apoyo. No llamar reunión a una mera intención de agendar.

**Aceptación:** cada KPI tiene definición, período y alcance claros; el usuario puede abrir sus registros de origen.

Evidencia: `src/components/dashboard/SummaryCards.tsx:60-90,119-124`; `src/app/(app)/dashboard/page.tsx:19-20`.

### H21 · P2 · Algunos vacíos no distinguen carga, error y ausencia de datos

**Observado.** CRM tiene carga/error diferenciados, pero su vacío no ofrece un CTA. Respondidos inicializa una lista vacía y carga sin un estado inicial de loading/error equivalente; “Aún no hay respuestas” puede renderizarse antes de completar la consulta. El resumen de próximos pasos falla sin botón de reintento.

**Dolor probable:** interpretar una carga o un fallo como ausencia de actividad, o llegar a un callejón sin salida.

**Mejora:** carga, vacío real, sin coincidencias, actualización fallida y permisos insuficientes diferenciados. En cada caso, acción útil: reintentar, limpiar filtros, conectar correo o buscar contactos.

**Aceptación:** no se afirma que no hay respuestas mientras todavía se están consultando; el error conserva los datos ya disponibles.

Evidencia: `src/app/(app)/crm/page.tsx:119-129`; `contacted/replied/page.tsx:21,33-34,220-224`; `NextStepsWidget.tsx:180-184`.

### H22 · P2 · Los límites se explican con dos unidades sin resolver la decisión

**Observado.** Enriquecimiento muestra créditos estimados y aclara que la cuota cuenta una operación por contacto. El aviso de cuota desincronizada añade cifras locales/servidor. Ya existe una base útil de transparencia de costos.

**Dolor probable:** no saber cuántos contactos puede trabajar ahora, qué ocurrirá si no aparece un dato o cuándo se recupera el cupo.

**Mejora:** síntesis orientada a la selección: costo estimado, saldo/cupo comprobado, regla real de cobro y momento real de restablecimiento. Ofrecer procesar los elegibles y conservar pendientes cuando corresponda.

**Aceptación:** el usuario entiende el costo y el alcance antes de confirmar; el resultado distingue encontrado, pendiente y no encontrado. No prometer devolución ni horario de renovación sin verificar la política real.

Evidencia: `src/components/enrichment/enrichment-options-dialog.tsx:79-89`; `saved/leads/page.tsx:245-252,377-379`.

### H23 · P2 · La construcción de audiencias cambia de lenguaje entre módulos

**Observado.** Búsqueda usa “Nivel de responsabilidad” con multiselección; campañas representa `seniorities` como “Antigüedad” en un input de valores separados por comas. Campañas busca dentro de enriquecidos, aunque su CTA dice “Buscar leads ideales”.

**Dolor probable:** interpretar seniority como años de experiencia o pensar que la campaña está encontrando prospectos nuevos en lugar de seleccionar la base disponible.

**Mejora:** componente y vocabulario de audiencia compartidos, con alcance explícito “Buscar nuevos” / “Seleccionar de mis contactos”. Reutilizar búsquedas guardadas o convertirlas sin reescribir criterios.

**Aceptación:** responsabilidad jerárquica nunca se presenta como antigüedad; se entiende sobre qué universo se busca.

Evidencia: `src/app/(app)/search/page.tsx:1905-1908`; `src/components/campaigns/BulkCampaignWorkspace.tsx:163-179`. Condicionado a campañas masivas.

### H24 · P2 · La colaboración existe, pero debe llegar antes a la decisión de prospección

**Observado.** La ficha CRM contiene responsable, reserva, estado de contacto y conflicto de hilo. En Guardados, “Encontrado por” y “Solo mis leads” se basan en procedencia/usuario, conceptos distintos del responsable comercial.

**Inferencia:** el ejecutivo puede confundir quién encontró el contacto con quién está trabajando la cuenta. No se afirma ausencia de controles de duplicado; sí una oportunidad de hacerlos visibles antes de invertir esfuerzo.

**Mejora:** responsable y relación previa visibles desde resultados y selección, aprovechando los controles existentes. Para GrupoExpro, validar también titularidad por empresa: dos personas de una misma cuenta pueden representar una sola gestión comercial.

**Aceptación:** antes de investigar o preparar mensajes se identifica si un compañero ya trabaja el contacto; “Mis contactos” se define por responsabilidad, con procedencia separada.

Evidencia: `src/components/crm/LeadDetailDrawer.tsx:154-178,637-642`; `src/app/(app)/saved/leads/page.tsx:145-165,230-235`.

## 5. Capacidades existentes que conviene preservar

- Búsquedas guardadas y criterios compartibles; evitar pedir filtros repetidamente.
- Desambiguación de empresas y distinción entre ubicación de empresa y del contacto.
- Estimación de créditos antes de completar datos.
- Investigación con fuentes y estados de calidad; ya hay resúmenes comerciales en los informes. La mejora es llevar la evidencia útil a la decisión, no agregar otro informe.
- Borrador editable, revisión de propuestas IA antes de aplicarlas y protección de cambios en el editor.
- Tratamiento explícito de envío fallido, pendiente o confirmado, y reintentos que evitan duplicación.
- Secuencias con detención ante respuesta y estados por destinatario en campañas.
- Colaboración, conflictos de contacto e historial comercial en CRM.
- Patrones responsive, foco y carga ya presentes en varias superficies. Reutilizarlos en las vistas rezagadas; no se certifica su funcionamiento renderizado en esta revisión.

## 6. Recorrido recomendado

### Primera sesión

1. Confirmar pertenencia a GrupoExpro, identidad/firma y cuenta corporativa.
2. Elegir servicio y audiencia desde criterios aprobados por el equipo.
3. Encontrar una selección pequeña de empresas y decisores relevantes.
4. Abrir ficha: quién es, por qué podría encajar, responsable y contacto previo.
5. Preparar contacto: completar solo los datos necesarios e investigar con progreso recuperable.
6. Revisar correo y seguimientos con evidencia accesible, remitente real y consecuencias claras.
7. Enviar o programar; ver confirmación y siguiente acción sin abandonar el contacto.

### Sesiones siguientes

**Hoy → atender respuestas → cumplir compromisos → revisar borradores → prospectar cuando haya capacidad.**

La automatización debería ejecutarse sobre este mismo recorrido, con resultados y excepciones visibles donde el ejecutivo ya trabaja, en vez de exigirle aprender otra operación completa.

### Ficha comercial mínima

- Persona, cargo, empresa, responsable y relación previa.
- Servicio de GrupoExpro elegido y motivo del encaje.
- Una señal verificable relevante, con fecha y fuente; hipótesis claramente separadas.
- Correo/teléfono con estado de calidad y origen.
- Última interacción, próxima acción y fecha.
- Acción principal contextual: completar datos, investigar, revisar, responder o registrar reunión.

Los servicios concretos, casos de éxito y afirmaciones comerciales deben salir del material aprobado de GrupoExpro. Este informe no los inventa ni da por confirmado un catálogo.

## 7. Secuencia de mejora propuesta

| Tramo | Entregable | Hallazgos | Tamaño relativo |
|---|---|---|---|
| 1. Confianza y claridad | Criterios de “listo”, remitente real, CTA de aprobación/envío, calidad del email importado, alcance del borrado | H03, H06, H07, H10, H13 | Pequeño a medio; remitente puede requerir integración |
| 2. Activación y prioridad | Preparación inicial retomable, inicio Hoy, respuestas y enlaces a tareas concretas | H02, H04, H09, H19, H20, H21 | Medio |
| 3. Continuidad | Ficha persistente, selección única, trabajos recuperables y acciones por canal | H01, H11, H16, H17 | Medio a grande |
| 4. Conversación a reunión | Responder en contexto y registrar compromisos/resultado | H08, H12 | Grande si exige integración de correo/calendario |
| 5. Productividad GrupoExpro | Criterios y mensajes por servicio, audiencia compartida, colaboración temprana | H05, H14, H18, H22, H23, H24 | Medio a grande; requiere decisiones comerciales |

Son tamaños relativos, no estimaciones de calendario. Requieren revisar dependencias y contrastar la versión desplegada antes de planificar implementación.

## 8. Validación con ejecutivos y medición

Realizar una primera ronda moderada con 5–8 ejecutivos, mezclando nuevos y habituales. Sirve para descubrir problemas, no para estimar estadísticamente a toda la organización. Usar contactos de demostración y evitar envíos externos durante la evaluación.

Tareas:

1. Entrar por primera vez y explicar qué falta para trabajar.
2. Encontrar tres decisores para un servicio real de GrupoExpro.
3. Preparar contacto con una persona sin email, pero con empresa y LinkedIn.
4. Completar datos, salir y recuperar el contacto.
5. Revisar un correo e indicar quién envía, a quién y qué hará cada botón.
6. Recuperar una investigación o secuencia después de cerrar la pestaña.
7. Resolver un envío pendiente sin duplicarlo.
8. Atender una respuesta positiva y dejar un compromiso con fecha.
9. Identificar si un compañero ya trabaja ese contacto o empresa.

Registrar finalización sin ayuda, errores, retrocesos, cambios de pantalla evitables, solicitudes de ayuda y comprensión de estados. Medir por separado tiempo activo del usuario y espera del sistema.

Métricas propuestas, todavía sin línea base:

- Tiempo al primer contacto revisado y al primer envío confirmado.
- Abandono entre búsqueda, guardado, datos, investigación, borrador y envío.
- Porcentaje de recomendaciones del inicio que llevan directamente a una tarea resuelta.
- Tiempo desde respuesta positiva detectada hasta atención del ejecutivo.
- Porcentaje de conversaciones activas con responsable y próxima acción fechada.
- Reuniones confirmadas por ejecutivo y por servicio, con período explícito.
- Recuperación exitosa de procesos interrumpidos y envíos con estado incierto.
- Comprensión del remitente y de las consecuencias de aprobar/enviar.

La métrica guía debería combinar **conversaciones comerciales calificadas y reuniones confirmadas**, no solo volumen de correos. Establecer objetivos de mejora después de medir la situación inicial.

## 9. Preguntas de negocio pendientes

- ¿Qué servicios y segmentos prioriza hoy GrupoExpro y qué materiales están aprobados?
- ¿El ejecutivo posee cuentas, territorios, contactos individuales o una combinación?
- ¿Cómo se distinguen cliente actual, prospecto nuevo, cuenta reservada y oportunidad abierta?
- ¿Qué herramientas son fuente de verdad para correo, calendario y CRM?
- ¿Qué parte de la prospección debe aprobar una persona y qué automatización está habilitada realmente?
- ¿Qué define para el equipo una respuesta positiva, una reunión calificada y una oportunidad?
- ¿Cuándo corresponde email, teléfono o LinkedIn? ¿Qué canales usan de verdad los ejecutivos?

Estas respuestas permiten adaptar el producto a la operación comercial real en vez de optimizar únicamente el uso de sus módulos.
