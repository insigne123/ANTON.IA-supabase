# Cowork · ver el proceso en vivo (26 sep 2026)

Tercer PR de la Ola A del plan de Cowork (punto 1.3: plan visible y menos espera).

## Qué cambia para el usuario

Mientras Cowork trabaja, el chat muestra su plan como una lista de pasos que se van marcando:

- **Al empezar**, aparecen de 2 a 5 pasos cortos, por ejemplo «Reviso tus contactos de RR. HH.», «Veo a quién ya le escribiste» y «Redacto el correo con tu oferta».
- **Cada paso** muestra si está hecho (✓), en curso (círculo que gira) o pendiente. Si Cowork decidió que un paso no hacía falta, queda tachado; nunca se marca como hecho algo que no se hizo.
- **Arriba** se ve qué está haciendo ahora, cuántos pasos lleva y el tiempo.
- **Al terminar**, la lista se pliega en una línea: «Siguió un plan de 3 pasos y hizo 2 consultas». Al abrirla se ven el plan y cada consulta.

Además, la pantalla se actualiza apenas cambia algo, en vez de esperar la próxima consulta (cada 2 a 4 segundos).

Si la pregunta se responde sin consultar nada (un saludo o una duda simple), no hay plan: la respuesta llega directo.

## Cómo funciona

**El plan lo escribe el modelo en su primera decisión.**
- Es un campo nuevo, `outline`, de la decisión: pasos con `label` y `read` (la consulta que completa ese paso, o `null` para el paso en que escribe la respuesta). Regla 12 del prompt.
- El bucle lo sanea con `coworkOutline`: sin IDs ni `[relleno]`, sin Markdown, hasta 80 caracteres por paso, hasta 5 pasos. `read` se conserva solo si es una consulta que el bucle conoce.
- Se guarda una sola vez, antes de la primera consulta, como evento `tool.completed` con `action: 'assistant.plan'` (igual que la nota del asistente). No requiere migración.
- Nunca vuelve al modelo como dato: no entra en las observaciones del turno, ni en el historial del hilo (`conversation-context.ts`), ni en la reanudación de especialistas (`specialist-queue.ts`), ni en el conteo de lecturas.
- Desde la primera consulta, el contexto incluye `planStatus` («el plan ya se mostró: outline es null»), para que no lo repita.

**El avance lo calcula la interfaz** (`coworkPlanProgress` en `presentation.ts`):
- Un paso con `read` queda hecho cuando esa consulta termina.
- Una consulta planificada que no se hizo, y que quedó atrás de otra ya hecha, se marca como «no hizo falta».
- El paso final queda hecho cuando llega la respuesta o la propuesta.
- Si el trabajo falla, lo pendiente queda pendiente y nada aparece «en curso».
- El panel lateral «Progreso» nombra el paso en curso («Paso 2 de 3: …»).

**La actualización inmediata usa un stream (SSE)**: `GET /api/cowork/runs/[id]/stream`.
- Solo avisa que algo cambió (estado o último evento); no lleva contenido. La página vuelve a leer el turno con el `GET` de siempre.
- Revisa el turno una vez por segundo con dos consultas indexadas, con la sesión del usuario (RLS) a través de su token. Cierra al terminar el turno, cuando el usuario se va o a los 55 s; el navegador se reconecta solo.
- La página abre el stream solo mientras Cowork trabaja; con una decisión pendiente lo cierra. Si el stream falla, sigue consultando como antes.
- Mientras el stream está abierto y el turno corre, la consulta de respaldo baja de cada 2 a 4 segundos a cada 15.

| Pieza | Dónde |
|---|---|
| `outline` en la decisión y `coworkOutline` | `src/lib/cowork/agent-loop.ts` |
| Regla 12 | `src/lib/cowork/agent-instructions.ts` |
| `COWORK_PLAN_ACTION`, `coworkPlanSteps`, `coworkIsAssistantEvent` | `src/lib/cowork/contracts.ts` |
| `coworkPlanProgress` | `src/lib/cowork/presentation.ts` |
| Lista del plan y resumen | `src/components/cowork/CoworkActivity.tsx` |
| Stream | `src/app/api/cowork/runs/[id]/stream/route.ts`, `src/lib/server/cowork/run-stream.ts`, `getCoworkRunCursor` en `runs.ts` |
| Stream y respaldo en la página | `src/components/cowork/CoworkWorkspace.tsx` |
| `planStatus` | `src/lib/cowork/decision-context.ts` |
| Notas de propuestas sin explicación del modelo (`proposalNote`) y de una búsqueda que antecede una campaña | `src/lib/cowork/agent-loop.ts` |
| El corpus guarda el plan y mide `plansShown`, `plannedReadsRun` y `laterOutlines` | `scripts/fixtures/cowork-conversation-runner.ts`, `scripts/evaluate-cowork-conversations.ts` |

## Validación

**Modelo real** (gpt-6-luna, bucle real, lecturas de fixture, 31 casos con 3 repeticiones = 93 ejecuciones), el mismo día contra el PR anterior (tarjetas):

| | PR anterior | Este PR |
|---|---|---|
| Casos | 91/93 | 90/93 |
| Verificaciones | 823/825 | 817/825 |
| Turnos que terminan con error | 0 | 1 (respuesta vacía del proveedor) |
| Turnos con consultas que muestran plan | — | 66/75 (88 %) |
| Consultas planificadas que sí se hicieron | — | 122/126 (97 %) |
| Plan repetido en decisiones posteriores | — | 0 (antes, 3 de 17) |
| Consultas por caso | 1,69 | 1,67 |
| Llamadas al modelo por caso | 2,09 | 2,16 |

- **Fallas restantes**, ninguna del plan ni del stream:
  - `prospeccion-mineria`: el proveedor devolvió una respuesta vacía;
  - `agendar-reunion`: propuso buscar el correo en vez de explicar que no agenda;
  - `mkt-a-quien-escribo`: nombró a un solo contacto.
- **Lo que corrigió la medición.** Hubo tres mediciones completas y dos dirigidas; lo que apareció se corrigió antes de la final:
  - **Propuestas sin explicación del modelo:** una de LinkedIn y otra de buscar un correo llegaban con «Revisa la propuesta antes de ejecutar el cambio.». Ahora llegan con una nota que dice qué hacen y para quién. Cubre LinkedIn, buscar correo, investigar y guardar; las campañas ya la tenían. Dos pruebas que exigían el texto genérico se actualizaron.
  - **Búsqueda como primer paso de una campaña:** sin nota del modelo, no decía que la campaña venía después (2 de 3 en una medición). La nota de respaldo ahora lo dice. Prueba dirigida: 12/12.
  - **Plan repetido:** el modelo repetía el plan en 3 de 17 decisiones posteriores, salida que nadie ve. Desde la primera consulta, el contexto dice que el plan ya se mostró: 0 en la final.
- **Tiempo:**
  - El plan agrega unos 15 a 80 tokens a la primera llamada.
  - En tiempo total, pesa más la variación de la API: en la medición final, los turnos sin consultas (que no tienen plan) también fueron 1,6 s más lentos que en la del PR anterior.
  - El plan aparece al terminar la primera llamada (unos 3 s), antes de la respuesta completa.

| | PR anterior | Este PR |
|---|---|---|
| Turno sin consultas (sin plan) | 4,1 s | 5,7 s |
| Turno con consultas (con plan) | 8,1 s | 9,6 s |
| Tokens de salida de la primera llamada | 297 | 314 |

**Pruebas sin modelo:**
- `agent-loop.test.ts`: el plan se guarda una vez, saneado y antes de la primera consulta, y nunca llega al modelo como dato. Tampoco hay plan si responde sin consultar. Notas de propuestas sin explicación.
- `presentation.test.ts`: estados del plan (hecho, en curso, pendiente, no hizo falta), la línea «Plan listo. Empezando…», el paso en curso del panel lateral y la lectura del plan guardado.
- `run-stream.test.ts`: el stream avisa una vez por cambio, cierra al terminar, manda latidos y se detiene si el usuario se va.
- `conversation-context.test.ts` y `decision-context.test.ts`: el plan no entra al historial; `planStatus` aparece solo después de la primera consulta.

**Navegador** (Playwright contra el build de producción local, con un Supabase simulado solo en local que avanza un turno cada 4 s):
- Escritorio claro y oscuro (1440 px) y teléfono (390 px).
- El plan aparece con el primer paso en curso y se va marcando.
- Cada paso se marca entre 0,5 y 1 s después del cambio, en vez de esperar la consulta siguiente.
- El panel lateral dice «Paso 2 de 3: …».
- Al terminar se pliega en «Siguió un plan de 3 pasos y hizo 2 consultas».
- Sin scroll horizontal y sin ningún POST.
- `curl` del stream: `change` a los 0,1 s, 4,1 s, 8,1 s y 12,2 s, y `end` al completarse. Sin sesión responde 401.
- **Encontrado en esta prueba:** la primera versión del stream se cerraba al segundo. Las cookies de la petición ya no se pueden leer una vez que la respuesta empieza. Ahora las lecturas usan el token de la misma sesión, con RLS.

## Pendientes

- **Agentes en la lista:** cuando lleguen los especialistas con rol propio (Ola B), cada paso podrá mostrar quién lo hace («Redactora: 3 correos»).
- **Texto mientras se escribe** (punto 4.6 del plan): el stream ya existe; falta enviar la respuesta por partes.
