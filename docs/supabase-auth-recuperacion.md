# Recuperación de contraseña · configuración en Supabase

Proyecto de producción: `yfdelflsheurzaicwayi`. El mantenedor eligió configurar esta parte desde el dashboard de Supabase. No requiere archivos `.env*` ni una migración.

## URL y enlace

En **Authentication → URL Configuration**:

- Site URL: `https://studio--leadflowai-3yjcy.us-central1.hosted.app`.
- Mantener las Redirect URLs existentes y agregar:
  - `https://studio--leadflowai-3yjcy.us-central1.hosted.app/api/auth/callback`
  - `https://studio--leadflowai-3yjcy.us-central1.hosted.app/api/auth/callback?next=%2Frestablecer-clave`

La segunda es la dirección exacta que envía `requestPasswordReset` en `src/context/AuthContext.tsx`. El callback intercambia el código por una sesión y abre `/restablecer-clave`. No cambiar el enlace del correo por una URL directa a esa pantalla: se perdería la verificación del código.

## Correo en español

En **Authentication → Email Templates → Reset Password**:

- Asunto: **Crea una contraseña nueva para ANTON.IA**.
- Contenido: copiar `docs/templates/supabase-password-recovery-es.html`.
- Mantener `{{ .ConfirmationURL }}` como destino del botón y del enlace alternativo.

## SMTP propio

En **Authentication → Email → SMTP Settings**, configurar el proveedor real:

- host y puerto indicados por el proveedor;
- usuario y contraseña SMTP, guardados solo en Supabase;
- correo remitente de un dominio verificado;
- nombre del remitente: **ANTON.IA**.

Completar en el proveedor la verificación de dominio y sus registros SPF/DKIM. Desactivar el seguimiento de clics para estos correos si el proveedor reescribe los enlaces de autenticación. No usar credenciales de Outlook/Gmail de los ejecutivos como SMTP compartido ni copiar contraseñas en este repositorio.

## Comprobación después de guardar

1. Abrir `/login?recuperar=1` en el navegador que se usará para abrir el correo.
2. Pedir un enlace para la propia cuenta de prueba del mantenedor.
3. Verificar remitente, asunto y texto en español; abrir el enlace en ese mismo navegador (PKCE conserva ahí el verificador).
4. Confirmar que aparece «Crea tu contraseña nueva» y que la cuenta mostrada es la correcta.
5. Guardar una contraseña nueva, cerrar sesión y entrar con ella.
6. Verificar que reutilizar o abrir un enlace vencido lleva a la explicación correspondiente, con la opción de pedir otro.

La app conserva una respuesta genérica al pedir recuperación para no revelar si existe una cuenta. La presencia de la pantalla desplegada no confirma que SMTP y las Redirect URLs hayan sido configurados: esta verificación requiere el correo real del paso 2.
