# Cuentas creadas solo por administración

Decisión del dueño, 8 de octubre de 2026: no hay registro público. Solo el dueño de ANTON.IA provisiona cuentas por administración. Los administradores de un workspace pueden gestionar membresías, pero la app no les ofrece un endpoint de creación de usuarios de Auth.

## Bloqueo efectivo

- Producción `yfdelflsheurzaicwayi`: `disable_signup: true` en Supabase Auth, aplicado por Management API el 8 de octubre de 2026. Se envió únicamente ese campo y se verificó por una lectura posterior. No se cambiaron los proveedores, sesiones, JWT, URLs ni recuperación de contraseña.
- `supabase/config.toml`: `[auth].enable_signup = false` para que el entorno local siga la misma política. El proveedor de correo permanece habilitado para iniciar sesión.
- La creación por Auth Admin API con credenciales administrativas sigue disponible. No se introducen credenciales ni un nuevo endpoint de creación en la app.
- Ocultar un botón no es el control: el bloqueo de Supabase también impide solicitudes directas de registro y el alta de nuevas identidades por los flujos públicos de Auth.

## Pantalla y flujo

Problema de flujo y formulario. Referencia funcional: el formulario de acceso existente de ANTON.IA; se consultó ScreensDesign (`https://screensdesign.com/`) como referencia de flujos. Se simplifica a una columna y una acción principal, sin añadir paneles ni usar identidad o assets ajenos. Se conservan `Card`, `Input`, `Label`, `Button` y los tokens semánticos de claro/oscuro.

- `/login` ofrece iniciar sesión y recuperar contraseña, sin pestaña de registro ni formulario de confirmación.
- Se elimina `signUpWithPassword` de `AuthContext`, incluido el llamado a `supabase.auth.signUp`.
- El aviso de acceso explica que la administración de ANTON.IA crea las cuentas.
- Una invitación pide iniciar sesión con la cuenta que ya fue creada; no propone registrarse.
- La recuperación de contraseña y los destinos `next` de login/invitaciones siguen usando el flujo existente.

## Operación

El dueño crea la cuenta en Supabase Auth con el correo acordado y asigna la membresía del equipo mediante el proceso administrativo. Una invitación de workspace no crea una cuenta de Auth. Si alguien olvidó la contraseña, recupera la cuenta original; no se crea una variante de su dirección.

Este cambio no borra, fusiona ni modifica usuarios existentes. La cuenta `cflores2026@grupoexpro.com` y su falta de membresía son un caso separado que debe resolverse eligiendo la cuenta que Christian utilizará.

## Verificación

- Pruebas de flujo y mensajes: login, destino seguro, recuperación de contraseña y ausencia de creación desde el cliente.
- Typecheck y build.
- Comprobación proporcional en producción: lectura de `disable_signup` y solicitud a `/auth/v1/signup` con un correo de formato inválido y sin contraseña, que debe responder `signup_disabled` antes de validar credenciales. No se envía una dirección válida, un correo ni se crea un usuario de prueba.
- Revisión de login en móvil/escritorio y claro/oscuro; teclado, labels, errores y estado de carga.

Resultados del 8 de octubre de 2026: 2.711 pruebas unitarias aprobadas, typecheck y build aprobados; 8 capturas de login/restablecer contraseña a 390/1440 px en ambos temas, sin errores de consola, overflow ni hallazgos de axe. `node scripts/test-login-admin-only-browser.mjs` comprobó las cuatro combinaciones de tamaño/tema con Auth simulado: ausencia de registro, teclado, mostrar contraseña, loading, error de credenciales, recuperación y retorno a `/search`. El smoke de producción respondió 422 `signup_disabled`; no se enviaron contraseñas ni direcciones válidas.

## Referencia técnica

Supabase Management API: `PATCH /v1/projects/{ref}/config/auth` con `{"disable_signup":true}`. Referencia: `https://supabase.com/docs/reference/api/v1-update-auth-service-config`.
