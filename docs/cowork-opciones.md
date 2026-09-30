# Cowork · Preguntas con opciones (29 sep 2026)

Plan 2, punto V5. Cuando Cowork necesita un dato que solo el usuario sabe y que tiene pocas respuestas posibles, ya no pide escribirlo: la pregunta llega con sus **opciones para tocar**, de a una o varias, más «Otra respuesta» para escribir. Por ejemplo:
- a qué segmentos va una campaña;
- en qué industria buscar prospectos;
- cuál de varias alternativas prefiere.

Las preguntas de sí o no siguen con sus respuestas sugeridas, como antes.

## Qué cambia para el usuario

- **Bajo la pregunta final** aparecen las opciones, con el mismo estilo que las respuestas sugeridas:
  - **Una respuesta:** un toque la envía, tal como está escrita («Minería»).
  - **Varias respuestas:** dice «Elige una o varias.».
    - Cada toque marca o desmarca una opción, y su casilla se dibuja con un check.
    - «Continuar» se habilita con la primera marcada y dice cuántas lleva («Continuar con 2»).
    - Envía la respuesta como la escribiría una persona: «RR. HH. y outsourcing y Retail», o con comas si son más («A, B y C»).
  - **«Otra respuesta»:** abre un campo para escribir (Escape lo cierra y devuelve el foco al botón).
    - Con una sola respuesta, Enter o la flecha envían lo escrito.
    - Con varias, lo escrito se suma a las marcadas.
- **Al enviar,** las opciones se van, como las sugerencias, y el mensaje aparece en la conversación. Si el envío falla, vuelven listas para responder otra vez.
- **Teclado y lectores de pantalla:**
  - las opciones de una respuesta son botones, y las de varias son casillas (`role="checkbox"`, `aria-checked`);
  - el grupo se anuncia como «Elige una respuesta» o «Elige una o varias respuestas»;
  - Tab recorre las opciones y Espacio marca o desmarca.
- **Movimiento:** el grupo entra con el mismo fundido corto que las sugerencias y el campo de «Otra respuesta» abre su espacio. Con «reducir movimiento», nada se desplaza y el check aparece ya dibujado.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Contrato: `answer.choices {multiple, options}` junto a `answer.question`; lectura para la página (`coworkStoredChoices`); mensaje que envía una elección (`coworkChoiceMessage`) | `src/lib/cowork/contracts.ts` |
| Limpieza (`coworkChoices`), y opciones solo con pregunta final: con ellas no hay sugerencias ni el «Sí, adelante» automático | `src/lib/cowork/answer-quality.ts` |
| Una corrección de cierre no las pierde | `completeFrom` en `src/lib/cowork/agent-loop.ts` |
| Lectura del turno terminado | `coworkTurnChoices` en `src/lib/cowork/presentation.ts` |
| Tarjeta | `src/components/cowork/CoworkChoices.tsx`, bajo la pregunta en `CoworkTurn.tsx` |
| Regla del modelo | reglas 4 y 9 de `agent-instructions.ts` |
| Juez | ve las opciones (`opciones` en lo que vio el usuario) y tiene una regla para ellas (`judge.ts`) |

- **Qué deja pasar la limpieza:**
  - de 2 a 5 opciones distintas, de hasta 60 caracteres;
  - sin IDs, códigos ni [corchetes], y sin viñetas ni numeración al inicio;
  - un punto final suelto se quita; el de una abreviatura se queda («RR. HH.»).
  - «Sí» y «No» solos no son una elección: la pregunta queda con su «Sí, adelante».
  - Sin pregunta final, no hay opciones.
- **Se guardan con la respuesta** (`run.completed`), igual que las sugerencias: sin migración y sin flag. Los turnos anteriores no traen opciones y se ven como siempre.
- **La regla del modelo:**
  - usa opciones cuando la pregunta pide un dato que solo el usuario sabe y que tiene pocas respuestas posibles;
  - las toma de lo que consultó cuando se puede (los segmentos de sus contactos), con nombres cortos y los detalles en la respuesta;
  - no las usa para un sí o un no, ni para algo que puede decidir con un valor razonable (regla 5) o consultar (regla 6).
- **La regla del juez:** pedir así un dato que solo el usuario sabe no es fricción. Pedir con opciones algo que Cowork podía decidir o consultar sí lo es, igual que ofrecer un sí y un no como opciones.

## Validación

**Pruebas sin modelo** (`npm run test:unit` y `verify-cowork`; cifras en el PR):
- `answer-quality.test.ts` (+3):
  - las opciones se limpian una por una: viñetas, negritas, largos, IDs, [corchetes], repetidas, «Otra…» (la app ya la ofrece) y «Sí» y «No» solos;
  - solo acompañan a una pregunta final, y con ellas no hay sugerencias;
  - la página lee las guardadas, y elegir envía lo que escribiría una persona.
- `presentation.test.ts`: las opciones salen de la respuesta terminada; los turnos anteriores no traen.
- `agent-loop.test.ts` (+1): si la corrección de cierre las pierde, vuelven las de la primera respuesta.
- `decision-context.test.ts` (+1) y `judge.test.ts` (+1):
  - la regla del modelo, y lo que el juez ve y lee de las opciones;
  - sin opciones, la entrada del juez no cambia.
- **Corpus sin modelo:**
  - un caso nuevo, `opciones-industria` («quiero buscar prospectos nuevos en otra industria para axis, ayudame»): pregunta con opciones de industrias y no busca a ciegas;
  - las verificaciones comunes aceptan opciones en lugar de sugerencias.

**Navegador:** Playwright contra el build de producción local, con un Supabase simulado solo en local (`fake-supabase-v5.mjs`) y dos turnos terminados: segmentos (varias) e industria (una). Lo que la página envía se captura, y la respuesta es un error local, así que no se crea nada. Se probó en claro y oscuro a 1440 px, en claro a 390 px y con `reducedMotion: 'reduce'`. En las cuatro variantes:
- **Varias:**
  - la pregunta, «Elige una o varias.» y las 4 casillas, sin sugerencias;
  - «Continuar» desactivado al inicio;
  - con clic y con teclado (Tab y Espacio) se marcan, con el anillo de foco visible;
  - «Continuar con 2» y, con «Otra respuesta» escrita, «Continuar con 3»;
  - se envía «RR. HH. y outsourcing, Retail y solo los de Santiago».
- **Una:**
  - 5 opciones más «Otra respuesta», sin casillas ni «Continuar»;
  - un toque envía «Minería»;
  - «Otra respuesta» con Enter envía «Salud»;
  - Escape cierra el campo y devuelve el foco al botón.
- **Si el envío falla:** las opciones vuelven, listas para reintentar, y las marcadas siguen marcadas. La primera pasada mostró que quedaban bloqueadas; ahora el bloqueo contra el doble toque dura 1,5 s.
- **Movimiento reducido:** el grupo aparece sin desplazamiento.
- **En todos los casos:** sin errores de página ni scroll horizontal. `/cowork` queda en 240 kB de carga inicial (`main`: 239 kB).

**Con el modelo real** (`gpt-6-luna`, con la Redactora y el juez del turno encendidos, como en producción; juez offline `gpt-6-sol`; mismo día):

| | Casos que pasan | Juez: buenas / mejorables / malas | Fricción | Utilidad | Mediana |
|---|---|---|---|---|---|
| `opciones-industria`, `main` × 3 | 0 de 3 | 2 / 1 / 0 | 5,0 | 5,0 | 10,6 s |
| `opciones-industria`, este PR × 5 | 4 de 5 | 5 / 0 / 0 | 5,0 | 4,2 | 11,1 s |
| 8 casos que cierran con una pregunta, `main` × 3 | 21 de 24 | 6 / 6 / 12 | 3,33 | 3,58 | 17,0 s |
| Los mismos, este PR × 3 | 21 de 24 | 8 / 6 / 10 | 3,63 | 3,54 | 17,4 s |

- **En «otra industria»:**
  - `main` propone la búsqueda con una industria que elige él (la tarjeta de búsqueda se puede editar antes de aprobar);
  - este PR pregunta con opciones en 4 de 5, y la quinta propone la búsqueda.
  - El juez da por buenas las dos formas: el cambio es cómo se responde la pregunta (un toque en vez de escribir), no si la respuesta es buena.
- **Los 8 casos de regresión** son `vender-mas`, `mkt-necesito-clientes`, `mkt-que-puedes-hacer`, `mkt-a-quien-escribo`, `mkt-campana-rrhh`, `metricas-semana`, `agendar-reunion` y `prospeccion-mineria`.
  - Ninguna de las 24 respuestas usó opciones: siguen con su «sí» y sus sugerencias.
  - Las diferencias caben en el ruido medido antes.
- **Dos casos se probaron y se descartaron, porque ahí lo correcto es no preguntar:**
  - «ayúdame a elegir a cuáles de mis contactos»: el modelo recomienda a quiénes con los datos;
  - un correo cuando la cuenta vende dos productos: el modelo escribe el correo.

  El juez les dio 5 en todo a esas respuestas, en `main` y en este PR. Las opciones quedan para lo que de verdad bloquea, como dicen las reglas 5, 6 y 10.

## Límites

- **Hasta 5 opciones.** Para más alternativas, la respuesta las resume y el usuario puede escribir otra.
- **Solo las respuestas del coordinador traen opciones.** La Redactora entrega correos y cierra con su pregunta de sí o no.
- **Una elección no guarda nada:** es un mensaje más en la conversación, que el siguiente turno lee con la pregunta que respondió.
