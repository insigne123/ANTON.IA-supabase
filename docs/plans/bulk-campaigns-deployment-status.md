# Estado del despliegue de campañas — 2026-09-09

## Publicado

- App Hosting `studio` en `leadflowai-3yjcy`: el rollout de la etapa anterior terminó correctamente. Se publicó el subconjunto de campañas desde la copia aislada `bulk-deploy`, con `BULK_CAMPAIGNS_ENABLED=true` y `BULK_CAMPAIGNS_AUTOMATION_ENABLED=false`.
- Comprobación HTTP posterior: `/api/campaigns/bulk` y `/api/cron/bulk-campaigns` responden `401 Unauthorized` sin credenciales. Esto acredita rutas publicadas y protección de acceso; no acredita el flujo autenticado.
- `campaignProcessingTick` desplegada desde el workspace `main`, únicamente con `--only functions:campaignProcessingTick`. Build explícito de Functions aprobado. Revisión Cloud Run `campaignprocessingtick-00007-cox`, operación terminada a las 21:15:38 UTC.
- Se conservó el schedule existente cada cinco minutos, con invocación OIDC privada.
- Los dos primeros intentos fallaron durante la subida a Storage. El intento con resolución DNS IPv4 terminó correctamente.

## Pendiente antes de automatizar

- Ejecución confirmada en logs a las 21:20:13 UTC: `bulk-campaign-delivery completed with 200`. Esto comprueba el puente con automatización apagada, no la entrega de correos.
- Corrección local probada: `20260910170000_bulk_revision_binding.sql` actualiza la audiencia revisada antes de crear los borradores, dentro de la misma transacción, y protege identidades/contenido enviados ante ediciones posteriores. No aplicada remotamente todavía.
- El servicio de revisión consulta los miembros existentes sin volver a aplicar el filtro de primer contacto. El contenido bloqueado se compara usando el contexto original y sus overrides.
- La reaprobación reconoce el primer envío confirmado (incluido su marcador conservado por retención), pero sigue bloqueando respuestas y destinatarios no elegibles para primer contacto.
- Pruebas ejecutadas: SQL PostgreSQL/WASM de vinculación y mensajes bloqueados; cinco pruebas de flujos, incluida reaprobación; typecheck aprobado. Pendiente la prueba autenticada con el esquema completo.
- Bloqueo operativo: `opencode mcp list` confirma `supabase-production` conectado y limitado a `yfdelflsheurzaicwayi`, pero la sesión actual no expone sus herramientas. Se requiere recargar la conexión/herramientas para aplicar y verificar la corrección por el MCP autorizado.
- La copia aislada utilizada para el rollout anterior quedó detached y sin integrar un commit en `main`. No volver a desplegar desde ella. Alinear el conjunto publicado con `main` sin incluir el trabajo concurrente ajeno a campañas.

La automatización sigue apagada. No se enviaron correos de prueba a destinatarios reales.
