# Cowork · Crea archivos de lo que muestra: Excel, CSV, Word y PDF (29 sep 2026)

Segundo PR de la Ola F del plan 2 de Cowork (punto F3). Hasta hoy, un correo o una secuencia solo se copiaban; una tabla o un gráfico bajaban en CSV (armado en el navegador); y el documento del panel, en PDF o Markdown. Si el usuario pedía «pásamelo a Excel» o «dámelo en Word», Cowork no tenía cómo entregarlo y el modelo tendía a proponer código. Ahora **cada tarjeta trae su botón «Descargar»** con los formatos que le corresponden. El archivo se arma en el servidor a partir de lo que el usuario ve, sin ejecutar código y sin guardar nada.

## Qué cambia para el usuario

- **Un menú «Descargar» en cada tarjeta,** en el chat y en el panel:

  | Tarjeta | Formatos |
  |---|---|
  | Tabla, cifras y gráfico | Excel (.xlsx) y CSV |
  | Correo y secuencia | Word (.docx) y PDF |
  | Documento del panel | Word, PDF y Markdown (Word es nuevo) |
  | Contactos (ya existía) | Excel y CSV |

- **El botón dice qué pasa:**
  - mientras se arma el archivo, muestra «Preparando…» con un indicador que gira y queda desactivado (un archivo a la vez);
  - al bajar, muestra «Archivo listo» con un check que se dibuja y, después de 2,6 s, vuelve a «Descargar»;
  - el nombre y el tamaño quedan en el título del botón y se anuncian a los lectores de pantalla («Archivo listo: contactos-de-rr-hh.xlsx, 9 KB»);
  - con «reducir movimiento», el cambio es un fundido: el indicador no gira y el check aparece ya dibujado.
- **Baja la versión editada.** Si el usuario editó un correo o una secuencia en el panel, baja esa versión, tanto desde el panel como desde la tarjeta del chat (la tarjeta lee la misma edición que el panel guarda en la pestaña).
- **Qué trae cada archivo:**
  - **Excel:** una hoja con el nombre de la tarjeta, sin los caracteres que Excel no admite y con 31 caracteres como máximo. Tiene autofiltro y columnas a la medida.
    - El texto queda como texto: un código `00123` conserva sus ceros, y un valor que parece fórmula (`=HYPERLINK(…)`) es un dato, nunca una fórmula.
    - Las cifras de un gráfico son números, y el encabezado dice el período y la unidad.
  - **CSV:** UTF-8 con BOM, para que Excel lea las tildes. Los valores van entre comillas, y los que empiezan como fórmula llevan un apóstrofo delante.
  - **Word:** el título y, en negrita, «Para» y «Asunto».
    - El cuerpo va en párrafos, tal como se escribió: el texto de un correo nunca se lee como Markdown, así que un guion sigue siendo un guion.
    - Una secuencia trae una sección por correo, con su día.
    - El documento del panel conserva títulos, listas (una numerada empieza donde dice), tareas, citas, código, tablas con la fila de encabezado repetida en cada página, y vínculos. Solo son vínculos los que se pueden seguir fuera de la app (https y mailto).
    - Las propiedades del archivo llevan el título y el autor «ANTON.IA Cowork», con idioma `es-CL`. El pie dice «ANTON.IA Cowork · página X de Y».
  - **PDF:** el mismo contenido, con el mismo dibujo que ya usaba el documento del panel. Si el texto trae caracteres que las fuentes del PDF no admiten (emoji, otros alfabetos), lo dice y ofrece Word, que sí los conserva.
- **Si falla:** el aviso del espacio de trabajo muestra una vez «No se pudo crear el archivo.» y el botón queda disponible para reintentar. Si la sesión venció, se trata igual que cualquier otra consulta privada.
- **Cuando el usuario pide un archivo** («pásamelo a Excel», «dámelo en Word»), Cowork entrega la tarjeta y dice en una frase que se baja con «Descargar» y en qué formatos. No propone código ni dice que no puede hacer archivos.
- **Escape dentro de un menú «Descargar» cierra solo el menú.** Antes, con el panel abierto, lo cerraba también, porque el panel escuchaba Escape en toda la ventana. El foco vuelve al botón.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Formatos de cada tarjeta, sus nombres y el tamaño legible (los usan el menú y el servidor) | `src/lib/cowork/export-formats.ts` |
| Tarjeta → archivo (Excel, CSV, Word o PDF) y revisión de la solicitud | `src/lib/server/cowork/block-export.ts` |
| Word desde el árbol de Markdown | `src/lib/server/cowork/docx-render.ts` |
| Documento del panel en Word, y piezas compartidas con el PDF (`coworkPdfBytes`, `mapCoworkMarkdownText`, `COWORK_MIME`) | `src/lib/server/cowork/file-exports.ts` |
| Ruta | `POST /api/cowork/export` (`src/app/api/cowork/export/route.ts`) |
| Menú | `src/components/cowork/ExportMenu.tsx`, con `CoworkExportProvider` en `CoworkWorkspace.tsx` para el aviso de error y la sesión vencida |
| Tarjetas | `CoworkBlocks.tsx`: `BlockCard`, `MetricsBlock`, `ChartBlock`, `DraftView` y `CoworkBlockView` |
| Instrucciones | regla 11 de `agent-instructions.ts` y reglas del producto del juez (`judge.ts`) |

- **Por qué un POST con la tarjeta y no un GET por identificador:**
  - el usuario edita correos y secuencias en el panel, y esa edición vive en la pestaña, no en la base; el archivo tiene que llevar su versión;
  - el servidor no lee la base ni guarda nada: revisa la tarjeta con el mismo esquema que las respuestas (`coworkBlockSchema`, que ya acota los tamaños) y el cuerpo hasta 2 MB;
  - si el cuerpo pasa de 2 MB, responde 413, sea por el largo declarado o mientras llega (deja de leerlo);
  - pide acceso a Cowork (`requireCoworkAccess`) antes de leer el cuerpo;
  - la respuesta es privada (`Cache-Control: private, no-store`, `nosniff`) y el nombre del archivo sale del título, sin tildes ni símbolos.
- **Cada tarjeta ofrece solo sus formatos,** y el servidor rechaza otro con 400 (un correo no es una hoja de cálculo). La lista está en un solo lugar (`COWORK_BLOCK_FORMATS`), así que el menú y el servidor no pueden discrepar.
- **El texto de un correo no pasa por el lector de Markdown:** sus párrafos se arman directamente (una línea en blanco separa párrafos; un salto de línea es un salto). Asteriscos y guiones quedan como se escribieron.
- **Word con `docx` 9.0.0** (MIT, 3 MB, fijado exacto):
  - usa el mismo `@types/node` 20 del repositorio sin duplicarlo;
  - trae `jszip` (ya estaba por `mammoth`), `nanoid` 5.1, `xml` y `xml-js`;
  - `npm audit --omit=dev` da el mismo total con y sin `docx` (59, todos previos).
- **Solo servidor y en diferido:** `docx`, `xlsx` y `jspdf` se cargan dentro de la ruta al pedir un archivo. `/cowork` queda en 239 kB de carga inicial, igual que la base.
- **Caracteres que un `.docx` no admite** (de control, sustitutos sueltos) se quitan, porque uno solo hace que Word rechace el archivo entero.
- **Sin migraciones, sin flags y sin Storage.** El archivo sale de lo que ya está en pantalla, no de un paso del turno. Por eso no aparece en la actividad (el plan original lo proponía; no aplica).

## Validación

**Pruebas sin modelo** (`npm run test:unit`: 1825 de 1825; la base tenía 1811. `verify-cowork`: 404 de 404 más sus scripts):
- `block-export.test.ts` (9):
  - la solicitud revisada: JSON roto, campos de más, una tarjeta que no existe, un formato que no corresponde a la tarjeta (400) y un cuerpo de más de 2 MB (413);
  - la tabla en Excel, leída de vuelta con el lector de Cowork: columnas y filas iguales, hoja con el nombre de la tarjeta, un valor con forma de fórmula como texto, `00123` con sus ceros y autofiltro;
  - el CSV: BOM, comillas y fórmulas neutralizadas;
  - el gráfico con sus cifras como números (y el nombre de hoja recortado a 31 caracteres), y las cifras con su período, en Excel y CSV;
  - el correo en Word y PDF, con destinatarios, asunto y cuerpo, y un guion que sigue siendo guion; la secuencia con una sección por correo y su día;
  - la versión editada es la que sale, y el PDF avisa cuando sus fuentes no admiten el texto (ofrece Word);
  - cada tarjeta ofrece exactamente los archivos que el servidor sabe hacer, y una tarjeta sin título igual recibe nombre.
- `docx-render.test.ts` (4): el Word leído de vuelta con `mammoth` (el lector de F1) conserva títulos, texto, listas anidadas, tareas, citas, código y tablas; es un Word bien formado (título y autor, estilos de título, un solo vínculo porque `/campaigns` no se puede seguir fuera de la app, encabezado de tabla repetido, sin caracteres de control); el pie usa su estilo y los números de página se ven como el resto del pie; una lista numerada empieza donde dice y cada lista reinicia; un documento largo con una tabla ancha sale en un solo archivo legible.
- `file-exports.test.ts` (+1): el documento del panel en Word.
- `scripts/test-cowork-block-export-route.mjs` (nuevo, en `verify-cowork`): la ruta pide acceso antes de leer el cuerpo; la descarga es privada y con el nombre de la tarjeta; el correo editado sale en Word; las negativas traen su motivo (JSON roto, formato ajeno, emoji en PDF → 422 que ofrece Word); y un cuerpo grande se rechaza por su largo declarado sin leerlo o deja de leerse al pasar el límite.
- **Corpus sin modelo:** dos casos nuevos, «pásame a excel mis contactos de rrhh…» (`descargar-tabla`) y «redáctame un correo para felipe… y pásamelo en word» (`descargar-correo`). Verifican que entrega la tarjeta, que dice «Descargar» con el formato, que no propone código y que no dice que no puede (tampoco «no puedo adjuntar»).

**Navegador:** Playwright contra el build de producción local, con un Supabase simulado solo en local (`fake-supabase-f3.mjs`): un turno terminado con tabla, correo, secuencia, cifras y documento. Se probó en claro y oscuro a 1440 px, en claro a 390 px y con `reducedMotion: 'reduce'`. En las cuatro variantes:
- **Menú y estados:** cada menú ofrece sus formatos (tabla: Excel y CSV; correo: Word y PDF; documento: Word, PDF y Markdown) y se abre con teclado (Enter).
  - Con una respuesta demorada a propósito, el botón pasa a «Preparando…», desactivado, y se anuncia «Preparando el archivo…».
  - Al bajar, pasa a «Archivo listo»; su título dice `contactos-de-rr-hh.xlsx · 9 KB` y se anuncia «Archivo listo: contactos-de-rr-hh.xlsx, 9 KB». A los pocos segundos vuelve a «Descargar».
- **Descargas reales:** 11 archivos por variante (tabla en Excel y CSV, correo en Word y PDF, secuencia en Word, cifras en Excel, correo editado desde el panel y desde la tarjeta, documento en Word, PDF y Markdown). Todos se leen de vuelta con los lectores de Cowork.
- **La edición viaja:** con el panel en edición no se ofrece descargar. Después de editar, el Word bajado desde el panel y desde la tarjeta trae «Asunto que edité yo»; el bajado antes trae el original.
- **Escape:** dentro del menú del panel lo cierra y deja el foco en «Descargar documento» con el panel abierto; sin menú, cierra el panel.
- **Error:** si el servidor falla, se muestra «No se pudo crear el archivo.» y el botón vuelve a «Descargar», habilitado.
- **En todos los casos:** sin errores de página y sin scroll horizontal. `/cowork` queda en 239 kB de carga inicial, igual que la base.

**Con LibreOffice** (Writer y Calc, en este entorno): los 8 archivos de Word, Excel y CSV bajados desde el navegador se abren y se convierten a PDF.
- Se ven los títulos, «Para» y «Asunto» en negrita, las secciones de la secuencia, la tabla del documento con su encabezado sombreado y las cifras alineadas, y el pie «ANTON.IA Cowork · página 1 de 1».
- En la primera versión del pie, los números de página salían más grandes que el texto: los campos quedaban en la misma corrida que el texto y LibreOffice les perdía el formato. Ahora el formato está en el estilo del pie: en LibreOffice se ve parejo, y `docx-render.test.ts` lo verifica.
- El CSV se lee con tildes y con la fórmula neutralizada (`'=HYPERLINK…`). Una hoja de cálculo lee `00123` como 123: es propio del CSV (ya pasaba antes), y el Excel lo conserva.

**Con el modelo real** (`gpt-6-luna`, con la Redactora y el juez del turno encendidos, como en producción; juez offline `gpt-6-sol`). Los dos casos nuevos × 5, el mismo día, contra la base: la cabeza de F1 con solo los casos nuevos agregados, juzgada con las reglas de F3.

| | Casos que pasan | Verificaciones | Juez: buenas / mejorables / malas | Fricción | Utilidad | Veracidad | Mediana |
|---|---|---|---|---|---|---|---|
| Base | 0 de 10 | 101 de 115 | 1 / 2 / 7 | 2,7 | 3,3 | 4,1 | 15,6 s |
| F3 | 9 de 10 | 114 de 115 | 10 / 0 / 0 | 4,9 | 5,0 | 5,0 | 15,6 s |

- **La base** no nombra la descarga (no existe) y, en 4 de 5 correos, dice que no puede entregar el archivo («No puedo adjuntar un archivo Word desde aquí»).
- **En F3,** el correo dice «Descargar» en Word o PDF en 5 de 5; la tabla, en 4 de 5 (la otra dice «planilla Excel descargable» sin nombrar el botón). Ninguna propone código. Las llamadas por caso no cambian (unas 4).
- **Una primera ronda** sin la línea nueva en la Redactora dio 4 de 10: el correo lo escribe la Redactora, que no sabía de la descarga y respondía «No puedo adjuntar un archivo Word». Por eso su regla de salida suma una frase.
- **Regresión** (7 casos que entregan tarjetas × 3, mismo día: `metricas-semana`, `informe-jefe`, `mkt-secuencia`, `mkt-mejorar-correo`, `mkt-seguimiento`, `archivo-a-quien` e `inicio-escribir`):

  | | Casos que pasan | Verificaciones | Juez: buenas / mejorables / malas | Fricción | Utilidad | Claridad | Veracidad | Mediana |
  |---|---|---|---|---|---|---|---|---|
  | Base | 15 de 21 | 209 de 216 | 13 / 5 / 3 | 4,38 | 4,05 | 4,62 | 4,43 | 18,3 s |
  | F3 | 18 de 21 | 213 de 216 | 13 / 7 / 1 | 4,90 | 4,19 | 4,48 | 4,62 | 20,5 s |

  - Ninguna respuesta nombra «Descargar» si el usuario no pidió un archivo (0 de 21 en ambos): la regla no se cuela en otros turnos.
  - Las diferencias caben en el ruido medido antes (±0,4 de fricción con 15 a 25 respuestas y la misma rama): no hay una regresión atribuible a este cambio.

## Límites

- **Sin Microsoft Word en este entorno.** Los archivos se revisaron leyéndolos de vuelta con los lectores del propio Cowork (`mammoth`, `unpdf` y SheetJS) y abriéndolos con LibreOffice.
- **Fuentes del PDF:** solo admiten texto de Europa occidental. Para lo demás, el mensaje ofrece Word.
- **Un archivo a la vez por botón, y nada se guarda:** no hay historial de archivos creados.
