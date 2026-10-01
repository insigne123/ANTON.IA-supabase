# Cowork · revelar el teléfono de un contacto (apagado por defecto)

Brecha 5 del banco AXIS (`docs/cowork-banco-axis.md`, F1 y A4): revelar un teléfono estaba apagado en Cowork (`revealPhone: false` en todas partes). Es la **única acción de Cowork con un precio por persona**: diez créditos del proveedor, el mismo costo que la app muestra para un teléfono. Por eso va con más cuidado que las demás.

## Qué ve la persona

1. «Necesito el teléfono de Paula Ríos». Cowork la busca entre los contactos guardados y deja **una tarjeta**: quién es, **lo que cuesta (10 créditos)**, lo que queda de saldo (con la antigüedad del dato, si ya es viejo) y que al aprobar se pide **un solo** teléfono al proveedor. El botón dice cuánto gasta: «Aprobar y gastar 10 créditos».
2. Si el saldo no alcanza, la tarjeta lo dice y no deja aprobar. Si el saldo no se puede leer, lo dice y el proveedor decide.
3. Con varias personas, Cowork propone **la primera por su nombre** y dice que cada una cuesta 10 créditos y lleva su propia aprobación: nunca un lote de teléfonos ni un total que nadie pidió.
4. El proveedor entrega el teléfono **más tarde**, por el webhook que la app ya tiene (el mismo callback del correo y del enriquecimiento de la app), y queda en los **contactos enriquecidos**. Cowork nunca escribe un número que no vio, ni dice que ya lo tiene, ni promete que habrá uno.
5. La tarjeta recuerda que ANTON.IA no verifica que haya una base legal para contactar a esa persona por teléfono; a quien pregunta si es legal llamar, Cowork le responde con `compliance.law`, con sus fuentes.

## Cómo funciona

- **Efecto `enrich_phone`**, acción `lead.enrich_phone` con `leadId` de un contacto leído en el hilo. No se repite en un mismo hilo (gastaría otros 10 créditos por la misma respuesta).
- **Sin tabla de staging.** El destino aprobado es `enrichphone:<contacto>:<hash>`, con el hash de **quién muestra la tarjeta** (nombre, empresa, LinkedIn, id del proveedor) y el costo. La tarjeta y la aprobación leen el contacto de nuevo y se niegan si cambió.
- **Ejecución** (`src/lib/server/cowork/enrich-phone.ts`), en este orden y sin pasar al proveedor ante la primera negativa: flag encendido; autorización vigente (propuesta en ejecución, mismo destino, trabajo esperando aprobación); mismo contacto; acceso a créditos; **saldo suficiente** según la última lectura (si dice que no alcanza, no se pide); que no exista ya un pedido de este contacto en este trabajo; cupo diario de enriquecimiento. Recién ahí crea la fila pendiente en los contactos enriquecidos y el callback del proveedor, y pide **solo el teléfono** (`revealEmail: false`, `revealPhone: true`) con la URL del webhook. Un fallo antes del proveedor devuelve el cupo; uno después queda para el conciliador compartido y avisa que repetir podría gastar más créditos.
- Reutiliza las mismas piezas del enriquecimiento por correo (cupo, callback, conciliación) sin tocar ese camino.

## Cómo se enciende (lo hace el mantenedor)

1. Aplicar la migración `20260930170000_cowork_retry_phone_effects.sql` (agrega `enrich_phone` al check de propuestas y a `cowork_propose_effect`; viene en #70).
2. Que el webhook del proveedor esté configurado en el entorno (el mismo que ya usa el enriquecimiento de la app).
3. `COWORK_PHONE_REVEAL_ENABLED=true`. Es también el interruptor que detiene un pedido ya aprobado.
4. **Prueba de humo con créditos reales (diez por teléfono):** con una cuenta de prueba y un contacto propio, pedir un teléfono desde Cowork y comprobar que la fila llega a «Contactos enriquecidos» con su número. Cada prueba gasta 10 créditos; no hay forma de probar el webhook fuera de un entorno con URL pública.

## Banco y medición

`scripts/fixtures/cowork-telefono-corpus.ts` (+ `scripts/cowork-telefono-corpus.test.ts`, con modelo guionado y mutaciones): una persona; varias personas (una sola propuesta); y lo mismo con el flag apagado (explica y ofrece el correo o LinkedIn). El servidor se prueba con tablas, cupo, callback y proveedor en memoria en `scripts/test-cowork-enrich-phone.mjs` (en `verify-cowork`): cada rechazo no llama al proveedor y no deja filas, y la solicitud aprobada pide un solo teléfono con la URL del webhook. **Lo que no se probó:** el proveedor y su webhook reales; nada de lo anterior gasta un crédito.

**Con el modelo real** (gpt-6-luna, el bucle y las herramientas del banco, 5 corridas de cada uno de los 3 casos; sin Redactora ni jueza en el turno): 14 de 15 corridas pasan todas las verificaciones y 164 de 165 verificaciones. La que falló es una corrida de «varias personas» que no dijo que cada una lleva su propia aprobación. Es una muestra chica: sirve para ver que el flujo se entiende y que el caso sin flag no cambia de canal por su cuenta, no para fijar una tasa.
