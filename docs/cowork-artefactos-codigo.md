# Cowork · artefactos con código: el motor seguro (Plan 12, PR 3a)

Cowork va a poder escribir el código de un artefacto a medida (un tablero, una ficha, una lista priorizada) y la app lo va a mostrar en el lienzo, al lado del chat. Este PR es el motor: arma el artefacto y lo aísla. La Diseñadora que escribe el código, las lecturas de datos y el lienzo llegan en 3b; aquí no cambia nada de lo que ve el usuario.

**El reparto:**

- **El modelo escribe** el diseño y la lógica: HTML, CSS y JavaScript.
- **El servidor pone los datos** en `antonia.data`, desde lo que Cowork consultó.
- **El modelo nunca escribe una cifra.** Las calcula desde las filas con `antonia.agg`, así que todo número en pantalla está en los datos. Es la misma regla de los gráficos de hoy (`charts.ts`).

## Cómo se arma

`buildCoworkArtifactDocument({ title, code: { html, css, js }, data })` (`src/lib/server/cowork/code-artifact.ts`) devuelve un solo HTML, que funciona igual en el marco de la app y descargado:

1. **CSP en `<meta>`:** `default-src 'none'; script-src 'nonce-…'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'`.
   - El nonce es nuevo en cada armado.
   - Solo corren los dos scripts del documento: sin `onclick` en atributos, sin `javascript:` y sin `eval`.
2. **El tema de la app:** los tokens en claro y oscuro (`--text`, `--accent`, `--series-1..5`, `--stage-1..6`…), con las clases de diseño (`card`, `grid-2`, `badge-success`, `header`…).
3. **Los datos:** en `<script type="application/json">`, sin ningún `<`, así que ningún valor puede cerrar la etiqueta. Hasta 2.000 filas por tabla, con celdas planas y columnas con tipo (`text`, `number`, `money`, `percent`, `date`).
4. **La biblioteca `antonia`** (`src/lib/cowork/artifact-runtime.ts`): unos 55 KB de JavaScript ES5, incluidos en el archivo, sin red.
5. **El código del modelo:**
   - Va envuelto en `(async function(){'use strict'; … })()`, así que acepta `await` arriba.
   - Va dentro de `<main>` si su HTML no trae uno.
   - Conserva sus números de línea, así un error dice en qué línea del código falló.

## La biblioteca `antonia`

| Pieza | Qué hace |
|---|---|
| `antonia.data.<tabla>` | `{ label, source, columns, rows, total, truncated }` |
| `antonia.agg` | `sum`, `avg`, `count`, `min`, `max`, `groupBy`, `series` (lista para un gráfico), `byMonth`, `top` |
| `antonia.format` | `money` («$1.234.567»), `number`, `percent` («12,3%»), `compact` («$568 M»), `date` («1 oct 2026», sin correrse de día) |
| `antonia.chart(el, spec)` | `bar` (se pone horizontal sola si las etiquetas son largas), `line`, `donut`, `funnel` y `stacked` |
| `antonia.table(el, datos, opciones)` | Tabla que ordena (con `aria-sort`), filtra, pagina («Mostrar 25 más») y acepta `render` por columna |
| `antonia.kpi(el, items)` | Tarjetas de cifras, con el cambio en signo y flecha (no solo color). Si la cifra no cabe, se acorta («$568 M») y muestra el valor completo al pasar el mouse |
| `antonia.h`, `antonia.mount`, `antonia.esc` | Arman HTML con texto, nunca con HTML: así un dato no puede inyectar marcado |
| `antonia.theme`, `antonia.onTheme` | El tema actual, y un aviso cuando la app lo cambia |

**Los gráficos** siguen la guía de visualización:

- **Colores:** los cinco colores de gráfico de la app, en orden fijo (azul, naranjo, violeta, verde, rojo). Validados para daltonismo con apoyo de leyenda y etiquetas.
  - Una sexta serie, o una séptima tajada, se junta en «Otros»: nunca se inventa un color.
- **Trazos:** barras con 4 px redondeados en la punta y apoyadas en la base, líneas de 2 px y marcadores con anillo.
- **Etiquetas:** en las marcas solo cuando caben, y con el monto corto.
- **Lectura y acceso:** un tooltip al pasar el mouse, más el resumen para lectores de pantalla y «Ver datos» con la tabla de cada gráfico.
- **Tamaño:** se redibujan al cambiar el ancho del lienzo.

**Dos ejemplos escritos con la biblioteca** (`code-artifact-examples.ts`): «Pipeline por etapa» y «Prospectos priorizados». La Diseñadora los va a recibir como modelo en 3b.

## Las paredes

De afuera hacia adentro:

1. **El marco:** `sandbox="allow-scripts"`, con origen opaco.
   - Sin cookies ni sesión, y sin acceso a la app.
   - Sin ventanas nuevas, sin formularios y sin navegar la página de arriba.
2. **La página `/cowork` solo permite marcos de sí misma** (`frame-src 'self'` en `next.config.js`, más los inicios de sesión de Microsoft y Google).
   - **Es la pared que impide que un artefacto se lleve datos navegando su propio marco hacia afuera.**
   - La prueba lo confirma: sin esta cabecera, un `location.href` con datos llega al servidor de afuera; con ella, el navegador lo detiene.
   - Un test (`code-artifact.test.ts`) mantiene iguales la cabecera y la constante `COWORK_ARTIFACT_FRAME_SRC`.
3. **La ruta sirve el archivo con su propia CSP** de sandbox, que ya existía, y el documento trae la suya en `<meta>`.
4. **La revisión del código** (`checkCoworkArtifactCode`) rechaza lo que se ve, con un mensaje que la Diseñadora puede corregir:
   - **Red:** `fetch`, `XMLHttpRequest`, `WebSocket` y URLs externas.
   - **Navegación:** `location`, `window.open` y enlaces que no sean `#…`.
   - **Otras ventanas:** `top`, `parent` y `postMessage`.
   - **Almacenamiento:** `localStorage` y `document.cookie`.
   - **Código dinámico:** `eval`, `Function` e `import`.
   - **Elementos peligrosos:** `<script>` en el HTML, `<iframe>`, `<form>`, `<meta>` y atributos `on…`.
   - **CSS:** `@import` y `url()` externas.
   - **HTML abierto:** un comentario, unas comillas o un `<textarea>` sin cerrar, que se comerían el código siguiente.
   - **Tamaño:** hasta 200 KB de código. Los datos no cuentan, porque van aparte.
   - Una palabra común que el código declara para sí, como `function walk(node, parent)`, se toma como suya.
   - Es una revisión de lo visible, no la pared: ofuscado se la puede saltar, y para eso están las otras.
5. **La biblioteca protege la página antes de que corra el código:**
   - El HTML que se escribe en tiempo de ejecución (`innerHTML`, `insertAdjacentHTML`, `DOMParser`, `createContextualFragment`…) se limpia de scripts, marcos, formularios, `<meta>`, atributos `on…` y enlaces hacia afuera.
   - `createElement` no crea esas etiquetas.
   - Un `<meta>` existente no se puede convertir en refresh.
   - `document.write` no existe.
   - Los clics en enlaces que no sean `#…` no navegan.
6. **Freno de bucles:** cada bucle lleva `__antoniaLoop()`.
   - Si la página sigue en bucle 2 segundos sin darle un turno al navegador, se detiene y avisa.
   - Un bucle que espera (`await`) nunca se corta.
7. **Errores:** todo error del artefacto llega a la app (`{ source: 'antonia-artifact', type: 'error', detail: { message, line } }`), solo al origen que la app nombró.
   - La línea es la del código del artefacto.
   - Dentro del artefacto aparece «Una parte de este artefacto no se pudo mostrar».
   - En 3b, el lienzo ofrece «Arreglarlo».

## Prueba en un navegador real

`node --loader ./scripts/ts-test-loader.mjs scripts/test-cowork-artifact-sandbox.ts [--out=dir]` levanta dos servidores locales: la app y uno «de afuera», que nunca debe recibir nada. La prueba corre en Chromium y da **49 de 49**:

- **Los dos ejemplos se dibujan en claro y en oscuro, a 1280 y 390 px.**
  - Cifras, gráficos con sus marcas y la tabla.
  - Sin desborde, sin errores y con **axe limpio dentro del marco**.
- **Interacción:**
  - la tabla ordena por Empresa y filtra;
  - el tema cambia por mensaje sin recargar el marco.
- **Errores:**
  - `notDefinedAnywhere` en la línea 3 llega a la app con «línea 3»;
  - un HTML que se come el código avisa que el código no llegó a ejecutarse.
- **Bucles:**
  - `while (true) {}` se detiene en 2,4 s y la página de la app sigue viva;
  - un bucle de 30 esperas de 100 ms termina sin cortarse.
- **15 ataques, insertados después de la revisión** (como si se la hubieran saltado). El servidor de afuera no recibe nada en ninguno:
  - `fetch`, imagen, `url()` en CSS, WebSocket, `sendBeacon` y `<link rel=prefetch>`;
  - `location.href` con los datos, `<meta>` refresh nuevo y uno reusado, clic en un enlace, `window.open(_self)`, `top.location` y un formulario;
  - un `<img onerror>` inyectado;
  - cookies, `localStorage`, `sessionStorage` y `top.document`, todos bloqueados.
- **Cada ataque se repite sin la cabecera `frame-src`, solo para saber qué pared lo detiene.** El único que pasa sin ella es `location.href`. Por eso esa cabecera es obligatoria.

Las pruebas unitarias son `src/lib/server/cowork/code-artifact.test.ts` y `artifact-runtime.test.ts`, con la biblioteca corriendo en JSDOM.

## Lo que sigue

- **La Diseñadora (3b) ya está:** `artifact.create`, los datos, el lienzo con versiones, «Pedir cambios», «Arreglarlo» y la descarga. Ver `docs/cowork-disenadora.md`.
- **Imprimir y el CSV de los datos:** quedan para el lienzo (2).
- **Cuatro ejemplos más y el juez de artefactos (3c):** que se dibuje, axe, que no desborde a 390 px, que las cifras salgan de los datos y su utilidad.
