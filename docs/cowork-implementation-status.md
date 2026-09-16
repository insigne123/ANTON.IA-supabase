# Cowork — Estado de implementación

Actualizado: 15 de septiembre de 2026.

**Entrega actual:** las cinco migraciones ya están aplicadas en producción y sus versiones locales alineadas. Ver `cowork-handoff-2026-09-15.md`. Las menciones a migraciones preparadas de abajo describen el historial de desarrollo, no el estado actual. La activación de la funcionalidad sigue pendiente.

## Implementado localmente

- Contrato de identidad: email verificado exacto y UUID fijado en configuración servidor.
- Kill switch servidor y denegación por defecto.
- Guardia de petición con sesión verificada, organización vigente y autorización en DB.
- Guardia para workers con nueva consulta de Auth, autorización vigente y membresía antes de efectos.
- Endpoint privado `GET /api/cowork/access` con respuestas no cacheables.
- Contrato estricto de solicitud: no admite propietario, organización ni herramienta arbitraria desde el cliente.
- Transiciones base de ejecución y pruebas de estados terminales.
- Gateway independiente del runtime: schemas de entrada/salida, registro explícito, concesiones, revalidación tras reserva y cancelación antes de efectos. El almacén durable de operaciones aún debe implementar la interfaz de reserva/replay.
- Migración preparada para acceso privado, ejecuciones y eventos ordenados, con RLS de lectura y escrituras restringidas al servidor.
- Admisión SQL idempotente: inserción y evento inicial atómicos; rechaza reutilización de clave con otro contenido.
- Página privada `/cowork` con inicio centrado, historial, lectura del trabajo, actividad real y documento lateral. Menú visible solo después de consultar autorización servidor.
- APIs de listado, admisión, detalle y cancelación con propietario y organización derivados de sesión.
- Worker de lectura y redacción: puede buscar hasta 20 contactos guardados propios o consultar una ficha por UUID. Filtra por propietario y organización, sin acceso a registros de compañeros. Produce respuesta y documento Markdown opcional; no tiene búsqueda externa ni ejecución de código.
- Bucle de decisiones con hasta tres consultas reales y cuatro llamadas de modelo, plazo total de 105 segundos y revalidación de acceso/lease antes de consultas y publicación. No implica ejecución paralela de especialistas.
- Consultas registradas como `tool.completed`; sus datos se reutilizan para exportación CSV autenticada, con columnas limitadas, deduplicación y neutralización de fórmulas. Exporta snapshots observados, no tablas inventadas por el modelo.
- Continuidad mediante trabajo padre: “Continúa este trabajo” usa resultados anteriores de la misma cuenta/organización. Hasta ocho turnos y 60.000 caracteres; no trunca silenciosamente el documento inmediato. El historial anterior omitido se declara al modelo. Cada continuación crea un trabajo enlazado, no edita una versión in situ.
- Endpoint interno `POST /api/cron/cowork` autenticado con secreto propio. Procesa un trabajo por petición.
- Segunda migración preparada con claim `SKIP LOCKED`, leases de 180 s, hasta tres intentos de recuperación, finalización protegida por token y cancelación atómica.
- Lectura periódica de estado cada 3 s; publicación de resultados después de una cancelación rechazada por token/estado. No hay etapas temporizadas ficticias.

## Configuración requerida, todavía no aplicada

Variables **solo servidor**:

```dotenv
COWORK_ENABLED=false
COWORK_OWNER_USER_ID=
COWORK_WORKER_ENABLED=false
COWORK_MODEL=
COWORK_WORKER_SECRET=
```

Resolver el UUID de la cuenta verificada `nicolas.yarur.g@yago.cl` mediante administración autorizada de Auth. No aceptar un UUID proporcionado por navegador ni derivarlo del email. Provisionar el registro de autorización en DB por un operador autorizado; no existe autoinscripción.

Las migraciones `20260915120000_cowork_private_core.sql` y `20260915130000_cowork_worker_leases.sql` están preparadas, no aplicadas ni probadas contra Postgres. Aplicarlas una por vez con su verificación correspondiente. Sin esquema/grant/configuración, la guardia deniega acceso. La revocación inmediata operativa debe realizarse deshabilitando el grant: cada petición y cada inicio de herramienta lo consulta sin caché. La variable de entorno es un cierre adicional y su cambio depende del ciclo de despliegue.

También están preparadas `20260915140000_cowork_tool_events.sql` y `20260915150000_cowork_followups.sql`. Esta última valida padre completado y scope, y liga la clave de idempotencia al padre, mensaje y modo en una transacción. Es necesario aplicar y verificar las cuatro antes de activar esta versión.

Antes de activar `COWORK_WORKER_ENABLED`, configurar y verificar una llamada programada a `POST /api/cron/cowork`, cabecera `x-cowork-worker-secret`, y el proveedor/modelo configurado. El endpoint está implementado; el scheduler no está provisionado. La API evita admisión mientras faltan flags/modelo/secreto, pero esto no acredita la salud de un scheduler externo. Su comprobación operativa sigue pendiente. Reutiliza el cliente de modelos existente y sus credenciales servidor.

## Pendiente para el producto completo

- Inventario por operación y auditoría de servicios actuales.
- Validación visual renderizada de light/dark y responsive; por ahora hay prueba de interacción DOM, no auditoría en navegador real.
- Provisionar scheduler y comprobar recuperación/cancelación y políticas en Postgres.
- Conversaciones: falta visualizar el hilo completo en una misma pantalla y versionar el mismo artefacto. No se presenta el modo autónomo en la UI mientras no hay operaciones de escritura.
- Orquestación de herramientas de dominio, almacén de operaciones del gateway, presupuesto, aprobaciones y múltiples workers.
- Sandbox, archivos, previews, artefactos y memoria.
- Suite SQL/RLS, pruebas de integración de acceso y benchmark integral.

El producto completo continúa pendiente. Existe ahora un recorrido de redacción preparado para activación privada, pero no está desplegado y no equivale a controlar toda ANTON.IA.

## Verificación local

### Consolidación, scheduler y guardado de contactos

- Supabase volvió a estar disponible. Identidad verificada: `nicolas.yarur.g@yago.cl`, UUID `de3a3194-29b1-449a-828a-53608a7ebe47`. No se habilitó un grant ni se cambió una cuenta.
- `apphosting.yaml` incorpora UUID/modelo del piloto y mantiene `COWORK_ENABLED=false` y `COWORK_WORKER_ENABLED=false` hasta la verificación del despliegue.
- Nuevo `functions/cowork-scheduler.ts`: tick cada minuto, secreto dedicado, destino HTTPS, redirects rechazados, timeout y sin retries automáticos del scheduler. Requiere `COWORK_SCHEDULER_ENABLED=true` en Functions y secreto en ambos runtimes. No está desplegado.
- Guardar contacto desde un resultado Apollo: toma exclusivamente la observación persistida; identidad determinista por usuario/organización/proveedor, inserción sin sobrescritura, reutilización de contacto propio existente y confirmación por relectura. No transfiere titularidad ni inventa email verificado.
- Botón para continuar con la ficha guardada y su investigación. No deduplica universalmente contactos con identidades distintas ni contra registros invisibles de otros usuarios; esos casos deben resolverse en el modelo compartido.
- Verificación aislada de guardado y scheduler aprobada; TypeScript de app y Functions aprobado, regresión DOM y lint de archivos afectados aprobados.
- Nuevo comando `node scripts/verify-cowork.mjs` agrupa las pruebas aisladas del desarrollo. No usa producción ni acredita migraciones, despliegue, sandbox o prueba visual.

El alcance integral solicitado continúa abierto: activación real, nuevas migraciones, operaciones durables generalizadas, autonomía, multiworker, sandbox, artefactos versionados, cobertura total, memoria y programaciones. No se ha finalizado el plan completo.

### Solicitar investigación nativa desde contactos

- Contactos guardados observados en un trabajo completado ofrecen “Investigar contacto”, con confirmación explícita del alcance estándar y cuotas del servicio. Los resultados externos `apollo:ID` todavía requieren guardado previo; no se hacen pasar por contactos propios.
- Endpoint privado `/api/cowork/runs/:id/research` verifica trabajo, observación, propiedad vigente y datos actuales antes de invocar `enqueueNativeResearch`.
- Clave por trabajo/contacto, profundidad estándar, idioma español, `refresh:false`. No se cobra una segunda cuota Cowork: la cola nativa aplica su política existente. Un contacto identificable sin email puede investigarse.
- Seguimiento por clave de solicitud nativa, actualizado cada cinco segundos. Reabrir el resultado vuelve a consultar estado. Al terminar, “Consultar informe en el chat” prepara una continuación explícita para `research.get_existing`.
- Flag `COWORK_RESEARCH_ENABLED=true` requerido junto al motor/scheduler nativo. No se ha activado ni desplegado. No requiere tablas nuevas: conserva los jobs existentes de investigación.
- Prueba aislada de target observado, propiedad, revocación, clave estable y ausencia de requisito de email aprobada. TypeScript, ESLint y regresión DOM aprobados. Falta E2E con investigación real y verificar recuperación si el motor reutiliza un job previo con otra clave.
- Límite: una investigación admitida pertenece al scheduler nativo y sigue sus reglas; detener el trabajo Cowork no cancela automáticamente ese job. La cancelación/revocación cruzada entre ambos motores debe integrarse antes de certificar autonomía general.

### Borrador nativo durable en segundo plano

Reemplaza la generación dentro de la petición descrita más abajo.

- `POST /api/cowork/runs/:id/draft` solo valida y encola (`cowork_request_draft`); responde 202. Repetir la solicitud devuelve el estado admitido sin duplicar trabajo.
- El scheduler Cowork procesa primero un borrador pendiente y después búsquedas y conversación. Reclamos concurrentes compiten con `FOR UPDATE SKIP LOCKED`.
- Antes de generar se revalidan acceso, snapshot y contacto; antes de publicar el resultado se revalidan acceso y cancelación. Un resultado tardío nunca revive un trabajo cancelado.
- Clave nativa estable por trabajo/snapshot: los reintentos reutilizan el mismo borrador. Bloqueos del generador (falta de correo, preflight, supresión) terminan como fallo terminal con mensaje, sin reintento ciego.
- Un crash inesperado deja la solicitud en ejecución; el siguiente tick la reencola (hasta 3 intentos) y después la marca fallida con mensaje de reintento explícito.
- `GET /api/cowork/runs/:id/draft?snapshotId=` recupera el estado y, al completar, el contenido desde el evento persistido. Cerrar la pestaña y volver muestra el borrador sin regenerar.
- La UI distingue en cola, preparando, guardado y fallo con reintento; la actividad del trabajo registra solicitado/iniciado/guardado/fallido.
- Migración `20260915230000_cowork_draft_queue.sql` aplicada en producción y verificada (tabla, RLS solo lectura privada, RPCs solo `service_role`). Junto a ella quedaron aplicadas `20260915220000_cowork_external_search.sql` y `20260915221000_cowork_search_queue.sql`: el esquema Cowork en producción está al día con el código local.
- Prueba `scripts/test-cowork-native-draft.mjs` reescrita al flujo durable (encolado validado, clave estable, generación en worker, bloqueo, crash sin evento prematuro y recuperación de estado); TypeScript, ESLint y regresión DOM aprobados.
- Pendiente: exponer el borrador en el editor de correos (enlace/edición) y programar el scheduler con el secreto dedicado. Flags `COWORK_NATIVE_DRAFTS_ENABLED` y worker continúan cerrados por defecto.

### Borrador nativo desde investigación consultada (petición sincrónica, reemplazada)

- Acción explícita en Fuentes: “Crear borrador con este informe”, disponible con `COWORK_NATIVE_DRAFTS_ENABLED=true` y trabajo completado.
- Adaptador a `createNativeDraft`, conservando perfil/estilo, control de evidencia, supresión y preflight del motor actual. No crea un correo enviado ni una aprobación de envío.
- Solo admite snapshot observado en eventos del trabajo, con validación actual de snapshot/contacto propios, organización y autorización Cowork. El body no acepta destinatario, organización, contenido o clave de idempotencia arbitrarios.
- Clave estable por trabajo/snapshot para recuperar la misma generación nativa tras reintentar. Preview como texto; contenido HTML no se ejecuta.
- Muestra bloqueo/fallo del generador sin presentarlo como borrador guardado. Acceso revocado retira resultados de la UI.
- Prueba aislada del adaptador aprobada (snapshot observado, scope, autorización, idempotencia y bloqueo), TypeScript, lint y regresión DOM aprobados.
- Pendiente antes de activar: prueba real del generador en entorno autorizado; cola dedicada para generación larga; enlace/edición del borrador y registro durable de su referencia en el trabajo. Actualmente reabrir permite recuperar por la misma clave, no muestra automáticamente el borrador previo. Una petición en curso puede terminar su escritura tras revocación; se verifica acceso antes y después, pero el motor nativo no recibe todavía cancelación Cowork.
- No requiere migración nueva; usa persistencia nativa existente. Flag permanece cerrado por defecto. No se habilitó en producción.

### Consulta de investigaciones existentes

- Tool `research.get_existing` conectada al bucle: recibe UUID de contacto propio, verifica identidad/organización y consulta el último job y snapshot bajo ese mismo alcance.
- No inicia investigaciones ni consume créditos. Distingue ausencia de job, job sin snapshot e informe disponible. Si el último job está pendiente no presenta un informe anterior como resultado nuevo.
- Valida el contrato compartido `ResearchSnapshotV1Schema` y la identidad interna del snapshot; entrega evidencia, fuentes, clasificación hecho/hipótesis, contradicciones, advertencias y vencimiento de claims.
- Acota la selección a 25 evidencias, 20 claims y 20 contradicciones; declara truncamiento. Se omiten metadatos de solicitudes y proveedores no necesarios para redactar.
- Workspace muestra fuentes con fecha del informe y aviso de que no fueron consultadas nuevamente. URLs limitadas a HTTP(S).
- Dos pruebas de resumen y scope aprobadas, junto con regresiones del bucle, TypeScript, lint y DOM de fuentes/cola. Sin llamadas a proveedores ni escritura en producción.
- Pendiente: iniciar nuevas investigaciones con autorización y cuota, recuperar su finalización, y conectar el generador nativo de borradores. El texto redactado por el worker aún no es un borrador de correo persistido en el motor de envíos.

### Búsqueda externa en segundo plano

Este incremento reemplaza la ejecución dentro de la petición de aprobación descrita más abajo.

- Aprobar persiste `approved` y el evento `search.approved`; la petición no llama a Apollo ni consume cuota. Repetir la misma aprobación devuelve el estado admitido.
- El scheduler Cowork procesa primero una búsqueda aprobada y después, si no tomó ninguna, un trabajo de conversación. Dos invocaciones compiten mediante `FOR UPDATE SKIP LOCKED`; solo una toma cada propuesta.
- Antes de consumir cuota y antes de llamar al proveedor se vuelve a verificar acceso y cancelación.
- Una ejecución interrumpida más de 180 segundos se marca con resultado incierto en el siguiente tick, sin relanzarla ni volver a consumir. Esto evita repetición pero no recupera un resultado perdido del proveedor; falta conciliación si Apollo ofrece una identidad consultable para esa llamada.
- La UI distingue aprobada/en cola, búsqueda en curso y resultado incierto. La acción de aprobar desaparece tras admisión y se conserva cancelar el trabajo.
- Nueva migración pendiente `20260915221000_cowork_search_queue.sql`, dependiente de `20260915220000_cowork_external_search.sql`, también pendiente. Requiere aplicar ambas antes de habilitar búsqueda externa. No se tocaron las cinco migraciones ya aplicadas.
- Pruebas aisladas de aprobación sin llamada externa, ticks paralelos, cuota, timeout sin replay, descarte y cancelación aprobadas. DOM de propuesta/cola/resultado incierto y regresión del workspace aprobados; TypeScript y ESLint aprobados. Los mocks no certifican locking ni ejecución SQL real.

### Incremento: búsqueda externa con revisión

- Acción `prospecting.propose_search` con cargos, sectores, ubicación de personas y límite máximo 25. Nueva búsqueda siempre requiere revisión, no revelado de email/teléfono.
- Adaptador a `requestApolloSearch`, reutilizando el proveedor actual y `getEffectiveDailyQuotaLimits` / `checkAndConsumeDailyQuota` para una operación de cuota por búsqueda admitida. El rechazo no consume cuota. Una cuota reservada no se devuelve automáticamente si falla después; misma política conservadora que la entrada de búsqueda actual.
- Claim persistente previo a la llamada: duplicar la aprobación no vuelve a llamar al proveedor. Propuesta, ejecución y resultado quedan identificados en eventos; cancelación no revive el trabajo con una respuesta tardía.
- Resultados con identidad `apollo:ID`, sin equipararlos a IDs de contactos guardados. Visibles y exportables en CSV/Excel; no se guardan automáticamente en CRM.
- Continuaciones incluyen observaciones persistidas de hasta tres consultas por turno, además de respuesta/documento, dentro del presupuesto de contexto.
- Flag servidor `COWORK_EXTERNAL_SEARCH_ENABLED=true` únicamente después de aplicar/verificar `20260915220000_cowork_external_search.sql` y confirmar proveedor/cuotas. La migración está preparada, no aplicada por el mantenimiento del MCP; la capacidad está cerrada por defecto.
- El primer ejecutor corre en la petición de aprobación (máximo 90 s). Un cierre del proceso deja la operación marcada en ejecución: no se reintenta automáticamente porque puede haber consumido proveedor. Falta conciliación/ejecución durable general antes de certificar este recorrido para producción. Cancelar sigue disponible.
- Pruebas aisladas de claim, cuota agotada, timeout sin repetición, descarte sin costo, criterios y ausencia de revelado aprobadas. TypeScript, ESLint y regresiones de contexto/archivos/DOM aprobadas; no se ha consumido Apollo real ni certificado SQL concurrente.

### Continuidad visual y activación privada

- Detalle del trabajo incluye hasta ocho turnos anteriores, en orden cronológico, con lectura bajo la identidad y organización de la sesión. Ciclos o ancestros inaccesibles fallan sin exponer un hilo parcial.
- Workspace muestra solicitudes/respuestas anteriores y permite abrir el resultado de un turno previo.
- URL estable `/cowork?work=UUID`, con restauración al recargar y navegación atrás/adelante. Se conserva la autorización servidor; el UUID no concede acceso.
- Pruebas aisladas `scripts/test-cowork-thread.mjs` y regresión DOM aprobadas (incluida actualización de URL).
- Intento de verificación de identidad para activar piloto bloqueado por mantenimiento de Supabase MCP, que informó disponibilidad estimada para 15 Sep 2026 21:45 GMT. No se cambió ningún grant ni configuración de producción en este intento. Activación/modelo/scheduler siguen pendientes.

### Incremento posterior a la entrega: resultados y archivos

- Descargas autenticadas `?format=csv|xlsx|pdf|md` a partir de eventos persistidos; sin migraciones nuevas ni cambios en tablas de dominio.
- Excel con hoja Contactos, columnas acotadas, autofiltro y valores como celdas de texto, sin fórmulas generadas a partir de datos.
- PDF multipágina de documentos Markdown, con títulos y números de página. Renderiza texto, no HTML ni recursos externos. Tipografía básica occidental; caracteres no compatibles devuelven 422 con alternativa Markdown, evitando corrupción silenciosa. No es todavía un renderer completo de tablas/Markdown ni PDF Unicode universal.
- Markdown se descarga también mediante autorización servidor, en lugar de generar la descarga directamente desde el contenido del navegador.
- Lista visible de contactos consultados, búsqueda local, resultados vacíos y advertencia de límite. La descarga incluye el conjunto observado completo; el filtro visual no altera el archivo y se indica junto al control.
- Menú de descarga por tipo, estado de preparación, errores persistentes y retirada de resultados privados ante revocación durante descarga.
- Seis pruebas de archivos/CSV aprobadas; comprobación de XLSX al reabrir, PDF con streams descomprimidos y último párrafo en páginas múltiples. No sustituye validación visual con un lector PDF externo.
- `scripts/test-cowork-export-route.mjs` aprobado: autorización antes de lecturas, scope, headers privados, formatos inválidos y resultados ausentes.
- Prueba DOM ampliada para contactos, filtro, límite y revocación; TypeScript y ESLint aprobados.

Este incremento es local, posterior al commit de entrega. No se ha activado Cowork ni desplegado este cambio.

### Incremento: revisión de notas CRM

- Nueva acción `crm.propose_note`: exige identificar el contacto mediante una consulta real del mismo trabajo. Solo prepara el reemplazo; no escribe la nota desde el modelo.
- Panel de revisión con identidad del contacto, nota anterior, texto completo propuesto, Guardar y Descartar.
- Endpoint de decisión solo acepta un booleano; el cliente no puede sustituir el texto, propietario o destino aprobado.
- Migración preparada `20260915160000_cowork_note_approvals.sql`: propuesta y espera atómicas; decisión, escritura y resultado en una transacción; repetición de la misma decisión idempotente; conflicto si cambió la nota desde la propuesta; verificación fresca de usuario, grant, membresía y propiedad.
- Alcance inicial: entrada CRM existente `lead_saved|ID` de un contacto propio. No crea fichas ni sobrescribe la variante enriquecida. No reutiliza `syncLeadAutopilotToCrm`, cuyo comportamiento actual captura errores y realiza dos upserts; esta integración necesita todavía pruebas SQL y revisión de consistencia con el servicio general de CRM.
- La cancelación del trabajo impide aplicar una propuesta pendiente. El modo autónomo general sigue pendiente; esta escritura siempre requiere revisión explícita.
- Pasaron cinco pruebas del bucle (incluida la exigencia de destino observado), TypeScript y la regresión DOM del workspace. No se ha ejecutado la migración ni certificado concurrencia/RLS en Postgres.

- `npm run typecheck`: aprobado tras añadir workspace, API y worker.
- `node scripts/test-cowork-workspace.mjs`: aprobado; prueba aislada de estado sin worker, apertura de documento persistido, contenido como texto seguro, foco y revocación. Sin `.env.local`, credenciales ni proveedores.
- Se aprobaron seis pruebas de bucle/consultas (observaciones reales, límite de pasos, revocación, cancelación, scope y entrada), tres de continuidad y dos de exportación CSV. También se verificaron nuevamente contratos, TypeScript y ESLint de los archivos afectados.
- Las pruebas locales usan mocks; no sustituyen pruebas SQL/RLS ni autenticación real.
