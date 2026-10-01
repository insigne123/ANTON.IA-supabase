# Remitente predeterminado y oferta en juego (1 oct)

**Problema (prueba del 1 oct, `Pruebas_de_app.docx`):**
- **Remitente:** Cowork preguntaba cada vez si enviar desde Gmail u Outlook.
- **Oferta:** los borradores hablaban de «automatización con IA» cuando la conversación era sobre revisión de antecedentes (AXIS). El producto que se pidió promocionar no llegaba a quien escribe.

## Qué cambia

1. **Remitente predeterminado** (Conexiones).
   - **La tarjeta «Remitente predeterminado»** muestra Gmail y Outlook con su estado. Elegir una la guarda en el perfil (`profiles.default_mail_provider`), y solo se puede elegir una cuenta conectada.
   - **Cuál envía** (`resolveMailProvider` en `src/lib/mail-sender.ts`):
     - la elegida, mientras siga conectada;
     - si no hay elección, la única conectada;
     - con dos conectadas y ninguna elegida, la tarjeta pide elegir.
   - **Cowork:**
     - recibe la cuenta en `userContext.sender` y no pregunta;
     - al armar una campaña, el servidor usa la cuenta que la persona nombró en su mensaje («desde Outlook») si está conectada; si no, la predeterminada (`coworkCampaignProvider`);
     - la etiqueta de la propuesta dice «desde Gmail».
     - Un envío individual usa la predeterminada antes de probar Gmail y luego Outlook.
   - **La campaña manual** parte con la cuenta predeterminada.
   - **API:** `GET/PUT /api/integrations/default-sender`. Nunca devuelve tokens.
2. **Oferta en juego** (decisión 3 del plan): si en la conversación se pidió promocionar un producto, la memoria del hilo lo guarda (`offer`), y ese producto manda en:
   - **la Redactora:** `userContext.offerInPlay`, con la regla de ofrecer eso y no otra cosa del perfil;
   - **los borradores desde una investigación** (`draft.request`): el vendedor del borrador lleva ese producto como propuesta y servicio (`sellerWithOfferInPlay`). Nombre, cargo, empresa y pruebas siguen siendo los del perfil.

   Sin oferta en la conversación se usa «Perfil», como antes.
3. **Saludo de los borradores individuales:** «Hola Rafael,» con el nombre de pila. Nunca un nombre oculto («Ra\*\*\*l») de una investigación hecha antes de buscar el correo; en ese caso, «Hola,».

## Base de datos

**Migración `20261002000000_profiles_default_mail_provider.sql`:**
- **Columna:** `profiles.default_mail_provider`, nula, que solo admite `google` u `outlook`.
- **Permisos:** sin políticas nuevas. La persona actualiza su propia fila con las de `profiles`.
- **Aplicación:** se puede repetir sin efecto.

## Pruebas

- `src/lib/mail-sender.test.ts`: cuál envía y la cuenta nombrada en el pedido.
- `src/lib/server/seller-offer-in-play.test.ts`: el producto en juego y el resto del perfil.
- `scripts/test-default-sender-ui.mjs` (DOM):
  - elegir con dos cuentas;
  - una sola cuenta;
  - cuenta no conectada;
  - error al guardar.
- `supabase/tests/database/profiles_default_mail_provider.test.sql` (pgTAP): la columna, nula al inicio, valores válidos y rechazo de otros.

## Pendiente

- **Revisión de punta a punta de la campaña manual** (audiencia → correos → revisión), con ayuda de la IA por persona y Jev antes de aprobar.
- **Medición con el juez** del caso del usuario (AXIS, 2 destinatarios). Necesita las claves del modelo, así que la corre el mantenedor.
