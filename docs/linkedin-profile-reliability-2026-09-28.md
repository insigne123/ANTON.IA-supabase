# Búsqueda por perfil LinkedIn — 28 sep 2026

## Diagnóstico

La captura del usuario muestra una fila sin identidad presentada como un lead encontrado.
La consulta de solo lectura de producción para esa URL mostró un registro sin nombre,
cargo ni empresa, en estado failed. Los callbacks recientes registran fallos
APOLLO_PERSON_IDENTITY_MISMATCH y apollo_request_id_unknown. Estos códigos no prueban
por sí solos qué respuesta original causó cada intento; falta una reproducción con
la versión desplegada y trazas del proveedor.

El flujo del repositorio es nativo: /api/leads/search invoca executeProviderLeadSearch
en proceso. El perfil exacto usa /api/opportunities/enrich-apollo y submitApolloEnrichment,
que llama a https://api.apollo.io/api/v1/people/match. El navegador consulta
/api/leads/profile-status; callback y reconciliación viven en esta app.

## Correcciones

- Reintentar por URL no pone a null nombre, cargo, empresa ni la identidad Apollo ya vinculada.
- Una discrepancia de ID se clasifica como rechazo de identidad conocido, no como
  resultado desconocido que queda esperando un callback.
- Una respuesta que solo contiene ID/URL no cuenta como match exitoso.
- Las filas de seguimiento pendientes conservan su ID para polling, pero no aparecen
  como leads. No se anuncia «perfil encontrado» sin datos utilizables.
- El polling puede insertar el perfil cuando aparece; antes solo actualizaba filas existentes.
- El estado pendiente explícito permite seguimiento también cuando no se solicitó teléfono.
- Un fallo terminal sin perfil se presenta como «Perfil no confirmado».

Referencia funcional: documentación oficial People Enrichment de Apollo,
https://docs.apollo.io/reference/people-enrichment, consultada el 28 sep 2026.
Referencia UI: captura del usuario y estados existentes de la app; sin rediseño de layout.

## Verificación y límites

- Typecheck: aprobado.
- 54 pruebas específicas de cliente, proveedor, callbacks, reconciliación e identidad: aprobadas.
- Build: aprobado.
- Sin nuevas consultas de pago a Apollo ni escrituras de reparación en producción.
- Pendiente: validación autenticada en navegador, responsive/light-dark y reproducción
  del caso real después de integrar por PR y desplegar. No se certifica cobertura
  de datos de Apollo ni resolución de request_id_unknown con estas pruebas simuladas.
