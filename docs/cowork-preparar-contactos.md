# Cowork: preparar contactos en una sola aprobación (1 oct)

**Problema (prueba del 1 oct, `Pruebas_de_app.docx`):**
- Cowork pedía una aprobación por persona y por paso (guardar, buscar el correo, investigar).
- Cada aprobación encadenaba otro paso y acercaba el límite del hilo.
- Proponía guardar a alguien que ya estaba guardado desde el panel.
- Las tablas traían personas de más, porque buscaba a las personas por texto.

## Qué cambia

1. **Un lote para varias personas: `contacts.prepare_batch`** (efecto `lead_prepare_batch`). Lleva un objetivo:
   - **save:** guardarlas;
   - **email:** guardarlas si falta y buscar su correo (1 crédito por persona);
   - **research:** además, investigarlas. Sin correo buscado no se investiga, así que el lote lo busca antes.

   Las personas son resultados de búsqueda (`providerId`) o contactos guardados (`leadId`) que la conversación ya vio. Admite hasta 50 para guardar y 10 para correo o investigación.
2. **Solo lo que falta:** antes de proponer, el servidor lee el estado real de cada persona y salta lo hecho. Revisa si ya está guardada, si su correo ya está o ya se buscó (por cualquier camino) y si tiene una investigación hecha o en curso.
   - Nada se cobra dos veces.
   - Si a nadie le falta nada, no hay tarjeta: Cowork sigue con el paso siguiente sin pedir aprobación.
3. **Las acciones de a una también revisan:** guardar, buscar correo o investigar a alguien que ya lo tiene vuelve al modelo con «ya está hecho», en vez de pedir una aprobación inútil (`coworkEffectAlreadyDone`).
4. **La tarjeta** (`PrepareBatchReview`) muestra:
   - a cada persona, con sus pasos (lo hecho aparece como hecho);
   - quiénes ya estaban listos;
   - el costo de quienes quedan y el saldo de créditos;
   - un botón para quitar a alguien antes de aprobar.

   Al aprobar se ejecuta persona por persona: guardar, buscar el correo e investigar.
   - Un cupo agotado detiene ese paso para el resto y lo dice.
   - Una investigación sin correo buscado no se pide.
   - El trabajo se corta a los 75 s y avisa qué faltó, sin pagar dos veces al repetirlo.
5. **El resultado por persona:** nombre real, correo con su estado, LinkedIn e investigación (del PR-1 en adelante).
   - Cowork continúa con una tabla de esas mismas personas, tomadas del resultado y no buscadas de nuevo por nombre.
   - Esas son «las personas de este trabajo».
6. **Guardar desde el panel queda en el hilo:** evento `contact.saved`. El historial lo muestra como acción hecha y el lote lo reconoce.
7. **Una búsqueda de correo hecha desde la app también cuenta para investigar.** «Buscar correo» de «Por completar» liga el resultado a la persona por el id del proveedor, no al contacto guardado.
   - Antes, Cowork pedía buscar el correo de nuevo. Ahora lo reconoce y la investigación usa ese correo (`start-research.ts`).
   - Una investigación «parcial» cuenta como hecha. Repetirla queda para el PR de investigación (Plan 5, PR-5).

## Piezas

- **Reglas puras:** `src/lib/cowork/prepare-batch.ts` (qué falta, costo, etiqueta, hash y resumen).
- **Servidor:** `src/lib/server/cowork/prepare-batch.ts` (preparar, vista previa y quitar personas) y `prepare-batch-run.ts` (ejecutar; aparte para que el worker no cargue el código del proveedor ni de investigación).
  - Reutiliza `insertCoworkContact`, `enrichCoworkSavedLead` y `startCoworkResearchForLead`, con las mismas reglas, cupos e ids de operación que la acción individual.
- **Ruta:** `GET/POST /api/cowork/runs/[id]/preparebatch`.
- **Migración `20261001210000_cowork_prepare_batch.sql`:** enseña el tipo nuevo a la tabla de lotes, a la tabla de propuestas y a `cowork_propose_effect`.
  - Reutiliza `cowork_batch_proposals` y su guardia: una persona una vez, sin mensajes, lista fija y quitar solo antes de decidir.
- **Apagado de emergencia:** `COWORK_PREPARE_BATCH_ENABLED=false`. Está encendido por defecto.

## Pruebas

- `src/lib/cowork/prepare-batch.test.ts`: personas válidas, pasos que faltan, plan, etiqueta, hash y resumen.
- `src/lib/cowork/agent-loop.test.ts`: la propuesta, su origen y los rechazos con motivo.
- `scripts/test-cowork-prepare-batch.mjs`:
  - solo personas vistas y propias;
  - salto de lo hecho, y «nada que hacer»;
  - acciones individuales que dicen «ya está hecho»;
  - quitar personas;
  - ejecución con nombre real;
  - cupos;
  - aprobación fijada.
- `scripts/test-cowork-prepare-batch-card.mjs`: DOM de la tarjeta y del resultado.
- `supabase/tests/database/cowork_prepare_batch.test.sql`: el tipo nuevo en la tabla, en la propuesta y en la guardia.
