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
- **Tarea aprobada:** viaja en el contexto como la pasa el worker. Si entrega algo y le quedan pasos, sigue sola con «Continúa la tarea aprobada…». Un mensaje de la persona la termina, igual que en producción.
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

## Lo que sigue

1. **Programar desde el chat**, con aprobación: «cada lunes a las 9…» termina en una tarjeta «Programar», no en instrucciones. Necesita la migración del punto de arriba.
2. **Tareas largas de verdad.**
   - Hoy una tarea aprobada termina apenas la persona escribe algo, aunque sea «sí».
   - Claude Cowork mantiene el plan visible y lo va completando. Falta:
     - una lista de pasos que se marca en la conversación;
     - que una respuesta corta no corte la tarea;
     - un aviso por correo cuando termina.
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
