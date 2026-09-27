# Cowork · cierre con pregunta aparte (26 sep 2026)

Primer PR de la Ola A del plan de Cowork (punto 4.1: la pregunta final como campo aparte).

## Qué cambia para el usuario

Cada respuesta termina con una pregunta sobre el siguiente paso, por ejemplo «¿Preparo la campaña para estos 4 contactos?». Ahora esa pregunta:

- **Se ve aparte:** queda debajo del texto, con un ícono de siguiente paso y justo encima de los botones. Antes podía quedar en medio de un párrafo.
- **Siempre tiene un botón para decir que sí:** si el modelo no dejó sugerencias, aparece «Sí, adelante». Tocarlo envía «Sí, adelante.».
- **No se pierde:** si el bucle pide corregir la respuesta y el reintento la olvida, se recupera la pregunta anterior.

Los turnos anteriores se ven igual que antes, porque el texto guardado no cambia de forma.

Además, proponer una campaña ya no termina el turno con error cuando el modelo no consultó antes las campañas existentes. Si quedan lecturas, el bucle las consulta él mismo y sigue con la propuesta.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| `answer.question`: opcional; nula al proponer un efecto | `coworkDocumentSchema` en `src/lib/cowork/contracts.ts` |
| Saneo de la pregunta: una frase con «¿…?», sin IDs ni `[relleno]`, de hasta 300 caracteres | `coworkQuestion` en `src/lib/cowork/answer-quality.ts` |
| La pregunta queda al final de `reply` sin repetirse, y reemplaza otra pregunta final distinta | `polishCoworkAnswer` en `answer-quality.ts` |
| Botón «Sí, adelante» cuando hay pregunta y no hay sugerencias | `COWORK_YES_CHIP` en `answer-quality.ts` |
| La corrección de cierre acepta la pregunta en `answer.question`, no gasta una llamada solo por faltar botones y recupera la pregunta si se pierde | `closingFeedback` y `completeFrom` en `src/lib/cowork/agent-loop.ts` |
| `campaign.create` sin `campaigns.list`: el bucle la consulta si quedan lecturas | `runCoworkReadLoop` en `agent-loop.ts` |
| Reglas 4 y 9 y formato de salida | `src/lib/cowork/agent-instructions.ts` |
| El chat separa cuerpo y pregunta | `coworkReplyBody` en `contracts.ts`, `NextStep` en `src/components/cowork/CoworkTurn.tsx` |

La pregunta también queda al final de `reply`. Así el historial, las copias y los exportes la leen igual que antes, sin cambios en esas partes.

No hay migración: la pregunta viaja en `run.completed`.

## Validación

**Modelo real** (gpt-6-luna, bucle real, lecturas de fixture, 31 casos con 3 repeticiones = 93 ejecuciones), el mismo día contra la base (insigne123/ANTON.IA-supabase#8, `cf183bf`):

| | Base (#8) | Este PR |
|---|---|---|
| Casos | 89/93 | **92/93** |
| Verificaciones | 806/813 | **812/813** |
| Marketing (correo y LinkedIn) | 30/33 | **33/33** |
| Turnos que terminan con error | 1 | **0** |
| Respuestas con pregunta final y botones | 69/69 | 64/64 |
| Consultas por caso | 1,87 | 1,83 |
| Llamadas al modelo por caso | 2,24 | 2,26 |

La única falla restante (`linkedin-seguimiento`, 1 de 3) es de contenido: no explicó cómo sincronizar LinkedIn. También falla a veces con la base.

**Lo que corrigió la medición.** La primera medición de este PR dio 91/93. Leyendo las respuestas aparecieron tres problemas, que se corrigieron antes de la medición final:
- **Campaña después de tres consultas:** el modelo consultó contactos, oferta y contexto, y propuso la campaña en su última decisión sin haber visto las campañas existentes. El bucle rechazaba la propuesta y el turno terminaba con error. Ahora esa consulta la hace el bucle una vez, aunque ya se hayan usado las tres.
- **Campaña sin explicación:** en ese mismo caso el modelo no explicó la propuesta y la tarjeta llegaba con un texto genérico. Ahora llega con una nota: nombre, destinatarios y correos, y que queda pausada.
- **Párrafo perdido:** si el último párrafo de `reply` terminaba con otra pregunta, se reemplazaba el párrafo completo por la pregunta final. En un caso se perdió la lista de a quién escribir. Ahora solo se quitan las oraciones que preguntan; el resto del párrafo queda.

Además, `compliance.law` pide decir en `reply` que es información general y no asesoría legal. Antes era solo una descripción de la consulta, y el modelo la omitió 2 de 6 veces.

Entre medio, una prueba dirigida de los 4 casos de campaña (3 repeticiones), ya con la primera corrección, dio 11/12 sin turnos con error. La falla que quedaba era la campaña sin explicación, que llevó a la segunda corrección.

**Pruebas sin modelo:**
- `answer-quality.test.ts`: la pregunta se sanea, se agrega al final una sola vez, reemplaza solo las oraciones que preguntan y trae el botón «Sí, adelante».
- `agent-loop.test.ts`: la pregunta aparte no gasta una corrección; la campaña consulta las existentes aun después de tres lecturas y llega con nota.
- `presentation.test.ts`: los turnos nuevos muestran la pregunta aparte y los viejos quedan igual.

Cómo se corre la evaluación:

```
OPENAI_API_KEY=… COWORK_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=400 --repeat=3
```

## Pendientes

- **Preguntas con opciones** (punto 4.2 del plan): cuando falta un dato (fecha, segmento, proveedor), mostrar una tarjeta con opciones en vez de una pregunta de texto.
