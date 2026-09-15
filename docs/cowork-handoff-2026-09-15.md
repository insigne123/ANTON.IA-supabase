# Cowork — entrega para trabajo concurrente

## Producción

Las cinco migraciones Cowork se aplicaron una por una con MCP a `yfdelflsheurzaicwayi` el 15 de septiembre de 2026. Los nombres locales se alinearon con las versiones asignadas por el historial remoto para evitar reaplicaciones:

| Versión | Migración |
|---|---|
| 20260915154310 | cowork_private_core |
| 20260915154406 | cowork_worker_leases |
| 20260915154432 | cowork_tool_events |
| 20260915154504 | cowork_followups |
| 20260915154603 | cowork_note_approvals |

Verificación de catálogo: cuatro tablas con RLS habilitado; políticas solo SELECT para el usuario autorizado; RPCs de escritura sin EXECUTE para anon/authenticated; solo `cowork_has_access` es ejecutable por authenticated. No hay grants habilitados. No se crearon trabajos, contactos ni notas de prueba en producción. No hubo herramienta de logs disponible en el MCP: esta entrega no certifica logs ni pruebas funcionales concurrentes en producción.

## Estado de activación

El esquema está aplicado; la función permanece cerrada por defecto. Faltan UUID/configuración de propietario, grant, modelo, secreto y scheduler para activación funcional. No se habilitó autonomía, sandbox ni envíos. Subir el código no equivale a configurar esos servicios.

## Límites para continuar desarrollando

- Código principal aislado en `src/lib/cowork`, `src/lib/server/cowork`, `src/components/cowork`, `/cowork`, `/api/cowork` y `/api/cron/cowork`.
- Único componente compartido modificado por Cowork: `src/components/app-sidebar.tsx` (entrada privada con comprobación servidor).
- No modificar las cinco migraciones aplicadas; cualquier cambio siguiente debe ser una migración forward-only nueva.
- El resto de cambios locales de extensión/Apollo/secuencias antecede a Cowork y no forma parte de esta entrega.
- `cowork-implementation-status.md` contiene el historial incremental; esta entrega prevalece respecto al estado de aplicación de migraciones.
