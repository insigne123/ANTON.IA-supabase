# Cowork · respuestas sugeridas (26 sep 2026)

## Qué cambia para el usuario

Bajo la última respuesta de Cowork aparecen hasta tres botones con las respuestas más probables. Un toque envía el mensaje en el mismo hilo, sin escribir.

- El primero responde «sí» a la pregunta con que cierra la respuesta. Va destacado con el color de acento.
- Los demás son alternativas distintas que Cowork puede hacer apenas se tocan.
- El botón muestra una etiqueta corta («Sí, busca los correos»). Lo que se envía es el mensaje completo («Sí, busca el correo de Carlos de Minera Centinela…»), visible al pasar el cursor.
- Solo aparecen en el turno más reciente, cuando terminó, no hay una propuesta esperando aprobación y se puede enviar.

Idea tomada de las «follow-up chips» de LobeHub y los «Follow up» de Open WebUI. Aquí las genera el mismo modelo en la misma respuesta, sin una llamada extra.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| `answer.suggestions [{label, message}]`, opcional y nulo al proponer | `src/lib/cowork/contracts.ts` |
| Regla 9 del prompt: 1 a 3 sugerencias, accionables, sin relleno | `src/lib/cowork/agent-instructions.ts` |
| Saneo determinista antes de guardar | `coworkSuggestions` en `src/lib/cowork/answer-quality.ts` |
| Una corrección si falta la pregunta final o las sugerencias | `closingFeedback` en `src/lib/cowork/agent-loop.ts` |
| Lectura para la interfaz | `coworkTurnSuggestions` en `src/lib/cowork/presentation.ts` |
| Botones y envío | `CoworkTurn.tsx`, `CoworkWorkspace.tsx` |

**Saneo.** Se descarta cada sugerencia que no cumpla, sin rechazar la respuesta:
- etiqueta de más de 40 caracteres o mensaje de más de 200;
- con un UUID;
- con un mensaje que termina en «:», porque espera texto del usuario;
- que deja algo para después, porque no se puede hacer al tocarla: empieza con «Sí, cuando…» o dice «voy a…», «te indicaré…», «te aviso…», «más tarde» o «déjame pensar».

También se traducen los códigos internos igual que en la respuesta y se quedan como máximo tres.

**Corrección.** Si una respuesta sin propuesta llega sin la pregunta final o sin sugerencias válidas, el bucle pide una sola corrección, nunca en la última decisión. Si la corrección tampoco cumple, la respuesta queda como vino.

**Sin migraciones.** Las sugerencias viajan dentro del evento `run.completed`, que se guarda tal cual en `cowork_run_events.payload`. Los turnos anteriores no tienen sugerencias y se ven igual que antes.

## Validación con el modelo real

Corpus `scripts/fixtures/cowork-conversation-corpus.ts` con gpt-6-luna, el bucle real y lecturas de fixture. No se tocó producción, la base de datos ni proveedores.

Se agregaron dos verificaciones comunes a los 14 casos:
- ofrece respuestas sugeridas cuando responde sin proponer;
- cada sugerencia pide algo que Cowork hace al tocarla, sin anuncios ni condiciones.

| Medición | Casos | Verificaciones | Respuestas con sugerencias |
|---|---|---|---|
| Antes (sin sugerencias, 1 repetición) | 14/14 | 84/84 | — |
| Primera versión de la regla | 14/14 | 98/98 | 11/11 |
| Reglas de sugerencias accionables | 25/28 | 221/224 | 18/18 |
| Sin sugerencias a medias | 26/28 | 222/224 | 17/17 |
| Corrección del cierre, 3 repeticiones | **41/42** | **335/336** | **30/30** |

En la última corrida todas las respuestas cierran con pregunta y sugerencias, con 2,2 llamadas por caso, igual que antes. La única falla es `recomendacion-hoy`, que repitió una lectura del turno anterior; no tiene relación con este cambio.

Cómo se corre:

```
OPENAI_API_KEY=… COWORK_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=220 --repeat=3 --output=eval.json
```

El resumen incluye `answersWithSuggestions` y la consola muestra las sugerencias de cada caso para leerlas.

## Pendientes

- **Salto antes de la pregunta final:** si la pregunta viene justo después de una lista, el Markdown la deja dentro del último punto. Es previo a este cambio y queda para un ajuste del parser.
- **Botones solo en el último turno:** en un turno anterior no se muestran, para no ofrecer acciones sobre un estado que ya cambió.
