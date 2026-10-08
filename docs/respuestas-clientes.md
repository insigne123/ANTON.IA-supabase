# Respuestas a clientes que contestaron (8 oct 2026)

## Problema

Cuando un cliente contesta un correo, `draftAutonomousReply` (`src/lib/server/antonia-reply-drafting.ts`) le pide a la IA un
borrador de respuesta (`generateAntoniaReply`). Le faltaban dos cosas:

- **Qué vende el remitente.** El campo `valueProposition` se llenaba con el resumen de la investigación del lead: la IA veía la
  empresa del cliente como si fuera la oferta propia.
- **Qué le escribimos.** Del correo enviado solo pasaba el asunto («Ultimo asunto enviado: …»).

Con el modelo real (`gpt-6-luna`, el de producción) eso se notaba en tres de seis casos:

- Ante «Mándame información de sus servicios por correo», pedía una llamada en vez de mandarla (2 de 2).
- Ante «¿Ustedes también hacen los finiquitos?», decía que debía revisarlo, aunque el remitente los ofrece (2 de 2).
- Tuteaba a quien se le había escrito de usted (2 de 2).

Además, sin adjuntos el modelo a veces devuelve `recommendedAssetNames: null`. Eso fallaba la validación y la app caía a la plantilla
genérica («Te comparto un poco más de contexto…»).

## Qué cambia

- `antonia-reply-drafting.ts` carga la oferta del Perfil (`loadSellerProfile`, la misma que usan los borradores) y el texto enviado,
  de las mismas fuentes que la vista de la conversación: la copia entregada al proveedor (`outbound_dispatches`) o la versión
  aprobada (`messaging_draft_versions`). Solo lecturas.
- `generate-antonia-reply.ts`:
  - separa «Lo que vende el remitente» de la investigación del lead;
  - responde primero lo que escribió el cliente:
    - si pidió información, se la da en el correo;
    - si preguntó si hacen algo, sí o no según la oferta;
    - si preguntó un precio que no está, dice de qué depende y pide solo esos datos;
    - ante «ya tenemos proveedor» o «no hay presupuesto», agradece y no vuelve a vender;
  - mantiene el trato del correo enviado;
  - acepta `null` en los adjuntos sugeridos.
- `scripts/evaluate-antonia-replies.ts` prueba seis casos con lo que la app pasa: tres objeciones, un precio, un servicio y una reunión.

## Medición

24 respuestas con `gpt-6-luna`: 12 con lo que la app pasaba antes y 12 con este cambio (2 por caso). Las calificó a ciegas otra
sesión de Claude, sin saber cuál era cuál, leyendo el correo enviado y lo que contestó el cliente:

| | Antes | Después |
|---|---|---|
| Contesta lo que escribió el cliente (1 a 5) | 3,00 | 4,92 |
| Veracidad (1 a 5) | 4,25 | 4,92 |
| Mantiene el trato del correo enviado | 10 de 12 | 12 de 12 |
| Lo enviaría tal cual | 2 de 12 | 12 de 12 |
| Mejor respuesta del caso | 0 de 6 | 6 de 6 |

Una primera versión de las reglas pedía «dejar una razón para tenerte presente» después de una objeción. El evaluador marcó que
así volvía a vender después de un «no», y se cambió por agradecer y preguntar si se puede escribir más adelante.

Sin migraciones ni flags. No cambia cuándo se envía una respuesta: eso lo sigue decidiendo la política del autopiloto (`antonia-reply-policy.ts`).
