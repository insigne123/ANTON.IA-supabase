# Cowork — Fase 4: coordinación y cobertura

Fecha: 21 de septiembre de 2026. Estado: **Fase 4 en ejecución, no cerrada**. El runtime inicial está desplegado; siguen pendientes operaciones de negocio, especialistas con herramientas y aceptación real. Las secciones de incrementos inferiores conservan historia y no son certificación del estado actual.

## Ejecución de cierre tras auditoría

Actualización de runtime: `studio-build-2026-09-21-003` confirmado listo, 100% tráfico. Incluye firma, herramientas de especialistas, consumo, corrección de eliminación de búsquedas, turno D5, reglas AXIS y efectos `crm_update_record` + `campaign_prepare_draft_v2` (esquemas `20260921041859`/`20260921041917` aplicados y verificados). Evaluación AXIS: 19 llamadas reales, 19784 tokens, sin costo monetario conocido. Ver `cowork-phase4-execution.md` y `cowork-axis-acceptance.md`; los párrafos siguientes describen incrementos anteriores.

- Presupuesto global corregido en producción mediante `20260921015112_cowork_conversation_budget`: árbol completo, bloqueo transaccional compartido entre ramas y rechazo de profundidad excesiva/ciclos/ancestros ajenos. Conserva reservas históricas y límites por trabajo.
- Verificados inmediatamente función instalada, RLS de tablas relacionadas y privilegios exclusivos de servidor. Cloud Run ERROR+ sin entradas en la ventana de 15 minutos consultada. No hay herramienta de logs Supabase disponible; no se certifican esos logs.
- Versiones locales de las dos migraciones anteriores alineadas con el historial remoto (`20260921010035`, `20260921010105`); no se reaplicaron.
- PostgreSQL nativo desechable, dos conexiones independientes: cupo compartido entre ramas, claims concurrentes exclusivos y publicación simultánea con una sola reanudación aprobados. `SKIP LOCKED` puede devolver un tick vacío; se comprueba progreso en el tick posterior sin duplicación.
- Firma por canal implementada **localmente**, con sanitización de HTML antes de staging, preservación del otro canal, revisión aislada y rechazo de cambios concurrentes. No se ha desplegado este incremento de app.
- Typecheck y build del árbol actual aprobados (incluye cambios concurrentes; no equivale a build aislado de release). Aceptación local completa aprobada: 98 pruebas TypeScript, scripts de efectos/dominios y SQL/integración.
- Chrome headless con APIs simuladas: revisión de firma en claro/oscuro, 360/768/1440, teclado/foco, carga, conflicto y revocación; sandbox bloquea scripts y red. No sustituye recorrido autenticado ni revisión visual manual/contraste medido.
- Pendientes del plan completo permanecen abiertos: herramientas de especialistas, consumo/costo, recuperación ampliada de lecturas, CRM/tareas, campañas v2, lotes/Sheet, correo/hilos, misiones, privacidad, autonomía y aceptación real.

Reproducción y alcance de pruebas: `docs/cowork-phase4-execution.md`.

## Despliegue y activación Fase 4 — 21 de septiembre

- Migraciones aplicadas una por vez y verificadas acto seguido (esquema, RLS, privilegios RPC exclusivos de `service_role`):
  `20260921010035_cowork_phase4_effects` (5 kinds nuevos + tablas `cowork_profile_proposals` y `cowork_saved_search_proposals`)
  y `20260921010105_cowork_thread_model_budget` (primera versión de agregado por ancestros, corregida por `20260921015112_cowork_conversation_budget`).
- `firebase deploy --only apphosting -P leadflowai-3yjcy` completo desde árbol aislado al scope Fase 4 (stash selectivo del trabajo concurrente, restaurado después).
  Revisión `studio-build-2026-09-21-001` con 100% del tráfico, condiciones Ready/ConfigurationsReady/RoutesReady en True.
- Flags activos verificados en la revisión: `COWORK_OPERATION_LEASES_ENABLED`, `COWORK_SPECIALISTS_ENABLED`,
  `COWORK_SPECIALIST_QUEUE_ENABLED`, `COWORK_MODEL_BUDGET_ENABLED` = `true`. `COWORK_AUTONOMY_ENABLED` sigue ausente:
  ningún efecto se auto-aprueba; los 5 nuevos tampoco.
- Smoke sin sesión: `/api/cowork/access`, `profile-preview` y `campaign-stop-preview` responden 401 (guardia antes que lectura;
  404 habría indicado ruta ausente). Cloud Logging de la revisión, severidad ERROR+, ventana consultada: cero entradas.
- Código desplegado incluye: planes de lectura, cola de especialistas con reanudación, presupuestos por trabajo e hilo,
  9 reads nuevas de dominio y 5 efectos con revisión humana (perfil, búsquedas ×3, detener seguimiento v2).

## Despliegue de compatibilidad — 20 de septiembre

- Firebase autenticado; `firebase deploy --only apphosting -P leadflowai-3yjcy --non-interactive` confirmó rollout completo de studio. Archivo de fuente: `studio--25660-bk4En3DVReSQ-.zip`.
- Publicado desde `main` con cambios de Fase 4 sin commit. Se aislaron cambios concurrentes con stash selectivo y se restauraron después; el stash `cowork-phase4-release-preserve-concurrent` se conserva como respaldo.
- Build aislado de los cambios concurrentes de aplicación aprobado. Se incluyeron dos correcciones de fixtures preexistentes de Cowork tras revisar su diff (native-draft y save-contact).
- La verificación aislada aprobó 96 tests TypeScript; detectó un fixture antiguo de native-draft tras aislar el árbol. Se restauró su corrección preexistente y la suite específica pasó. No describir ese primer comando completo como aprobado: se detuvo en el fixture.
- Comprobación HTTP sin sesión de `/api/cowork/access`: 401. No prueba el flujo autenticado.
- Cloud Run describe mediante gcloud bloqueado por reautenticación; el éxito de rollout está confirmado por Firebase, no por inspección independiente de tráfico/revisión.
- Flags nuevos permanecen ausentes. El runtime de cola/presupuesto no está activo. Faltan aceptación integrada/renderizada y resto de dominios; este despliegue no cierra Fase 4.

### Comprobación independiente tras renovar gcloud

- Cloud Run confirma `studio-build-2026-09-20-002` como última revisión creada y lista, con 100% del tráfico. Condiciones Ready, ConfigurationsReady y RoutesReady en True.
- Consulta de Cloud Logging filtrada a esa revisión, severidad ERROR o superior y última hora: cero entradas devueltas. No certifica recorridos no ejecutados ni logs de Supabase.
- Inspección de la revisión confirma ausentes (desactivados): `COWORK_OPERATION_LEASES_ENABLED`, `COWORK_SPECIALISTS_ENABLED`, `COWORK_SPECIALIST_QUEUE_ENABLED`, `COWORK_MODEL_BUDGET_ENABLED`.
- Se resuelve el bloqueo de autenticación gcloud mencionado arriba; siguen pendientes activación y aceptación, además del alcance de dominio restante.

## Incremento 4A: planes de lectura

`reads.plan` está integrado en el contrato de decisión y en el bucle que usa el worker real. Cada tarea contiene `id`, `dependsOn` y una lectura del catálogo. Se rechazan ciclos, dependencias desconocidas, IDs/lecturas duplicados y operaciones de escritura antes de ejecutar.

- Las tareas listas comparten el pool existente de dos lectores; las dependientes esperan la finalización y el registro de sus requisitos.
- El presupuesto sigue siendo tres lecturas totales por turno, compartido con lecturas individuales y `reads.parallel`; no se multiplican llamadas de modelo.
- Cada lectura usa el gateway durable existente, con claves de operación por ejecución/acción/entrada. Se conservan los registros completados aunque otra tarea falle.
- Se revalida autorización antes de leer y antes de publicar. Cancelación o error detiene nuevas tareas y se espera a los lectores en curso.
- Los eventos de resultado incluyen ID y dependencias de tarea. El plan completo todavía no tiene checkpoint persistente propio: ante recuperación, el modelo puede replantear el trabajo; las lecturas idénticas usan el replay del gateway.
- No hay sustitución dinámica de argumentos: si un ID debe descubrirse, se requiere una nueva decisión tras observarlo.

Es coordinación de herramientas, no especialistas con modelos independientes. Se mantiene el paralelismo actual hasta contar con mediciones de costo y calidad.

## Incremento 4B: revisión por especialistas

`specialists.review` delega a `analyst`, `researcher` o `verifier`, con una llamada estructurada de modelo independiente por asignación. Se conecta desde `worker.ts` a través de `specialist-review.ts`. Requiere conjuntamente `COWORK_SPECIALISTS_ENABLED=true` y `COWORK_OPERATION_LEASES_ENABLED=true`, actualmente no configurados. El mismo control rige la disponibilidad del callback y las instrucciones del coordinador.

- Hasta dos roles distintos, una delegación por turno, 20 segundos y 1.800 tokens de salida por llamada; no hay reintentos automáticos de proveedor. El coordinador conserva su límite propio de decisiones.
- Cada especialista recibe únicamente índices de observaciones asignados (máximo 24.000 caracteres serializados). No recibe clientes de DB, credenciales ni herramientas de escritura.
- Hallazgos con referencias a observaciones reales; referencias fuera del encargo se rechazan. Esto valida referencias, no demuestra por sí solo verdad factual.
- Plan inmutable por ejecución en `cowork_operations`, y resultado durable por asignación. Un plan distinto tras recuperación se rechaza; uno idéntico reutiliza resultados completados sin nuevas llamadas de modelo.
- Revalidación antes y después de generación; todas las llamadas activas se esperan antes de retornar un error.
- Las asignaciones interrumpidas con reserva activa no se relanzan automáticamente. Falta conciliación/expiración controlada para recuperación completa, más una cola de asignaciones independiente del proceso coordinador.

### Corrección previa del ledger

El gateway comprobaba el token devuelto por la reserva, pero no que perteneciera a la invocación actual. Ahora solo ejecuta el propietario del token que acaba de generar. Además, comprueba el resultado booleano de finalización y restringe las huellas por `runId` para evitar reutilizar lecturas antiguas entre trabajos. No se modificaron registros históricos. Las reservas interrumpidas fallan cerrado; la recuperación automática sigue pendiente.

### Revisión posterior: publicación y minimización

- El gateway vuelve a verificar autorización, concesión y cancelación después de ejecutar y antes de devolver un resultado recuperado. Los resultados recuperados también pasan el schema de salida; un replay no omite esos controles.
- La validación del presupuesto y las referencias de los especialistas ocurre antes de reservar. El plan persistido contiene solo las observaciones asignadas, no todo el contexto del coordinador.
- Cada rol tiene instrucciones distintas: análisis de magnitudes sin extrapolar listas truncadas; síntesis de fuentes existentes sin fingir nuevas consultas; verificación de contradicciones y faltantes.
- TypeScript y 23 pruebas dirigidas de gateway, ledger, especialistas y persistencia aprobados tras los cambios de publicación/minimización. No acreditan concurrencia SQL real ni evaluación factual con modelos.

## Backlog de cierre

Último incremento local: cinco consultas de dominio (`missions.list`, `exceptions.list`, `campaigns.inbox`, `crm.collaboration`, `privacy.contactability`) conectadas al agente, gateway y planes. Aceptación integrada ejecutada con agente/adaptadores reales, RPCs de PostgreSQL embebido y proveedor simulado; ver `cowork-phase4-acceptance.md`. La aceptación local pasa, pero las escrituras restantes y el recorrido de producción siguen pendientes. No se desplegó este incremento.

### Incremento 4D: cola de especialistas y reanudación

Aplicada en producción `20260920205105_cowork_specialist_queue.sql`, junto a la migración de presupuesto `20260920205152_cowork_model_budget.sql`. Se verificaron RLS y privilegios RPC exclusivos de servidor después de cada aplicación; logs remotos no disponibles mediante las herramientas actuales. El código de `specialist-queue.ts` y su integración con scheduler/coordinador sigue local. Requiere flags de especialistas, leases v2, cola y presupuesto; todavía apagados.

- Admisión atómica de hasta dos asignaciones y transición a `waiting_workers`. Plan de una sola admisión por trabajo; tabla privada con RLS y RPCs exclusivas de servidor.
- Claims exclusivos por tarea, token de ejecución y plazo de 60 segundos. El scheduler procesa una asignación por invocación; no se afirma paralelismo real entre ticks ni mejora de latencia.
- Publicación del resultado y regreso del padre a `queued` en la misma transacción al terminar todas las tareas. La síntesis recupera observaciones y no recibe un nuevo presupuesto de herramientas/especialistas.
- Vencimiento de tarea en ejecución produce `uncertain`, sin reejecución automática; el coordinador recibe el estado real junto a resultados parciales.
- Cancelación y revocación impiden nuevos claims/publicación. La UI mantiene polling, mensaje de revisión y cancelación durante `waiting_workers`.
- Consumo reportado por proveedor se guarda por tarea como input/output/total tokens, modelo y duración; faltantes quedan `null`, no cero. No hay todavía estimación monetaria ni presupuesto de tokens agregado para toda la conversación.
- Prueba PostgreSQL embebida aprobada: admisión, claims sucesivos exclusivos, cierre atómico, vencimiento, cancelación, revocación, RLS/permisos. No acredita carreras entre conexiones independientes.
- `verify-cowork`: 94 pruebas TypeScript y scripts anteriores aprobados. Suite nueva del adaptador aprobada por separado: flags, permisos, límites de generación, consumo, evidencia inválida, cancelación y rechazo de publicación. TypeScript aprobado antes de las pruebas.
- Pendiente: revisión renderizada del estado nuevo y prueba integrada scheduler/DB/modelo simulado, antes de aplicar/activar la cola. No desplegado.
  Corrección de estado: el esquema ya se aplicó; esas revisiones siguen pendientes antes de activar. Se eliminó del worker la vía síncrona alternativa de especialistas para que ninguna llamada evite la cola y su presupuesto durable.

### Presupuesto y evaluación

Intento de preparación de despliegue: `firebase apphosting:backends:get studio -P leadflowai-3yjcy --non-interactive` rechazado por credenciales vencidas; requiere `firebase login --reauth`. No hubo despliegue. `npm run build` aprobó sobre el árbol de trabajo actual (incluye cambios concurrentes, no es todavía build aislado del release). Warning preexistente de `<img>` en `ArtifactPreview.tsx`.

La reserva de modelo se ejecuta antes de cada llamada del coordinador o especialista, bajo bloqueo del padre y token vigente. Máximo siete llamadas por trabajo (cinco coordinador y una por rol), salida reservada total 33.600 tokens; no se restituyen reservas tras un fallo incierto. No equivale a límite monetario ni presupuesto agregado por conversación.

Pruebas SQL aisladas del techo de reservas y prueba del adaptador que bloquea generación cuando se deniega presupuesto: aprobadas. TypeScript y regresiones de cola, autonomía y equidad aprobadas tras cerrar la vía síncrona. Benchmark sintético documentado en `cowork-phase4-benchmark.md`, sin certificar calidad de modelo ni rendimiento de producción.

Adaptador `profile.get` implementado localmente: identidad propia, campos minimizados y email de perfil explícitamente no verificado como mailbox. Pruebas de alcance, filtrado y errores aprobadas. Edición de perfil/oferta/firma continúa pendiente.

### Incremento 4C: reservas recuperables por intento

Aplicada en producción como `20260920161555_cowork_operation_leases_v2.sql` (versión asignada por MCP; archivo local alineado). Añade vencimiento y token del intento padre; RPCs nuevas `cowork_reserve_operation_v2` y `cowork_finish_operation_v2`, exclusivas de `service_role`. Se verificaron catálogo, RLS y permisos inmediatamente; no hay herramienta de logs Supabase disponible para certificar esa revisión. El worker está conectado detrás de `COWORK_OPERATION_LEASES_ENABLED=true`, actualmente ausente.

- Reserva y finalización bloquean primero el trabajo padre. Exigen identidad, grant/membresía, estado `running`, token y plazo vigentes.
- Solo las lecturas de una lista explícita y el plan local pueden recuperarse, con máximo tres intentos. Un nuevo intento del worker invalida al anterior incluso si el plazo de operación no venció.
- Una llamada de especialista interrumpida termina como `outcome_unknown`; no se vuelve a facturar automáticamente. Recuperar resultados completados conserva replay.
- Finalización tardía, revocación y cancelación rechazan publicación.
- Se conserva la RPC anterior para compatibilidad. Activar el flag exige aplicar primero la migración y verificar catálogo/permisos; no habilitarlo antes.
- Prueba SQL aislada aprobada con PGlite/PostgreSQL: migración real, tokens, recuperación de lecturas, rechazo de intentos antiguos, incertidumbre de proveedor, límite de intentos, vencimiento, revocación, cancelación, RLS y permisos RPC. No es una prueba de carreras entre conexiones de producción.
- Ejecución: `COWORK_PGLITE_MODULE` apunta al `dist/index.js` de `@electric-sql/pglite` instalado fuera del repo; luego `node scripts/test-cowork-operation-leases-sql.mjs`. No carga archivos de entorno ni usa Supabase remoto.
- TypeScript, diez pruebas de operaciones y regresiones aisladas de autonomía/equidad aprobadas.
- Después de aplicar: archivo alineado con ledger remoto, prueba SQL embebida repetida con la versión definitiva, TypeScript y siete pruebas de especialistas aprobados. El control nuevo impide habilitar llamadas de especialistas sin el ledger v2.

Esto permite recuperación del ledger, pero no sustituye la cola independiente de asignaciones ni resuelve resultados perdidos de un proveedor.

Incremento de catálogo: `saved_searches.list` conectado al gateway, bucle de decisiones, lecturas paralelas y planes. Usa la normalización compartida de criterios; filtros explícitos por organización y visibilidad propia/compartida, límite de 20 con indicador de truncamiento y criterios acotados. No ejecuta la búsqueda ni consume créditos. Crear/editar/eliminar búsquedas y ejecutarlas con todos sus filtros sigue pendiente. TypeScript y verificación completa Cowork aprobados: 91 tests TypeScript más scripts aislados.

| ID | Entregable | Dependencia | Aceptación | Estado |
|---|---|---|---|---|
| F4-01 | Plan de lecturas con dependencias y presupuesto | Gateway durable | Rechazo de ciclos; orden; cancelación; registros parciales; presupuesto compartido | Implementado, desplegado y activo |
| F4-02 | Asignaciones persistentes a especialistas | Contrato de tarea/resultado, cola, leases, migración revisada | Reinicio recupera asignación; ningún resultado de intento vencido se publica | Implementado, desplegado y activo |
| F4-03 | Especialistas con herramientas y presupuestos acotados | F4-02 | Coordinador/analista/investigador/verificador con permisos servidor; costo agregado comprobable | Implementado, desplegado y activo: síntesis sin herramientas; presupuesto por trabajo e hilo; consumo por asignación persistido (sin precio monetario del proveedor) |
| F4-04 | Inventario completo por operación y alcance acordado | Auditoría de servicios actuales | Una fila por operación, permisos, prueba, estado y exclusiones explícitas | Congelado v1 abajo; diferidos con motivo en lugar de cobertura simulada |
| F4-05 | Perfil, oferta, firma y ajustes permitidos | Servicios compartidos y roles actuales | Lectura mínima; edición revisada, ligada a versión y comprobada | Implementado, desplegado y activo: `profile.get` + `profile_update` con deriva rechazada; firma HTML solo lectura en UI existente |
| F4-06 | CRM: etapas, responsables, próximas acciones, tareas | Ficha comercial y colaboración | No perder cambios concurrentes; autorización por entidad; verificación posterior | Implementado, desplegado y activo: ficha (`crm.record`), colaboración (lectura) y notas con revisión; asignación de responsable y cambios de etapa/próxima acción diferidos (las RPC nativas exigen `auth.uid()` y el worker opera con `service_role`: requieren envoltorio dedicado con la misma matriz de roles) |
| F4-07 | Secuencias y resto de campañas | Estabilizar cambios concurrentes de secuencias/campañas-v2 | Preparación, revisión, activación, pausa y estado con contrato del motor correspondiente | Implementado, desplegado y activo: inbox/plan/step-context de lectura + `campaign_stop_v2` con revisión; crear/editar planes y preparar borradores siguen en la UI (requieren contexto interactivo de redacción) |
| F4-08 | Búsquedas guardadas, importación/Sheet y operaciones por lote | Inventario, cuotas e identidad de contactos | Conteos/errores por fila; idempotencia y cuotas compartidas | Implementado, desplegado y activo: CRUD de búsquedas propias con revisión + reutilización vía `prospecting.propose_search`; importación/Sheet por lote diferida (efecto masivo sin revisión por fila) |
| F4-09 | Correo/hilos, misiones, excepciones y privacidad | Adaptadores y permisos de servicios originales | Datos minimizados; destino observado; acción confirmada por motor | Implementado, desplegado y activo: contactabilidad 1:1 y por lote, lecturas de misiones/incidencias, envío versionado existente; respuesta en hilo y resolución de misiones diferidas (disparan automatización del motor) |
| F4-10 | Benchmark y aceptación de fase | F4-02 a F4-09 | Corpus reproducible, latencia/costo/calidad, cobertura acordada y cero duplicados críticos | Aceptación local verde + smoke de producción verde; benchmark sintético documentado; recorrido privado y calidad factual con modelos reales pendientes del propietario |

Responsabilidad técnica por frente: runtime/backend F4-01/02/03; integración de dominio F4-05 a 09; producto e integración F4-04; QA/plataforma F4-10. No se asignan personas sin acuerdo.

## Verificación de esta entrega

- `npm run typecheck`: aprobado.
- `node scripts/verify-cowork.mjs`: aprobado (incluye suites nuevas `domains` y `domain-effects`; los mocks de worker/effects se ampliaron para los módulos nuevos).
- `node scripts/accept-cowork-phase4.mjs`: aprobado (verificación Cowork, servicios compartidos campañas-v2/privacidad, SQL leases/cola/presupuesto, integración agente→PostgreSQL→workers→síntesis).
- `node scripts/benchmark-cowork-specialists.mjs`: 20 muestras por modalidad, p50 93,21 ms secuencial / 46,80 ms paralelo (medición sintética del pool local; no certifica producción).
- Pruebas SQL con PostgreSQL embebido: leases v2, cola/presupuesto (incluido agregado por hilo: 16 reservas/96000 aceptadas, 17ª rechazada; ancestro cíclico rechazado), permisos y RLS.
- Migraciones aplicadas una por vez con verificación inmediata de esquema, RLS y privilegios. Sin herramienta de logs Supabase disponible.
- La aceptación privada de Fase 3 y el recorrido privado de Fase 4 continúan pendientes del propietario; no se usa una prueba de mocks como evidencia de su cierre.

## Pendiente (propietario / seguimiento)

1. Recorrido privado en `/cowork` con la sesión del propietario: lecturas nuevas, `profile.update`, CRUD de búsquedas, `campaign.stop_v2` en defendants, y una revisión de especialistas.
2. Calidad factual con modelos reales sobre corpus fijo (los mocks solo prueban contratos).
3. Envoltorio `service_role` para asignación/etapa/próxima acción CRM con la matriz de roles de las RPC nativas.
4. Importación/Sheet por lote con revisión por fila; respuesta en hilo; resolución de misiones; modo autónomo.
5. Revisión visual renderizada (claro/oscuro, móvil, foco) de las tarjetas nuevas y corrida de `release-audit-checklist`.

## Orden siguiente

1. Diseñar contrato persistente de asignaciones, leases y recuperación (F4-02), antes de ampliar concurrencia.
2. Implementar especialistas con concesiones de lectura y resultados verificables; después extender efectos mediante revisiones existentes.
3. Completar el inventario por dominios y conectar adaptadores en lotes pequeños, sin duplicar los motores actuales.
4. Medir contra la ejecución secuencial y cerrar la matriz de aceptación antes de desplegar la fase como completa.
