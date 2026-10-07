# Búsquedas por perfil y empresa · recuperación de sesión

## Evidencia del incidente

Las capturas muestran un perfil de LinkedIn con «Tu sesión expiró», empresa `acciona` con error genérico y recuperación de búsquedas no disponible. En la revisión servida `studio-build-2026-10-07-001`, Cloud Logging registró búsquedas/enriquecimientos/checkpoints con 401/403 y fallos de renovación `Refresh Token Not Found`. Otras solicitudes equivalentes llegaron a 200/202: no hay evidencia de caída total de Apollo.

La cuenta reportada está confirmada, sin bloqueo y con membresía de GrupoExpro. Los intentos rechazados no dejaron eventos `search.requested` de esa cuenta en el ledger consultado, compatible con rechazo previo al proveedor. La tabla de checkpoints existe y respondió también 200: no es necesario crear otra migración para ella.

No se dispone del token o sesión del navegador del usuario para atribuir cada trace a su cuenta. El informe no afirma que toda respuesta 403 sea la misma captura. La inconsistencia cookie/session y los mensajes equivocados se reproducen con los límites de autenticación simulados.

## Corrección

- `authenticatedApiFetch` usa el token vigente del SDK del navegador, solo en rutas `/api/` locales. No guarda ni imprime tokens. Un 401 reconocido de autenticación renueva una sola vez y reintenta con la misma persona, cuerpo y clave idempotente. Consultas concurrentes comparten la renovación. No reintenta 403, cuotas, proveedor, resultados ambiguos ni fallos de red.
- El BFF verifica ese token con Supabase Auth y usa un cliente **anon con el mismo JWT**, no service role, para comprobar membresías mediante RLS. No puede verificar una persona y consultar membresías con otra cookie. Headers/body de usuario no reemplazan la identidad verificada. Sin bearer se conserva el flujo de cookie y, separadamente, el flujo interno autenticado por su secreto.
- Las llamadas de búsquedas por empresa/perfil, polling, checkpoints y lectura de organizaciones usan el helper. No se abren permisos ni se agrega membresía.
- La interfaz diferencia 401 (sesión) de 403 (acceso al equipo) y ofrece volver a entrar también para empresa. El botón cierra solo la sesión local con acción explícita y regresa a `/search` tras login; evita rebotar inmediatamente desde login con la cookie vencida.
- Guarda solo criterios en sessionStorage, separados por persona y organización, una vez, con vencimiento de 20 minutos. No guarda resultados ni material de autenticación. No relanza búsquedas automáticamente tras login.

## Precio de rescates

Fuente oficial consultada el 7 oct 2026: `https://developers.openai.com/api/docs/pricing`.

Standard, contexto de entrada <=272K tokens, por millón: `gpt-6.1-sol` entrada US$2, entrada en caché US$0,10, salida US$10. Entrada de contexto largo y cache writes tienen tarifas diferentes; esta entrada de configuración se identifica como `openai-standard-2026-10-07-short`, igual que las entradas short actuales. No se inventa un precio de familia. Uso incompleto sigue con costo desconocido. No se reescriben registros históricos.

## Dependencias de main

El deploy incluye #228–#242 de Cowork (rescate, tareas y mejoras). Se confirmó por lectura que la migración `cowork_task_plan_effect` registrada en `20261007041954` ya está aplicada, el check y la función tienen task_plan y los permisos permanecen service-only. No se reaplica.

La prueba de fuente de tareas nuevas normaliza CRLF antes de comparar el orden de sus guardas; no cambia la aprobación del worker ni sus límites.

## Verificación

Regresiones de transporte/servidor cubren identidad, RLS, cookie obsoleta, renovación concurrente, cancelación, cuerpo e idempotencia, no repetición de resultados ambiguos, acceso denegado y criterios separados. La regresión de costos verifica tarifa y cálculo con caché desde `apphosting.yaml`.

`scripts/test-search-auth-recovery-browser.mjs` renderiza la página y el cliente reales con sesión/API simuladas: empresa renueva y muestra resultados; perfil con URL de tracking se normaliza; equipo denegado muestra el mensaje y CTA; refresh perdido permite iniciar sesión guardando criterios; reauth restaura sin iniciar una búsqueda. Nada se envía a proveedores o producción desde esas pruebas.

Build, typecheck, unitarias, CI/revisión y smokes son requeridos antes de cerrar la publicación. Los smokes no reemplazan repetir perfil/empresa con la sesión real del usuario tras desplegar.
