# Apollo in-process: verificación de producción

- Commit: `ea65182` en `main`.
- Cloud Build: `d4c04312-9e72-4b2e-a1d6-767736e4cf5d`, SUCCESS.
- Revisión: `studio-build-2026-09-16-002`, 100 % del tráfico de studio comprobado.
- La interrupción de la CLI no canceló el build remoto; se esperó su finalización sin duplicar el rollout.

## Causa

La migración de búsqueda/enriquecimiento a `src/lib/server/apollo-provider` existía localmente, pero el release anterior seguía llamando al gateway externo. Los intentos recientes de la cuenta afectada registraban `APOLLO_GATEWAY_HTTP_503/500`. `activity_logs` no era una fuente suficiente para concluir que no había uso.

## Comprobaciones realizadas

- Endpoint legacy GET `/api/leads/search?record_id=...`: HTTP 410, confirmando el handler nuevo.
- Búsqueda de empresa SONDA/Chile, limitada a un resultado, usando solicitud interna autorizada con la cuenta propietaria: HTTP 200, proveedor Apollo, un resultado.
- Reintento puntual del perfil que había fallado a Kristy, mediante el endpoint de enriquecimiento con su scope de organización y una nueva clave idempotente: HTTP 202, datos profesionales recuperados.
- Operación `75a4f14a-de32-47e5-8e53-bcb19791692b`: callback recibido una vez, proveedor `SUCCESS`, estado terminal `succeeded`, sin error.
- Registro final en `people_search_leads`: `completed`, teléfono presente, correo ausente. El resultado confirma la recuperación del flujo, no garantiza disponibilidad de correo para ese perfil.
- Las credenciales internas se obtuvieron de Secret Manager en memoria y no se escribieron en archivos.

## Alcance y límites

Búsqueda, enriquecimiento, consulta de resultados asíncronos y uso Apollo emplean el cliente directo de este repositorio. El flujo separado de investigación legacy no forma parte de este corte. La comprobación puntual no equivale a 24–48 horas de observación ni a una prueba visual dentro de la sesión del navegador de Kristy.

El trabajo local que se había aislado para desplegar se restauró sin conflictos.
