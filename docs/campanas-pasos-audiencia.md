# Campañas: pasos claros, audiencia en tabla y qué pasa al aprobar (Plan 6, PR-D1)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`, pág. 10)

Punto 28: la campaña manual necesitaba una revisión completa y una pantalla más clara. En `BulkCampaignWorkspace` (activa en producción con `BULK_CAMPAIGNS_ENABLED`):
- los pasos eran texto («1. Audiencia 2. Correos 3. Revisión»), sin decir cuál estaba hecho ni permitir volver;
- la audiencia era una lista de casillas, sin columnas: nombre, empresa, cargo y estado iban en una sola línea;
- la revisión resumía la aprobación en una frase gris al pie;
- el conteo decía «1 resultados».

## Qué cambia

- **Pasos** (`CampaignSteps`):
  - cada paso dice si está hecho, es el actual o falta, también para lectores de pantalla;
  - el actual lleva `aria-current="step"`;
  - un paso hecho se puede abrir de nuevo («Volver a Audiencia») mientras la campaña no esté aprobada ni pausada, ni en edición de pendientes.
- **Audiencia en tabla** (`CampaignAudienceTable`):
  - columnas: persona y correo, empresa y cargo, estado;
  - una persona que no se puede contactar sigue a la vista, con el motivo en ámbar, sin casilla activa;
  - los encabezados llevan `scope="col"`;
  - el conteo dice «1 resultado · 1 seleccionado (máximo 100) · 2 no disponibles en esta página»;
  - en pantallas angostas la tabla se desplaza dentro de su recuadro, no la página.
- **Revisión:**
  - un resumen: destinatarios, correos por persona y correos en total;
  - una caja «Qué pasa al aprobar» con los pasos en simple: nada sale antes, se aprueba de una vez, cómo salen los primeros correos (solos o desde la página, según la automatización), los seguimientos se detienen si la persona responde y la campaña se puede pausar.

## Pruebas

- **`src/lib/bulk-campaigns.test.ts`:** el estado de cada persona en una línea; el bloqueo gana sobre los motivos.
- **`scripts/bulk-campaign-browser.test.mjs`:** la campaña manual de punta a punta en Chromium, en claro y oscuro:
  - audiencia con IA y con filtros;
  - perfiles guardados;
  - secuencia con IA;
  - edición individual;
  - rechazo, aprobación y edición de pendientes;
  - historial;
  - sin desborde de 320 a 1440 px;
  - foco con teclado.

  Ahora verifica también la tabla, el paso hecho que se puede reabrir y la caja «Qué pasa al aprobar». Con `PLAYWRIGHT_MODULE` y `PLAYWRIGHT_EXECUTABLE` corre fuera del equipo del mantenedor; con `CAMPAIGN_SCREENSHOT_DIR` deja capturas de la audiencia, los correos y la revisión.
