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
