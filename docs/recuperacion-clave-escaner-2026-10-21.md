# Recuperación de contraseña · el enlace «vence» porque el filtro del correo lo abre primero

## Qué pasó

Una persona de una empresa con correo Microsoft 365 pidió recuperar su contraseña, abrió el enlace a los pocos minutos y la app le dijo que el enlace había vencido. Lo repitió y pasó lo mismo.

Los logs de Auth de producción (21 de octubre de 2026, hora UTC) muestran esto para la primera solicitud:

| Hora | Quién | Qué |
| --- | --- | --- |
| 12:36:02 | la persona | `POST /recover`: se envía el correo. |
| 12:36:32 | **otra dirección IP** | `GET /verify` con el token: 303 y un `login`. El token quedó gastado, 30 segundos después de pedirlo. |
| 12:37:30 | un servidor de Microsoft (Exchange Online) | `HEAD /verify`: 405. Es el filtro revisando el enlace al momento del clic. |
| 12:37:30 | la persona | `GET /verify`: **403 «One-time token not found»**. La app lo muestra como «enlace vencido». |

La segunda solicitud (12:37:40) repitió el patrón: otra dirección hizo `GET /verify` a los 47 segundos.

No vence por tiempo: el token es de un solo uso y el filtro de seguridad del correo (Defender, Safe Links u otro) pide todos los enlaces de un mensaje antes de que la persona lo lea. Esa petición gasta el token. Le pasa a cualquier persona cuyo correo pase por uno de esos filtros.

## Qué cambia

El enlace del correo ya no gasta el token al abrirse. Lleva a `/restablecer-clave` con el token sin usar, y la página pide un clic en «Continuar»; ese clic envía un `POST /api/auth/recovery` que lo gasta, abre la sesión y recarga la página, que ahora pide la contraseña nueva. Un filtro sigue enlaces, no pulsa botones.

- `src/lib/recovery-link.ts`: qué es un token de recuperación y a dónde lleva.
- `src/app/api/auth/callback/route.ts`: un enlace con `token_hash` ya no llama a `verifyOtp`; redirige a la página con el token intacto. El intercambio por `code` (los enlaces que ya están en bandejas) no cambia.
- `src/app/api/auth/recovery/route.ts`: el único lugar donde se gasta el token (solo `POST`).
- `src/app/restablecer-clave/page.tsx`: el paso «Continuar» y, después, la contraseña nueva de siempre.

## Para que funcione hay que cambiar la plantilla del correo (en Supabase)

El código nuevo se publica primero. Mientras la plantilla no cambie, el correo sigue trayendo el enlace anterior y el problema sigue igual. Los enlaces ya enviados siguen funcionando como antes.

En Supabase: **Authentication → Emails → Reset password**, reemplazar el cuerpo completo por el de abajo.

`{{ .RedirectTo }}` es el destino que la app ya envía al pedir el enlace (`…/api/auth/callback?next=%2Frestablecer-clave`), por lo que ya está en las direcciones permitidas y el resto del enlace se agrega con `&`.

Cuerpo completo (el de la plantilla actual, con los dos enlaces cambiados y sin la frase «Abre el enlace en el mismo navegador…», que ya no aplica: el enlace nuevo funciona desde cualquier navegador). El asunto no cambia («Crea una contraseña nueva para ANTON.IA»):

```html
<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Recupera tu contraseña de ANTON.IA</title></head>
  <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif;line-height:1.6">
    <main style="max-width:520px;margin:32px auto;padding:28px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px">
      <p style="font-size:14px;font-weight:bold;color:#4338ca">ANTON.IA</p>
      <h1 style="font-size:24px;line-height:1.3">Crea una contraseña nueva</h1>
      <p>Recibimos una solicitud para recuperar el acceso a tu cuenta. Pulsa el botón y elige tu contraseña nueva.</p>
      <p style="margin:28px 0"><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#4338ca;color:#ffffff;text-decoration:none;font-weight:bold">Cambiar mi contraseña</a></p>
      <p>Si no solicitaste este cambio, puedes ignorar el correo. Tu contraseña seguirá siendo la misma.</p>
      <p style="font-size:13px;color:#475569">Si el botón no funciona, copia este enlace en tu navegador:</p>
      <p style="font-size:13px;overflow-wrap:anywhere"><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery" style="color:#4338ca">{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery</a></p>
    </main>
  </body>
</html>
```

## Cómo comprobarlo después de cambiar la plantilla

1. Pedir un enlace desde «¿Olvidaste tu contraseña?».
2. En los logs de Auth no debe aparecer ningún `GET /verify` para esa solicitud: el correo ya no apunta a Supabase sino a la app.
3. Abrir el enlace: la página dice «confirma que abriste este enlace tú» y no gasta nada (se puede abrir dos veces).
4. «Continuar» abre la sesión y la página pide la contraseña nueva. Un `POST /api/auth/recovery` con 200 en los logs de la app, y un `login` en los de Auth.

## Qué se probó y qué no

Probado sin enviar correos reales: la ruta de retorno no gasta el token aunque la abra un filtro (dos veces seguidas), la ruta `POST` lo gasta una vez y no registra el token ni el correo, la página no hace ninguna petición hasta el clic, recarga sin el token tras el éxito, y un token vencido ofrece un enlace nuevo.

No probado: el correo real con la plantilla nueva ni un filtro real de Microsoft 365; solo se puede con la plantilla cambiada en producción.
