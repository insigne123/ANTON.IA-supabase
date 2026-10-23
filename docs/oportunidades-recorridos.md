# Oportunidades como la usa una persona: recorridos del administrador y del integrante

Fecha: 23 oct 2026. Banco: `npm run audit:journeys` (`scripts/visual-audit/journeys.mjs`), sobre la base simulada con el workspace completo
(`fixtures/opportunity-workspace.mjs`): 16 oportunidades en todas las etapas, una licitación con su informe, una que cierra mañana,
novedades y decisiones pendientes para cada persona. Nada sale a la red y ninguna escritura corre salvo las que cada recorrido permite.

## Qué se probó

Once recorridos (`journeys/opportunities.mjs`), cada uno una meta de verdad, con el computador y el teléfono:

| Persona | Meta | Clics |
|---|---|---|
| Administrador | Asignar una recomendada a Diego con su objetivo, sin salir de la lista | 4 (antes 5, y había que volver a la lista) |
| Administrador | Asignar desde la oportunidad ya abierta | 3 |
| Administrador | Responder la decisión que pidió un integrante (desde «Novedades») | 2 |
| Administrador | Marcar una oportunidad como presentada | 3 (antes 4: «Plan y tareas» y bajar hasta el final) |
| Administrador | Marcar un paso del informe como hecho | 1 |
| Integrante | Abrir lo más urgente y empezar a gestionarlo | 2 |
| Integrante | Reportar un bloqueo con su motivo | 1 |
| Integrante | Proponer no postular | 2 |
| Integrante | Marcar su oferta como presentada | 1 |
| Integrante (teléfono) | Ver y empezar lo urgente | 2 |
| Administrador (teléfono) | Ver el embudo y abrir una recomendada | 2 |

Todas terminan y dejan en la base lo que se pidió (etapa, equipo, objetivo, actividad). Ninguna deja la página con errores de consola ni
respuestas de error de la app.

## Lo que salió y lo que se arregló

1. **La etiqueta de cada etapa del embudo no se podía pulsar.** Era un texto suelto bajo el círculo: en el computador solo el círculo de
   64 px respondía, y quien pulsaba el nombre («Recomendadas») creía que la página no hacía nada. Ahora el círculo y su nombre son un solo
   botón. (El recorrido lo encontró: «Elijo la etapa Recomendadas» se quedaba esperando.)
2. **La etapa se cambiaba al final de «Plan y tareas».** Quien administra lee la etapa en la franja de arriba («Estado: En gestión») y
   tenía que adivinar que el cambio estaba en otra pestaña, abajo del todo. Ahora la franja trae «Cambiar etapa…» con las demás etapas.
3. **«Postular» seguía en las oportunidades ya presentadas, ganadas o perdidas.** Un consejo para una decisión ya tomada, junto al
   «Ganada» de al lado. Ahora no aparece una vez presentada o cerrada.
4. **Asignar obligaba a abrir cada oportunidad.** Las recomendadas decían «Asígnale un equipo para empezar» sin darte cómo; había que abrir
   la tarjeta, pulsar «Asignar equipo» y volver. Ahora la tarjeta trae «Asignar»: abre el mismo diálogo, con el nombre de la oportunidad,
   y al confirmar la tarjeta pasa a «Asignadas» sin salir de la lista. Con varias recomendadas, cada una cuesta 3 clics.

## Lo que se miró y está bien

- El integrante ve primero lo que cierra antes (ordenado por fecha de cierre) y cada paso hacia adelante es un botón en la franja de la
  oportunidad; el bloqueo y la decisión piden su motivo en un diálogo corto.
- Las decisiones pendientes suben a «Novedades» del administrador y se responden desde la propia oportunidad.
- El teléfono muestra las mismas etapas como lista y las tarjetas en una columna.
- La lista de las dos vistas, a 1440 y 390 px en tema claro, no tiene desborde horizontal ni violaciones serias o críticas de axe (`audit:visual`).

## Lo que queda

- La cabecera de la vista del administrador tenía cuatro bloques antes del embudo (estado de la oferta, novedades, «Antes de postular» y
  los filtros). **Hecho después (23 oct):** el estado de la oferta pasó de tarjeta a una línea con sus tres acciones («Qué buscamos»,
  «Ficha para licitaciones», «Actualizar oportunidades»), y «Antes de postular» de tarjeta a una línea que se despliega. Con la oferta
  por confirmar sigue la tarjeta, que ahí sí es la tarea. El embudo empieza 76 px más arriba a 1440 px (su título pasa de 675 a 599 px) y
  «Novedades», lo que el administrador tiene que atender, queda como la única tarjeta de arriba; los once recorridos terminan con los mismos
  clics y `audit:visual` no da hallazgos de accesibilidad ni de desborde en claro y oscuro, a 390 y 1440 px. Queda mover los filtros dentro
  del embudo, que es una decisión de diseño más grande.
- Cambiar de etapa a «Ganada» o «Perdida» no pide un motivo; para aprender qué se gana y qué no, convendría una línea opcional.

## Cómo repetirlo

```bash
npm run audit:journeys -- --file=scripts/visual-audit/journeys/opportunities.mjs
```

Cada corrida deja `journeys.md` con los clics y segundos por recorrido, una captura por paso, las verificaciones contra la base simulada y
los errores de la consola. Si un paso no se puede hacer, el recorrido queda «atascado» ahí: ese es el hallazgo.
