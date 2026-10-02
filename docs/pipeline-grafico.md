# Pipeline gráfico (Plan 5, PR-10b)

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
- **DOM:** `scripts/test-pipeline-flow-ui.mjs`.
