# Cowork · reintentar los envíos fallidos de una campaña (apagado por defecto)

Brecha 8 del banco AXIS (`docs/cowork-banco-axis.md`, D4): Cowork leía qué envíos se podían reintentar (`campaigns.retry_review`) pero el reintento no estaba entre sus efectos. Ahora lo propone, con su tarjeta de aprobación.

## Qué ve la persona

1. «Reintenta los envíos que fallaron de la campaña X». Cowork lee la revisión de reintentos y, si hay algo reintentable, deja **una tarjeta**: la campaña, cuántos envíos vuelven a la cola, a quién y por qué falló cada uno.
2. La respuesta dice cuántos se reintentan y, aparte, cuántos **no entran** y por qué: los terminales (la casilla no existe) y los inciertos (no se confirmó si salieron: se concilian en Contactados antes de repetirlos, nunca a ciegas).
3. Aprobar **no envía nada en ese momento**: los envíos vuelven a la cola del emisor de la campaña, que aplica los frenos de siempre (cupo, una empresa por día, quien ya respondió o se dio de baja) y los manda con la clave que impide que un mismo borrador salga dos veces. Cowork no promete «salen hoy».
4. Si no hay nada reintentable, lo dice y no propone nada.

## Cómo funciona

- **Efecto `campaign_retry`**, acción `campaign.retry` con `campaignId`. Solo se acepta si la campaña se leyó con `campaigns.retry_review` en este hilo y su `summary.retryable` es mayor que 0: lo decide el código, no el modelo.
- **Sin tabla de staging.** El destino aprobado es `campaignretry:<campaña>:<hash>`, con el hash de **exactamente los borradores que listó la tarjeta**. La tarjeta y la aprobación vuelven a listar lo reintentable desde la base y se niegan si ya no es la misma lista (un fallo nuevo después de la propuesta no entra en lo aprobado: se pide una propuesta nueva). Hasta 50 envíos por tarjeta.
- **Ejecución** (`src/lib/server/cowork/campaign-retry.ts`): verifica que el flag esté encendido, que la autorización siga vigente (propuesta en ejecución, mismo destino, trabajo esperando aprobación) y que la lista no cambió; luego llama, uno por borrador, a `retry_bulk_campaign_attempt_v1`, la función que ya usa «Reintentar» de la campaña y que se niega sola ante un estado que no es seguro reintentar. Un borrador que la base rechaza no detiene a los demás, y la respuesta lo nombra sin las palabras de la base.
- **Solo la lista reintentable**: `listCoworkRetryableTouches` (`batch-reads.ts`) usa el mismo veredicto que `campaigns.retry_review` (`classifySendRetry`) y deja fuera lo enviado, lo planificado, lo terminal y lo incierto.

## Cómo se enciende (lo hace el mantenedor)

1. Aplicar la migración `20260930170000_cowork_retry_phone_effects.sql` (agrega el tipo `campaign_retry` al check de propuestas y a la lista de `cowork_propose_effect`; viene en #70).
2. `COWORK_CAMPAIGN_RETRY_ENABLED=true`. Es también el interruptor que detiene un reintento ya aprobado.

Sin la migración, proponer falla al registrar la propuesta; con el flag apagado (el estado de hoy) Cowork lee y explica, pero no propone, y dice que el reintento se hace desde la campaña.

## Banco y medición

`scripts/fixtures/cowork-reintento-corpus.ts` (+ `scripts/cowork-reintento-corpus.test.ts`, con modelo guionado y mutaciones): reintentar una campaña con tres reintentables, uno terminal y uno incierto; no hay nada que reintentar; y el mismo pedido con el flag apagado. Pruebas de servidor con tablas en memoria en `scripts/test-cowork-campaign-retry.mjs` (en `verify-cowork`): cada rechazo reintenta cero, y la ejecución aprobada llama una vez por borrador.
