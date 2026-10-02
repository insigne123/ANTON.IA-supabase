# Cowork ve «Por escribir» (Plan 6, PR-A)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`, págs. 9 y 10)

Cowork decía que los contactos no tenían LinkedIn, aunque la app sí los mostraba.

**La causa:** Cowork leía solo los contactos guardados (`leads`). Al buscar el correo desde Buscar, la persona queda directo en «Por escribir» (`enriched_leads`), con el LinkedIn del proveedor.

**En producción (2 oct, solo lectura):**
- hay 326 contactos en «Por escribir» y 238 tienen LinkedIn;
- solo 4 están ligados a un contacto guardado;
- de los guardados de los últimos 60 días, solo 15 de 406 tienen LinkedIn.

Lo mismo dejaba incompleto «Revisa mis leads» (puntos 17 y 18): los contactos con correo de «Por escribir» no se contaban.

## Qué cambia

- **Lecturas** (`leads.search`, `leads.get`, `leads.count` y `leads.summary`): leen los contactos guardados y los de «Por escribir».
  - **Cada persona aparece una vez.** Si un contacto de «Por escribir» está ligado a uno guardado (por `data.sourceSavedLeadId` o por el mismo correo), completa su correo y su LinkedIn en vez de repetirlo.
  - **Cada contacto dice de dónde viene:** `source: saved` o `source: enriched` («Por escribir»).
  - **El resumen y el conteo muestran ambas listas** (`sources` y `bySource`).
  - **Si «Por escribir» no se puede leer,** responden los guardados y el resultado lo dice.
- **Acciones con contactos de «Por escribir»:**
  - invitación y mensaje de LinkedIn, sueltos y en lote;
  - investigación;
  - borradores desde la investigación;
  - «Preparar contactos», donde solo se les investiga, porque ya tienen correo.

  Las campañas ya los aceptaban (`loadAudience` incluye «Por escribir»).
- **Instrucciones de Cowork:** un contacto de «Por escribir» sirve igual que uno guardado y no se vuelve a guardar.

## Sin migración

Los ids de «Por escribir» ya son uuid, igual que los de los contactos guardados, así que las propuestas de LinkedIn (`lead_id uuid`) los admiten.

## Pruebas

- **`lead-tools.test.ts`:**
  - la búsqueda junta las dos listas, sin repetir a nadie y con el LinkedIn;
  - el filtro de «Por escribir» es seguro;
  - lectura por id;
  - falla de una fuente;
  - resumen y conteo con las dos listas.
- **`scripts/test-cowork-linkedin-jobs.mjs`:** una invitación a un contacto de «Por escribir», y el rechazo a uno de otra organización.
- **Ajustadas:** las pruebas del lote de LinkedIn, «Preparar contactos» y el contexto de decisión.
