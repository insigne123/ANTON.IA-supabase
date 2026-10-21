# Oportunidades: estrellas de prioridad, estado de cada tarjeta y LinkedIn con información

**Fecha:** 21 de octubre de 2026.

## Por qué

- **Miles por mirar:** en producción «Por revisar» llegó a 1243 oportunidades y «No recomendadas» a 3660. Nadie revisa tantas una por una.
- **El puntaje estaba escondido:** cada oportunidad ya tiene un puntaje de 0 a 100 (palabras y códigos que calzan con la oferta, monto, región, días para cerrar y el veredicto de la IA). El servidor traía las 60 de más puntaje, pero la pantalla no lo mostraba y las reordenaba por días para cerrar.
- **Una pregunta de la persona:** «¿cuál miro primero?». La respuesta tiene que verse de un golpe de vista.

## Qué cambia

1. **Estrellas en cada tarjeta** (`PriorityStars.tsx`), de 1 a 5, arriba a la derecha de la tarjeta del Embudo y en la cabecera de la tarjeta de la Lista. Se leen como «4 de 5 estrellas: calza bien con tu oferta» (también en el texto emergente y para lectores de pantalla). No aparecen en las que la IA dejó fuera: ahí lo que importa es «Por qué no».
2. **Qué significan** (`priority.ts`, `PRIORITY_STEPS`):

   | Puntaje | Estrellas | Lectura |
   | --- | --- | --- |
   | 80 o más | 5 | Calza muy bien con tu oferta |
   | 65 a 79 | 4 | Calza bien con tu oferta |
   | 50 a 64 | 3 | Calza en parte: vale la pena revisarla |
   | 30 a 49 | 2 | Calza poco con tu oferta |
   | menos de 30 | 1 | Calza muy poco con tu oferta |

   Los cortes salen de lo que hay en producción (21 de octubre): lo que la IA recomienda puntúa entre 55 y 90 (la mitad, 80 o más); lo que pide revisar se reparte de 1 a 85 (mediana 35, una de cada veinte sobre 70); lo que deja fuera queda en 10 o menos. Así «Recomendadas» cae entre 3 y 5 estrellas y «Por revisar» se reparte, en su mayoría, entre 1 y 3.
3. **Dos formas de ordenar** en cada etapa del Embudo (cuando hay más de una tarjeta):
   - **Prioridad** (por defecto): primero las de más estrellas; con las mismas estrellas, las que cierran antes.
   - **Cierran antes:** primero las que cierran antes (las sin fecha, al final); con la misma fecha, las que mejor calzan.
4. **El orden se aplica en el servidor,** no solo sobre las tarjetas que ya llegaron: `readOpportunityPipeline` recibe `sort` (`priority` o `deadline`) y trae esa página de cada etapa. Así «Cierran antes» muestra de verdad las que cierran antes entre todas las de la etapa, no entre las 60 que tocaron por puntaje. Al cambiar el orden la paginación vuelve a la primera página, como con una búsqueda nueva. La API acepta `?sort=` y cualquier otro valor es «Prioridad».
5. **Manual de ayuda:** el paso de «Embudo» (`src/lib/help/manual.ts`) explica las estrellas y los dos órdenes. El manual se envía entero con cada pregunta y tiene un tope de 40.000 caracteres (`manual.test.ts`), con solo 10 de margen: para que cupiera se acortó ese párrafo y se quitó su última frase («Bajo cada nombre, la IA resume de qué se trata»), que sigue explicada en su pregunta frecuente.
6. **Texto de apoyo:** bajo el título de la etapa, «Las estrellas dicen qué tan bien calza cada una con tu oferta», y el aviso de lo que falta por mostrar dice cuál orden se usó («las de mayor prioridad» o «las que cierran antes»).

## Estado de cada tarjeta: «Investigando…», «Informe listo» y «Abierta hace…»

Antes, abrir una oportunidad, ponerla a investigar y volver al Embudo no dejaba rastro: la tarjeta era idéntica y la persona no sabía si ya la había mirado ni en qué iba el trabajo. Ahora cada tarjeta (Embudo y Lista) lleva marcas, siempre en este orden (`ProgressMarks.tsx`, `progress.ts`):

| Marca | Cuándo | Se ve como |
| --- | --- | --- |
| **Investigando…** | La investigación está en cola, corriendo o esperando | Azul, con un círculo que gira; el texto emergente dice desde cuándo |
| **Informe listo · hace 3 min** | Hay un informe guardado (o la investigación terminó) | Verde, con una marca |
| **Investigación fallida** / **detenida** | La investigación no terminó | Ámbar, con una alerta; invita a abrirla y reintentar |
| **Abierta hace 1 min** (o «recién», «ayer») | La persona la abrió desde este navegador | Gris, con un ojo |

- **Lo del servidor:** `readOpportunityPipeline` lee `opportunity_jobs` (tipo `research`) y `opportunity_reports` de la organización (hasta 600 filas) y arma, solo para las tarjetas que devuelve, `progress[id] = { research, researchAt, reportAt }` (`buildProgress`). Si esa lectura falla, el Embudo sigue igual, sin marcas.
- **Lo del navegador:** «Abierta hace…» se guarda en `localStorage` por persona (`anton:opportunities-opened:<usuario>`, hasta 400 oportunidades, solo las más recientes). No viaja al servidor ni se comparte con el equipo: es para no confundirse al volver, no un registro de actividad.
- **Se mantiene al día:** mientras alguna tarjeta diga «Investigando…», la pantalla recarga el Embudo cada 15 s (hasta 120 veces) y la marca pasa sola a «Informe listo». Los tiempos relativos se refrescan cada minuto.
- **Accesible:** cada marca es texto, no solo color ni ícono.

## Oportunidades de LinkedIn con información

Las tarjetas de «Actividad de contratación» se veían con barras grises en lugar de texto. La causa: ninguna tenía resumen. El resumen lo escribe un trabajo de IA que procesa 24 por vuelta, ordenado por la fecha de cierre más cercana, y las señales de LinkedIn no tienen fecha de cierre: quedaban siempre al final de la fila. Además, la pantalla mostraba el esqueleto gris sin límite mientras esperaba.

- **Línea inmediata** (`fallbackLine` en `summaries.ts`), solo para avisos de contratación y publicaciones de LinkedIn: el primer motivo de la evaluación (si no es el «Pendiente de evaluación» ni repite el título), o, si no hay, «Busca A y B.» / «Busca A, B y N más.» con los cargos de los avisos. En publicaciones, el texto de la publicación. Nunca inventa: usa lo que la tarjeta ya sabe.
- **«N avisos»:** un chip con la cantidad de avisos de contratación observados.
- **Sin esqueleto eterno:** cuando se acaban los 5 minutos de espera del resumen, la tarjeta deja de mostrar barras grises (`summariesStalled`).
- **Licitaciones:** siguen con su resumen de IA y su esqueleto mientras llega.
- **Queda pendiente (no se tocó):** el orden y la velocidad del trabajo de resúmenes para las señales sin fecha; la línea inmediata lo cubre mientras tanto.

## Qué no cambia

- **El puntaje:** no se recalcula; solo se muestra. Si mañana cambia la forma de calcularlo, las estrellas lo siguen sin tocar la pantalla (solo `PRIORITY_STEPS` si cambia la escala).
- **El orden de la Lista:** conserva el suyo; ahí las estrellas son solo una ayuda a la vista.
- **Qué etapa tiene cada oportunidad:** «Por revisar» y «Recomendadas» siguen dependiendo del veredicto de la IA, no de las estrellas.

## Pruebas

- **`src/lib/commercial-opportunities/priority.test.ts`:** los cortes (80, 65, 50, 30), un puntaje roto o fuera de escala, el texto de cada nivel, el orden por prioridad y por fecha (con empates y sin fecha) y el valor de `sort` desconocido.
- **`src/components/commercial-opportunities/pipeline-ui.test.ts`:** estrellas y su texto en cada tarjeta, ninguna en las que la IA dejó fuera, el orden en pantalla, los dos botones con su estado y su ayuda, el texto de «Se muestran N de M», y que con una sola tarjeta no se ofrezca ordenar.
- **`src/lib/server/commercial-opportunities/workspace-pipeline.test.ts`:** cada página se pide por puntaje o por fecha de cierre (sin fecha al final) y un orden desconocido es el normal.

- **`src/lib/commercial-opportunities/progress.test.ts`:** unir trabajos e informes por oportunidad (el más reciente de cada uno), los textos de cada marca, el almacenamiento de «abierta» (valores rotos, tope de 400).
- **`src/lib/commercial-opportunities/summaries.test.ts`:** la línea inmediata de contratación y de publicaciones.
- **`pipeline-ui.test.ts` y `workspace-pipeline.test.ts`:** las marcas en las tarjetas, la línea y el chip de avisos de LinkedIn, y que la lectura del progreso no rompa el Embudo si falla.

## Código

| Pieza | Archivo |
| --- | --- |
| Cortes, textos y orden (puro) | `src/lib/commercial-opportunities/priority.ts` |
| Estrellas | `src/components/commercial-opportunities/PriorityStars.tsx` |
| Embudo: estrellas, botones de orden y orden en pantalla | `src/components/commercial-opportunities/PipelineBoard.tsx` |
| Pantalla: orden elegido y paginación | `src/components/commercial-opportunities/OpportunityWorkWorkspace.tsx` |
| Lectura del Embudo con orden | `src/lib/server/commercial-opportunities/workspace-pipeline.ts` |
| API | `src/app/api/commercial-opportunities/workspace/route.ts` (`?sort=`) |
| Estado de las tarjetas (puro) | `src/lib/commercial-opportunities/progress.ts` |
| Marcas de la tarjeta | `src/components/commercial-opportunities/ProgressMarks.tsx` |
| Línea de LinkedIn | `fallbackLine` en `src/lib/commercial-opportunities/summaries.ts` |
