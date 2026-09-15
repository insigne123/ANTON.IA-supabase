# Inventario Cowork — revisión inicial

Fecha: 15 de septiembre de 2026. Estado: inventario inicial, todavía no congelado ni cobertura certificada.

Primeras herramientas implementadas localmente: `leads.search` y `leads.get`, limitadas a contactos propios en la organización activa. No están desplegadas. El registro SUPL.IA contiene schemas descriptivos en texto; una entrada en ese registro no equivale a una integración auditada. El worker inicial usa un bucle de solo lectura acotado; el gateway general de operaciones sigue pendiente de conectar a su almacén durable.

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
