# Campañas: la revisión, persona por persona (Plan 6, PR-D2)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`, págs. 8 a 10)

Puntos 19, 21 y 28: en la campaña había que ver a quién le llega cada correo y revisarlo antes de aprobar. En la revisión de la campaña manual (`BulkCampaignWorkspace`):
- las personas estaban escondidas en un desplegable, «Vista previa por destinatario»: no se veía de un vistazo quién estaba en la campaña;
- no se distinguía a quién se le había editado un correo solo para él.

## Qué cambia

- **Lista de personas**, a la izquierda en pantallas anchas y arriba en el teléfono:
  - nombre y correo de cada una;
  - la marca «Editado para esta persona» cuando tiene un correo propio;
  - la persona elegida va resaltada y lleva `aria-current`.
- **Sus correos tal como los recibirá**, al lado: el primero y cada seguimiento, con su asunto, su texto y cuántos días después sale. Arriba, los botones para editarlos solo para ella, a mano o pidiendo el cambio a la IA, como antes.
- **Mientras se edita a una persona**, la lista no cambia de persona: no se pierde la edición.

## Pruebas

`scripts/bulk-campaign-browser.test.mjs` (Chromium, claro y oscuro):
- tras guardar la edición individual aparece «Editado para esta persona» y la persona queda elegida;
- el foco con teclado parte desde la persona de la lista;
- sin desborde de 320 a 1440 px.

Con `CAMPAIGN_SCREENSHOT_DIR` deja la captura de la revisión por persona.
