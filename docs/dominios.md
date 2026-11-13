# Las dos direcciones de la app

Desde el 13 de noviembre de 2026 la app responde en dos direcciones, y cada una tiene su papel. El código que lo decide está en `src/lib/server/app-origins.ts`.

| Dirección | Variable | Para qué |
|---|---|---|
| `https://anton-ia.yago.cl` | `APP_PUBLIC_URL` | La que la gente conoce. Los enlaces de los correos que la app manda a sus usuarios abren aquí, y quien inicia sesión aquí se queda aquí. |
| `https://studio--leadflowai-3yjcy.us-central1.hosted.app` | `CANONICAL_APP_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL` | La propia de la app, donde está alojada. Es la que tienen registrada Google y Microsoft para los permisos de correo, y la que usan los proveedores que llaman de vuelta. |

Las dos sirven la misma app. La sesión es por dirección: quien entró por una no está dentro en la otra.

## Qué abre en la dirección pública

Los correos de la app a sus propios usuarios (`appLinkBase`): avisos de la mañana, «Contacto del día» y «Campaña lista para aprobar», informe semanal, avisos de respuestas y de escalamiento, avisos de Oportunidades (asignación, decisión, fuente caída) y el enlace de una invitación al equipo.

## Qué sigue en la dirección propia

- Lo que va dentro de los correos a prospectos: el enlace de desuscripción y el seguimiento de aperturas y clics. Cambiar ese dominio toca la entregabilidad y los enlaces ya enviados, así que es una decisión aparte.
- Las direcciones a las que llaman de vuelta los proveedores (Apollo, Twilio) y las llamadas internas entre rutas de la app.
- La vuelta de los permisos de Gmail y Outlook (`/api/auth/callback/google` y `/azure`): es la única que Google y Microsoft conocen.

## Conectar Gmail u Outlook desde la dirección pública

Quien inició sesión en `anton-ia.yago.cl` tiene ahí su sesión y la cookie del intento, pero Google y Microsoft solo devuelven a la dirección propia. Antes se mandaba a la persona a la dirección propia a empezar, donde no tenía sesión, y terminaba en «sesión vencida». Ahora (`src/lib/server/provider-oauth.ts`):

1. El permiso empieza en la dirección pública, con la sesión de la persona. La cookie del intento queda ahí, y el `state` lleva la marca `p.`.
2. Google o Microsoft responden a la dirección propia. Esa ruta ve la marca y reenvía la respuesta tal cual a la dirección pública, sin leerla ni tocar cookies. Solo reenvía a la dirección configurada en `APP_PUBLIC_URL`, nunca a una que venga en la solicitud.
3. La dirección pública termina como siempre: misma sesión, mismo intento, mismo verificador, y guarda el permiso.

La marca no es lo que protege el intento. El `state` se sigue comparando entero con la cookie, la sesión tiene que ser la de quien empezó, y el código no sirve sin el verificador que guarda esa cookie. No hace falta tocar las consolas de Google ni de Microsoft.

Conectar el correo desde el enlace de un correo de contactos (sin sesión, `provider-oauth-link.ts`) sigue pasando entero por la dirección propia y devuelve a la persona a la página del enlace.

## Iniciar sesión y recuperar la clave

`/api/auth/callback` devuelve a la persona a la dirección por la que llegó, si es una de las dos configuradas (`authCallbackOrigin`). Los encabezados de la solicitud solo eligen entre las direcciones configuradas: nunca aportan un destino.

## Apagarlo

Sin `APP_PUBLIC_URL`, o si no es una dirección https simple, todo vuelve a la dirección propia. `LEAD_DROPS_PUBLIC_URL`, si se define, vale solo para los enlaces de los correos de contactos.
