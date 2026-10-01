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
