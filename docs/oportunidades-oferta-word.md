# Oportunidades: el Word de la oferta, los formularios de las bases y «Cómo postular» a todo el ancho

**Fecha:** 21 de octubre de 2026.

## Qué se veía mal

Con el borrador de la licitación «Servicio de aseo para dependencias del MHN» (ID 1217466-29-LP26):

- **El Word no era un documento formal.** Salía del mismo convertidor de Markdown que el chat: el título dos veces, una lista larga de «datos que faltan» antes de la carta, la carta con «[Lugar y fecha]» y «[Firma][Nombre][RUT]» pegados en una línea, la frase «Responde a:» corrida junto al texto y los requisitos como una tabla de pares de frases con corchetes. Nada para llenar: había que borrar corchetes a mano.
- **Faltaban los formularios.** Las bases exigen presentar la identificación y declaración jurada (Anexo N°1), la oferta económica (N°4), la experiencia (N°6), un anexo por trabajador (N°10), los servicios adicionales (N°11)… El borrador solo los nombraba. Desde «Qué entregar», «Preparar borrador» pedía el texto al chat, que lo devolvía como un párrafo con barras verticales (`|`) y avisaba que no tenía el formato oficial.
- **«Cómo postular» era una columna angosta al centro** (`max-w-3xl`): en una pantalla ancha sobraba más de la mitad.

## Qué cambia

### 1. El Word (`offer-docx.ts`)

El Word se arma ahora con un constructor propio (librería `docx`) y no desde Markdown. Orden:

1. **Hoja de trabajo · no se envía:** datos de la licitación (organismo, ID, cierre, presupuesto, oferente y RUT), cómo completar el documento, **datos por completar** con casilla ☐ cada uno y **documentos que debe entregar** (carpeta, firma, «si falta, queda fuera»).
2. **Carta de presentación:** ciudad y fecha, destinatario, referencia con el ID, «De nuestra consideración», el cuerpo escrito por la IA, despedida y firma. Se escribe todo salvo el cuerpo (el prompt ahora pide solo el cuerpo; los borradores antiguos se limpian con `letterBody`).
3. **Identificación del oferente** (solo si ningún formulario trae la identificación).
4. **Oferta técnica:** una sección por criterio, con su ponderación en una barra aparte y el texto en párrafos y viñetas.
5. **Cumplimiento de requisitos técnicos:** tabla con **lista desplegable** («Sí cumple», «No cumple», «Por confirmar»), ya en «Sí cumple» donde la IA lo respaldó, y una casilla para describir cómo se cumple donde no se sabe.
6. **Oferta económica:** líneas, cantidades, precio unitario y subtotal; neto, IVA y total si ya están todos los precios; vigencia y condiciones.
7. **Cada formulario de las bases** en su propia página, con su título, tablas, casillas, declaración y línea de firma.

**Campos para llenar.** Lo que la empresa no ha dado es un *control de contenido* de Word (amarillo): se hace clic y se escribe, o se elige de una lista, o se marca la casilla, o se abre el selector de fecha. Nada se inventa: un dato desconocido queda como campo. El constructor pone solos la razón social y el RUT de la «Ficha para licitaciones» donde el formulario los pide (nunca los del representante ni del contacto, `prefillField`).

**Descarga.** `GET /api/commercial-opportunities/:id/export?doc=offer&format=docx` baja todo; `&annex=N` baja un solo formulario (sin hoja de trabajo ni el resto de la oferta). El nombre del archivo lleva el número y el título del anexo.

### 2. Los formularios (`offer-annexes.ts`)

- Un segundo paso del mismo trabajo `offer` (`workspace-offer.ts`) escribe los formularios aparte, con su propio presupuesto: una oferta y sus formularios juntos no caben en una respuesta. El modelo lee el **texto de los formularios**: todos los fragmentos de los archivos «Anexo…», «Formulario…», «Declaración…» y los fragmentos de las bases que parecen un formulario (`offerFormExcerpts`, hasta 45.000 caracteres). Los reproduce fielmente (mismas columnas, mismas filas fijas, misma declaración con sus referencias legales) y marca `faithful: false` cuando tuvo que armarlos con lo que piden las bases; el Word lo dice en un recuadro.
- Un formulario es una lista de bloques planos (`text`, `fields`, `table`, `choices`): lo que usan los formularios reales que revisamos (Dirección del Trabajo, Valparaíso: antecedentes administrativos con declaración jurada y pactos de integridad; oferta económica por oficina; oferta técnica con «Sello 40 horas» y tiempo de respuesta; nómina de clientes).
- Si el segundo paso falla (presupuesto, respuesta rara), la oferta sale igual, lo dice en «Datos que faltan» y se puede pedir «otra versión». Si se perdió el arriendo del trabajo (409), se reintenta.
- Los borradores anteriores no tienen formularios; la pantalla lo dice y ofrece «Preparar otra versión».

### 3. «Cómo postular» (`SubmissionKit.tsx`)

- La cabecera ocupa todo el ancho: título y canal a la izquierda, avance a la derecha.
- Debajo, dos columnas desde el ancho `xl`: a la izquierda lo que hay que **preparar** («Tu oferta» y «Qué entregar», una tarjeta por carpeta con filas separadas) y a la derecha lo que hay que **revisar** («Lo que te deja fuera», «Los números», «Garantías», «Para preguntar en el foro», «Cómo se envía», «Después de enviar»), cada uno en su tarjeta. En pantallas angostas y en teléfono todo apila en ese mismo orden.
- La fila de un anexo cuyo formulario ya está en el borrador ofrece **«Descargar Word para llenar»** en lugar de «Preparar borrador» (que pedía el texto al chat). Los demás documentos conservan «Preparar borrador»; ese mensaje ahora pide un formulario con tabla «Campo | Dato», no un párrafo con barras.

## Qué no cambia

- La hoja económica de la pantalla (precios, neto, IVA, presupuesto) y el Markdown (`format=md`).
- El esquema de la base de datos: los formularios van dentro del mismo JSON `draft` (campo opcional `annexes`).

## Límites

- Es una **reproducción** del formulario, no el archivo del comprador: si las bases exigen el original, hay que pasar los datos a él. El Word lo recuerda en cada formulario.
- Los totales del Word se calculan al descargar (los precios se escriben en la pantalla); Word no recalcula solo.
- Los controles de contenido se probaron abriendo el archivo con LibreOffice, no con Microsoft Word.

## Pruebas

- `offer-docx.test.ts`: el XML es válido, cada control tiene un id propio, hay casillas, listas y selector de fecha; la hoja de trabajo va primero; la carta escribe ella misma fecha, destinatario y cierre; la tabla de cumplimiento; los formularios con los datos de la ficha; precios y totales; un formulario solo; y datos con caracteres raros no rompen el archivo.
- `offer-annexes.test.ts`: el número de un anexo («4-A», «4 A –», «4 a la oferta»), cómo cada documento de la guía encuentra su formulario, el recorte y la lectura del texto de los formularios.
- `offer-document.test.ts`: cuerpo de la carta, respuestas de cumplimiento y campos que la empresa ya contestó.
- `offer-draft.test.ts`, `offer-draft-ui.test.ts` y `submission-kit-ui.test.ts`: el prompt de los formularios, la lista de formularios con su descarga, y el nuevo diseño a todo el ancho.

## Código

| Pieza | Archivo |
| --- | --- |
| Constructor del Word | `src/lib/server/commercial-opportunities/offer-docx.ts` |
| Formularios: esquema, número, recorte, texto de las bases | `src/lib/commercial-opportunities/offer-annexes.ts` |
| Cuerpo de la carta, cumplimiento, campos de la empresa | `src/lib/commercial-opportunities/offer-document.ts` |
| Prompt de los formularios y mezcla con el borrador | `src/lib/commercial-opportunities/offer-draft.ts` |
| Trabajo `offer` con su segundo paso | `src/lib/server/commercial-opportunities/workspace-offer.ts` |
| Descarga | `src/app/api/commercial-opportunities/[id]/export/route.ts` |
| Pantalla | `SubmissionKit.tsx`, `OfferDraft.tsx`, `OpportunityWorkWorkspace.tsx` |
