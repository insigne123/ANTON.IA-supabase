# Cowork: conversaciones largas con memoria (1 oct)

**Problema (prueba del 1 oct, `Pruebas_de_app.docx`):**
- La conversación se cortó con «Este hilo alcanzó su límite. Abre un trabajo nuevo».
  - Había encadenado 13 pasos, y `cowork_reserve_model_call` recorría la ascendencia de a un paso y rechazaba pasados 13.
  - Sin embargo, solo había usado 22 de 40 llamadas y 127 mil de 180 mil tokens.
- Además, cada turno ve solo los últimos 8 turnos, sin resumen. Se perdió que el producto era revisión de antecedentes, y los correos hablaron de «automatización con IA».

## Qué cambia

1. **Cada conversación sabe cuál fue su primer turno** (`cowork_runs.root_run_id`).
   - Lo mantiene un trigger al crear un turno o al colgarlo de su padre.
   - Los turnos que ya existían se completaron con la migración.
   - El presupuesto lee la conversación de una vez, sin importar su largo: desaparece el corte a los 13 pasos.
2. **Topes nuevos** (`20261001220000_cowork_thread_root.sql`):

   | Tope | Antes | Ahora |
   |---|---|---|
   | Por turno | 11 llamadas, 55 mil tokens | Igual |
   | Por conversación | 40 llamadas, 180 mil tokens | 200 llamadas, 1 millón de tokens (resguardo ante un ciclo) |
   | Por persona y día (hora de Chile) | No había | 300 llamadas, 1,8 millones de tokens |

   El día más pesado hasta hoy usó 55 llamadas y 330 mil tokens.
3. **Memoria de la conversación** (`cowork_thread_memory`, migración `20261001230000`).
   - Con la decisión que cierra cada turno, Cowork deja un resumen corto: la oferta en juego, a quién se busca, las personas de este trabajo con su estado, las decisiones y lo pendiente.
   - El turno siguiente lo lee junto con el primer pedido de la conversación, que nunca sale del contexto.
   - Un turno viejo que termina tarde no pisa una memoria más nueva.
4. **La oferta en juego:** si el usuario dijo en la conversación qué producto promociona, esa oferta manda (decisión del 1 oct). Si no lo dijo, se usa la del Perfil.
5. **Mensajes sin «Abre un trabajo nuevo»:** cada tope dice qué hacer.

   | Tope alcanzado | Mensaje |
   |---|---|
   | Por turno | «Escríbeme «sigue» y continúo desde aquí, en esta misma conversación». |
   | Pasos automáticos seguidos | «Escríbeme para seguir: retomo en esta misma conversación». |
   | Del día | «Se renueva a medianoche, hora de Chile; lo que hicimos quedó guardado». |

## Piezas

- **Reglas puras:** `src/lib/cowork/thread-memory.ts` (forma de la memoria y contexto para el modelo).
- **Servidor:**
  - `src/lib/server/cowork/thread-memory.ts` (leer y guardar, como mejor esfuerzo);
  - `worker.ts` (la lee antes del turno y guarda la que trae la decisión);
  - `model-budget.ts` (distingue el tope del día y el de la conversación).
- **Loop:** `agent-loop.ts` acepta `memory` en la decisión y llama a `remember`. Las lecturas no la traen.
- **Mensajes:** `src/lib/cowork/failure-messages.ts`.

## Pruebas

- `src/lib/cowork/thread-memory.test.ts`: forma de la memoria y contexto.
- `src/lib/server/cowork/thread-memory.test.ts`:
  - leer el primer pedido y la memoria, siempre dentro de la cuenta;
  - un turno viejo no pisa uno nuevo;
  - sin raíz, no hace nada.
- `src/lib/cowork/agent-loop.test.ts`: la decisión que cierra el turno entrega la memoria, y una falla al guardarla no rompe el turno.
- `src/lib/cowork/failure-messages.test.ts`: ningún tope dice «trabajo nuevo».
- **pgTAP:**
  - `cowork_thread_root.test.sql`: el turno 18 de una conversación reserva su llamada, junto con los topes de conversación, del día y del turno;
  - `cowork_thread_memory.test.sql`: tabla, RLS, una por conversación y que se borra con ella.

# Memoria larga: recordar toda la conversación (5 nov)

**Problema (conversación real del 29 oct):**
- La segunda búsqueda de la conversación trajo 5 personas.
- Diez turnos después, tras ocho turnos de escribir y ajustar el correo, el usuario pidió «Sí, guarda las 5 personas de la segunda búsqueda y busca sus correos».
- Cowork respondió que no tenía sus nombres ni sus ids y que ya se habían usado las dos búsquedas del hilo.
- **Causa:**
  - Cada turno leía solo sus últimos 8 turnos (60 mil caracteres).
  - La memoria del modelo guarda personas con su id de contacto guardado, nunca el de una búsqueda.
  - Los chequeos de una propuesta solo aceptaban personas vistas en esos 8 turnos.
  - El lote «Preparar contactos» solo aceptaba personas de los últimos 12 pasos.
  - Lo de «las dos búsquedas» fue una invención: el tope de búsquedas cuenta solo los pasos automáticos que siguen a un mensaje.

## Cómo lo hacen los chats que recuerdan

- **ChatGPT y Claude** mandan la conversación completa en cada turno, en ventanas de cientos de miles de tokens. El caché de prompt abarata la parte que no cambia.
- **Cuando ya no cabe**, resumen la parte más antigua (compactación) y siguen.
- **Los agentes con herramientas** no guardan cada resultado completo: dejan referencias livianas (ids, nombres) y vuelven a leer el detalle cuando lo necesitan («just in time»).
- **La memoria entre conversaciones** es otra pieza. En Cowork ya existe: las preferencias que el usuario aprueba (`memory_save`).

**Lo que cambia en Cowork:**
- Cada turno se arma de nuevo desde la base de datos. No hay un arreglo de mensajes que viva entre turnos, así que «mandar todo» significa leer toda la conversación.
- El coordinador (Claude Haiku 5.5) admite 1 millón de tokens. Pasados 100 mil tokens de prompt, cada token de entrada cuesta 5 veces más.
- Por eso el contexto de la conversación se mantiene bajo unos 50 mil tokens, incluso en las conversaciones más largas.

## Qué cambia

La conversación viaja en tres capas.

1. **Los últimos turnos, completos** (`history`):
   - pasan de 8 a 12 turnos, y de 60 mil a 90 mil caracteres;
   - traen sus tarjetas, sus lecturas y lo que se hizo, como antes;
   - las consultas de cada turno van en paralelo, así que leer más turnos no agrega espera.
2. **Todo lo anterior, leído de la base** (`threadRecall`, nuevo). Se lee en pocas consultas paralelas: los turnos de la conversación por `root_run_id`, la rama recorrida en memoria y sus eventos en tandas de 100.
   - `earlierTurns`: cada turno anterior a `history`, en una o dos líneas (lo pedido, lo respondido, las tarjetas y lo que se hizo). Un paso automático no muestra su mensaje interno. Tope: 30 mil caracteres. Si no cabe, primero se acortan los turnos y luego salen los más antiguos después del primero.
   - `searches`: todas las búsquedas externas de la conversación, numeradas en orden («Búsqueda 1, 2…»). Cada una trae lo pedido, sus criterios y sus personas con sus ids, además de `savedLeadId` si hoy ya están en los contactos. Tope: 40 mil caracteres. Primero pierden su lista las búsquedas que `history` ya muestra completas; después se recortan las listas más largas, que dicen cuántas personas omitieron.
   - `emails`: la última versión de cada correo o secuencia escrita antes de `history`, salvo los que `history` muestra con el mismo título. Tope: 12 mil caracteres.
   - La instrucción pide buscar ahí antes de decir que algo no está, usar los ids tal cual y no repetir una búsqueda que ya existe.
3. **La memoria que escribe el modelo** (`threadMemory`, del 1 oct), sin cambios: la oferta en juego, a quién se busca, las decisiones y lo pendiente.

**Las personas de una búsqueda antigua se pueden usar:**
- Los chequeos de una propuesta leen las búsquedas de toda la conversación antes que `history` (`coworkWithRecallArchive`). El último turno sigue siendo el último, que es lo que responde un «sí».
- Guardar a una persona queda anclado al turno que la encontró, y al guardarla se vuelve a leer ese turno.
- El lote «Preparar contactos» revisa a cada persona contra toda la conversación, no contra los últimos 12 pasos.

**Costo:**
- En el peor caso, unos 170 mil caracteres (cerca de 50 mil tokens) en una conversación muy larga.
- En la conversación del 29 oct, unos 2 mil tokens más.
- Si la lectura falla, el turno sigue con `history`, como antes.

## Piezas

- **Reglas puras:** `src/lib/cowork/thread-recall.ts` (rama, búsquedas numeradas, turnos condensados, correos anteriores, contexto y archivo para los chequeos).
- **Servidor:**
  - `src/lib/server/cowork/thread-recall.ts` (lee la conversación, quién está guardado y la rama);
  - `conversation-context.ts` (12 turnos y lecturas en paralelo);
  - `prepare-batch.ts` (el lote mira toda la rama);
  - `worker.ts` (lo lee antes del turno y lo pasa al contexto y a los chequeos).
- **Contexto:** `decision-context.ts` (`threadRecall` con sus horas locales) y la instrucción de `thread-memory.ts`.

## Pruebas

- `src/lib/cowork/thread-recall.test.ts`:
  - la rama, sin otras versiones ni ciclos;
  - búsquedas numeradas con quién está guardado;
  - topes y recortes;
  - turnos condensados y correos anteriores;
  - contexto con horas locales;
  - el caso del 29 oct. Antes, el lote de la segunda búsqueda se rechazaba. Ahora sale con una sola aprobación, y guardar a una persona queda anclado a esa búsqueda.
- `src/lib/server/cowork/thread-recall.test.ts`: la conversación del 29 oct con personas inventadas. Prueba:
  - las dos búsquedas con sus personas y su estado actual;
  - los turnos anteriores en orden;
  - la rama completa sin la versión descartada;
  - que toda lectura queda dentro de la cuenta.
- `src/lib/server/cowork/conversation-context.test.ts`: el tope nuevo de `history`.
