# Cowork · Jev lee el correo antes de que lo apruebes (apagado por defecto)

Del plan del 30 sep («Jev para revisar antes de enviar», operaciones C4, C5 y D5 del banco AXIS). Jev ya revisa la respuesta de Cowork (`docs/cowork-jev.md`); esto es distinto: lee **el texto exacto que saldría** junto a lo que escribió la otra persona y lo que vendes, y avisa en la tarjeta de aprobación si algo no calza. **Nunca bloquea**: la persona decide.

## Qué ve la persona

En la tarjeta de «Responder en el hilo» y en la de «Enviar correo»:

- Si encontró algo: un aviso con lo que hay que mirar (y que la revisión automática puede equivocarse). Por ejemplo, «Parece contradecir lo que escribió la persona: un día u horario que no ofreció, lo contrario de lo que pidió, o seguir escribiendo tras una baja».
- Si no encontró nada: «Revisado contra lo que escribió y tu oferta: sin contradicciones ni promesas nuevas».
- Si está apagado o Jev no respondió: nada. La tarjeta nunca dice que revisó si no revisó.

## Qué pregunta

`src/lib/cowork/email-review.ts`. Tres preguntas en inglés (el idioma donde Jev rinde más), sobre un estado en español con quién vende (nombre, empresa, oferta, servicios, pruebas), lo último que escribió la otra persona y el borrador:

| Pregunta | Qué busca | Se muestra |
|---|---|---|
| `contradicts_thread` | un día u horario que la persona no ofreció, lo contrario de lo que pidió, tomar interés por rechazo (o al revés), seguir escribiendo tras una baja | sí (0,80) |
| `invents_commitment` | un precio, plazo, descuento, función o cliente que no está en la oferta ni en la conversación | sí (0,80) |
| `ignores_question` | una pregunta directa sin respuesta | no: se mide, no se muestra |

Un primer correo (sin conversación) solo se revisa contra la oferta: `invents_commitment`.

## Calibración (35 respuestas inventadas, Jev real)

`scripts/fixtures/cowork-email-review-set.ts` (seis personas que escribieron: pregunta de precio, propuesta de horario, interés, baja, objeción, pregunta técnica; 12 respuestas correctas y 23 con un defecto conocido) y `scripts/calibrate-cowork-email-review.ts`:

| Pregunta | AUC | Falsos positivos a 0,80 | Defectuosas que caza a 0,80 | Umbral que no marca ninguna correcta |
|---|---|---|---|---|
| `contradicts_thread` | 1,00 | 0 de 25 | 9 de 10 | 0,53 (caza 10 de 10) |
| `invents_commitment` | 1,00 | 0 de 27 | 8 de 8 | 0,67 (caza 8 de 8) |
| `ignores_question` | 0,95 | 3 de 30 | 5 de 5 | 0,98 (caza 0 de 5) |

Latencia de Jev: p50 146 ms, p95 310 ms. `ignores_question` marca tres respuestas correctas a 0,80 y solo un umbral de 0,98 las limpia, que no caza ninguna: no tiene umbral y nunca se muestra (se sigue preguntando para medirla). Los otros dos entran con 0,80, más prudente que el mínimo limpio.

**Lo que esto no prueba:** son 35 textos escritos por mí, no correos reales; el AUC de 1,00 dice que las preguntas distinguen estos defectos cuando están claros, no cuánto fallarán con correos reales y ambiguos. Por eso se prende primero en modo sombra.

## Cómo se enciende (lo hace el mantenedor)

`COWORK_EMAIL_REVIEW=off|shadow|on` (sin valor, o con uno desconocido: `off`; Jev no se consulta). Necesita el secreto `TYPESAFE_API_KEY` que ya pide Jev en la revisión de la respuesta (`docs/cowork-jev.md`).

1. `shadow`: Jev lee cada correo que llega a una tarjeta y solo se registra una línea `[cowork.email_review] {…}` con las probabilidades, la latencia y el costo. **El texto del correo, el destinatario y la oferta no se registran.** Sirve para ver, con correos reales, cuánto marca y cuánto cuesta (unos 0,00002 USD por correo).
2. `on`: lo que encuentra sale en la tarjeta.

Falla abierto: sin clave, con un tiempo de espera de 1,5 s, un error HTTP o una respuesta ilegible, la tarjeta sale sin revisión. No hay migración.

## Dónde está en el código

- Lógica pura y preguntas: `src/lib/cowork/email-review.ts` (+ prueba).
- Modo, lectura y registro: `src/lib/server/cowork/email-review.ts` (+ prueba con un Jev de mentira).
- Tarjetas: `readCoworkReplyThreadPreview` (`reply-thread-effect.ts`) y `send-preview/route.ts` devuelven `review`; `EmailReviewNote` en `ReviewParts.tsx`, usada por `ReplyThreadReview` y `SendReview`. Pruebas: `scripts/test-cowork-reply-thread.mjs` (apagado, encendido, sin respuesta de Jev, y que el correo no llega a un registro) y `scripts/test-cowork-email-review-ui.mjs`.
