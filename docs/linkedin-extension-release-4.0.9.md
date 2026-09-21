# 4.0.9 · recuperación de LinkedIn y conexión persistente

14 de septiembre de 2026.

## Causas y correcciones

- La captura muestra `Receiving end does not exist`: fallo de transporte anterior a cualquier búsqueda de cabecera/compositor. Antes de leer, preparar o reservar un envío, el worker comprueba el receptor y, si falta, inyecta únicamente los tres scripts empaquetados en la pestaña de perfil LinkedIn validada. Permiso adicional `scripting`; listeners protegidos contra duplicación. No reejecuta una mutación si se pierde su respuesta.
- El vínculo anterior se guardaba en session storage y se eliminaba si desaparecía `/extension/connect`. Ahora se guarda localmente usuario/organización/origen, sin tokens. El worker consulta directamente la API con las cookies existentes del navegador. La pestaña solo interviene al autorizar inicialmente; desconectar o recibir 401 elimina el vínculo. Cerrar una pestaña no cierra sesión.
- API admite Origin de extensión Chrome con formato válido y marcador explícito, manteniendo autenticación y comprobación de usuario/organización. Esto no convierte Origin en una credencial. No se permite Origin web arbitrario, vacío o LinkedIn. Campañas delegadas usan el origen público de producción.
- Documentación, privacidad y página de conexión actualizadas. El panel observa cambios del vínculo en almacenamiento local.

## Verificaciones

- 50/50 pruebas aprobadas, incluyendo receptor ausente, recuperación previa a preparación, respuesta perdida sin replay, reinicio de worker sin pestaña app, 401, desconexión y comprobación de scope para Origin de extensión.
- Chromium real, extensión cargada y servidor HTTP local: envío de cookie de prueba HttpOnly SameSite=Lax y Origin chrome-extension desde worker sin pestaña app. Script `scripts/test-extension-worker-browser.mjs`. No usa credenciales reales.
- Smoke panel claro/oscuro 320/380/520 aprobado con frontera Chrome simulada.
- Next.js build aprobado. ZIP 4.0.9: 1.919.540 bytes; SHA-256 `61d631b0e36c9f5e93f38563d798e26e59b65a5b0acba89f658ba61f3a084ccc`.
- Desplegado en `studio-build-2026-09-14-003`, 100% tráfico. ZIP público idéntico; privacidad, conexión y API sin sesión verificados. Solicitud con Origin de extensión llega a autenticación y devuelve 401 sin cookies. Sin ERROR en la consulta inmediata de logs de la revisión (15 minutos).

## Uso y límites

Actualizar los archivos y recargar la extensión en Chrome; aceptar el permiso nuevo si lo solicita. Reconectar una vez para establecer el vínculo si ya se había perdido con la versión anterior. Se puede cerrar la app después de conectar; un logout, una sesión revocada o vencida sí requiere autenticación.

Preparación conserva las verificaciones de destinatario, borrador y texto completo. No se probó la sesión real del usuario en LinkedIn ni se envió un mensaje real. La prueba de cookies fue local, no una prueba autenticada de producción.
