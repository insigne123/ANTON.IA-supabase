# Pipeline: panel tipo CRM (Plan 11, PR 4a)

El usuario pidió que el Pipeline se viera como un CRM, con la referencia de un panel de Zoho: cifras con comparación, donas por etapa, barras por período con una línea de referencia y una línea de tendencia. La vista «Gráfico» del Plan 5 era un flujo en línea; **«Panel»** la reemplaza y sigue siendo la vista por defecto. «Tablero» no cambia.

## Qué muestra

- **Filtros en una fila**, arriba de todo:
  - período: 7, 30 o 90 días, o el último año;
  - responsable;
  - origen: guardados, enriquecidos, contactados u oportunidades.

  Todo lo de abajo usa el mismo recorte. El período elegido se recuerda en el navegador.
- **Lectura:** hasta tres frases calculadas, sin IA:
  - los contactos del período contra el anterior;
  - la tasa de respuesta contra la anterior;
  - la etapa con más leads sin movimiento hace más de 14 días, con un botón para verlos.
- **Cifras:**
  - abiertos;
  - leads nuevos y contactados, con su diferencia contra el período anterior del mismo largo;
  - tasa de respuesta, de quienes se contactaron en el período, con la diferencia en puntos;
  - en reunión o más;
  - % ganados, con ganados y perdidos.

  La flecha ↑↓ siempre va con el número escrito, nunca solo el color.
- **Pipeline abierto por etapa:** una dona con las 6 etapas abiertas. Al centro va el total; la leyenda trae la cantidad, el %, «N por confirmar» si hay sugerencias pendientes y un clic para ver los leads.
- **Avance por etapa:** cuántos llegaron a cada etapa y qué parte siguió a la siguiente. Los perdidos van aparte.
- **Contactos por mes**, de los últimos 6:
  - barras;
  - la línea de referencia es **automática**: el promedio de los 3 meses anteriores;
  - el tooltip trae los contactados, los que respondieron y la tasa.
- **Leads nuevos, últimos 13 meses:** una línea con tooltip.
- **«Ver como tabla»** en cada gráfico: los mismos datos en una tabla, accesible sin el mouse.
- **Automático:**
  - se vuelve a leer cada minuto mientras la pestaña está visible, y al volver a ella;
  - no recarga mientras alguien mueve un lead o decide sugerencias;
  - dice «Actualizado hace N min».

## Datos y límites

- Las fechas que se comparan son reales:
  - la creación del lead;
  - el envío del primer correo (`sentAt`);
  - la respuesta (`repliedAt`).

  Este PR agrega `sentAt` y `repliedAt` a las filas de conversaciones, y usa el envío como fecha de creación de una conversación, que antes quedaba vacía.
- **La etapa es una foto de hoy.** Para comparar ganados o reuniones por período hace falta el historial de etapas (`crm_stage_events`, PR 4b). El valor de cada negocio (ingreso esperado, ganado y donas por monto) llega en 4c, detrás de `CRM_DEAL_VALUES_ENABLED`.
- **Colores de las etapas:** `--pipeline-stage-1..6`, pasos del azul primario de claro a oscuro (en modo oscuro, de tenue a brillante). Pasan las pruebas de rampa ordinal del validador dataviz:
  - luminosidad monótona;
  - pasos visibles;
  - el extremo claro sobre 2:1.

  Ganado usa `--cw-success`.

## Archivos

- `src/lib/pipeline-dashboard.ts` y sus pruebas: la lógica, pura.
- `src/components/crm/PipelineDashboard.tsx`: el panel.
- `src/app/(app)/crm/page.tsx`: «Panel» y «Tablero», con la actualización automática.

## Pruebas

- **Unitarias:** `src/lib/pipeline-dashboard.test.ts`.
- **DOM:** `scripts/test-pipeline-dashboard-ui.mjs`, que corre dentro de `scripts/verify-cowork.mjs` y reemplaza a `test-pipeline-flow-ui.mjs`.

---

# Antes: Pipeline gráfico (Plan 5, PR-10b)


## Problema (prueba del 1 oct, `Pruebas_de_app.docx`)

El pipeline era solo un Kanban. No decía de un vistazo:
- cuántos leads hay en cada etapa;
- cuántos avanzan;
- cómo va la semana.

El usuario pidió un pipeline gráfico, como la imagen de referencia.

## Qué cambia

**Pipeline** tiene dos vistas, y la elección se recuerda:
- **«Gráfico»**, la vista por defecto;
- **«Tablero»**, el Kanban de siempre, para mover leads.

**Cifras arriba:**
- **Activos:** los que no están cerrados, sobre el total del pipeline.
- **Tasa de respuesta:** de quienes llegaron a Contactado, cuántos llegaron a Interesado o más.
- **Llegaron a reunión:** reunión, negociación o ganado.
- **Ganados**, con los perdidos al lado.

**Avance por etapa:**
- **Un nodo por etapa:** Nuevos → Calificado → Contactado → Interesado → Reunión → Negociación → Ganado. Cada uno trae su cantidad y una barra proporcional.
- **Entre nodos:** el porcentaje de quienes llegaron a una etapa y siguieron a la siguiente.
- **«Perdido»** va aparte, porque puede pasar en cualquier etapa.
- **Al pasar el mouse o el foco:** los 5 leads más recientes de esa etapa, bajo el flujo. No flota, así que no se corta en el celular.
- **Al tocar una etapa:** un panel con todos sus leads. Tocar uno abre su detalle.

**Contactos nuevos por semana:**
- las últimas 8 semanas, de lunes a domingo;
- tooltip con la cifra exacta;
- una tabla para lectores de pantalla.

**Diseño:**
- solo los tokens de la paleta (`primary`, `muted`, `card`, `popover`), con la misma jerarquía en claro y en oscuro;
- revisado a 1280 y a 390 px, sin desborde horizontal de la página. En el celular el flujo se desplaza de lado.

## Fuera de este PR

- **Sugerencias de etapa:** llegan en PR-10a (`docs/pipeline-sugerencias.md`), que además marca en cada etapa del gráfico los cambios por confirmar.
- **Días por etapa:** no hay historial de cambios de etapa, solo la etapa actual. Las sugerencias decididas de PR-10a darán ese historial.

## Pruebas

- **Unitarias:** `pipeline-flow.test.ts`.
- **DOM:** `scripts/test-pipeline-flow-ui.mjs`, retirada en el Plan 11 junto con la vista.
