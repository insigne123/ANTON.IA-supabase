# «Agenda»: el enlace para agendar y cuándo va en los correos

**Fecha:** 19 de octubre de 2026. **Propuesta 3** de la comparación con otras apps: enlace de agenda en los correos (Apollo, Outreach, HubSpot).

## Por qué

Cuando alguien muestra interés, el siguiente paso es la reunión. Coordinar el horario por correo cuesta dos o tres mensajes. Con un enlace de agenda la persona elige un horario de una vez.

Ponerlo en el primer correo, antes de que te conozcan, suele bajar las respuestas. Por eso nunca va ahí.

## Qué ve la persona

En «Firmas y estilo» hay una pestaña nueva, «Agenda».

- **«Enlace de tu agenda»:**
  - Sirve Calendly, Google Calendar (agenda de citas), Microsoft Bookings, HubSpot, Cal.com u otra página https.
  - La pantalla reconoce el servicio y ofrece «Probar».
  - Si la persona no tiene agenda, explica cómo crearla gratis en Google Calendar.
- **«¿Cuándo va en tus correos?»:**
  - **Automático (recomendado):** la IA lo agrega a la respuesta sugerida cuando la persona muestra interés o pide reunión.
  - **Solo cuando lo pida:** aparece el botón «Insertar mi agenda» al responder o redactar; la IA no lo agrega sola.
  - **Nunca:** ningún correo lo lleva.
- **«Avisos para retomar»:** cuántos días esperar para «Para retomar» (`docs/para-retomar.md`).

## Cómo funciona

- **`src/lib/booking-link.ts`:**
  - `normalizeBookingUrl` acepta solo direcciones https públicas: sin espacios ni credenciales, y agrega `https://` si falta.
  - `bookingProvider` reconoce el servicio.
  - `readBookingPreference` lee lo guardado en `profiles.signatures.booking`, junto a la firma.
  - `bookingLinkForReply` decide el enlace de la respuesta sugerida.
    - «Automático» lo da solo si la respuesta es `meeting_request` o `positive`.
    - «Solo cuando lo pida» y «Nunca» no lo dan.
    - Sin preferencia guardada, sigue el enlace del workspace, como antes.
  - `insertBookingLine` agrega una sola vez «Si te acomoda, puedes elegir un horario aquí: …» al final del texto. La firma se agrega después, al enviar.
- **Pantallas:**
  - `src/components/email-studio/BookingSettings.tsx`: la pestaña «Agenda».
  - `src/hooks/use-booking-link.ts`: el botón «Insertar mi agenda» en «Redactar» y al responder en «Conversaciones».
- **Respuesta sugerida:** `src/lib/server/antonia-reply-drafting.ts` usa `bookingLinkForReply` con la intención de la respuesta.
- **Sin migración:** la preferencia vive en `profiles.signatures`.

## Pruebas

- `src/lib/booking-link.test.ts`: direcciones válidas e inválidas, servicios, preferencia guardada, cuándo va en la respuesta y la frase insertada una sola vez.
