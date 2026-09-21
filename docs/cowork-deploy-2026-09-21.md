# Despliegue Cowork — 21 de septiembre de 2026

## Resultado

`firebase deploy --only apphosting -P leadflowai-3yjcy --non-interactive`
terminó con `Rollout for backend studio complete` y `Deploy complete`.

- URL: https://studio--leadflowai-3yjcy.us-central1.hosted.app
- Fuente subida: `gs://firebaseapphosting-sources-1083965020353-us-central1/studio--74064-w9J0tCbCSNx3-.zip`.
- Incluye asignación/reserva/liberación CRM, clasificación de incidencias y control de misiones pendientes del despliegue anterior, con las demás capacidades Cowork existentes.
- Las migraciones ya estaban aplicadas; en esta entrega no se modificó la base.
- No equivale al cierre de todas las capacidades AXIS ni a aceptación autenticada.

## Verificación

- TypeScript aprobado.
- `verify-cowork`: 110 pruebas TypeScript y scripts de integración aislada aprobados.
- Build aislado aprobado. El primer comando combinado agotó su timeout durante build;
  se repitió solo el build con mayor plazo y terminó correctamente.
- HTTP sin sesión: 401 en `/api/cowork/access` y previews `crmassign`, `exception`, `mission`.
- Tras reautenticar gcloud, inspección independiente confirmada: revisión
  `studio-build-2026-09-21-004`, 100% del tráfico, servicio Ready/ConfigurationsReady/RoutesReady
  en True y revisión Ready/Active/ContainerHealthy en True.
- Flags Cowork, worker, leases, especialistas, cola, presupuesto, herramientas y consumo en `true`.
  Autonomía general ausente (desactivada).
- Cloud Logging: consulta de esta revisión con severidad ERROR o superior, últimas 24 horas,
  sin entradas devueltas. No sustituye la aceptación autenticada ni certifica logs de Supabase.

## Conservación del trabajo local

- Fuente de despliegue aislada en `main`, conservando solo cambios Cowork preparados en el índice.
- Trabajo de otras superficies restaurado; comparación de archivos versionados contra el snapshot sin diferencias, sin conflictos pendientes.
- Respaldo conservado: stash `cowork-deploy-20260921-preserve-other-app-work`,
  SHA `c65e33201baf43e02634dd082882471444071d74`.
- No se hizo commit ni push. Los cambios Cowork continúan preparados en el índice;
  el resto del trabajo concurrente permanece local. El despliegue no sustituye un commit.
