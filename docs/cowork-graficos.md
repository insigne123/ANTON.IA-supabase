# Cowork · Gráficos de lo que consultó (29 sep 2026)

Tercer PR de la Ola G del plan 2 de Cowork (punto G3). Cuando Cowork responde con las cifras de una consulta de métricas o de una campaña, bajo la tarjeta de cifras aparece un **gráfico** de esos mismos datos: barras que crecen desde la base la primera vez que se ven, con su leyenda, su descripción para lectores de pantalla y su descarga en CSV. El gráfico lo dibuja la app con lo que Cowork leyó; el modelo no lo escribe. Sin consultas con qué dibujar (por ejemplo, sin envíos), no hay gráfico.

## Qué cambia para el usuario

- **Bajo las cifras, un gráfico de lo mismo:**
  - «¿Cómo voy?» (`metrics.rates`): «Correos enviados y lo que volvió», con enviados, respuestas, positivas y rebotes de los últimos 7 días junto a los de 30;
  - correo y LinkedIn (`metrics.channels`): enviados y respuestas de cada canal;
  - cómo le fue a una campaña (`campaigns.batch_report`): enviados, pendientes, fallidos y por confirmar.
- **Se entiende sin explicación:** título y período arriba, leyenda con la serie de cada color, el valor sobre cada barra y el nombre debajo. Los colores son los de la app (el acento y dos grises que conservan su contraste sobre la tarjeta), en claro y oscuro.
- **Se ve aparecer:** las barras crecen desde la base, una tras otra, y los números cuentan hacia arriba, solo la primera vez que el gráfico aparece mientras miras. Un turno guardado, o con «reducir movimiento», ya trae todo dibujado.
- **Se puede llevar:** «Copiar datos» (pega como tabla en una hoja de cálculo) y «Descargar CSV» (desde F3, «Descargar» ofrece Excel o CSV: ver `cowork-crear-archivos.md`).
- **Sin gráfico si no hay nada que mostrar:** sin envíos, o si la consulta no trajo todas las cifras, la respuesta sale solo con su tarjeta de cifras.
- **Accesible:** el dibujo se oculta a los lectores de pantalla, que reciben una frase («Correos enviados y lo que volvió, Últimos 7 y 30 días. 4 puntos y 2 series. Últimos 7 días: mayor en Enviados (40)…») y la tabla de valores.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Tarjeta `chart` (título, `kind` de barras o línea, período, unidad, hasta 24 puntos y 3 series) | `coworkChartBlockSchema` en `src/lib/cowork/contracts.ts` y su limpieza en `coworkBlocks` (`answer-quality.ts`) |
| De qué consulta sale cada gráfico y cuándo no hay | `coworkChartCandidates` en `src/lib/cowork/charts.ts` |
| Cuál va con la respuesta y dónde | `coworkWithCharts` en `charts.ts`, aplicada a toda respuesta por `runCoworkReadLoop` (`agent-loop.ts`) |
| Texto, CSV y frase para lectores de pantalla | `coworkChartRows`, `coworkChartCsv`, `coworkChartSummary` y `coworkChartValue` en `blocks.ts` |
| Interfaz | `ChartBlock` en `CoworkBlocks.tsx`; `CoworkTurn.tsx` lo muestra bajo las cifras |

- **El modelo no escribe gráficos.** Un bloque `chart` que el modelo entregue se descarta, sin mirar sus cifras: solo vale lo que sale de las consultas. La regla 11 del coordinador dice que la app dibuja sola el gráfico bajo un bloque `metrics`.
- **Cuándo se agrega:** solo si la respuesta trae una tarjeta de cifras (`metrics`), la consulta de la que sale tiene datos y quedan menos de 4 tarjetas. Va justo después de la última tarjeta de cifras.
- **Cuál, si hay varias consultas:** el de la consulta cuyas cifras repite la tarjeta (se comparan los números de la tarjeta con los del gráfico); si empatan, el de la primera consulta. Siempre uno solo por respuesta.
- **Sin consultas con qué dibujar:** las series salen con todas sus cifras o el gráfico no sale. Un turno sin envíos no dibuja barras vacías.
- **Sin biblioteca de gráficos:** el dibujo son barras HTML y una polilínea SVG con la animación de la app (V0), sin `recharts`: la carga inicial de `/cowork` sube de 249 a 250 KB. Las líneas (`kind: 'line'`) están en el contrato y en la interfaz, pero ninguna consulta de hoy entrega una serie en el tiempo, así que todavía no se generan.
- **Solo en el chat:** el gráfico, como las cifras, no se abre en el panel lateral.

### Lo que no se hizo en este PR

- **El Analista como agente aparte** (una llamada de modelo que interprete las cifras) no está aquí. Sin datos que muestren que mejoraría lo que hoy dicen el coordinador y el juez, sumaría 5 s a las respuestas de números y una superficie más que mantener. Entra en G4 junto a los otros agentes (Estratega, Investigadora, LinkedIn) con una estructura común y medido con el juez.
- **Exportar el gráfico a XLSX** queda para F3 (archivos), que agrega XLSX y DOCX a las tarjetas.

### Flags y dependencias

- Sin flags: es parte de la respuesta y no gasta llamadas.
- Sin migraciones ni dependencias nuevas.
- Va apilado sobre G2 (insigne123/ANTON.IA-supabase#33), que va sobre G1 (insigne123/ANTON.IA-supabase#31).

## Validación

**Pruebas sin modelo:**
- `charts.test.ts`:
  - de qué consulta sale cada gráfico y cuándo no hay (sin envíos, cifras que faltan, otra consulta), y que se dibuje la última consulta de cada fuente;
  - el gráfico va justo después de la tarjeta de cifras de la que trata, y con varias consultas es el de la tarjeta que repite sus cifras;
  - sin tarjeta de cifras, sin consultas o sin lugar (4 tarjetas), la respuesta queda igual;
  - un gráfico escrito por el modelo se descarta, con sus cifras;
  - texto, CSV, frase para lectores de pantalla y unidad; la limpieza deja solo lo que se dibuja;
  - el bucle completo: un turno que lee `metrics.rates` termina con «cifras + gráfico», y sin envíos, solo con las cifras.
- Ya existentes, sin cambios: `answer-quality`, `blocks`, `presentation`, `contracts`, `decision-context` y el corpus sin modelo.

**Navegador:** Playwright contra el build de producción local, con un Supabase simulado solo en local (`fake-supabase-g3.mjs`): un turno con plan, la consulta de métricas y la respuesta con su tarjeta de cifras y su gráfico. Claro y oscuro a 1440 px, claro a 390 px y con `reducedMotion: 'reduce'`.
- **Mientras se ve aparecer:** las barras miden menos justo después de aparecer y crecen hasta su altura; con movimiento reducido ya están dibujadas.
- **Contenido:** título, período, leyenda con las dos series, el valor sobre cada barra («40», «240»…) y los nombres debajo; el orden es primero las cifras y después el gráfico.
- **Accesibilidad:** el dibujo trae la frase para lectores de pantalla y una tabla de 4 filas.
- **Acciones:** «Descargar CSV» baja `correos-enviados-y-lo-que-volvio.csv` y «Copiar datos» confirma «Copiado».
- **En reposo:** al recargar, el gráfico ya está dibujado y no se mueve.
- **En todos los casos:** sin errores de página y sin scroll horizontal.
- **Contraste:** en la primera versión, la segunda serie (un acento mezclado con el fondo) quedaba oscura sobre la tarjeta en modo oscuro. Ahora usa los grises de la app (`--cw-muted`, `--cw-faint`) y se lee bien en claro y oscuro.
- **Peso:** `/cowork` queda en 250 KB de carga inicial, 1 KB más que G2.

**Observación fuera de este PR:** al recargar `/cowork?work=…`, la conversación se muestra y vuelve a «Cargando conversación…» por un instante antes de quedarse. Ocurre igual en `main` (probado con el build de `c9ee727`), así que no viene de estos PR.
