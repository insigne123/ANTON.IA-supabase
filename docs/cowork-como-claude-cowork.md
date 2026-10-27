# Cowork como Claude Cowork: el banco de tareas y lo que encontró (27 de octubre de 2026)

Desde el 27 de octubre la prioridad es que Cowork trabaje como Claude Cowork o el agente de ChatGPT. Eso significa que reciba un encargo de varios pasos y lo lleve hasta el final, pidiendo aprobación solo para lo que cambia algo o gasta. Hasta ahora se medía un turno a la vez (`scripts/fixtures/cowork-full-corpus.ts`, 141 casos con chequeos léxicos). Ese corpus dice si una respuesta está bien, no si el trabajo se termina. Esta página presenta el banco que mide lo segundo, lo que encontró, lo que se arregló y el plan.

## Lo que se usa hoy en producción

Medido el 27 de octubre, solo lectura:

- **Uso:** desde el 17 de septiembre hubo 56 conversaciones de Cowork. 47 son de cuentas de Yago. Los clientes tuvieron 9, de 5 personas, en GrupoExpro y PSOL, que suman 37 personas.
- **Conversaciones de un turno:** 46 %, no el 79 % de la evaluación del 24 de octubre. Las de los clientes no son abandonos: trabajan aprobando búsquedas, lotes y campañas, no escribiendo mensajes. En 3 de esas 5, la última propuesta quedó sin responder.
- **El harness:** corre con Haiku 5.5 desde el despliegue del 26 de octubre. Lleva 6 turnos, con unas 3 llamadas al modelo por turno, unos 22 segundos de modelo y unos US$0,011 por turno.

## El banco de tareas

`scripts/evaluate-cowork-tasks.ts` y `scripts/fixtures/cowork-task-corpus.ts` juegan ocho encargos completos, desde el primer mensaje hasta el último paso que la persona aprobaría:

| Encargo | Qué pide |
| --- | --- |
| `lista-y-campana` | 10 jefes de selección de retail, guardarlos con su correo y una campaña pausada |
| `mineria-investigar-escribir` | Prospectos de minería, guardar 5, investigarlos y un correo a cada uno |
| `correos-faltantes` | Completar los correos que faltan y decir a cuáles 3 escribir primero |
| `informe-jefe` | Un informe del mes en Word para el jefe |
| `que-hago-hoy` | «¿Qué debería hacer hoy? Hazlo tú» |
| `empresas-y-decisores` | 8 empresas de logística parecidas y a quién contactar en cada una |
| `tarea-larga-plan` | Un encargo grande con plan: 20 prospectos, correos y campaña |
| `cada-lunes` | Algo que se repite cada semana |

**Cómo se juega:**

- Cada turno corre como en producción: el harness con Haiku 5.5, las banderas de `apphosting.yaml` y la Redactora encendida (Haiku en el banco, Luna en producción).
- Entre turnos se juega lo que la persona aprueba:
  - una búsqueda trae personas que calzan con sus criterios;
  - un lote las guarda y encuentra el correo de dos de cada tres;
  - una campaña queda en pausa y aparece en la lista;
  - una investigación termina y la conversación sigue con el mismo aviso que escribe el worker.
- **Tarea aprobada:** viaja en el contexto como la pasa el worker, con su grafo de pasos. Si entrega algo y le quedan pasos, sigue sola con «Continúa la tarea aprobada…». Un mensaje de la persona la sigue o la termina con la misma regla que producción (ver «Tareas largas» más abajo).
- **Fidelidad:** la conversación sigue con las mismas palabras que escribe el worker (`src/lib/cowork/continuation-messages.ts`, ahora compartido por el servidor y el banco). El historial lleva lo que carga `conversation-context.ts`: las lecturas, las tarjetas y los efectos de cada turno.
- **La persona simulada:** una persona hecha con Haiku contesta lo que Cowork pregunta. Usa pocas palabras, se queda dentro de lo que pidió y da el encargo por terminado cuando ya lo tiene.
- **La jueza:** al final, una jueza (Haiku) lee el trabajo entero contra lo que significa «terminado» para ese encargo. Marca si quedó completo, parcial o no, y califica de 1 a 5 el avance, la veracidad y la claridad. También anota los pasos de más, dónde se trabó y qué habría hecho distinto Claude Cowork.

`scripts/cowork-task-corpus.test.ts` prueba el simulador sin modelo (se corre en `scripts/verify-cowork.mjs`).

## Lo que encontró y ya se arregló

1. **Los correos de la Redactora para una campaña se perdían (PR 567, en `main`).**
   - La herramienta `redactar` le decía al coordinador «la Redactora ya escribió, propón la campaña», sin el texto. Haiku no proponía un texto que no había visto y contestaba «el texto no volvió a mí».
   - Lo escrito vive solo en el turno: la persona nunca veía los correos y la campaña no se creaba.
   - Ahora el coordinador ve los correos. Si igual no propone la campaña, la respuesta los lleva, y un «sí» siguiente la arma con ese texto.
   - El primer encargo pasó de no crear nunca la campaña a crearla.
2. **La Redactora se llamaba dos veces.** Haiku, con el texto ya escrito, volvía a pedir `redactar` en vez de proponer la campaña. Ahora la segunda llamada vuelve con «ya están escritos, propón la campaña».

## Resultado

Una corrida de los ocho encargos con el código de hoy y los dos arreglos de arriba. La jueza es Haiku 5.5, con el perfil y la oferta de quien pide a la vista: sin ellos marcaba como inventado lo que el perfil dice.

| Encargo | Terminado | Turnos | Costo del coordinador | Dónde se trabó |
| --- | --- | --- | --- | --- |
| `lista-y-campana` | sí | 6 | US$0,047 | — |
| `mineria-investigar-escribir` | no | 8 (máximo) | US$0,048 | Las investigaciones vuelven, pero en 8 turnos no alcanza a escribir los cinco correos; se confunde sobre quién quedó guardado |
| `correos-faltantes` | parcial | 3 | US$0,018 | Recomienda sin haber leído a todos los que no tienen correo |
| `informe-jefe` | sí | 1 | US$0,004 | — |
| `que-hago-hoy` | parcial | 8 (máximo) | US$0,065 | Avanza, pero en propuestas sueltas: no cierra lo que eligió hacer |
| `empresas-y-decisores` | sí | 3 | US$0,030 | — |
| `tarea-larga-plan` | sí | 5 | US$0,030 | — |
| `cada-lunes` | no | 8 (máximo) | US$0,045 | Las reglas le dicen que no cree tareas programadas: lo convierte en una búsqueda única |

- **4 de 8 terminados, 2 a medias.** Un encargo cuesta unos US$0,036 de coordinador y tarda unos 2 minutos de punta a punta.
- **El ruido es grande.** Con una sola corrida y una jueza Haiku, el mismo encargo cambia de «sí» a «parcial» entre corridas. El mismo trabajo, juzgado otra vez con la jueza corregida, pasó de 1 a 4 terminados. Para decidir entre variantes hacen falta al menos 3 corridas por variante.
- **Se probó y no quedó: «hacer en vez de ofrecer».** Era cambiar las continuaciones para que Cowork escribiera en la misma respuesta lo que el encargo ya pedía. Dio 2 de 8 contra 4 de 8, con menos llamadas (98 contra 109), y no se distingue del ruido. No se cambia en producción.
- **Las dos fallas que se repiten en las dos corridas** son las que hay que atacar primero:
  - **Programar desde el chat.** Lo que Claude Cowork hace con una tarjeta, aquí se le prohíbe al coordinador. Requiere un efecto nuevo y una migración pequeña: el tipo `schedule_create` en el *check* de `cowork_effect_proposals` y en la función que registra los efectos.
  - **Encargos largos con investigación.** Ocho turnos no alcanzan. Hace falta que la tarea siga viva cuando la persona contesta algo corto, y que sus pasos queden a la vista.

## Tareas largas: un «sí» ya no corta la tarea y sus pasos se ven

Segunda parte, el mismo 27 de octubre. Una tarea aprobada (un plan de 2 a 6 pasos que la persona aprueba una vez) terminaba apenas la persona escribía algo, aunque fuera «sí». Desde ahí, cada paso volvía a pedir su tarjeta. Claude Cowork, en cambio, sigue trabajando mientras la persona le contesta y deja el plan a la vista. En producción ninguna persona ha aprobado todavía una tarea (no hay eventos `task.*`), así que esto prepara la función antes de que se use.

**Qué cambia**

- **Un mensaje de la persona sigue con la tarea** (`coworkTaskReplyContinues`, `src/lib/cowork/task-plan.ts`) cuando es:
  - un «sí» («dale», «sigue», «ok, adelante»);
  - uno de los botones u opciones que ofreció el turno anterior;
  - la respuesta a lo que ese turno preguntó, aunque la dirija («no, primero lee los informes»).
- **Lo que la sigue terminando:** «para», «espera», un «no» a secas («no, todavía no»), un pedido que abre con «ahora…» u «otra cosa…», cualquier mensaje después de un turno que no preguntó nada, y los mensajes de más de 280 caracteres.
- **Lo que la tarea aprueba sola no cambia:** solo el paso siguiente del plan y dentro de su gasto. Enviar, activar o escribir por LinkedIn siempre piden aprobación.
- **Si un turno de la tarea pregunta algo, espera la respuesta.** Antes el worker seguía solo con el siguiente paso aunque Cowork acabara de preguntar.
- **Los pasos se ven.** Al final de cada turno de la tarea, el worker guarda dónde va cada paso (`task.progress`). La conversación lo muestra bajo el último turno de la tarea: lo hecho, el paso que sigue y lo que falta.
- **Los correos que Cowork escribe en su propia respuesta cuentan** para el paso de redactar en ese mismo turno. Antes la continuación pedía escribirlos de nuevo.
- **Una campaña lleva sus propios correos.** Si Cowork la propone con el texto ya escrito, cuenta también como el paso de redactar cuando es lo único que le falta. Antes ese paso nunca se marcaba: la campaña pedía su tarjeta y, ya creada, la tarea volvía a pedir redactar.
- **La tarjeta del plan lo dice:** «Si me contestas o me dices “sigue”, continúo; un pedido nuevo o un “para” la detiene».

**El banco, más fiel**

- **Mismo grafo que el worker.** La tarea del banco decide el siguiente paso y lo que se aprueba solo con `coworkTaskGraph`, a partir de todas las lecturas y efectos de cada turno. Antes usaba una regla propia por tipo de paso.
- **Lotes como en `prepare-batch-run.ts`:** un correo que el proveedor no encontró es un paso hecho con su nota, no un fallo, y la investigación se pide para todos los guardados.
- **Opciones nuevas:**
  - `--max-turns=12` da más turnos a los encargos con investigación;
  - `EVAL_TASK_REPLY=off` juega la regla anterior, para comparar.

**Resultado** (4 encargos × 2, hasta 12 turnos, Haiku):

| | Regla anterior | Regla nueva |
| --- | --- | --- |
| Encargos con plan aprobado | 5 | 5 |
| La tarea se cortó antes de terminar | 5 | 2 |
| Tarjetas que tuvo que aprobar la persona después del plan | 5 | 3 |
| Pasos que aprobó la propia tarea | 10 | 13 |
| Encargos terminados (de 8) | 1 | 1 |

- **En lo que ataca, el cambio funciona:**
  - Con la regla anterior, las 5 tareas se cortaron cuando la persona contestó una pregunta de Cowork («Sí, crea la campaña pausada…», «Sí, investiga a las 5…»). Desde ahí, cada paso volvió a pedir su tarjeta.
  - Con la nueva, «tarea-larga-plan» llega a la campaña sin otra aprobación en las dos corridas.
  - Los 2 cortes que quedaron eran respuestas largas que dirigían la tarea. Por eso se subió el tope de 160 a 280 caracteres y un «no, primero…» ya no la corta.
- **«Terminado» no se mueve:** 1 de 8 en ambas. Lo que la jueza marca como parcial es de contenido, no de la tarea:
  - la búsqueda trae 10 personas cuando se pidieron 20;
  - afirmaciones que el resultado no respalda;
  - en minería, demasiados turnos verificando las investigaciones.
- **Con la regla ya ajustada**, minería y tarea larga, 2 veces cada uno:
  - ningún mensaje de la persona cortó las 4 tareas;
  - la tarea aprobó 9 pasos sola y la persona, 2 tarjetas.
  - De esas 2, una era correcta: el segundo lote pedía más créditos que los que el plan aprobó.
  - La otra fue una campaña propuesta con sus correos ya escritos, con el paso de redactar todavía abierto. Eso llevó a arreglar lo de «una campaña lleva sus propios correos».
  - El banco, además, ahora cuenta lo que la Redactora entrega dentro del turno, como hace `onWriteDelivery` en producción.
  - Ninguno de los 4 quedó «terminado» para la jueza, por las mismas razones de contenido de arriba.
- **Revisión visual:** `cowork-tarea-en-curso` y su versión de teléfono, en claro y oscuro. Los 16 recorridos de Cowork pasan.

## Lo que sigue

1. **Programar desde el chat**, con aprobación: «cada lunes a las 9…» termina en una tarjeta «Programar», no en instrucciones. Necesita la migración del punto de arriba.
2. **Tareas largas: lo que falta.**
   - Un aviso por correo cuando la tarea termina. La app ya manda correos propios (`self-email.ts`); conviene decidirlo antes, porque es un correo nuevo a cada persona.
   - Que la búsqueda de una tarea traiga lo que el plan pide (20 personas, no 10).
   - Que, dentro de una tarea, Cowork no pregunte lo que el plan ya aprobó.
3. **Contexto más liviano.**
   - Cada llamada del coordinador lee unos 62.000 tokens: 75.000 caracteres de reglas, unos 33.000 del contexto del turno y las herramientas. El 87 % sale de la caché, así que con Haiku cuesta poco.
   - El problema es la atención: con tantas reglas, Haiku se salta algunas.
   - El camino es que las reglas de cada capacidad lleguen solo cuando se usan (las guías por demanda del harness, `skills.ts`), y medirlo con este banco.
4. **Medir con la Redactora de producción (Luna).** En el banco escribe Haiku, que dos veces devolvió «Writer returned no email».
5. **Archivos como entregable.** El informe en Word ya sale. Faltan Excel y presentaciones a partir de un pedido, con versiones.
6. **Conectores.**
   - **Calendario:** para proponer horarios cuando alguien pide reunión. Requiere agregar el permiso de calendario en la consola de Google (y probablemente una nueva verificación de Google) y en la de Microsoft; después cada persona reconecta su correo.
   - **Drive:** para leer archivos.
7. **Que se use.** Hoy lo usan 5 de 37 personas de los clientes. Llevar a Cowork desde «Hoy» con un encargo listo, y hacer seguimiento de las propuestas que quedan sin responder.

## Qué no se midió

- **La Redactora con Luna, como en producción:** la clave de OpenAI de la sesión estaba vencida. En el banco escribe Haiku, y dos veces devolvió «Writer returned no email».
- **El mundo es simulado:** las personas, las empresas y los hallazgos de las investigaciones son inventados por el banco. Sirve para ver si el trabajo avanza, no para juzgar el contenido de un correo.
- **La web es real:** con `COWORK_WEB_ENABLED=true`, las búsquedas en la web salen de verdad (US$0,01 cada una). La jueza ve qué se buscó y qué fuentes salieron.

## Cómo repetirlo

```
set -a; . <banderas COWORK_* de apphosting.yaml>; set +a
ANTHROPIC_API_KEY=... COWORK_WRITER_MODEL=claude-haiku-5-5 COWORK_REVIEWER_MODEL=claude-haiku-5-5 COWORK_MODEL=claude-haiku-5-5 \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-tasks.ts --live --writer --max-calls=500 [--tasks=a,b] [--repeat=2] [--max-turns=12] --output=tareas.json
```

`EVAL_DEBUG=1` imprime cada herramienta que llama el coordinador y lo que le vuelve. Con `--rejudge=tareas.json --max-calls=1`, la jueza vuelve a leer una corrida guardada sin volver a correr Cowork. Una corrida de los ocho encargos cuesta alrededor de US$0,5, entre coordinador, Redactora, persona y jueza, y tarda unos 20 a 40 minutos.
