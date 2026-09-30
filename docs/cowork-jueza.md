# Cowork · La Revisora lee la respuesta antes de mostrarla (29 sep 2026)

Segundo PR de la Ola G del plan 2 de Cowork (punto G2, juez dentro del turno). Antes de mostrar la respuesta final del coordinador, un juez la lee con la misma rúbrica que el juez de la evaluación y, si vale la pena, pide **una** corrección. La corrección puede hacer **una** consulta: el arreglo típico es hacer la consulta que la respuesta ofrecía en vez de preguntar «¿quieres que revise…?». Todo va detrás de `COWORK_JUDGE_ENABLED`: sin el flag, Cowork funciona igual que hoy.

> **30 sep:** la Jueza está apagada en producción (`COWORK_JUDGE_ENABLED=false`, #48) porque revisaba la respuesta después de mostrarla y la corrección la reemplazaba a la vista. `docs/cowork-una-respuesta.md` cambia eso: con `COWORK_ANSWER_HOLD_ENABLED` la respuesta se muestra una vez revisada, la Jueza corrige solo con puntajes de 2 o menos, la corrección edita la respuesta anterior y se descarta si empeora. Prenderla de nuevo es una decisión del mantenedor con las cifras de ese documento.

## Qué cambia para el usuario

- **Se ve que la respuesta se revisa:** para el usuario, el juez es la misma Revisora de G1, ahora leyendo la respuesta.
  - «Ahora: Revisora · revisando la respuesta…» en el titular, y su fila bajo el paso que responde («Te resumo cómo vas»).
  - Con el texto en vivo (V2), el texto en pantalla se queda con «Revisando la respuesta…».
  - Si no hay nada que corregir, la fila termina en «Sin ajustes», con su check, y la respuesta sale tal cual.
  - Si pide una corrección, la fila pasa a «Ajustando la respuesta…». La consulta que haga la corrección aparece como cualquier otra. Al final la fila dice «Ajustó la respuesta» y la respuesta nueva reemplaza a la primera, con el aviso «Ajusté la respuesta al revisarla.» que ya existe en V2.
  - Las filas cambian en su lugar, sin nada que gire en bucle.
- **Al terminar:** la actividad se pliega en una línea que lo dice: «Siguió un plan de 2 pasos, hizo 2 consultas y revisó la respuesta». Si hubo ajuste, lo dicen la fila de la Revisora y el aviso bajo el texto; así la línea no se corta.
- **Si algo falla, la respuesta sale igual:** sin veredicto (la llamada falló) la fila dice «No alcanzó a revisar»; si la corrección falla o no hay tiempo, sale la primera respuesta y la fila dice «No alcanzó a ajustarla». Las dos con una raya, sin check.
- **Quedó fuera, a propósito, la marca «Revisado» bajo cada respuesta de texto** que proponía el plan. Con el juez prendido aparecería en casi todas las respuestas y no diría nada que no diga ya la línea de actividad. La marca «Revisado · …» sigue en las tarjetas de correo de G1, donde sí ayuda antes de enviar.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Cuándo corregir y el texto de la corrección (`coworkJudgeFix`); lo que ve el juez (`coworkShownFromAnswer`, `coworkJudgeTurnPrompt`) | `src/lib/cowork/judge.ts` |
| Un juicio por turno, la respuesta juzgada como respaldo y una consulta permitida | entrada `judge` de `runCoworkReadLoop` en `src/lib/cowork/agent-loop.ts` |
| Conexión con el worker: presupuesto del rol `judge`, tiempo del turno, pasos y borrador en revisión | `coworkJudgeTurn` en `src/lib/server/cowork/judge-run.ts`; `worker.ts` |
| El agente `judge` en los eventos `assistant.agent` | `coworkAgentEvent` en `src/lib/cowork/contracts.ts` |
| La Revisora como nombre, y cómo quedó la respuesta (`coworkAnswerReview`) | `src/lib/cowork/presentation.ts` |
| Interfaz | `CoworkActivity.tsx` (fila de la Revisora y línea resumen) |

- **Qué lee:** la rúbrica, las instrucciones y el formato del juez de la evaluación (`coworkJudgeSchema`, `COWORK_JUDGE_INSTRUCTIONS` y `coworkJudgePrompt`), con lo que vería el usuario: el texto, las tarjetas (`coworkBlocksText`), la pregunta final y los botones. También lee las consultas del turno, los tres turnos anteriores y el perfil del usuario.
- **Cuándo corre:**
  - solo sobre la respuesta final del coordinador (acción `answer`);
  - no corre sobre:
    - las respuestas de la Redactora (ya pasaron por la Revisora de G1);
    - las propuestas con tarjeta de aprobación;
    - «Usa exactamente esta versión», que solo confirma la versión;
    - una respuesta que ya tuvo la corrección de cierre;
    - la respuesta de la última decisión;
  - solo si queda al menos una decisión, antes del límite blando del turno (50 s) y con al menos 45 s por delante (ver «Tiempo y presupuesto»);
  - una vez por turno.
- **Cuándo pide corregir** (`coworkJudgeFix`), siempre con algún problema concreto:
  - **si a la corrección le queda una consulta** (una decisión para consultar y otra para responder): veredicto `mala`, fricción de 3 o menos, o veracidad de 3 o menos. Así corrige lo que el juez de la evaluación marcaba como malo en G1: pedir permiso para una consulta gratuita que podía hacer, dejar para otro turno lo que podía hacer ahora, afirmar lo que los datos no dicen;
  - **si no le queda** (la respuesta llegó en la penúltima decisión): solo veracidad de 3 o menos, o comprensión de 2 o menos. Es lo que se arregla reescribiendo: sin poder consultar, una consulta ofrecida en vez de hecha no tiene arreglo en ese turno, y la corrección solo sumaría tiempo;
  - lo que solo es mejorable pasa sin corrección.
- **La corrección:** los problemas vuelven al coordinador como una corrección, igual que la corrección de cierre, junto con la pregunta con que terminaba su respuesta («Tu respuesta terminaba con «¿Reviso tus contactos guardados…?»»). El coordinador no ve su respuesta anterior; así sabe qué ofreció.
  - Si le queda una consulta, debe hacer la que ofrecía en una sola decisión y responder con lo que encuentre, cerrando con una pregunta sobre qué hacer con eso (escribir, preparar o decidir algo), no con otra consulta.
  - Esa consulta puede pasar el tope de consultas del turno (3 por defecto): es justo la que la respuesta ofrecía en vez de hacerla. Después de ella debe responder.
- **La respuesta juzgada es el respaldo:** si la corrección falla, se queda sin tiempo o intenta algo que no corresponde (una segunda consulta, especialistas), sale la primera respuesta, nunca un turno fallido.

### Tiempo y presupuesto

- **Tiempo:** la llamada del juez tiene un tope de 15 s. El juez solo empieza si quedan al menos 45 s de los 100 s que se cuentan desde que el worker toma el trabajo (el worker corta a los 105 s): su llamada más una decisión del coordinador (tope de 30 s). Además corre solo antes del límite blando del turno. Si la corrección quiere consultar cuando ya pasó ese límite, sale la primera respuesta.
- **Presupuesto** (con `COWORK_MODEL_BUDGET_ENABLED`; sin ese flag no se reserva nada, como hoy): la llamada reserva el rol `judge` en `cowork_reserve_model_call`, con 1 500 tokens en M2 (PR #28).
  - **Mientras M2 no esté aplicada**, se reserva como del coordinador, como la Redactora. Un turno juzgado con corrección y consulta cabe en los topes de hoy: como mucho 4 decisiones del coordinador y el juez, 5 llamadas y 30 000 tokens (el tope es 5 del coordinador y 33 600 tokens).
  - Si la reserva falla (por ejemplo, topes agotados), la respuesta sale sin revisión.
  - Por conversación, cada turno juzgado suma una o tres llamadas. Con el tope actual de 100 000 tokens por conversación, **conviene prender el flag después de aplicar M2**, igual que la Redactora.
- **Modelo:** `COWORK_JUDGE_MODEL`; si falta, `COWORK_MODEL`. El juez de la evaluación (`gpt-6-sol`) debe seguir siendo distinto del que se evalúa.

### Flags y dependencias

- `COWORK_JUDGE_ENABLED=true` prende el juez (apagado por defecto). `COWORK_JUDGE_MODEL` es opcional.
- `COWORK_REVIEW_ENGINE` (`llm`, `jev`, `jev-llm` u `off`) decide quién lee la respuesta: sin valor sigue a `COWORK_JUDGE_ENABLED`, y con `llm` es este juez. `COWORK_JEV_SHADOW=true` agrega a Jev en sombra. Ver `docs/cowork-jev.md`.
- Se puede prender con o sin `COWORK_WRITER_ENABLED`: el juez no lee las respuestas de la Redactora.
- **Fuera de este PR:**
  - **G1 (PR #31):** este PR va apilado sobre la Redactora y usa sus eventos `assistant.agent` y sus filas.
  - **M2 (PR #28):** el rol `judge` en el presupuesto. Sin M2 funciona con el respaldo descrito arriba.
  - **M1 (PR #21) y `COWORK_STREAMING_ENABLED`:** el texto en vivo y «Revisando la respuesta…» sobre él. Sin ellos, la fila y el titular dicen lo mismo.
- Sin migraciones ni dependencias nuevas.

## Validación

**Pruebas sin modelo:**
- `judge.test.ts`:
  - cuándo vale una corrección, con y sin una consulta disponible;
  - el texto de la corrección, con la pregunta con que terminaba la respuesta;
  - lo que ve el juez de una respuesta (texto, tarjetas, pregunta y botones);
  - las instrucciones del juez del turno: parten por las de la evaluación, que no cambian.
- `agent-loop.test.ts`:
  - respuesta limpia, leída una vez;
  - corrección con una consulta y después la respuesta obligatoria;
  - corrección que consulta dos veces o que falla: queda la primera respuesta;
  - juez que falla;
  - si la corrección puede consultar según la decisión en que llegó la respuesta, y la consulta después del tope;
  - sin juez: en la última decisión, con la Redactora y con «Usa exactamente esta versión».
- `judge-run.test.ts`:
  - el rol, el modelo, el tope y lo que lee el juez;
  - los pasos: «Sin ajustes», «Ajustando la respuesta», «Ajustó la respuesta», «No alcanzó a ajustarla» y «No alcanzó a revisar»;
  - sin tiempo no empieza;
  - un turno cancelado no se trata como fallo del juez.
- `presentation.test.ts`: la Revisora como nombre, la línea en vivo y `coworkAnswerReview`.
- Corpus sin modelo (`cowork-conversation-corpus.test.ts`): una respuesta que ofrece una consulta pasa por el juez, la corrección la hace y el caso cumple sus verificaciones.
- `test-cowork-judge.mjs`, el worker completo en `verify-cowork`:
  - corrección con consulta;
  - respuesta limpia;
  - corrección que falla y juez que falla;
  - respaldo al rol del coordinador sin M2;
  - las respuestas de la Redactora no se juzgan;
  - sin el flag no cambia nada.

**Con el modelo real** (`gpt-6-luna` para el coordinador, la Redactora, la Revisora y el juez del turno; juez de la evaluación `gpt-6-sol`; corpus completo, 40 casos × 3 = 120 respuestas: producción, marketing, botones de inicio, edición y archivos; misma rama y el mismo día; `evaluate-cowork-conversations.ts --live --writer` sin y con `--judge-in-turn`):

| | Redactora sola | Con el juez del turno |
|---|---|---|
| Casos que pasan todas sus verificaciones | 119/120 | 114/120 |
| Verificaciones | 1067/1068 (99,9 %) | 1062/1068 (99,4 %) |
| Juez de la evaluación: buenas / mejorables / malas | 59 / 34 / 27 | 64 / 40 / 16 |
| Fricción (1 a 5) | 4,21 | 4,35 |
| Utilidad | 4,01 | 3,95 |
| Veracidad | 4,64 | 4,68 |
| Claridad | 4,58 | 4,62 |
| Llamadas por caso | 2,70 | 3,72 |
| Mediana por caso (p90) | 11,2 s (18,1 s) | 18,2 s (27,3 s) |

- **Qué hizo el juez:** leyó 57 respuestas de 120, pidió una corrección en 37 y en 34 la respuesta cambió. Las otras 63 no llegaron a él: respuestas de la Redactora (33), propuestas con tarjeta de aprobación, la última decisión, o sin tiempo.
- **Metas del plan:**

| Meta | Resultado |
|---|---|
| Buenas ≥ 60 % | **No**: 53 % (la base de hoy: 49 %) |
| Malas ≤ 10 % | **No**: 13 % (la base de hoy: 22 %) |
| Fricción ≥ 4,3 | **Sí**: 4,35 |
| Verificaciones ≥ 97 % | **Sí**: 99,4 % |
| Mediana como mucho 5 s más | **No**: 7 s más. En las respuestas que pasan por el juez, la mediana es de 20 s contra 9,5 s de esas mismas respuestas sin él |

- **Dónde ayuda:** las respuestas malas bajan de 27 a 16, y los puntos del juez (buena = 2, mejorable = 1, mala = 0) suben de 152 a 168. Entre los casos donde el juez pidió corregir, mejoran los números de la semana, los pendientes de hoy, qué trae el archivo, el dominio, la campaña con un contacto que no está guardado y la ley: respuestas que cerraban ofreciendo una consulta o un texto en vez de hacerlo, y ahora lo hacen.
- **Dónde no:**
  - donde el juez pidió corregir, empeoran «qué puedes hacer», el archivo que no está, los últimos guardados y el informe para el jefe. Otros cambios de más o de menos, en casos donde no intervino, son variación del modelo y del juez;
  - de las 16 malas que quedan, 8 son respuestas que el juez pidió corregir, y 6 son respuestas que leyó y dejó pasar (el juez del turno y el de la evaluación son modelos distintos y no siempre coinciden);
  - en 3 de las 34 correcciones, el texto nuevo perdió algo que decía el primero y falló una verificación del caso (por ejemplo, dejó de mencionar LinkedIn);
  - ofrecer preparar un correo («¿Preparo un correo para Camila?») lo marca el juez del turno como fricción, y el juez de la evaluación lo deja pasar en la mayoría de los casos.
- **Variación entre corridas:** el juez de la evaluación varía bastante de una corrida a otra. Tres versiones del juez del turno (con instrucciones más o menos estrictas) midieron 63, 67 y 64 buenas y 24, 22 y 16 malas: una diferencia de 3 o 4 respuestas no distingue una versión de otra. La versión final es la más estricta con ofrecer lo que Cowork podía hacer ya (`COWORK_JUDGE_TURN_INSTRUCTIONS`), y la de menos malas.
- **Latencia:** cada respuesta que el juez lee suma su llamada (mediana de 4,1 s) y, si pide corregir, una decisión más del coordinador. Con el flag, uno de cada dos turnos tarda unos 10 s más.
- **Lo que queda para después:** la mediana es la única meta que el plan pedía cuidar y no se cumple. El filtro por palabras que el plan proponía como salida no separa bien: el juez corrige respuestas cuya pregunta no nombra ninguna consulta («¿Preparo el correo para Camila?»). Lo que sí serviría es un clasificador rápido delante del juez, que solo lo llame cuando duda. Se probará con un modelo de decisiones cuando haya acceso; hasta entonces, el flag se deja apagado y se prende sabiendo que cuesta unos 10 s en la mitad de los turnos.

**Navegador:** Playwright contra el build de producción local, con un Supabase simulado solo en local (`fake-supabase-g2.mjs`). El simulado reproduce los eventos y el borrador en vivo de un turno con plan, una consulta, la respuesta que ofrece una consulta, el juez que pide un ajuste, la consulta de la corrección y la respuesta final; y otra versión donde el juez no encuentra nada. Se probó en claro y oscuro a 1440 px, en claro a 390 px y con `reducedMotion: 'reduce'`.
- **Mientras el juez lee:** «Ahora: Revisora · revisando la respuesta…», su fila bajo el paso «Te resumo cómo vas», el texto en pantalla que se queda con «Revisando la respuesta…», y ningún elemento de las filas gira en bucle.
- **Si pide un ajuste:** el titular y la fila pasan a «Ajustando la respuesta…»; después aparece la consulta de la corrección (por ejemplo «Revisó tus campañas · 2 resultados»), la respuesta nueva reemplaza a la primera con «Ajusté la respuesta al revisarla.» y la fila termina en «Ajustó la respuesta».
- **Si no encuentra nada:** «Sin ajustes», sin aviso de cambio, y la línea dice «Siguió un plan de 2 pasos, hizo 1 consulta y revisó la respuesta».
- **En todos los casos:** sin errores de página y sin scroll horizontal.
- **Peso:** `/cowork` queda en 249 KB de carga inicial, igual que G1.

