# Recuperación · callback detrás de App Hosting

## Incidente observado

El correo de recuperación llegó por Resend (Delivered; el usuario lo encontró en spam). Al abrirlo, el navegador terminó en `https://0.0.0.0:8080/login?enlace=vencido`.

Los logs de Supabase Auth registran:

- solicitud de recuperación aceptada a las 18:43:34 UTC;
- verificación del correo con redirección a las 18:52:11 UTC;
- intercambio del código rechazado con HTTP 422 a las 18:52:12 UTC: `invalid flow state, flow state has expired`.

Son dos hechos distintos: el enlace había vencido y la app construyó el destino del error con la dirección interna del contenedor.

## Corrección

`src/app/api/auth/callback/route.ts` usa un origen público de configuración mediante `authCallbackOrigin`, tanto al completar la sesión como al mostrar un error. Prioridad: `CANONICAL_APP_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL`. En producción no se acepta el origen de la petición como reemplazo si falta configuración. Host y cabeceras reenviadas no pueden seleccionar el destino.

Se conservan el intercambio PKCE con su almacenamiento de cookies y `safeNextPath`. Las redirecciones llevan `Cache-Control: no-store`. El diagnóstico del intercambio solo registra código de error y estado HTTP; no registra códigos de autenticación, verificadores, tokens, correos ni enlaces.

## Verificación

- Regresiones del handler real: éxito detrás de `0.0.0.0:8080`, error del proveedor, estado PKCE vencido, destino `next` externo, cabeceras manipuladas y configuración ausente/incorrecta.
- Suite unitaria completa: 2413 pruebas aprobadas con el runner seguro de Windows.
- Typecheck y build requeridos antes de integrar.
- Smoke de producción sin código real: callback con `error=access_denied` debe redirigir al login público con `enlace=vencido`; callback sin código y con `next=/restablecer-clave` debe conservar el dominio público y no afirmar que validó una sesión.

Para cerrar la prueba real se necesita solicitar otro correo y abrir el enlace recién recibido en el mismo navegador. Un enlace que ya venció no vuelve a ser válido por publicar esta corrección. No se generan ni se envían correos reales desde las pruebas automatizadas.
