# Inventario Cowork — revisión de Fase 4 (v1 congelado 21-09-2026)

## Estado contrastado con código — 21 de septiembre de 2026

Inventario v1 congelado sobre el código desplegado en `studio-build-2026-09-21-001` con flags Fase 4 activos
(`COWORK_OPERATION_LEASES_ENABLED`, `COWORK_SPECIALISTS_ENABLED`, `COWORK_SPECIALIST_QUEUE_ENABLED`,
`COWORK_MODEL_BUDGET_ENABLED`). `COWORK_AUTONOMY_ENABLED` ausente: ningún efecto se auto-aprueba.
Implementación local y despliegue verificados (smoke 401, revisión Cloud Run, logs sin errores);
el recorrido privado del propietario sigue pendiente y no se cuenta como evidencia.

| Operaciones conectadas al agente | Alcance / reglas | Evidencia principal |
|---|---|---|
| `leads.search`, `leads.get` | Usuario y organización; lecturas acotadas | `leads.test.ts`, `agent-loop.test.ts` |
| `crm.search`, `crm.get_lead` | Contactos de organización; no equivale a toda la ficha comercial unificada | `extended-reads.test.ts` |
| `contacted.search`, `contacted.timeline` | Historial de organización acotado | `extended-reads.test.ts` |
| `metrics.overview`, `app.context` | Métricas con alcance; conexiones sin tokens | `extended-reads.test.ts` |
| `research.get_existing` | Informe propio persistido con evidencia | `research.test.ts` |
| `draft.get`, `campaigns.list` | Versiones de borrador y campañas propias | `extended-reads.ts`, suites de envío/campañas |
| `files.list` | Nombres de uploads propios; lectura de contenido separada | `extended-reads.test.ts` |
| `saved_searches.list` | Nuevo local: búsquedas propias y compartidas de la organización, hasta 20; solo consulta, sin Apollo ni cuotas | `saved-searches.test.ts` |
| `missions.list`, `exceptions.list` | Misiones propias e incidencias abiertas del equipo, sin edición | `scripts/test-cowork-domains.mjs` |
| `campaigns.inbox`, `campaigns.plan`, `campaigns.step_context` | Servicio nativo de campañas-v2, usuario/organización actual, respeta flag; plan y contexto minimizados | `scripts/test-cowork-domains.mjs`, `campaigns-v2/inbox.test.ts` |
| `crm.collaboration`, `crm.record`, `privacy.contactability`, `privacy.contactability_batch` | Responsabilidad/reserva, ficha comercial y restricciones de contacto por UUID; lote de hasta 5 en una operación | `scripts/test-cowork-domains.mjs` |
| `profile.update` | Revisión humana; deriva rechazada; solo identidad comercial | `scripts/test-cowork-domain-effects.mjs` |
| `saved_search.create/update/delete` | Revisión humana; solo propias; duplicados y deriva rechazados; nunca ejecuta búsquedas | `scripts/test-cowork-domain-effects.mjs` |
| `campaign.stop_v2` | Revisión humana; inscripción observada; servicio nativo idempotente | `scripts/test-cowork-domain-effects.mjs` |
| `reads.parallel` | Máximo dos lecturas concurrentes y tres totales por turno | `parallel-reads.test.ts` |
| `reads.plan` | Nuevo local: IDs, dependencias acíclicas, mismo límite y gateway; metadatos de tarea en observaciones persistidas | `read-plan.test.ts` |
| `specialists.review` | Nuevo local, deshabilitado por flag: hasta dos roles de síntesis de evidencia, sin herramientas; plan y resultados persistidos | `specialists.test.ts`, `specialist-review.test.ts` |
| `prospecting.propose_search`, `leads.save_contact` | Búsqueda con cuota; guardado de resultado observado | `test-cowork-external-search.mjs`, `test-cowork-save-contact.mjs` |
| `research.start`, `draft.request` | Colas nativas y destinos observados | `test-cowork-start-research.mjs`, `test-cowork-native-draft.mjs` |
| `crm.propose_note` | Reemplazo de nota propia sujeto a revisión | `agent-loop.test.ts`, migración de notas |
| `lead.enrich`, `email.send` | Email, cuota y envío ligado a versión/remitente | `test-cowork-enrich-contact.mjs`, `test-cowork-send-email.mjs` |
| `campaign.create`, `campaign.activate`, `campaign.pause` | Campañas bulk; revisión y flags propios; no cubre todos los modelos de campañas | `test-cowork-campaigns.mjs` |
| `code.execute` | Sandbox y revisión humana | `test-cowork-code-execution.mjs` |

Tests TypeScript bajo `src/lib/cowork/` y `src/lib/server/cowork/`; scripts bajo `scripts/`.
Las pruebas aisladas no sustituyen SQL concurrente ni recorridos autenticados.

## Diferido explícito (no implementado en v1)

- Asignación de responsable y cambios de etapa/próxima acción CRM (las RPC nativas exigen `auth.uid()`; el worker usa `service_role`).
- Importación/Sheet y operaciones por lote con escritura; respuesta de correo en hilo; resolución/control de misiones;
  crear/editar planes v2 y preparar borradores desde Cowork; modo autónomo.
- Estos frentes requieren envoltorios dedicados o decisiones de producto; quedan como seguimiento, no como cobertura.

Pendientes de Fase 4, dependencias y aceptación: [cowork-phase4-status.md](cowork-phase4-status.md).

## Historial: revisión inicial

Fecha: 15 de septiembre de 2026. Estado: inventario inicial, todavía no congelado ni cobertura certificada.

Primeras herramientas implementadas localmente: `leads.search` y `leads.get`, limitadas a contactos propios en la organización activa. No están desplegadas. El registro SUPL.IA contiene schemas descriptivos en texto; una entrada en ese registro no equivale a una integración auditada. El worker inicial usa un bucle de solo lectura acotado; el gateway general de operaciones sigue pendiente de conectar a su almacén durable.

Incremento local: `prospecting.propose_search` y ejecución aprobada `prospecting.search`, hasta 25 resultados sin revelado, con cuota compartida y claim contra duplicados. Requiere nueva migración y flag; falta validación del proveedor real y recuperación durable de interrupciones. Investigación y borradores siguen pendientes de conectar.

| Operación candidata | Evidencia local | Adaptación / verificación pendiente |
|---|---|---|
| `app.context.get` | `suplia-tools.ts`, handler `getAppContext` | Minimización, campos autorizados, actualización de conexiones |
| `profile.get_company_profile` | Registro SUPL.IA | Schema y alcance; edición requiere servicio distinto |
| `crm.search` | Handler `searchCrm` | Paginación, esquema actual y scope estricto |
| `crm.get_lead_detail` | Handler `getLeadDetail` | Validación ID/email y consistencia con ficha actual |
| `contacted.search` | Handler `searchContacted` | Calidad de estado y exclusión de datos de otra organización |
| `contacted.get_timeline` | Handler `getContactedTimeline`; API `commercial/timeline` | Preferir servicio comercial actual, revisar divergencias |
| `prospecting.search_companies` | Handler `searchCompanies` | Apollo actual, cuotas, paginación y respuesta asíncrona si aplica |
| `prospecting.search_people` | Handler `searchPeople`; API `leads/search` | Reutilizar filtros actuales y límites, no una variante antigua |
| `prospecting.dedupe_against_crm` | Handler `dedupeAgainstCrm` | Identidad y duplicados persona/empresa |
| `prospecting.score_companies` | Handler `scoreCompanies` | Evidencia de puntuación y persistencia desacoplada de jobs SUPL.IA |
| `prospecting.score_people` | Handler `scorePeople` | Criterios explícitos y contactabilidad |
| `lead.enrich` / `lead.enrich_batch` | Registro SUPL.IA; servicios Apollo actuales | Idempotencia, cuota, callbacks y conciliación |
| `research.request/status/result` | API `lead-research`; `native-research.ts` | Adaptador al motor actual, no reimplementar research vía búsquedas sueltas |
| `gmail.profile.get` | Handler `getGmailProfile` | Nunca devolver tokens; verificar cuenta real |
| `gmail.search_messages` / `get_message` | Registro SUPL.IA | Límites de body y permiso de lectura por trabajo |
| `gmail.search_threads` / `get_thread` | Registro SUPL.IA | Scope de mailbox y paginación |
| `email.prepare/rewrite` | APIs `native-drafts` | Conservar versiones y revisión vigente |
| `email.send` | API `contact/send`; tool SUPL.IA | Un único servicio de envío, idempotencia y conciliación |
| `campaigns.list/get` | Registro SUPL.IA | Identificar modelo legacy/v2 y flags vigentes |
| `campaign.create_draft` | Handler `createCampaignDraft` | Comprobar compatibilidad con campañas actuales |
| `campaign.activate/pause/resume` | APIs campañas y registro SUPL.IA | Preflight, destinatarios exactos y revisión ligada a versión |
| `sequence.prepare` | Código local `research-sequences` | Trabajo concurrente existente; integrar después de estabilización |
| `antonia.missions.list` | Handler `listAntoniaMissions` | Filtros y organización |
| `antonia.exceptions.list` | Handler `listAntoniaExceptions` | Lectura y resolución son permisos distintos |
| `metrics.overview` | Handler `getMetricsOverview` | Añadir período, alcance y registros de origen |
| `privacy.contactability.check` | Handler `checkContactability` | Mantener servicio compartido de supresión |
| `privacy.batch_contactability.check` | Handler `batchContactability` | Resultado por destinatario y límites |

## Dominios por desglosar antes de congelar v1

Importación/edición de Sheet, búsquedas guardadas, cambios CRM, configuración comercial, administración permitida, tareas/calendario, Outlook, respuesta en hilo, privacidad, misiones, exportaciones y código. Cada operación requiere entrada/salida, efecto, concesión, presupuesto, evidencia y prueba. No afirmar 100% de cobertura antes de completar este desglose.

## Decisiones de integración

- Runtime y workers no invocarán callbacks/cron ni se autenticarán con cookies sintéticas.
- Acciones compartidas se extraen a servicios de negocio, sin publicar herramientas genéricas de SQL o HTTP con credenciales globales.
- Un adaptador SUPL.IA debe justificar cada handler reutilizado y eliminar dependencia incidental de sus IDs/tablas.
- Prueba mínima por adaptador: identidad/scope, entrada inválida, error proveedor, resultado correcto y retry si hay efectos.
- Falta decidir proveedor de sandbox y transporte de cola después de una prueba comparativa; no se ha instalado ni elegido un SDK adicional.
