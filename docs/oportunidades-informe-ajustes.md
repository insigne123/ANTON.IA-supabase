# Oportunidades: informe de postulación, ticks que se pueden deshacer, recordatorios claros y preguntas completas

**Fecha:** 21 de octubre de 2026.

Cuatro cosas que se vieron mal al usar el informe de una licitación (ID 1217466-29-LP26).

## 1. No dejaba desmarcar un avance

**Qué pasaba.** Todas las marcas (los ticks de «Qué hacer ahora», de la ruta, de los requisitos, del plan y de los documentos) compartían un solo «estoy guardando»: mientras una se guardaba, **todas** quedaban deshabilitadas. El servidor tarda en responder (guarda la marca, anota la actividad y, al marcar, puede mover la oportunidad de etapa). Un segundo clic en el mismo tick («me equivoqué»), dado en ese intervalo, se perdía en silencio. Se reprodujo en el navegador con un servidor lento: tras marcar, el tick quedaba `disabled` y el clic de deshacer no hacía nada.

**Qué cambia.**

- **Ninguna marca se bloquea mientras guarda.** Un tick se ve al instante y solo «respira» (se anima) mientras su guardado va en camino.
- **Cola por marca** (`mark-queue.ts`): los cambios de una misma marca viajan al servidor en orden, de a uno; las demás marcas no esperan. Solo el último cambio de una marca dice cómo termina (sin parpadeo del tick). Si el último guardado falla, vuelve a lo último que el servidor confirmó.
- **Un refresco no pisa lo que acabas de hacer:** si el expediente se vuelve a leer mientras una marca guarda, esa marca conserva lo que la persona hizo.
- **Marcar el paso de «presentar la oferta» movía la oportunidad a «Presentada» y desmarcarlo no la devolvía.** Ahora, si el último cambio de etapa fue ese movimiento automático (no uno hecho por una persona), desmarcar el paso la devuelve a «En preparación» y lo anota en la actividad (`automaticUndo`, `undoAutomaticMove`). Una etapa que eligió una persona no se toca.

## 2. Recordatorios claros: de qué licitación son

**Qué pasaba.** El evento de Google Calendar decía «Recordatorio: Cierre de recepción de ofertas (1 día antes)» y su descripción solo repetía la fecha: sin el nombre de la licitación, el organismo ni cómo abrirla.

**Qué cambia** (`report-marks.ts`, `ReminderMenu`):

- **Título:** `Mañana: Cierre de recepción de ofertas · SERVICIO ASEO PARA DEPENDENCIAS DEL MHN (ID 1217466-29-LP26)`. El prefijo dice cuándo es (Hoy, Mañana, En 3 días, En una semana); el mismo día va sin prefijo.
- **Descripción:** la fecha completa; «Licitación» (o «Compra Ágil», «Oportunidad»), «Organismo» e «ID»; y los enlaces «Abrir en ANTON.IA» y «Ficha oficial» (Mercado Público).
- **Lugar** del evento: el enlace a la ficha oficial, solo si es `http(s)`.
- El archivo `.ics` lleva el mismo nombre, organismo e ID en el título, la descripción y la alarma.

## 3. «Recordatorios de todas» con Google Calendar, y la respuesta «No» que parecía pegada

- **(Desde el 22 de octubre el menú ofrece también Outlook (Microsoft 365) y lo elige primero: ver `docs/oportunidades-recordatorios-outlook.md`.)**
- **Google Calendar para todas.** El menú de «Recordatorios de todas» lista cada fecha con su botón «Google Calendar» (una pestaña por fecha; Google solo recibe un evento por enlace) y ofrece «Descargar todas juntas (.ics)» para importarlas de una vez (en Google Calendar, Configuración → Importar).
- **«La IA está pensando».** Responder «Sí» o «No» a una pregunta de «Falta un dato» guarda la respuesta y **vuelve a leer todos los requisitos con la IA, en la misma petición**: 10 a 40 s sin ninguna señal, con los botones apagados. Ahora la pregunta respondida muestra «Guardé tu respuesta («No»). La IA está revisando todos los requisitos con tu ficha…», un círculo que gira y una barra que se mueve (con movimiento reducido, la barra queda quieta y llena), y «Tarda unos segundos. Puedes seguir leyendo el informe.» (`FitThinking`, animación `thinking-slide` en Tailwind).

## 4. Preguntas completas: las del comprador y las «Falta un dato»

**Preguntas al comprador** (`BUYER_QUESTION_RULE` en `report-generation.ts`). Antes el prompt solo decía «consultas listas para enviar al comprador». Ahora pide **todas** las que la empresa necesite, completas y listas para pegar (dónde está la duda, cuál es y qué respuesta se necesita), por orden de riesgo: contradicciones (fechas y horas distintas entre el portal y las bases, anexos con nombres o números distintos, montos, garantías); lo que puede dejar la oferta inadmisible (visitas a terreno y su alternativa, formato y firma de anexos, certificados y su vigencia, medio y hora de entrega); la base del precio (neto o con IVA, referencial o máximo, reajuste, cantidades reales, turnos, lugares, quién aporta insumos); criterios de evaluación y desempate; condiciones del contrato (inicio, plazo, pago, multas, subcontratación, uniones temporales); y lo que falta en las bases. No pregunta lo que las bases o el foro ya contestan. Para una señal de LinkedIn pide 5 a 10 preguntas de descubrimiento.

**Una sola lista** (`buyerQuestions` en `report-view.ts`): «Para preguntar en el foro» de «Cómo postular» traía contradicciones que no estaban en «Preguntas para el comprador». Ahora el informe, el correo de consultas, el Markdown/PDF/Excel descargados y la guía usan la misma lista: las preguntas del informe más las contradicciones de las bases, sin repetir las que dicen lo mismo con otras palabras.

**«Falta un dato»** (`requirement-fit.ts`):

- Una pregunta **completa** por requisito: lo que hace falta para decidir y, si se postula, para llenar el formulario (cantidades, montos, años, fechas, vigencias, nombres). Hasta 320 caracteres (antes 200).
- **Tipo de respuesta** (`answerKind`): sí/no, o **detalle**. Una pregunta con cifras o nombres («¿Cuántos contratos de aseo por más de $20.000.000 ha ejecutado desde 2023, con qué clientes y por qué montos?») se abre como un cuadro de texto, no con «Sí / No»: un «Sí» no alcanzaba para llenar el anexo de experiencia.
- **«Para armar tu oferta»** (`extraQuestions`, hasta 8): datos que la empresa debe darnos aunque ningún requisito los nombre y que su ficha aún no dice (base de precio o costos, personas que pondría y su experiencia, desde cuándo podría empezar, subcontratos, quién firma, servicios adicionales), con una frase de para qué se piden. Se guardan en la misma lectura (bajo una clave propia: sin migración) y sus respuestas van a la ficha como las demás.
- Se pide clasificar **todos** los requisitos y no repetir lo que ya se contestó.
- El resumen («N cumples · N falta un dato…») y la decisión cuentan los requisitos, no estas preguntas.

## Qué no cambia

- El servidor ya aceptaba `done: false`; el problema era del cliente.
- La ficha y el esquema de la base de datos: las notas de respuestas admiten ahora preguntas de hasta 320 caracteres (antes 200); las guardadas siguen siendo válidas.

## Límites

- **Las preguntas completas dependen del modelo.** Se cambió lo que se le pide y se probó que lo pedido llega al prompt, pero no se midió con una licitación real: hay que generar un informe nuevo y mirar sus preguntas.
- El manual de ayuda tiene un tope de 40.000 caracteres; para que cupieran estas frases se acortó la respuesta «¿Qué pasa si dejo preguntas de la ficha en blanco?» (ya no menciona que, al guardar, ofrece revisar las licitaciones descartadas) y dos textos más.

## Pruebas

- `mark-queue.test.ts`: la cola (un segundo clic no se pierde, las otras marcas no esperan, qué pasa si falla el último o uno anterior, y la lectura del expediente).
- `pipeline.test.ts`: cuándo desmarcar devuelve la etapa y cuándo no.
- `report-marks.test.ts`: título, descripción, lugar y archivo de los recordatorios.
- `report-interactive-ui.test.ts`: cada fecha con su Google Calendar, el nombre y el ID en cada evento, ninguna marca deshabilitada, la barra de «pensando», las preguntas con detalle, «Para armar tu oferta» y la lista única de preguntas.
- `requirement-fit.test.ts`, `report-generation.test.ts`, `report-view.test.ts`: tipos de respuesta, preguntas extra, reglas del prompt y la lista única.

## Código

| Pieza | Archivo |
| --- | --- |
| Cola de marcas | `src/lib/commercial-opportunities/mark-queue.ts` |
| Marcas en pantalla y menú de recordatorios | `src/components/commercial-opportunities/ReportMarks.tsx` |
| Título y descripción de los recordatorios | `src/lib/commercial-opportunities/report-marks.ts` |
| Volver de «Presentada» | `pipeline.ts` (`automaticUndo`), `workspace-pipeline.ts` (`undoAutomaticMove`), ruta `[id]/workspace` |
| «La IA está pensando» y preguntas con detalle | `src/components/commercial-opportunities/RequirementFit.tsx`, `tailwind.config.ts` |
| Preguntas de los requisitos | `src/lib/commercial-opportunities/requirement-fit.ts` |
| Preguntas al comprador | `report-generation.ts`, `report-view.ts` (`buyerQuestions`), `workspace-exports.ts` |
