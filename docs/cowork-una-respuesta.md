# Cowork · una sola respuesta, revisada antes de mostrarse (30 sep 2026)

Cowork ya no muestra un texto que después cambia. La respuesta se escribe, se revisa y recién entonces aparece, una sola vez. Mientras tanto la pantalla dice en qué fase va.

## Qué pasaba

- **Dos textos:**
  - la respuesta se mostraba a medida que se escribía;
  - después la Jueza la revisaba y, si pedía una corrección, el texto nuevo reemplazaba al que el usuario ya estaba leyendo («Ajusté la respuesta al revisarla»);
  - quien lo vio en producción lo describió así: primero un mensaje, luego otro, y el segundo a veces peor.
- **Por qué la corrección empeoraba la respuesta:**
  - **Corregía desde cero:** el modelo no veía su respuesta anterior, así que reescribía todo y perdía lo que estaba bien.
  - **Reglas contradictorias:** al coordinador se le pedía cerrar ofreciendo un siguiente paso (regla 4 y las recetas) y la Jueza castigaba justo eso; casi todas las respuestas revisadas volvían con una corrección.
  - **Veía menos que el coordinador:** solo 6 lecturas, cortadas a 2.500 caracteres y con horas en UTC. Una cifra correcta le parecía sin respaldo.
  - **Corregía con un 3:** «un paso evitable» o «una cifra imprecisa» ya disparaban una corrección. En la evaluación de G2 esas correcciones no mejoraban las respuestas.
  - **Corría con un modelo más débil** que el de la evaluación.
  - **No dejaba rastro:** no se guardaba qué encontró ni si se quedó con la corrección.
- **Otros cambios después de mostrar**, que este PR también evita: la corrección de cierre del coordinador, la Revisora de la Redactora y el pulido final.

## Qué cambia para el usuario

- **Una respuesta, una vez:**
  - mientras Cowork escribe, revisa y ajusta, la pantalla muestra una línea con la fase: «Escribiendo la respuesta…», «Revisando la respuesta antes de mostrártela…», «Ajustando la respuesta tras revisarla…»;
  - si la respuesta trae correos, la línea lo dice («Revisando los correos…») y cada tarjeta en camino muestra qué es y cuánto lleva («Secuencia · 2 correos»), sin su título ni su texto, porque una corrección todavía puede cambiarlos;
  - el texto aparece una sola vez, ya final, con una subida corta y un fundido.
- **«Ajusté la respuesta al revisarla» ya casi no aparece:** solo si la Jueza pidió una corrección y Cowork se quedó con ella. Con el texto retenido no hay una primera versión que cambiar.
- **Movimiento:**
  - la línea cambia con un fundido cruzado sobre esqueletos quietos; nada gira ni late, porque el indicador de que Cowork trabaja ya es lo único en bucle de la pantalla;
  - con «reducir movimiento» la respuesta aparece sin subida;
  - claro, oscuro y 390 px con los mismos tokens `cw-*`.
- **Lectores de pantalla:** la línea no es una región viva. El estado del trabajo anuncia «Listo» cuando la respuesta está, como antes.

## Qué cambia por dentro

| | Antes | Ahora |
|---|---|---|
| **Texto en vivo** | El borrador escribía el texto cada 400 ms | Con `COWORK_ANSWER_HOLD_ENABLED` el borrador guarda solo la fase (`writing`, `reviewing`, `adjusting`) y cuánto lleva cada tarjeta; nunca texto ni títulos |
| **Fases** | — | Solo avanzan. La Jueza pasa a `reviewing`; si pide corregir, `adjusting`. Lo mismo la Revisora de la Redactora al aplicar un ajuste |
| **La corrección** | Reescribe desde cero | Recibe su respuesta anterior (`answerToCorrect`: texto, pregunta, botones, tarjetas y documento, acotados) con la orden de cambiar solo lo señalado |
| **Regla de cierre** | Dos versiones que se contradicen | Una sola (`src/lib/cowork/next-step.ts`): la pregunta final ofrece una acción que necesita aprobación o pide una decisión del usuario; lo que Cowork puede hacer ahora sin aprobación lo hace en la respuesta |
| **Lo que ve la Jueza** | 6 lecturas a 2.500 caracteres, horas UTC | Todas las lecturas en un presupuesto de 24.000 caracteres, con hora local, sin IDs y con un resumen por lista (cuántos, cuántos con correo, si se cortó); además la fecha del trabajo |
| **Cuándo corrige** | Con puntajes de 3 o menos | Solo con «mala» o con fricción, veracidad o comprensión de 2 o menos |
| **Tiempo** | 15 s | 8 s con el texto retenido: la persona espera la revisión antes de leer nada |
| **No empeorar** | Se aceptaba cualquier corrección | Se queda la primera respuesta si la corrección viene vacía, dice lo mismo o trae una cifra que no está en la primera, en las lecturas, en el historial ni en el perfil del usuario (`src/lib/cowork/correction-guard.ts`) |
| **Rastro** | Solo «Sin ajustes» o «Ajustó» | El paso de la Jueza guarda motor, modelo, duración, puntajes, problemas y veredicto; el cierre guarda si se quedó la corrección y por qué. La página no lo muestra |
| **«Ajustó»** | Comparaba objetos: una corrección fallida con gráficos se registraba como hecha | Usa el veredicto del bucle, o si cambió la respuesta |

## Cómo se activa

- **`COWORK_ANSWER_HOLD_ENABLED`:** «true» en `apphosting.yaml`, y actúa junto con `COWORK_STREAMING_ENABLED` (sin borradores no hay nada que retener). En «false» vuelve el texto en vivo de antes. Con la Jueza apagada, retener importa sobre todo en los borradores de la Redactora, cuya Revisora puede cambiar el texto; en las respuestas normales la corrección de cierre casi no ocurre (0 de 70 en la medición).
- **`COWORK_JUDGE_ENABLED`:** sigue en «false» (#48). Con el texto retenido y esta revisión la Jueza se puede volver a encender; lo decide el mantenedor con las cifras de más abajo.
- **Sin migraciones:** `cowork_write_run_draft` ya acepta texto vacío y hasta 4 KB de progreso.

## Cómo se midió

Modelo real (gpt-6-luna, con Redactora, texto en vivo y el juez del turno), el corpus completo (43 casos, 3 veces cada uno: 129 turnos por configuración), el mismo día y las mismas herramientas de prueba. El juez de la evaluación es gpt-6-sol, otro modelo. Tres configuraciones:
- **Hoy en producción:** `main` sin Jueza (`COWORK_JUDGE_ENABLED=false`, #48).
- **Antes de #48:** `main` con la Jueza de entonces.
- **Esta rama, con la Jueza encendida.**

| | Hoy (sin Jueza) | Antes de #48 (Jueza vieja) | Esta rama, con Jueza |
|---|---|---|---|
| Casos con todas sus verificaciones | 126 de 129 | 117 de 129 | 122 de 129 |
| Verificaciones | 99,7 % | 99,0 % | 99,4 % |
| Buenas / mejorables / malas | 67 / 36 / 26 | 65 / 43 / 21 | 68 / 37 / 24 |
| Fricción · utilidad · veracidad (1 a 5) | 4,18 · 4,04 · 4,66 | 4,21 · 3,94 · 4,55 | 4,14 · 3,92 · 4,61 |
| Respuestas que la Jueza mandó corregir | — | 40 de 70 (57 %) | **14 de 74 (19 %)** |
| Textos que el usuario habría visto cambiar | 0 | **27 de 70 (39 %)** | 11 de 74 (15 %); con el texto retenido, **0** |
| Llamadas al modelo por caso | 2,73 | 3,86 | 3,33 |
| Turno completo: mediana · p90 | 9 · 20,3 s | 14,2 · 25,7 s | 11,9 · 20,7 s |
| Hasta ver la respuesta, si es limpia (mediana) | 7,4 s (el texto ya venía escribiéndose) | 15 s | 12,6 s |
| Hasta ver la respuesta, si se corrigió (mediana) | — | 18,6 s | 17,2 s |

- **La queja de producción tiene número:** con la Jueza de antes, 4 de cada 10 respuestas cambiaban mientras se leían. Ahora se corrige 1 de cada 5 y ninguna se ve cambiar.
- **Metas del plan:**

| Meta | Resultado |
|---|---|
| Verificaciones ≥ 99 % | Sí: 99,4 % |
| Correcciones ≤ 25 % | Sí: 19 % |
| Buenas no bajan y malas no suben | Sí frente a hoy (68 contra 67 buenas, 24 contra 26 malas). Frente a la Jueza de antes hay 3 malas más (24 contra 21), dentro de la variación ya medida de 3 o 4 respuestas |
| Texto reemplazado a la vista = 0 | Sí, por construcción: con el texto retenido nadie lo ve antes de que sea final |

- **Qué cuesta:** la respuesta aparece cuando el turno termina y se revisa. Con la Jueza encendida son unos 5 s más que hoy (12,6 contra 7,4 s de mediana); sin ella, unos 2 s más que las primeras palabras de hoy. Es la razón por la que la Jueza sigue apagada.

### ¿La corrección mejora la respuesta?

Se calificó también la primera respuesta de cada turno corregido, con el mismo juez, para comparar en pares:

| Turnos corregidos | Primera → corregida (buenas / mejorables / malas) | Mejoran · igual · empeoran | Fricción | Veracidad |
|---|---|---|---|---|
| Esta rama (14) | 1 / 3 / 10 → 4 / 2 / 8 | 5 · 6 · 3 | 2,5 → 3,3 | 4,1 → **3,4** |
| Jueza de antes (25) | 7 / 7 / 11 → 5 / 16 / 4 | 9 · 10 · 6 | 3,3 → 3,8 | 4,5 → 4,4 |

- **Ahora corrige solo lo claramente malo:** 10 de las 14 primeras respuestas eran «malas». La corrección arregla parte (más buenas, menos fricción), pero 3 de las 14 empeoran.
- **Lo que preocupa es la veracidad:** al corregir, el modelo a veces agrega algo que los datos no dicen (por ejemplo, atribuir a un período un envío de otro). El chequeo de cifras no lo ve cuando el dato sí está en las lecturas pero mal usado. En esta corrida ninguna corrección cayó en el chequeo (`keptFirst`: 0).
- **Conclusión:** la Jueza se queda apagada. Este PR quita lo que confundía (dos textos, correcciones desde cero, reglas que se contradecían) y deja la medición para decidir. Lo que falta es una revisión más barata y más segura (Jev para la falla que sí detecta, `docs/cowork-jev.md`) antes de encenderla.

## Cómo verificarlo

1. `node scripts/test-cowork-held-answer.mjs`: en jsdom, con el stream simulado. Retenida, la página muestra las tres fases y nunca un texto; sin retener, el aviso «Ajusté…» solo sale tras una corrección que se quedó.
2. `node scripts/test-cowork-judge.mjs`, `test-cowork-live-draft.mjs` y `test-cowork-writer.mjs`: el worker completo con el modelo simulado, con y sin `COWORK_ANSWER_HOLD_ENABLED`.
3. En el navegador, con el flag encendido y la Jueza encendida en un entorno de prueba:
   - pregunta «¿cómo van mis correos esta semana?»;
   - la línea pasa por «Escribiendo…», «Revisando… antes de mostrártela» y, si hay corrección, «Ajustando… tras revisarla»;
   - la respuesta aparece una sola vez y no dice «Ajusté la respuesta al revisarla» salvo que la corrección se haya quedado.

## Límites conocidos

- **Se ve más tarde:** la respuesta aparece cuando termina el turno, no cuando empieza a escribirse. En una respuesta limpia son unos 2 s más, más lo que tarde la revisión.
- **El chequeo de cifras puede quedarse con la primera de más:** si la corrección trae una cifra que sí era correcta pero no aparece literal en las lecturas, se descarta. El motivo queda registrado (`new_figures`).
- **La Jueza sigue siendo un modelo:** la calibración con Jev (`docs/cowork-jev.md`) mostró que sirve bien para una falla y mal como veredicto general. Ese trabajo va en el PR siguiente.
