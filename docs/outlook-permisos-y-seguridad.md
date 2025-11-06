# Permisos y seguridad de Outlook (Microsoft Graph)

- **Modelo**: SPA multi-tenant con PKCE. Permisos **delegados** y **mínimos**.
- **Scopes**:
  - `User.Read` → solo identidad del usuario (al iniciar sesión).
  - `Mail.Send` → enviar correos en nombre del usuario (cuando hace clic en "Enviar").
  - `Mail.Read` (opcional) → leer *el propio buzón* para procesar acuses o respuestas (cuando el usuario activa “Tracking”).
- **Nunca** se solicita `*.Read.All` ni permisos de aplicación.
- **Ámbito de API**: únicamente endpoints `/me/*` (no directorio, no otros usuarios).
- **SCIM**: no se usa aprovisionamiento; el mensaje “SCIM no admitido” en Entra es esperado y **no aplica** a esta app.
- **Cifrado de tokens**: el aviso “app de otra organización” es normal para apps de terceros; no se utiliza token encryption SAML/WS-Fed en este flujo OIDC/PKCE de SPA.
- **Almacenamiento**: tokens en `sessionStorage` (no `localStorage`). Sin secretos en frontend.
- **Datos**: ANTON.IA no copia correos a sus servidores. Solo guarda metadatos necesarios (p. ej., `internetMessageId`, `conversationId`).
- **Revocación**: el usuario puede desconectar (logout) y el admin puede retirar el consentimiento desde Microsoft Entra (Aplicaciones empresariales → ANTON.IA).
- **URL de Admin Consent (si el tenant lo requiere)**:


https://login.microsoftonline.com/{TENANT_ID}/v2.0/adminconsent
?
client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=User.Read%20Mail.Send
