# Componer: quién envía, qué hace cada botón y sin bucles

**Fecha:** 1 de octubre de 2026.

Atiende tres hallazgos de `docs/ui-ux/informe-recorrido-grupoexpro-2026-09-12.md`.

## H06: remitente real

Antes, Componer decía «Perfil remitente: … Envío por Gmail: se usará la cuenta conectada al proveedor, que puede diferir del perfil. Versión guardada: <id>». No respondía «¿esto sale con mi correo?» y mostraba un identificador interno.

Ahora muestra **«De: Nombre <correo real>» por Gmail/Outlook**:
- La dirección la confirma el proveedor (`GET /api/integrations/sender`, `src/lib/server/mail-sender.ts`, que reutiliza `coworkMailboxIdentity`).
- **Sin cuenta conectada:** aviso «Gmail no está conectado» con «Conectar Gmail», y el envío queda deshabilitado (el borrador se conserva).
- **Si el proveedor no responde:** se avisa sin bloquear.
- Ningún token sale del servidor. El token rotado de Outlook se guarda cifrado, como en el resto de la app.

## H07: botones que dicen lo que hacen

| Antes | Ahora |
|---|---|
| «Revisar y aprobar» | «Confirmar revisión», con la nota «confirmar no lo envía todavía» |
| «Enviar correo» | «Enviar ahora», con la nota «Saldrá ahora desde <correo>» |

## H11: investigar sin perder el contexto

Antes, «Ir a investigar el contacto» abría la lista completa y pedía buscarlo y seleccionarlo otra vez.

Ahora «Investigar a este contacto» abre `/saved/leads/enriched?investigar=<id>`, y la investigación de ese contacto se abre sola.

## Pruebas

`scripts/test-compose-sender.mjs` corre en `test:unit` (vía `__tests__/compose-sender.test.mjs`). Cubre:
- el resolvedor: sin token, conectado, Outlook rota el token, proveedor caído, y que no se filtra ningún token;
- la línea «De:» en sus cuatro estados.
