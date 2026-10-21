# Harness de agentes

Un harness es lo que rodea al modelo y lo hace trabajar como Claude Code o Cowork: un bucle en que el modelo pide herramientas, el
sistema las ejecuta y le devuelve lo que pasó (incluidos los errores), hasta que entrega la respuesta. Esta página dice qué hay,
dónde se enciende, qué cambió en cada área y qué falta por medir con modelos reales.

Todo lo nuevo está **apagado por defecto**. Sin las variables de abajo, la app se comporta como antes.

## Piezas

| Carpeta | Qué es |
| --- | --- |
| `src/lib/agent-harness/` | El núcleo, sin dependencias del servidor: bucle con herramientas (`loop.ts`), herramientas y búsqueda de herramientas diferidas (`tools.ts`), compactación de contexto (`context.ts`), guías por demanda (`skills.ts`), subagentes (`subagent.ts`), plan (`plan.ts`), revisor (`review.ts`), resultado con esquema (`structured.ts`, la herramienta `entregar`), cliente de Anthropic con caché, reintentos y texto en vivo (`anthropic.ts`) y un modelo guionado para pruebas (`scripted.ts`). |
| `src/lib/cowork/harness-*.ts` | El coordinador de Cowork sobre el harness: lecturas como herramientas, propuestas por las mismas verificaciones de siempre, juez como revisor. |
| `src/lib/documents/` | El motor de documentos: spec, maquetación, PDF, Word, inspección, revisión visual. |
| `src/lib/server/commercial-opportunities/workspace-agent.ts` | Oportunidades: modelo con libro de presupuesto, el chat de una oportunidad y el corredor genérico de agentes. |
| `scripts/evaluate-cowork-harness.ts` | Mide el coordinador con harness sobre el mismo corpus y los mismos chequeos que el coordinador actual. |

## Dónde se enciende

| Variable | Qué hace | Requisitos |
| --- | --- | --- |
| `COWORK_RUNTIME=harness` | El coordinador de Cowork es un Claude con herramientas. Lo que el harness no toma (una tarea que retoma a sus especialistas, una pregunta sobre una propuesta) sigue por el bucle de siempre. | `ANTHROPIC_API_KEY`, worker y secreto de Cowork. |
| `COWORK_HARNESS_MODEL`, `COWORK_HARNESS_EFFORT`, `COWORK_HARNESS_MAX_ROUNDS`, `COWORK_HARNESS_MAX_READS` | Modelo (por defecto `claude-sonnet-5-5`), esfuerzo (`medium`), rondas (hasta 5: el libro admite 5 llamadas por ejecución) y lecturas por turno (6). | |
| `COWORK_STREAMING_ENABLED=true` | La respuesta se ve mientras se escribe. En modo harness sale de la entrada de `responder`. | Ya existía. |
| `COWORK_DOCUMENT_VISION=true`, `COWORK_DOCUMENT_REVIEW_MODEL` | Un Claude (Haiku por defecto) mira las páginas del documento que el agente revisa, además de la inspección determinista. | `pdftoppm` o `sharp` con fuentes en el servidor. |
| `COWORK_DOCUMENTS_ENGINE=legacy` | Vuelve al PDF y al Word anteriores. Sin esto, el PDF y el Word de Cowork pasan por el motor de documentos y, si el motor falla con un documento, usan el renderizador anterior. | |
| `OPPORTUNITIES_RUNTIME=harness` | El chat de una oportunidad y el asistente de la sección buscan y leen antes de responder. | `ANTHROPIC_API_KEY` y modelo del rol `chat` de Claude (`OPPORTUNITIES_CHAT_MODEL`, Haiku por defecto). |
| `OPPORTUNITIES_REPORT_VERIFY=on` | Segunda lectura del informe: una cita que no respalda su afirmación deja la afirmación «por confirmar». | Además de la anterior. Usa el modelo del rol `specialist`. |

## Cowork

El coordinador recibe las mismas reglas y el mismo contexto de siempre, más un protocolo corto. Las lecturas del gateway son
herramientas (varias a la vez corren juntas, una repetida se hace una sola vez, pasado el presupuesto se le pide responder).
Los errores vuelven como resultado y el modelo los corrige. Lo que cambia algo no lo ejecuta el agente: cada propuesta
(contactos, campaña, CRM, LinkedIn, ajustes, búsqueda, nota) pasa por `coworkStageDecision`, que corre las verificaciones del
bucle anterior (el destino debe haberse leído, los correos de la campaña son los exactos, no se repite una lectura) y termina en
la tarjeta de aprobación. La persona sigue aprobando todo lo que escribe o envía.

Además, `redactar`, `analizar` y `disenar` llaman a la Redactora, la Analista y la Diseñadora de siempre; el juez revisa la
respuesta antes de entregarla y puede devolverla una vez; la memoria de la conversación se guarda como antes. Los costos se
reservan y se registran por llamada en el mismo libro (`cowork_reserve_model_call`).

## Documentos

El circuito es *generar → maquetar → inspeccionar → corregir → entregar*. La inspección es determinista (títulos solos al final, tablas partidas,
última página casi vacía, caracteres que el PDF no puede dibujar) y `improveLayout` corrige lo que puede sin tocar el texto. En el turno de Cowork, el
agente llama `revisar_documento` con el documento que va a entregar y ve cómo quedaría como PDF (y, con `COWORK_DOCUMENT_VISION=true`, un Claude mira las
páginas); corrige y entrega. `crear_documento` (`documentTool`) hace el circuito completo (spec, PDF y Word) para cualquier agente que lo necesite; hoy ningún
turno lo usa. El PDF usa fuentes estándar (liviano, abre en todas partes); el Word se escribe con `docx`. La descarga de PDF y Word de Cowork pasa por el motor.

## Oportunidades

**Chat de una oportunidad.** Recibe las mismas reglas y los mismos fragmentos que la llamada única y puede buscar con otras palabras
(`buscar_en_documentos`), ver qué documentos hay (`listar_documentos`) y leer uno en orden (`leer_documento`). Solo puede citar
lo que leyó: una cita cuyo `chunkId` no existe o cuyo texto no está literal en el fragmento vuelve al modelo (dos veces como
máximo) y lo que aún falle se descarta, como antes.

**Asistente de la sección.** Parte con la misma lista y puede buscar entre todas las oportunidades que la persona ve
(`buscar_oportunidades`), leer lo que estableció un informe (`ver_informe`) y, para administradores, el Plan Anual de Compras
(`buscar_demanda`) y los contratos por vencer (`buscar_contratos`). Solo puede mostrar oportunidades que vio; un id inventado vuelve al
modelo.

**Presupuesto.** Cada ronda de un agente es un paso del libro de siempre (`opportunity_budget_reserve` / `_settle`):

- se reserva el peor caso de esa llamada (lo que lee al precio de escritura en caché, más todo lo que puede escribir);
- se concilia con el uso que reportó el proveedor;
- al retomar un trabajo, las rondas ya pagadas se repiten desde su resultado guardado, sin llamar al proveedor;
- un error HTTP del proveedor libera la reserva; una llamada cortada mientras corría queda «por conciliar», como en las llamadas únicas.

Los topes de la base no cambian: 2 USD al mes por organización en la categoría `chat` (unos cientos de preguntas con Haiku; con
Sonnet, unas pocas decenas), 0,75 USD por reserva y 0,75 USD por investigación. Subirlos es una migración, y no se aplica sin pedirlo.

**Segunda lectura del informe.** Revisa cada afirmación «documentada» contra sus citas (el modelo puede leer el fragmento completo).
Solo un «no relacionada» o «contradice» claro baja la afirmación a «por confirmar»; la duda no cambia nada. Si no hay tiempo, presupuesto
o el proveedor falla, el informe sale como estaba.

## Otros usos de IA: qué se movió y qué no

| Área | Decisión |
| --- | --- |
| Cowork: coordinador, documentos, escritura en vivo | Sobre el harness (arriba). |
| Oportunidades: chat, asistente, verificación del informe | Sobre el harness (arriba). |
| Oportunidades: informe (extraer por bloques, especialistas, redactor), evaluación, resúmenes, relleno, ficha, borrador de oferta | Se quedan como llamadas únicas con esquema: ya tienen validadores deterministas de citas y un libro de presupuesto, y un agente libre no mejora lo que es leer un bloque y devolver un objeto. |
| Informes de investigación v2 (`src/ai/flows/*report-v2*`), redactores de correo y LinkedIn, juez de mensajes, respuestas de ANTONIA, clasificación de respuestas | Se quedan: ya son canales de varias etapas con juez y corrección (medidos por rondas de lectura a ciegas), y cambiarlos sin poder medir con modelos reales arriesga más de lo que gana. |
| Ayuda («Pregúntale a la IA»), ajuste del lead, empresas parecidas | Se quedan: una llamada con todo el contexto necesario. |

Criterio para moverlos después: si la respuesta mejora cuando el modelo puede **mirar algo más** antes de contestar (un documento,
una lista, un dato que no cabe en el prompt) o **comprobar** lo que escribió, va al harness (`runStructured` + herramientas de lectura);
si es leer un bloque y devolver un objeto, no.

## Qué está verificado y qué no

Verificado (pruebas, tipos y lint):

- El bucle, las herramientas, la compactación, los subagentes, el revisor y los reintentos con un modelo guionado.
- El coordinador de Cowork sobre el harness, con las mismas verificaciones de propuestas y el juez; un caso del corpus corre por el harness con los
  mismos chequeos (`scripts/cowork-conversation-corpus.test.ts`). El resto del corpus solo corre con modelos reales (ver abajo).
- El libro de presupuesto de Oportunidades: reserva por ronda, costo con el uso real, repetición al retomar, errores del proveedor, tope de contexto.
- El PDF y el Word del motor de documentos, revisados como imagen en LibreOffice y `pdftoppm`.

**No verificado:**

- Ninguna ejecución con modelos reales de Anthropic: este entorno no tiene `ANTHROPIC_API_KEY`. No se ha medido la calidad contra el coordinador actual, ni
  latencia, ni costo real por turno.
- Que el proveedor devuelva el nombre del modelo tal como se pide (se acepta una versión con fecha del mismo modelo; otro nombre deja el costo «por conciliar»).
- El texto en vivo de la respuesta con el SDK real (probado con un cliente simulado de los eventos de `streamEvent`).
- El Word en Microsoft Word (se revisó en LibreOffice) y la revisión visual en el servidor de producción.

## Cómo medir y activar por etapas

1. Medir Cowork: con `ANTHROPIC_API_KEY` en el entorno (nunca desde un archivo),

   ```
   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-harness.ts --live --max-calls=200 --repeat=2 --output=harness.json
   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=200 --repeat=2 --output=bucle.json
   ```

   Se comparan tasa de casos que pasan sus chequeos, llamadas, tokens, costo y segundos por caso (mismos `--cases` y `--repeat`).
2. Activar en un entorno de prueba `COWORK_RUNTIME=harness` y probar a mano los turnos que proponen algo (campaña, búsqueda, nota) y los que entregan un documento.
3. Activar `OPPORTUNITIES_RUNTIME=harness` y hacer preguntas a un chat con documentos y al asistente; mirar en la base los pasos `answer:rN` del libro.
4. Solo después, `OPPORTUNITIES_REPORT_VERIFY=on` y leer qué afirmaciones bajó a «por confirmar».

Para apagar cualquiera: quitar la variable. No hay migraciones ni datos nuevos que revertir.

## Agregar una herramienta o un agente

- Una herramienta es `defineTool({ name, description, schema, kind, run })`. `kind: 'read'` corre junto a otras lecturas; `'effect'` corre sola y pasa
  por la política de aprobación; `'meta'` es del propio harness. `run` devuelve `ok`, `error` (el modelo lo lee y corrige) o `final`.
  Un error de acceso se lanza (`AuthError`) y termina el turno: el modelo no puede arreglarlo.
- Un resultado con esquema: `runStructured({ model, system, prompt, schema, tools, validate })`. El modelo termina llamando `entregar`;
  `validate` devuelve el problema para que lo corrija.
- Si el agente gasta dinero de un libro, pasa su modelo por `ledgeredModel` (Oportunidades) o por `reserve`/`recordUsage` (Cowork); no llames al proveedor por otro camino.
