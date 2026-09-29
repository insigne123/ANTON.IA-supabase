# Cowork · Redactora y Revisora escriben los correos del turno (28 sep 2026)

Primer PR de la Ola G del plan 2 de Cowork (punto G1). Cuando un turno tiene que entregar un correo o una secuencia, el coordinador ya no los escribe él mismo. Le pasa un encargo a la **Redactora**; controles fijos y la **Revisora** leen el borrador, y la Redactora lo corrige una vez si hace falta. Todo va detrás de `COWORK_WRITER_ENABLED`: sin el flag, Cowork funciona igual que hoy.

## Qué cambia para el usuario

- **Se ve quién hace qué:** bajo el paso del plan que escribe aparecen dos filas, cada una con su ícono.
  - «Redactora · Escribiendo 3 correos…» pasa a «Escribió 3 correos», con su check.
  - «Revisora · Revisando 3 correos…» pasa a «Aplicando 1 ajuste…» y termina en «1 ajuste», con lo que cambió en una pastilla («sin cifras inventadas»).
  - El titular «Ahora» dice lo mismo: «Redactora · escribiendo 3 correos».
  - Las filas cambian en su lugar, sin nada que gire en bucle; solo el marcador del paso y el titular dicen que sigue trabajando.
  - En un turno sin plan, la línea de actividad dice quién escribe («Redactora · escribiendo 3 correos…»). Las filas aparecen debajo cuando suman algo: cuando la Redactora termina o empieza la Revisora.
- **Lo que encontró va primero:** el texto de la Redactora parte por lo que encontraron las consultas del coordinador («Felipe y Camila tienen correo; Marcela queda fuera porque ya le escribiste»), incluido lo que Cowork no puede hacer de lo pedido (por ejemplo, agendar). El texto aparece mientras se escribe, seguido de las tarjetas «Armando la secuencia · correo 2».
- **Mientras se revisa, se dice:** el texto en pantalla se queda, sin cursor, con «Revisando la respuesta…». La tarjeta en camino dice «Revisando la secuencia».
- **La tarjeta dice cómo quedó:**
  - «Revisado · sin cifras inventadas» cuando la Revisora corrigió algo;
  - «Revisado · sin ajustes» cuando no hizo falta;
  - «Revísalo antes de usarlo», con lo que falta, cuando no alcanzó a corregirse (no hubo tiempo o la corrección falló);
  - sin marca cuando no hubo revisión.
- **Al terminar:** la actividad se pliega en una línea («Siguió un plan de 3 pasos, hizo 2 consultas y escribió 3 correos»). Al abrirla se ven la Redactora y la Revisora con lo que hicieron.
- **Con «reducir movimiento»:** sin desplazamientos y con el check ya dibujado.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Encargo del coordinador (`draft.write` con `write {kind, recipients, objective, angle, tone, steps, notes, findings}`) | `coworkDecisionSchema` en `src/lib/cowork/agent-loop.ts`, regla en `agent-instructions.ts` (`writerCapability`) y `writerAvailable` en `decision-context.ts` |
| Redactora, controles fijos, Revisora y una corrección | `runCoworkWriter` en `src/lib/cowork/writer.ts` |
| Conexión con el worker: presupuesto por rol, tiempo del turno, streaming y pasos | `coworkWriterTurn` en `src/lib/server/cowork/writer-run.ts` |
| Presupuesto por rol, con respaldo mientras M2 no esté aplicada | `reserveCoworkModelCall` en `src/lib/server/cowork/model-budget.ts` |
| Pasos de cada agente como eventos (`assistant.agent`) | `COWORK_AGENT_ACTION` y `coworkAgentEvent` en `src/lib/cowork/contracts.ts` |
| Filas de agentes, línea en vivo y marca de revisión | `coworkAgentRows`, `coworkAgentLine` y `coworkDraftReview` en `src/lib/cowork/presentation.ts` |
| Interfaz | `CoworkActivity.tsx` (`AgentRows`), `CoworkBlocks.tsx` (`ReviewLine`), `CoworkTurn.tsx` |

- **La Redactora:**
  - recibe el encargo, lo consultado en el turno (contactos, envíos y el contexto de redacción) y el perfil del usuario;
  - devuelve la respuesta completa del turno: texto (que parte por los hallazgos del coordinador, `findings`), una tarjeta de correo o secuencia, la pregunta final y las respuestas sugeridas;
  - su texto sale en vivo (usa el mismo borrador en vivo de V2).
- **Controles fijos, antes de gastar una llamada:**
  - texto de relleno entre corchetes;
  - términos prohibidos del contexto de redacción;
  - «gratis» o «sin costo» sin una oferta de prueba aprobada;
  - promesas («garantizamos», «el mejor»);
  - anunciar el último correo antes del último;
  - saludo con nombre en un texto que va a varias personas;
  - correo sin saludo;
  - falta de la firma del usuario.
  Si encuentran algo, la Redactora corrige sin pasar por la Revisora.
- **La Revisora:** busca datos inventados, promesas, tono y ortografía. No marca el saludo sin nombre ni el singular en correos de campaña, porque cada persona recibe el mismo texto por separado.
- **Una sola corrección:**
  - si la corrección rompe más de lo que arregla, queda el primer borrador;
  - si falla o no hay tiempo, queda el primer borrador y la tarjeta dice qué revisar.
- **Lo que no cambia:**
  - los mensajes de LinkedIn siguen con `linkedin.message`;
  - «Usa exactamente esta versión…» nunca pasa por la Redactora: si el coordinador lo intentara, el bucle se lo devuelve, igual que las propuestas.
- **Si la Redactora falla**, el coordinador recibe el motivo y escribe los correos él mismo, como antes. Por eso la Redactora solo está disponible mientras quede una decisión de reserva (`writerAvailable`). Si igual falla en la última decisión, el turno no falla: dice que no alcanzó a escribir los correos y ofrece «Sí, escríbelos», que repite el pedido.

### Tiempo y presupuesto

- **Tiempo:** cada llamada cabe en lo que le queda al turno. Se cuentan 100 s desde que el worker toma el trabajo, porque el worker corta a los 105 s.
  - La Redactora necesita 15 s (tope de 30 s).
  - La Revisora y una corrección necesitan 21 s en total; si no los hay, el borrador sale sin revisión.
  - Si no quedan ni 15 s, la Redactora no empieza y el coordinador responde.
- **Presupuesto** (con `COWORK_MODEL_BUDGET_ENABLED`; sin ese flag no se reserva nada, como hoy): cada llamada reserva su rol (`writer` o `reviewer`) en `cowork_reserve_model_call`: 6 000 tokens la Redactora y 1 500 la Revisora, como define M2 (PR #28).
  - **Mientras M2 no esté aplicada**, esa función rechaza los roles nuevos («Specialist attempt unavailable»). Entonces la llamada se reserva como del coordinador: mismos topes por turno (7 llamadas, 5 del coordinador) y por conversación.
  - Un turno típico cabe: una decisión con lecturas, el encargo, la Redactora y la Revisora son 4 llamadas y 24 000 tokens; con una corrección, 5 y 30 000. Si una corrección ya no cabe, queda el primer borrador con su marca.
  - Por conversación, en cambio, el tope de 100 000 tokens alcanza para unas 16 llamadas: tres o cuatro turnos de redacción lo agotan. **Por eso el flag debe prenderse después de aplicar M2**, que sube ese tope a 180 000 tokens y 40 llamadas, y reserva 1 500 tokens por llamada de la Revisora.
- **Modelos:** `COWORK_WRITER_MODEL` y `COWORK_REVIEWER_MODEL`; si faltan, se usa `COWORK_MODEL`.
- **Historial:** los pasos de los agentes no son contexto del turno siguiente. `loadCoworkHistory` los salta y pide hasta 12 eventos (antes 5), así un turno que escribió conserva sus tres lecturas.

### Flags y dependencias

- `COWORK_WRITER_ENABLED=true` prende la Redactora y la Revisora (apagado por defecto).
- `COWORK_WRITER_MODEL` y `COWORK_REVIEWER_MODEL` son opcionales.
- **Fuera de este PR:**
  - **M2 (PR #28):** roles y topes nuevos del presupuesto. Sin M2 funciona con el respaldo descrito arriba.
  - **M1 (PR #21) y `COWORK_STREAMING_ENABLED`:** el texto en vivo. Sin ellos, la respuesta llega completa al final, como hoy.
- Sin migraciones ni dependencias nuevas.

## Validación

**Pruebas sin modelo:**
- `writer.test.ts`:
  - los controles fijos, uno por tipo y lugar, y lo que leen del turno (firma, términos prohibidos, oferta de prueba);
  - borrador limpio revisado una vez;
  - corrección de lo que encuentran los controles, sin gastar a la Revisora;
  - corrección pedida por la Revisora;
  - Revisora o corrección que fallan, o sin tiempo: queda el primer borrador y se dice;
  - una corrección que rompe más de lo que arregla no se usa.
- `writer-run.test.ts`:
  - cada llamada con su rol, su modelo y su tope;
  - la Redactora transmite al borrador en vivo;
  - las llamadas caben en el tiempo del turno.
- `model-budget.test.ts`:
  - los roles nuevos, y el respaldo al rol del coordinador mientras M2 no está aplicada;
  - los especialistas y un presupuesto agotado no se reintentan.
- `agent-loop.test.ts`:
  - `draft.write` con Redactora, sin ella, con un fallo o sin encargo;
  - en la última decisión;
  - al reanudar después de los especialistas;
  - con «Usar esta versión».
- `decision-context.test.ts`: la regla y `writerAvailable` solo con el flag.
- `presentation.test.ts`: filas de agentes, línea en vivo y marca de revisión.
- `conversation-context.test.ts`: los pasos de los agentes no le quitan su lugar a las lecturas.
- Corpus sin modelo (`cowork-conversation-corpus.test.ts`): un caso de redacción pasa por la Redactora real con modelos guionados y cumple sus verificaciones.
- `test-cowork-writer.mjs`, el worker completo en `verify-cowork`:
  - con el flag: el coordinador entrega el encargo, la Redactora transmite, la Revisora pide un ajuste y se aplica;
  - los pasos quedan como eventos;
  - la respuesta final es la corregida;
  - sin los roles en la base, las llamadas se reservan como del coordinador;
  - sin el flag, el encargo se rechaza y el coordinador escribe.

**Con el modelo real** (`gpt-6-luna` para las tres funciones, juez `gpt-6-sol`; 12 casos de redacción × 3 = 36 respuestas; misma rama, el mismo día; `evaluate-cowork-conversations.ts --live --repeat=3 --writer`):

| | Sin Redactora | Con Redactora (versión final) |
|---|---|---|
| Verificaciones | 348/348 | 348/348 |
| Juez: buenas / mejorables / malas | 16 / 6 / 14 | 23 / 4 / 9 |
| Fricción (1 a 5) | 3,83 | 4,31 |
| Utilidad | 3,81 | 4,03 |
| Veracidad | 4,56 | 4,78 |
| Claridad | 4,58 | 4,58 |
| Llamadas por caso | 1,89 | 3,22 |
| Mediana por caso | 9,7 s | 14,7 s |

- **Variación entre corridas:** el juez varía bastante de una corrida a otra.
  - Las versiones 1, 3 y 4 con Redactora quedaron entre 19 y 23 buenas y entre 4 y 9 malas, contra 16 y 14 sin ella. La versión 2 tenía el resumen duplicado (12 buenas y 7 malas) y se corrigió.
  - Juntando las dos últimas versiones (72 respuestas): 58 % buenas y 18 % malas, contra 44 % y 39 % sin Redactora.
- **De dónde vienen las malas que quedan:** 7 de las 9 malas de la versión final son turnos en que el coordinador no delegó y pidió permiso para una consulta que podía hacer. Es el problema que ataca G2 (juez dentro del turno). Las otras 2:
  - pide confirmar antes de proponer la campaña, que es el flujo previsto; en otra corrida el mismo caso salió bueno;
  - una reunión con un contacto sin correo.
- **Lo que se corrigió entre versiones:**
  - el resumen del coordinador salía duplicado y con reglas internas: ahora se llama `findings`, son solo hechos, y los escribe la Redactora;
  - los correos sin saludo;
  - «¿lo dejo como borrador?» ahora es «¿Creo la campaña pausada para…?»;
  - las secuencias que repetían el mismo planteamiento: cada correo tiene su papel;
  - los apellidos enmascarados que se completaban;
  - un correo por persona que dejaba a alguien fuera.
- **Latencia:** la mediana sube unos 5 s por la Redactora y la Revisora. Con `COWORK_STREAMING_ENABLED`, el texto de la Redactora aparece mientras se escribe.

**Corpus completo** (40 casos × 3 = 120 respuestas: producción, marketing, botones de inicio, edición y archivos; mismo día y misma rama, sin y con el flag):

| | Sin Redactora | Con Redactora |
|---|---|---|
| Casos que pasan todas sus verificaciones | 119/120 | 118/120 |
| Verificaciones | 1067/1068 | 1066/1068 |
| Juez: buenas / mejorables / malas | 55 / 33 / 32 | 63 / 37 / 20 |
| Fricción | 3,99 | 4,18 |
| Utilidad | 3,92 | 4,02 |
| Veracidad | 4,68 | 4,62 |
| Claridad | 4,68 | 4,63 |
| Llamadas por caso | 2,21 | 2,68 |
| Mediana por caso | 10,6 s | 12,7 s |

- **Dónde se usó la Redactora:** en 29 respuestas de 12 casos (10 con una corrección). En esos casos, el juez sube en conjunto 11 puntos (buena = 2, mejorable = 1, mala = 0).
- **Los demás casos no la usan.** Sus diferencias (+9 en total, con subidas y bajas de hasta 3 puntos por caso) repiten las mismas lecturas y los mismos errores que la base (por ejemplo, «1 envío registrado» cuando solo hay un contacto marcado como contactado): son variación del modelo y del juez, no efecto de la regla nueva.
- **Las verificaciones que fallan** (una en la base, dos con Redactora) son de casos donde no se usó la Redactora.
- **Metas de G1:**
  - la fricción de 4,3 o más se cumple en los casos de redacción (4,31) y no en el corpus completo (4,18);
  - las buenas llegan al 52 %, contra el 59 % buscado.
  - Lo que falta es, sobre todo, el coordinador que pide permiso para una consulta que podía hacer. Es lo que ataca G2 (juez dentro del turno).

**Navegador:** Playwright contra el build de producción local, con un Supabase simulado solo en local (`fake-supabase-g1.mjs`). El simulado reproduce los eventos y el borrador en vivo de un turno con plan: dos lecturas, la Redactora, la Revisora con un ajuste y la respuesta final. Se probó en claro y oscuro a 1440 px, en claro a 390 px y con `reducedMotion: 'reduce'`, y también sin plan (claro a 1440 px y oscuro a 390 px).
- **Mientras la Redactora escribe:**
  - «Ahora: Redactora · escribiendo 3 correos…»;
  - la fila está bajo «Escribo la secuencia con tu oferta»;
  - el texto en vivo parte por lo encontrado;
  - ningún elemento de las filas gira en bucle.
- **En la revisión:**
  - «Revisora · revisando 3 correos…»;
  - «Revisando la respuesta…» y la tarjeta en camino dice «Revisando la secuencia»;
  - después, «Aplicando 1 ajuste…».
- **Al final:**
  - la tarjeta dice «Revisado · sin cifras inventadas»;
  - la línea dice «Siguió un plan de 3 pasos, hizo 2 consultas y escribió 3 correos»;
  - al abrirla: «Redactora · Escribió 3 correos», «Revisora · 1 ajuste» y la pastilla «sin cifras inventadas».
- **Sin plan:** mientras solo escribe la Redactora, la línea dice «Redactora · escribiendo 3 correos…» y no hay filas que la repitan. Las filas aparecen cuando empieza la Revisora.
- **En todos los casos:** sin errores de página y sin scroll horizontal.
- **Peso:** `/cowork` queda en 249 KB de carga inicial, 2 KB más que V4.
