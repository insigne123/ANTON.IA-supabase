# Plan 11 / Plan 12 · publicación del mantenedor

## Base publicada

`main` en `43b45399` incluye `a07ace0` y la entrega de #218. App Hosting `studio-build-2026-10-06-001`, Ready, 100 % del tráfico. La Function `commercialOpportunitiesTick` quedó ACTIVE con Node 22; scheduler ENABLED, autenticado, `15 11 * * *` UTC y retryCount 0 (el API omite el cero por defecto). No se ejecutó manualmente la búsqueda pagada.

Validación local: 2590 unitarias, build y typecheck aprobados; Functions build y cuatro pruebas de scheduler aprobadas. Artefactos en Chrome instalado, datos sintéticos y sin proveedores: 49/49 comprobaciones aprobadas (temas, 390/1280 px, gráficos, tabla, filtro, cambio de tema y aislamiento). Smokes de producción y logs de la revisión base sin errores observados.

## Migraciones autorizadas y verificadas

El dueño inicialmente quería usar el editor SQL; durante la coordinación autorizó explícitamente al mantenedor a aplicarlas por MCP. Se aplicaron una por vez, con revisión previa del esquema/SQL y verificación de permisos/RLS/logs antes de continuar. No hubo seeds, tests contra producción ni cambios de contactos.

| Archivo del repo | Registro en producción |
|---|---|
| `20261005150000_crm_deal_values_stage_events.sql` | `20261006182254 / crm_deal_values_stage_events` |
| `20261006150000_revoke_internal_functions_from_clients.sql` | `20261006182652 / revoke_internal_functions_from_clients` |
| `20261006160000_cowork_memory_save_effect.sql` | `20261006182758 / cowork_memory_save_effect` |

- **Pipeline:** cinco columnas y dos triggers habilitados; `crm_stage_events` con RLS y una política SELECT por organización, authenticated solo lectura, anon sin lectura. Funciones de trigger con search_path fijo y sin EXECUTE para clientes.
- **Internas:** siete funciones verificadas, anon/authenticated false, service_role/postgres true. Cron baseline sin fallos y todos sus jobs como postgres. La ventana de observación de una hora comienza en 18:26:52 UTC; su resultado se reporta aparte al cerrar la publicación.
- **Preferencias:** restricción y definición de `cowork_propose_effect` incluyen memory_save, RLS permanece activo, anon/authenticated sin EXECUTE y service_role lo conserva.
- Tickets y bóveda ya estaban aplicados; cowork-artifacts privado ya existía. No se reaplicaron.

## Flags autorizados

El dueño respondió «todo» a la habilitación de respuesta en hilo, importación y Leads Finder para su cuenta. Se activan:

- COWORK_OFFERED_READS_ENABLED
- COWORK_CODE_ARTIFACTS_ENABLED
- COWORK_PREFERENCES_ENABLED (tras verificar migración)
- CRM_DEAL_VALUES_ENABLED (tras verificar migración)
- COWORK_REPLY_THREAD_ENABLED
- COWORK_CONTACTS_IMPORT_ENABLED
- LEADS_FINDER_ENABLED, restringido a nicolas.yarur.g@yago.cl y máximo US$0,50 por corrida

Se conserva COWORK_ANSWER_HOLD_ENABLED=true. La autorización no aprueba una propuesta ni ejecuta un envío. COWORK_MODEL sigue en gpt-6-luna; no se usan modelos astra.

**LinkedIn en lote:** autorizado, pero el dueño confirmó que solo actualizó la extensión, sin completar el trabajo individual real. COWORK_LINKEDIN_BATCH_ENABLED queda explícitamente false hasta pasar `docs/linkedin-prueba-guiada.md`. Analyst, intent prompts y judge permanecen false.

## Smokes y aceptación

El documento de entrega pedía `/cowork` 200 sin sesión, pero el middleware implementado redirige al login: el smoke anónimo correcto observado es 307; 200 se comprueba con la cuenta autorizada. No se abrió el piloto privado para satisfacer ese smoke. `/api/onboarding/tour` y POST `/api/cowork/wake` responden 401 anónimamente.

`/api/leads/leads-finder/status` usa un contrato de disponibilidad: responde 200 con `{available:false}` sin sesión, no 401. Las rutas de trabajo siguen protegidas. Tutoriales .mp4/.vtt sirven 200. La extensión 4.1.1 se mantiene.

La aceptación con datos/cuenta reales la hace el dueño: pendiente hasta que pruebe «¿Qué queda por hacer hoy?», pipeline en gráfico, recordar preferencia, borrador para gerentes de personas de retail y monto en /crm. No se asume aprobada por pasar smokes ni se aprueban envíos desde la validación.

## Operación

Flags publicados mediante PR `feat/plan12-production-flags`, revisión automatizada ligada al SHA y CI. Deploy final desde main limpio y tag prod-2026-10-06 tras los checks del entorno servido. Resultado final de revisión/tag/logs se informa al dueño. Rollback: apagar flag o revertir PR, redeploy y smoke; las migraciones son forward-only.
