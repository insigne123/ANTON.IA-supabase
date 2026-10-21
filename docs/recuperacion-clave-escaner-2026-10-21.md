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

En Supabase: **Authentication → Emails → Reset password**, cambiar el enlace del cuerpo por:

```html
<p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Crear contraseña nueva</a></p>
```

`{{ .RedirectTo }}` es el destino que la app ya envía al pedir el enlace (`…/api/auth/callback?next=%2Frestablecer-clave`), por lo que ya está en las direcciones permitidas y el resto del enlace se agrega con `&`. Un cuerpo completo, si se prefiere reescribirlo:

```html
<h2>Crea tu contraseña nueva</h2>
<p>Pediste cambiar tu contraseña de ANTON.IA. Pulsa el botón para elegir una nueva:</p>
<p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Crear contraseña nueva</a></p>
<p>Si no fuiste tú, ignora este correo: tu contraseña sigue igual.</p>
```

## Cómo comprobarlo después de cambiar la plantilla

1. Pedir un enlace desde «¿Olvidaste tu contraseña?».
2. En los logs de Auth no debe aparecer ningún `GET /verify` para esa solicitud: el correo ya no apunta a Supabase sino a la app.
3. Abrir el enlace: la página dice «confirma que abriste este enlace tú» y no gasta nada (se puede abrir dos veces).
4. «Continuar» abre la sesión y la página pide la contraseña nueva. Un `POST /api/auth/recovery` con 200 en los logs de la app, y un `login` en los de Auth.

## Qué se probó y qué no

Probado sin enviar correos reales: la ruta de retorno no gasta el token aunque la abra un filtro (dos veces seguidas), la ruta `POST` lo gasta una vez y no registra el token ni el correo, la página no hace ninguna petición hasta el clic, recarga sin el token tras el éxito, y un token vencido ofrece un enlace nuevo.

No probado: el correo real con la plantilla nueva ni un filtro real de Microsoft 365; solo se puede con la plantilla cambiada en producción.
