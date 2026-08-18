# Guía de despliegue y pruebas

## Variables de entorno imprescindibles

### Firebase (cliente)
Configura las credenciales públicas que usa el SDK web:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_RECAPTCHA_V3_KEY` (opcional si se activa App Check)

### Firebase Admin
Para las funciones que consumen Firestore en el backend asegúrate de exportar una cuenta de servicio y apunta `GOOGLE_APPLICATION_CREDENTIALS` al archivo JSON correspondiente. Cuando ejecutes pruebas o desarrollo local con el emulador, define `FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"`.

### Integraciones adicionales
- `N8N_LEADS_WEBHOOK_URL`, `LEADS_N8N_TIMEOUT_MS`, `LEADS_N8N_MAX_RETRIES`
- `APIFY_TOKEN`, `APIFY_APOLLO_ACTOR_ID`, `APIFY_APOLLO_TASK_ID`, `APIFY_ACTOR_ID`, `APOLLO_API_KEY`
- `LEADS_PROVIDER_DEFAULT`, `ENRICHMENT_PROVIDER_DEFAULT`, `PDL_TRIAL_ENABLED`, `PDL_ALLOWED_ORG_IDS`, `PDL_API_KEY`, `PDL_BASE_URL`, `PDL_TIMEOUT_MS`, `PDL_SEARCH_PAGE_SIZE`, `PDL_SEARCH_MAX_PAGES`, `PDL_MAX_RESULTS`, `PDL_ENRICH_MIN_LIKELIHOOD`, `PDL_FALLBACK_TO_APOLLO`, `LEADS_DISABLE_EXTERNAL_FALLBACK`
- `N8N_API_KEY`, `N8N_RESEARCH_WEBHOOK_URL`, `N8N_WEBHOOK_URL`
- `ANYMAIL_FINDER_API_KEY`, `QUOTA_FALLBACK_SECRET`
- `NEXT_PUBLIC_AZURE_AD_CLIENT_ID`, `NEXT_PUBLIC_AZURE_AD_TENANT_ID`, `NEXT_PUBLIC_AZURE_AD_REDIRECT_URI`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_SEARCH_POLL_INTERVAL_MS`, `NEXT_PUBLIC_SEARCH_MAX_POLL_MINUTES`, `NEXT_PUBLIC_SEARCH_PAGE_SIZE`
- `INTERNAL_API_SECRET` (protege llamadas server-to-server con `x-user-id`; usar el mismo valor en Next y Firebase Functions)
- `APOLLO_WEBHOOK_SECRET` (obligatorio para `/api/apollo-webhook` y `/api/webhooks/apollo`)
- `UNSUBSCRIBE_TOKEN_SECRET` (secreto server-only dedicado y obligatorio para firmar/cifrar bajas)
- `CRON_SECRET` (secreto server-only obligatorio y compartido únicamente con el scheduler)
- `DEBUG_API_ENABLED=false` (mantener las rutas debug desactivadas en producción)

Consulta `.env.example` para un inventario completo con valores de referencia.

`UNSUBSCRIBE_TOKEN_SECRET` debe ser aleatorio, largo y estable. El runtime puede usar `SUPABASE_SERVICE_ROLE_KEY` y después `INTERNAL_API_SECRET` como fallback seguro y falla cerrado si no existe ninguno, pero ese fallback es solo de contingencia/rotación: producción debe configurar el secreto dedicado.

## Gate de rollout: Research Messaging V1

Las siguientes migraciones son un gate previo al código y deben aplicarse en este orden léxico exacto:

1. `supabase/migrations/20260813093000_research_messaging_v1.sql`
2. `supabase/migrations/20260813100000_atomic_daily_quota.sql`
3. `supabase/migrations/20260813103000_atomic_lead_research_request_claim.sql`
4. `supabase/migrations/20260813110000_remove_legacy_negative_reply_suppressions.sql`
5. `supabase/migrations/20260813113000_inbound_reply_idempotency_privacy.sql`
6. `supabase/migrations/20260813120000_idempotent_enrichment_quota_operations.sql`

Este inventario refleja los archivos presentes en el repositorio; no afirma que las migraciones hayan sido ejecutadas ni que se haya realizado un despliegue.

1. Mantener deshabilitados todos los cron jobs y aplicar en staging las seis migraciones, sin saltos ni reordenamientos, siguiendo la lista anterior.
2. Esperar las recargas de PostgREST incluidas en las migraciones de esquema; si PostgREST devuelve `PGRST202`, `PGRST205` o errores de schema cache, forzar la recarga y no continuar hasta verificar el esquema por REST/RPC. La cuarta migración solo limpia datos y no añade RPC ni cambia el esquema.
3. Verificar las tablas `research_snapshots`, `messaging_drafts`, `messaging_draft_versions`, `outbound_dispatches`, `outbound_quota_reservations`, `outbound_contact_quota_buckets` y `lead_research_jobs`, junto con RLS, grants, claves foráneas y la FK diferida de la versión actual.
4. Verificar los RPC de drafts (`create_messaging_draft_v1`, `append_messaging_draft_revision_v1`), cuota (`reserve_outbound_contact_quota_v1`, `release_outbound_contact_quota_v1`, `consume_antonia_daily_quota_v1`), claim atómico de research (`claim_lead_research_request_v1`, `consume_lead_research_request_quota_v1`, `mark_lead_research_request_submitting_v1`, `store_lead_research_request_terminal_v1`, `finalize_lead_research_request_terminal_v1`, `complete_lead_research_request_claim_v1`, `release_lead_research_request_claim_v1`, `fail_lead_research_request_claim_v1`, `mark_lead_research_request_unknown_v1`), reconciliación (`claim_outbound_dispatch_reconciliation_v1`, `abandon_outbound_dispatch_reconciliation_v1`, `repair_reconciled_sent_dispatch_history_v1`), inbound (`ingest_inbound_reply_v1`, `record_inbound_unsubscribe_v1`), operaciones de enrichment (`claim_antonia_quota_operation_v1`, `mark_antonia_quota_operation_submitted_v1`, `complete_antonia_quota_operation_v1`, `release_antonia_quota_operation_v1`) y privacidad (`lookup_research_messaging_subject_v1`, `delete_research_messaging_subject_v1`, `delete_research_messaging_retention_v1`). Confirmar las firmas y llamadas por PostgREST, que los RPC de drafts permiten `authenticated`/`service_role`, y que cuota, claim de research, reconciliación, inbound, operaciones de enrichment y privacidad quedan solo para `service_role`.
5. Probar las restricciones de estado: drafts `draft|ready|archived`; research jobs `queued|running|completed|partial|insufficient_data|failed|cancelled`; dispatches `pending|sending|sent|failed|deferred|unknown`. Incluir en staging reserva/liberación y settlement de cuota, una única propiedad del claim ante solicitudes concurrentes, consumo único de cuota por request, release/reclaim seguro antes de enviar al proveedor, estados de proveedor submitted/failed/unknown, transición y reintento de `deferred`, claim/abandon/reparación de reconciliación, outcome desconocido sin reenvío inmediato, y lookup/delete/retention de privacidad.
6. Verificar después de la cuarta migración que no quedan filas de `unsubscribed_emails` con `reason = 'reply:negative'` y que las bajas reales con otros motivos se conservan.
7. Solo después de aplicar y verificar las seis migraciones puede aprobarse el gate para iniciar el despliegue de la app y Firebase Functions. Si falta `20260813100000_atomic_daily_quota.sql`, enrichment/research falla cerrado; si falta `20260813103000_atomic_lead_research_request_claim.sql`, el alta de research falla cerrado; si faltan las migraciones quinta o sexta, fallan cerrado la ingesta inbound o las operaciones idempotentes de enrichment. Cualquier archivo faltante bloquea el rollout. Un despliegue app-first también deja los envíos outbound deshabilitados por diseño (fail closed) y no debe usarse como orden normal de rollout.
8. Ejecutar smoke tests autenticados de creación/revisión de draft, dispatch idempotente sin envío real, cuota, claim de research, reconciliación y privacidad. Habilitar cron jobs al final, primero como canary y observando logs/errores.

Rollback/canary: mantener los cron jobs deshabilitados hasta completar los smoke tests; si falla el gate, detener el rollout y revertir app/functions al release compatible sin intentar deshacer datos a ciegas. No publicar el draft n8n `ANTONIA2.0`; el endpoint activo debe seguir siendo `/webhook/ANTONIA`.

## Scheduler de producción

Si el despliegue principal corre en Firebase App Hosting, `vercel.json` no agenda cron jobs. En ese caso debes configurar un scheduler externo que invoque estas rutas con `CRON_SECRET`:

- `GET /api/cron/antonia`
- `GET /api/cron/process-campaigns`
- `GET /api/cron/outbound-reconciliation`
- `GET /api/cron/privacy-retention`

Recomendación mínima:

- Cloud Scheduler cada 5 minutos a `https://<tu-app>/api/cron/antonia`
- Cloud Scheduler cada 5 minutos a `https://<tu-app>/api/cron/outbound-reconciliation`
- Header `Authorization: Bearer <CRON_SECRET>` o `x-cron-secret: <CRON_SECRET>`
- Usar HTTPS, desactivar reintentos concurrentes/solapados y mantener los jobs pausados hasta aprobar el gate y los smoke tests
- Programar `process-campaigns` y `privacy-retention` según la política operativa; validar primero `privacy-retention?dryRun=1`
- Mantener `ANTONIA_FIREBASE_TICK_URL` y `ANTONIA_FIREBASE_TICK_SECRET` solo si seguirás usando el worker de Firebase como respaldo/delegado

## Verificaciones previas al release

Antes de desplegar ejecuta:

```bash
npm run verify:prod-config
npm run verify:antonia-cron
npm run build
```

Checklist manual breve:

- Confirmar que `INTERNAL_API_SECRET`, `APOLLO_WEBHOOK_SECRET`, `UNSUBSCRIBE_TOKEN_SECRET`, `CRON_SECRET` y `SUPABASE_SERVICE_ROLE_KEY` existen en Secret Manager/App Hosting
- Confirmar que `chrome-extension.pem` no viaja en el artefacto final ni en imágenes de runtime
- Ejecutar `GET /api/cron/antonia?dryRun=1&skipFirebaseForward=1` con `CRON_SECRET`
- Ejecutar `GET /api/cron/process-campaigns?dryRun=1&includeDetails=1` con `CRON_SECRET`
- Verificar que los webhooks Apollo manden `x-webhook-secret` o `Bearer <APOLLO_WEBHOOK_SECRET>`

## Pruebas manuales
Los siguientes escenarios se ejecutan tras cada despliegue mayor. Se documentan aquí los pasos y observaciones necesarias; si el entorno no está disponible (por ejemplo, en este contenedor) marca el resultado como bloqueado e indica la causa.

| Prueba | Pasos resumidos | Resultado | Observaciones |
| --- | --- | --- | --- |
| Registro | 1. Abrir la app en modo incógnito. 2. Completar formulario de alta y confirmar correo. 3. Validar creación en Firestore. | Bloqueada | Requiere credenciales de Firebase Auth y dominio configurado. |
| Login | 1. Abrir sesión en navegador primario. 2. Autenticarse con Azure AD/Google. 3. Confirmar acceso a panel principal. | Bloqueada | No se dispone de proveedores OAuth configurados en este entorno. |
| Migración de datos | 1. Ejecutar proceso de migración (n8n/apify). 2. Revisar logs de sincronización. 3. Validar métricas en Firestore. | Bloqueada | No hay conectividad a n8n/Apify desde el contenedor. |
| Sincronización multi-navegador | 1. Abrir sesión en dos navegadores. 2. Lanzar sincronización en uno. 3. Confirmar actualización en el otro. | Bloqueada | Requiere despliegue con hosting público para verificar websockets. |

> **Nota:** Actualiza la columna de resultado cuando ejecutes las pruebas en un entorno con credenciales válidas.
