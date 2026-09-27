# Cowork · juez que evalúa las respuestas (26 sep 2026)

Segundo PR de la Ola B del plan de Cowork (punto 2.2: juez LLM, primero fuera del turno, para calibrarlo).

## Para qué sirve

Las verificaciones del corpus leen texto: detectan si una respuesta nombra a alguien, si cierra con una pregunta o si trae una tarjeta. No ven si cuenta mal («3 de 5 con correo» cuando son 4), si inventa un dato, si deja al usuario en un callejón sin salida o si usa jerga.

Para eso, un modelo distinto al que redacta califica cada respuesta con una rúbrica fija, como lo haría una persona que lee el chat:

| Dimensión | 5 | 1 |
|---|---|---|
| Comprensión | Entiende el pedido y su intención | Responde otra cosa |
| Veracidad | Cada cifra, nombre y estado coincide con los datos consultados | Inventa, cuenta mal o contradice los datos |
| Utilidad | Acerca el objetivo y deja un siguiente paso que Cowork hace al tocarlo | Callejón sin salida o devuelve el trabajo |
| Claridad | Breve, en español simple, sin jerga, códigos ni IDs | Confusa |
| Fricción | El usuario no hace nada extra | Lo hace trabajar o esperar para nada |

Además de los puntajes, el juez devuelve hasta 5 problemas concretos, en palabras del usuario, y un veredicto: buena, mejorable o mala.

Son las mismas cinco dimensiones con que se calificaron a mano las conversaciones de producción del 25 de septiembre.

**Límites:**
- El juez no aprueba efectos ni cambia nada.
- Por ahora solo corre en la evaluación del corpus, fuera del turno.
- Usarlo dentro del turno, para corregir una respuesta antes de mostrarla, queda para cuando lleguen la Redactora y la Revisora (punto 2.1).

## Cómo funciona

- **Rúbrica, entrada y resumen:** `src/lib/cowork/judge.ts`.
  - La entrada lleva el pedido, el historial breve con los datos consultados en esos turnos, quién es el usuario y qué vende, los datos que Cowork consultó y exactamente lo que el usuario vio: respuesta, documento, tarjetas, pregunta final, botones y la tarjeta de aprobación con su nota y detalle.
  - La rúbrica trae las reglas del producto que el juez no puede adivinar: todo efecto se propone con una tarjeta de aprobación, un correo nuevo sale por una campaña, Cowork no crea contactos a partir de un correo ni tiene calendario, y el botón «Usar esta versión» fija un texto sin crear nada.
  - Los datos se recortan a un tamaño razonable.
- **Script:** `scripts/judge-cowork-conversations.ts`.
  - Con `--input=informe.json` califica un informe de `evaluate-cowork-conversations.ts`. Separa las respuestas que pasan las verificaciones de las que no, y lista dónde discrepan el juez y las verificaciones.
  - Con `--calibrate` califica las respuestas de producción ya puntuadas por personas y mide cuánto se aleja de ellas.
  - Se niega a correr si el juez es el mismo modelo que redacta.
- **Mismos datos que vio el modelo:** el corpus ahora guarda cada consulta con su entrada (`reads`), para reconstruirlos igual. `corpusShownAnswer` arma lo que vio el usuario.
- **Conjunto de calibración:** `scripts/fixtures/cowork-judge-calibration.ts`, con 7 respuestas reales de producción citadas como quedaron registradas, sus puntajes humanos y los datos que había.

## Calibración

Se calificaron las 7 respuestas de producción ya puntuadas por personas con tres modelos distintos al que redacta (gpt-6-luna): dos veces cada una en las primeras vueltas (14 calificaciones por modelo) y tres en la final. La medida es el **error medio absoluto** (MAE): cuántos puntos, en promedio, se aleja el juez de la persona. «±1» es la parte de las calificaciones que quedan a un punto o menos.

**Primera vuelta** (rúbrica inicial):

| Modelo juez | Comprensión | Veracidad | Utilidad | Claridad | Fricción | Promedio |
|---|---|---|---|---|---|---|
| gpt-6-sol | 0,57 | 0,57 | 0,50 | 0,93 | 0,64 | 0,64 |
| gpt-6-astra | 0,29 | 0,86 | 0,43 | 0,71 | 0,57 | 0,57 |
| gpt-5.5 | 0,50 | 0,93 | 0,79 | 1,07 | 0,71 | 0,80 |

Los tres eran benévolos con la **claridad** (+0,7 a +1,1 puntos sobre las personas) y la **fricción** (+0,6 a +0,7). No castigaban la jerga («cobertura», «barrido», «dominio desnudo») ni que Cowork pidiera un dato que podía deducir.

**Ajustes antes de la segunda vuelta:**
- **Rúbrica:** la jerga interna sin explicar deja la claridad en 3 o menos. Pedir un dato deducible, una decisión que Cowork podía tomar con un valor razonable, o detalles de algo que no puede hacer deja la fricción en 2 o menos. Son los mismos criterios con que se puntuaron las respuestas y que ya revisan las verificaciones del corpus.
- **Conjunto de calibración:** a uno de los casos le faltaba en mis datos el desglose que el registro sí confirma (respuestas humanas y automáticas, cobertura desconocida). El juez marcaba esas cifras como «sin respaldo».

**Segunda vuelta:** gpt-6-sol quedó en 0,50 de promedio y gpt-6-astra en 0,57, más lejos en veracidad (1,07). Se eligió gpt-6-sol.

**Ajustes después de leer el corpus** (ver la sección siguiente):
- **Entrada y rúbrica:** los datos de turnos anteriores, el documento, la tarjeta de aprobación y las reglas del producto.
- **Conjunto de calibración:** a «me gustan, dale créala» le faltaba el pedido original: una campaña de prueba solo para un contacto de prueba, al que Cowork llamó Nico por su correo. El juez marcaba «solo para Nico» como dato sin respaldo.

**Resultado final**, con la rúbrica de este PR y gpt-6-sol, tres veces cada respuesta (21 calificaciones por dimensión):

| Dimensión | MAE | ±1 | Sesgo (juez − persona) |
|---|---|---|---|
| Comprensión | 0,43 | 100 % | −0,14 |
| Veracidad | 0,48 | 95 % | 0,00 |
| Utilidad | 0,43 | 100 % | +0,14 |
| Claridad | 0,52 | 100 % | +0,05 |
| Fricción | 0,48 | 86 % | +0,48 |

- **En promedio, 0,47 puntos** de las personas. Todas las calificaciones quedan a un punto o menos, salvo 1 de veracidad y 3 de fricción.
- **La fricción sigue benévola** (+0,48), sobre todo en «¿cómo me ha ido esta semana?»: la persona le dio 3 porque la respuesta no deja un siguiente paso, y el juez le da 5. Conviene leerla con ese margen.
- **Es estable:** en 29 de los 35 puntajes (caso por dimensión) repitió la misma nota las tres veces; en el resto varió uno o dos puntos. Entre corridas casi iguales, el promedio se movió entre 0,42 y 0,60; por eso la medida final usa tres repeticiones.
- **Las diferencias mayores** son casos donde el juez fue más estricto que la persona y explica por qué. Por ejemplo, en «me gustan, dale créala» bajó la comprensión porque Cowork preguntó el proveedor en vez de proponer la campaña que se le pidió.
- **La cifra final es optimista:** los ajustes se hicieron mirando estas mismas 7 respuestas. La medida honesta llegará con respuestas nuevas puntuadas por personas (ver Pendientes).

## Primera lectura del corpus con el juez

Se calificaron las 102 respuestas de la última evaluación con el modelo real: 34 casos, 3 repeticiones, con gpt-6-luna redactando sobre la base de este PR.

**Qué hubo que corregir en el juez.** La primera pasada marcó 38 respuestas con algún 2 o menos, varias por falta de contexto:
- No veía los datos de turnos anteriores y tomaba como inventado lo que venía de ahí.
- No veía la tarjeta de aprobación ni el documento, y reclamaba que faltaba la propuesta.
- No conocía reglas del producto: pedía «enviar el correo directo» o «guardar el contacto a partir del correo», que Cowork no puede hacer, y leía «Usar esta versión» como «crea la campaña».

Con esa entrada y esas reglas, la veracidad media subió de 4,17 a 4,53, y las respuestas con algún 2 o menos bajaron de 38 a 27.

**Resultado:**

| | Comprensión | Veracidad | Utilidad | Claridad | Fricción |
|---|---|---|---|---|---|
| Promedio (1 a 5) | 4,79 | 4,53 | 3,97 | 4,63 | 3,99 |
| Respuestas con 2 o menos | 1 | 3 | 4 | 0 | 24 |

- **Veredictos:** 48 buenas, 27 mejorables y 27 malas.
- **De las 101 respuestas que pasan las verificaciones, 26 tienen algún 2 o menos.** Es lo que las verificaciones no ven.
- **La única que no pasa** (`editar-usar`: propuso una campaña que nadie pidió) también es mala para el juez.

**Lo que encontró:**
1. **Deja para otro turno lo que podía hacer en este.** Es el problema de 23 de las 27 respuestas bajas:
   - 17 ofrecen como siguiente paso una consulta gratuita: revisar los contactos, ver quién tiene correo o revisar los rebotes. Por ejemplo, «¿cómo voy?» y «necesito clientes» en sus tres repeticiones.
   - 5 piden permiso para redactar algo que podían entregar ya, como la invitación de «agéndame una reunión» o el primer correo de «quiero vender más».
   - 1 pregunta «¿preparo la campaña?» en vez de mostrar la tarjeta.
   - Causa probable: el tope de 3 consultas y 4 decisiones por turno. Es la entrada directa del orquestador (2.0), que decide cuántas llamadas hacen falta, y de la Redactora (2.1).
2. **Cuenta mal.** En una repetición de «resultado de la campaña» dice que hay 3 contactos con correo cuando son 4, y deja fuera a Camila Fuentes. Es el tipo de error («3 de 5 con correo») que el plan quería detectar.
3. **Completa apellidos enmascarados.** En el corpus de producción los apellidos vienen enmascarados («Nehal Pa***a»):
   - 6 de las 102 respuestas escriben «José Castro», deducido del correo jcastro@.
   - Una de ellas, además, inventó «Nehal Paraja» y «Katherine Saavedra», sin ninguna pista.
4. **Menores:** siglas sin explicar (SPF, softfail, p=none) al revisar el dominio, y una excepción de la ley omitida al responder si puede escribir sin consentimiento.

**Límites del juez que se vieron:**
- **Se equivoca a veces.** En `editar-campana` dijo que la tarjeta quitaba renglones en blanco del texto del usuario; el texto es idéntico.
- **Es estricto con inferencias razonables.** «No hay envíos registrados», dicho a partir de «0 contactados», le parece sin respaldo (veracidad 3).
- **Una respuesta suelta puede cambiar de veredicto entre pasadas.** En dos pasadas sobre las mismas 93 respuestas:
  - el 81 % de los puntajes fue idéntico y el 96 % quedó a un punto o menos;
  - el veredicto coincidió en el 72 %; los cambios se concentran en casos límite, como preguntar antes de proponer una campaña cuando el pedido admite las dos cosas.
  - Las tendencias por caso, con tres repeticiones, sí se mantienen.
- **Por eso** primero se leen los problemas que lista y después los números, y por eso el juez sigue fuera del turno.

## Cómo se corre

```
OPENAI_API_KEY=… COWORK_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs scripts/judge-cowork-conversations.ts --live --judge-model=gpt-6-sol --calibrate --repeat=3 --max-calls=25
OPENAI_API_KEY=… COWORK_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs scripts/judge-cowork-conversations.ts --live --judge-model=gpt-6-sol --input=informe.json --max-calls=120 --output=juez.json
```

## Pendientes

- **Corregir lo que encontró**, en PRs aparte y midiendo con el juez:
  - la fricción, con el orquestador (2.0) y la Redactora (2.1);
  - la cuenta y los apellidos: una regla para no completar nombres enmascarados y verificaciones nuevas en el corpus.
- **Más respuestas leídas por personas:** 7 respuestas bastan para una primera calibración, no para confiar del todo. Conviene que alguien del equipo puntúe unas 20 respuestas del corpus actual con la misma rúbrica y sumarlas al conjunto.
- **El juez dentro del turno** (punto 2.1): solo para redacción y análisis, con un umbral y una corrección dentro del techo de llamadas.
