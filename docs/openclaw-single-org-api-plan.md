# OpenClaw API Plan (Single Org)

## 1) Objetivo

Definir una API completa para que OpenClaw pueda:

- Monitorear la app 24/7 (estado, cola, errores, cuotas, eventos).
- Operar la app de punta a punta (misiones, tareas, leads, campanas, contacto, replies, unsubscribes, reportes).
- Hacerlo de forma segura y auditable para **una sola organizacion**.

Este plan prioriza reutilizar la logica existente de ANTONIA y encapsularla en una superficie API estable y versionada.

## Estado actual (implementado)

Ya existe una primera capa funcional en `src/app/api/openclaw/v1/*` con:

- auth exchange + bearer token con scopes
- identidad (`whoami`)
- overview operacional
- lectura de missions y tasks
- trigger de mission
- retry/cancel/rescue de tasks
- lectura/patch de leads
- lectura/patch de contacted leads
- lectura/patch de campaigns y `campaigns/run`
- endpoint de quotas

Todo esto sin cambios en UI, orientado a uso server-to-server.

---

## 2) Decision clave: Single Org

OpenClaw operara solo 1 organizacion.

Implicancias:

- No se necesita multi-tenant complejo para el agente.
- Cada API key/token queda fijado a `organization_id`.
- No se necesita impersonacion de multiples orgs.
- Los endpoints pueden omitir `organizationId` en payload y resolverlo desde el token.

---

## 3) Arquitectura objetivo

### 3.1 Superficie API dedicada

Crear namespace versionado:

- `/api/openclaw/v1/*`

No exponer a OpenClaw los endpoints legacy directamente (muchos hoy tienen auth inconsistente).

### 3.2 Modelo de auth

Recomendado:

1. `POST /api/openclaw/v1/auth/exchange`
   - Entrada: `x-openclaw-key`
   - Salida: token corto (JWT o token firmado servidor) con:
     - `org_id`
     - `scopes[]`
     - `exp`

2. Todas las demas rutas:
   - `Authorization: Bearer <openclaw_token>`

3. Scopes sugeridos:
   - `system:read`
   - `missions:read`, `missions:write`
   - `tasks:read`, `tasks:write`, `tasks:admin`
   - `leads:read`, `leads:write`
   - `campaigns:read`, `campaigns:write`, `campaigns:run`
   - `contact:send`
   - `tracking:read`, `tracking:write`
   - `reports:read`, `reports:write`
   - `integrations:read`, `integrations:write`
   - `ai:use`

### 3.3 Reglas operativas

- Idempotencia obligatoria para comandos con side effects (`Idempotency-Key`).
- Rate limit por key y por scope.
- Audit log de cada comando del agente.
- Responses normalizadas:
  - `ok`, `data`, `error`, `requestId`, `timestamp`

---

## 4) Endpoints completos (catalogo v1)

## 4.1 Sistema

- `GET /api/openclaw/v1/health`
  - Estado de API y dependencias (Supabase, worker bridge).
- `GET /api/openclaw/v1/whoami`
  - Org activa, scopes, limites.
- `GET /api/openclaw/v1/overview`
  - Snapshot agregada: misiones activas, tasks pendientes/procesando/fallidas, cuotas de hoy, ultimos errores.

## 4.2 Configuracion ANTONIA

- `GET /api/openclaw/v1/antonia/config`
  - Lee `antonia_config`.
- `PATCH /api/openclaw/v1/antonia/config`
  - Actualiza limites y flags (`daily_report_enabled`, `tracking_enabled`, etc).

## 4.3 Misiones

- `GET /api/openclaw/v1/antonia/missions?status=active|paused|completed|failed`
- `POST /api/openclaw/v1/antonia/missions`
- `GET /api/openclaw/v1/antonia/missions/{missionId}`
- `PATCH /api/openclaw/v1/antonia/missions/{missionId}`
- `POST /api/openclaw/v1/antonia/missions/{missionId}/trigger`
  - Wrapper seguro de `src/app/api/antonia/trigger/route.ts`.
- `GET /api/openclaw/v1/antonia/missions/{missionId}/intelligence`
  - Wrapper de `src/app/api/antonia/missions/[missionId]/intelligence/route.ts`.
- `PATCH /api/openclaw/v1/antonia/missions/{missionId}/intelligence`

## 4.4 Tareas (queue control)

- `GET /api/openclaw/v1/antonia/tasks?missionId=&status=&type=&cursor=`
- `POST /api/openclaw/v1/antonia/tasks`
  - Crear task explicita (SEARCH, ENRICH, CONTACT, GENERATE_REPORT, etc).
- `GET /api/openclaw/v1/antonia/tasks/{taskId}`
- `POST /api/openclaw/v1/antonia/tasks/{taskId}/retry`
- `POST /api/openclaw/v1/antonia/tasks/{taskId}/cancel`
- `POST /api/openclaw/v1/antonia/tasks/rescue-stuck`
  - Reencola tasks `processing` sin heartbeat valido.
- `GET /api/openclaw/v1/antonia/tasks/stats`
  - Queue depth por estado/tipo.

Opcional si OpenClaw actuara como worker:

- `POST /api/openclaw/v1/antonia/tasks/claim`
- `PATCH /api/openclaw/v1/antonia/tasks/{taskId}` (heartbeat/progress/complete/fail)

## 4.5 Leads

- `GET /api/openclaw/v1/leads?status=&missionId=&cursor=`
- `POST /api/openclaw/v1/leads`
- `GET /api/openclaw/v1/leads/{leadId}`
- `PATCH /api/openclaw/v1/leads/{leadId}`
- `POST /api/openclaw/v1/leads/bulk-update`
  - Actualizacion masiva de status y campos.
- `POST /api/openclaw/v1/leads/search`
  - Wrapper seguro de `src/app/api/leads/search/route.ts`.
- `POST /api/openclaw/v1/leads/enrich`
  - Wrapper seguro de enriquecimiento (Apollo/AnyMailFinder segun payload).
- `GET /api/openclaw/v1/leads/{leadId}/timeline`
  - Unifica `antonia_lead_events`, `lead_responses`, `contacted_leads`.

## 4.6 Enriched leads

- `GET /api/openclaw/v1/enriched-leads?cursor=`
- `GET /api/openclaw/v1/enriched-leads/{id}`
- `PATCH /api/openclaw/v1/enriched-leads/{id}`

## 4.7 Contacted leads y envio

- `GET /api/openclaw/v1/contacted-leads?status=&evaluation_status=&cursor=`
- `GET /api/openclaw/v1/contacted-leads/{id}`
- `PATCH /api/openclaw/v1/contacted-leads/{id}`
- `POST /api/openclaw/v1/contacted-leads/{id}/send`
  - Wrapper de `src/app/api/contact/send/route.ts`.
- `POST /api/openclaw/v1/contacted-leads/{id}/schedule-linkedin`
- `POST /api/openclaw/v1/contacted-leads/{id}/record-reply`
  - Reemplaza uso directo de `src/app/api/scheduler/reply/route.ts`.
- `POST /api/openclaw/v1/contacted-leads/{id}/classify-reply`
  - Wrapper de `src/app/api/replies/classify/route.ts`.

## 4.8 Campanas

- `GET /api/openclaw/v1/campaigns?status=active|paused`
- `POST /api/openclaw/v1/campaigns`
- `GET /api/openclaw/v1/campaigns/{campaignId}`
- `PATCH /api/openclaw/v1/campaigns/{campaignId}`
- `DELETE /api/openclaw/v1/campaigns/{campaignId}`
- `GET /api/openclaw/v1/campaigns/{campaignId}/steps`
- `PUT /api/openclaw/v1/campaigns/{campaignId}/steps`
- `POST /api/openclaw/v1/campaigns/{campaignId}/exclude-leads`
- `POST /api/openclaw/v1/campaigns/run`
  - Tick manual/autorizado de followups (wrapper de `src/app/api/cron/process-campaigns/route.ts`).
  - Soporta `dryRun=true`.

## 4.9 Tracking, replies y unsubscribes

- `GET /api/openclaw/v1/tracking/events?type=&cursor=`
- `GET /api/openclaw/v1/tracking/stats?from=&to=`
- `GET /api/openclaw/v1/unsubscribes?cursor=`
- `POST /api/openclaw/v1/unsubscribes`
- `DELETE /api/openclaw/v1/unsubscribes/{id}`
- `GET /api/openclaw/v1/blocked-domains`
- `POST /api/openclaw/v1/blocked-domains`
- `DELETE /api/openclaw/v1/blocked-domains/{id}`

## 4.10 Reportes y observabilidad

- `GET /api/openclaw/v1/reports?missionId=&type=&cursor=`
- `POST /api/openclaw/v1/reports/generate`
  - Encola `GENERATE_REPORT`.
- `GET /api/openclaw/v1/observability/logs?level=&missionId=&cursor=`
- `GET /api/openclaw/v1/observability/lead-events?missionId=&leadId=&cursor=`
- `GET /api/openclaw/v1/observability/queue`
- `GET /api/openclaw/v1/quotas`
  - Wrapper de quota con formato estable para agente.

## 4.11 Integraciones

- `GET /api/openclaw/v1/integrations/providers`
  - Estado de Gmail/Outlook tokens y salud.
- `POST /api/openclaw/v1/integrations/test-send`
- `POST /api/openclaw/v1/integrations/n8n/test`

## 4.12 AI utilities (si OpenClaw las usa)

- `POST /api/openclaw/v1/ai/generate-campaign`
- `POST /api/openclaw/v1/ai/outreach-from-report`
- `POST /api/openclaw/v1/ai/generate-phone-script`
- `POST /api/openclaw/v1/ai/enhance-report`

Todas bajo scope `ai:use` + rate limit estricto.

---

## 5) Endpoints actuales que deben endurecerse

Al exponer control por API al agente, hay que corregir auth inconsistente en rutas legacy:

- Proteger `src/app/api/cron/process-campaigns/route.ts` con secreto/token.
- Eliminar patron inseguro `x-user-id` sin firma en:
  - `src/app/api/contact/send/route.ts`
  - `src/app/api/leads/search/route.ts`
  - `src/app/api/opportunities/enrich-apollo/route.ts`
  - `src/app/api/quota/status/route.ts`
- Cerrar o proteger rutas publicas costosas/sensibles:
  - `src/app/api/ai/*`
  - `src/app/api/email/*`
  - `src/app/api/debug/*`
  - `src/app/api/leads/apify/*`
  - `src/app/api/opportunities/status/route.ts` (si no requiere auth hoy)
- Forzar secreto en webhooks productivos:
  - `src/app/api/tracking/webhook/route.ts`
  - `src/app/api/webhooks/apollo/route.ts`

---

## 6) Cambios de datos requeridos

Para operar OpenClaw de forma robusta y auditable:

1. `openclaw_api_keys`
   - `id`, `organization_id`, `name`, `key_hash`, `scopes`, `active`, `last_used_at`, `created_at`, `rotated_at`.

2. `openclaw_audit_logs`
   - `id`, `organization_id`, `api_key_id`, `actor`, `action`, `resource`, `resource_id`, `request_id`, `status_code`, `latency_ms`, `meta`, `created_at`.

3. `openclaw_idempotency`
   - `organization_id`, `idempotency_key`, `route`, `request_hash`, `response_cache`, `created_at`.

4. (Si no existe en migraciones oficiales) `excluded_domains`
   - Es usada por el codigo, debe quedar en `supabase/migrations/*` de forma canonica.

5. Consolidar migraciones duplicadas
   - Mover lo necesario desde `src/lib/migrations/*` hacia `supabase/migrations/*` para evitar drift.

---

## 7) Fases de implementacion

## Fase 0 - Seguridad base (bloqueante)

- Crear middleware/helper OpenClaw auth + scopes.
- Proteger cron de campanas y rutas legacy criticas.
- Agregar audit log basico.

Resultado: no se expone control a OpenClaw sin auth fuerte.

## Fase 1 - Monitoring core

Implementar:

- `health`, `whoami`, `overview`
- `missions list/get`
- `tasks list/get/stats`
- `observability/queue`, `observability/logs`, `quotas`

Resultado: OpenClaw puede monitorear 24/7 con lectura completa.

## Fase 2 - Operacion core

Implementar:

- `missions create/update/trigger`
- `tasks create/retry/cancel/rescue-stuck`
- `leads list/update/search/enrich`
- `campaigns list/update/run(dryRun+real)`

Resultado: OpenClaw puede operar el pipeline principal.

## Fase 3 - Operacion completa

Implementar:

- `contacted-leads send/schedule/reply/classify`
- `unsubscribes` y `blocked-domains`
- `reports generate/list`
- `integrations providers/test`

Resultado: cobertura funcional completa de la app.

## Fase 4 - Calidad operativa

- SSE o feed incremental de eventos.
- OpenAPI spec + coleccion Postman.
- SLOs, alertas, dashboards.

---

## 8) Criterios de aceptacion

- OpenClaw puede ejecutar ciclo diario sin UI:
  - trigger -> search -> enrich -> contact -> followups -> report.
- OpenClaw puede explicar "que paso" por lead y por mission.
- Cualquier comando es auditable e idempotente.
- Ningun endpoint critico queda expuesto sin auth/scopes.
- Pruebas E2E de control API en CI pasan.

---

## 9) Riesgos y mitigacion

- Riesgo: drift de schema por migraciones duplicadas.
  - Mitigacion: consolidar migraciones en `supabase/migrations`.

- Riesgo: abuso de endpoints AI/send.
  - Mitigacion: scopes + rate limit + cuotas + audit.

- Riesgo: reintentos duplican envios.
  - Mitigacion: `Idempotency-Key` + guardas por `message_id`.

---

## 10) Orden de trabajo recomendado (pragmatico)

1. Hardening de seguridad en legacy.
2. Construir `openclaw/v1` con lectura (monitoring).
3. Agregar comandos core (missions/tasks/leads/campaign run).
4. Completar contacto/replies/unsub/reportes.
5. Publicar OpenAPI + SDK cliente OpenClaw.

Con este orden, OpenClaw empieza a monitorear rapido y luego toma control operativo progresivamente sin comprometer seguridad.
