# Conversaciones de Contactados — tramos 1 a 6

## Incremento listo para publicación · 22 septiembre

- Compromisos persistidos en la ficha: llamada, recordatorio y reunión con fecha elegida por el usuario, responsable titular y marcar realizado. No crea invitaciones de calendario.
- Reprogramación de pasos aún no despachados, con bloqueo de fila y rechazo de secuencias detenidas/respondidas. Pausa/activación del envío automático; se revalida la pausa inmediatamente antes del proveedor.
- Recomendación IA persistida por respuesta durante sincronización y análisis manual con caché. Clasificación existente + política acotada: responder, coordinar, esperar, cerrar, no contactar o revisión por incertidumbre. Nunca activa envíos desde una recomendación.
- Solicitud de respuesta pendiente guardada también en servidor para recuperarla al abrir la ficha.
- Migraciones aplicadas y permisos verificados: `20260922223501_contacted_work_actions`, `20260922223650_cowork_send_batch_atomicity` (solo service_role; RLS conservado).
- PostgreSQL aislado (PGlite): compilación, mezcla de metadata, completar compromiso, conflictos, bloqueo de reprogramación, programación idempotente y rollback de reservas. No simula workers concurrentes independientes.
- Chrome headless con API simulada: 360/768/1440, claro/oscuro, formulario y recomendación, sin overflow horizontal, Escape y recuperación de foco.
- Verificación: typecheck/build aprobados, 185 pruebas Cowork + scripts aislados, 63 extensión, 28 pruebas focalizadas del incremento. Sin envíos externos reales ni prueba autenticada contra proveedor.
- Extensión 4.0.14 recompilada; ZIP ahora incluye prospecting-invite.js.

Estado: implementación parcial del plan original en el árbol local; migración de estado aplicada a producción. La aplicación no está desplegada en este cambio. El cierre anterior de todos los tramos no certificaba aceptación funcional integral.

## Tramos 1–3

- Sincronización de respuestas recorre correos ya respondidos, guarda progreso/errores y admite cursor manual. El cron reparte contactos por último intento de sincronización.
- Las solicitudes explícitas de baja se detectan antes de clasificación IA y se ignoran firmas quoted/historial citado. El RPC existente registra la baja y detiene secuencias.
- Bandeja Contactados con Por responder, Esperando respuesta, Programados y Todos; búsqueda, filtro por canal y alcance personal.
- Ficha con correos del proveedor cuando están disponibles, contenido enviado de snapshot/versiones, fase comercial, próximos seguimientos y estado de carga/cobertura.

## Tramo 4 — Responder y gestionar

- Sugerencia asistida editable con envío explícito desde la ficha.
- Gmail: parent id, thread, destinatario y asunto verificados; reply se envía al mismo `threadId`.
- Outlook: el mensaje original y su conversación se verifican, se crea un reply draft del proveedor, se reemplaza su contenido por el aprobado por la persona y se envía en ese hilo. Se confirma mediante correlación en Sent Items; ausencia de confirmación queda incierta.
- Antes de enviar: propiedad y pertenencia del contacto, respuesta pendiente, cuenta/proveedor, supresión, cuota y estado durable del envío.
- Reintento desconocido usa la misma clave idempotente; no genera otro envío.
- La respuesta enviada queda proyectada en la conversación y deja de aparecer como pendiente.

## Tramo 5 — Seguimientos

- La ficha consulta las secuencias Campaign V2 y los informes acotados de campañas masivas para mostrar fecha, estado, contenido disponible y estado pausado.
- Secuencias Campaign V2 del propietario pueden detenerse desde la ficha con confirmación; el historial enviado se conserva.
- Campañas masivas enlazan a Campañas; no se promete una hora de ejecución si el informe no puede comprobarla. La cobertura está limitada y se declara parcial al alcanzar sus límites.

## Tramo 6 — Actividad y calidad

- Rastreo por envío es opcional y está desactivado inicialmente al contestar. Si se habilita, usa identidad de despacho; no atribuye eventos al envío más reciente del mismo lead.
- Pixel y clic crean eventos ligados al `provider_message_id` y al `contacted_id` exactos. Las URL de baja no se reescriben.
- UI diferencia seguimiento no disponible, ausencia de señal y apertura/clic detectados; la apertura no se presenta como prueba de lectura.

## Migración

`20260922211338_contacted_conversation_state.sql` fue aplicada por MCP a `supabase-production` y figura en el ledger. Verificación posterior: cinco columnas presentes, índice `contacted_reply_sync_queue_idx` presente, RLS habilitado y sin modificación de políticas. Tabla estimada en 694 registros antes del cambio.

## Verificación local

- `npm run typecheck`: OK.
- Build integrado `npm run build`: OK; permanece la advertencia existente de `<img>` en `ArtifactPreview.tsx`.
- Pruebas afectadas: 53/53 pasaron antes del build (reply sync/ingestion, clasificación de baja, agrupación de conversaciones, send idempotency, targets Gmail/Outlook, tracking y endpoint de envío).

## Límites

- El contenido histórico solo se muestra como completo si el proveedor permite leer el hilo; la UI advierte ante cobertura parcial.
- Los informes de campañas masivas tienen límite de lectura; la interfaz expone alcance parcial.
- La medición de aperturas puede ser manipulada por proxies y precargas. Aun habilitada, es una señal técnica, no evidencia de lectura humana.
- Pendiente revisión autenticada en navegador y prueba real controlada de Gmail/Outlook; no se envió ningún correo.

## Auditoría posterior

- Corregido Gmail: conservar List-Unsubscribe al añadir encabezados de respuesta.
- Corregido Outlook: fijar destinatario único, vaciar CC/BCC y volver a leer el borrador antes de enviar. Verificar destinatario, conversación, asunto, cuerpo y correlación. Si Graph no admite la actualización/conservación del encabezado o normaliza el contenido de forma distinta, se bloquea el envío; no se certifica compatibilidad real a partir de mocks.
- Recuperación: consultar el despacho existente antes de exigir respuesta pendiente o renovar tokens. La identidad del borrador de respuesta ya no incluye el enlace de baja aleatorio. El editor conserva solicitud y clave en sessionStorage de esa pestaña; cerrar la pestaña o cambiar de dispositivo no constituye recuperación durable de la UI.
- Sugerencias: mantener el asunto del hilo y descartar resultados que llegan después de cambiar de contacto.
- Respuestas manuales se interpretan como texto, no como HTML proporcionado por el navegador. Se valida tamaño y se reconsulta supresión inmediatamente antes de invocar el proveedor.
- Campañas: descubrir campañas a través de RLS antes de utilizar el lector administrativo del informe.
- Tracking: un evento técnico no sobrescribe entrega, evaluación ni puntaje comercial. El contador de clics todavía no es un contador transaccional bajo concurrencia; no usar como métrica exacta.
- Verificación posterior: typecheck OK, 55/55 pruebas focalizadas OK, build OK (advertencia preexistente de img).

## Alcance aún no entregado del plan original

- Registro/edición/completado de compromisos y reuniones desde la nueva ficha.
- Reprogramación y pausa/reanudación completas desde la ficha (actualmente se puede detener una secuencia o abrir la campaña).
- Auditoría renderizada de contraste, teclado, responsive y recuperación completa con sesión real.
- Prueba de punta a punta de permisos, estado incierto, bajas y contenido final usando proveedores reales con un destinatario de prueba autorizado.

El plan original tenía tramos 0–5; la iteración posterior renumeró seguimiento/actividad como 5–6. Esa renumeración no equivale a completar compromisos ni auditoría visual.

## Corrección del bucle de sincronización (egress PostgREST)

Causa: los contactos con hilo no verificable (`incomplete_thread`, 598 en producción) se reintentaban cada 5 minutos con dos `PATCH` por contacto y pasada, generando ráfagas de `PATCH /rest/v1/contacted_leads`.

- `src/lib/server/reply-sync-policy.ts`: filtro de vencimiento por estado (hilos sanos cada 5 min, errores transitorios 60 min, conexión 6 h, hilos incompletos 24 h), aplicado antes del límite para no desplazar hilos sanos.
- Una sola escritura de intento por página y errores agrupados por estado en `syncRepliesForOrganization`; los tokens con fallo se reutilizan dentro de la pasada sin reintentar.
- Las escrituras de sincronización devuelven solo `select('id')` en vez de la fila completa, para no multiplicar el egress en cada tick.
- El cron y la sincronización manual usan el mismo filtro.
- Esta corrección detiene la ráfaga actual; no demuestra por sí sola los 5,92 GB acumulados del ciclo, cuyo consumo diario elevado precede al despliegue reciente.
- Verificación en producción tras desplegar `d03bc11`: reintentos de hilos incompletos en 10 min bajaron de ~362 a 0; los hilos sanos siguen confirmándose (~87 en 10 min). Commit `d03bc11`, desplegado en App Hosting `studio`.
