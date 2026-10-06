# Cowork · Plan 12, línea base con el modelo real (6 oct 2026)

Antes de cambiar nada medí Cowork tal como está en `main` (5e806df), con el modelo de producción y sus herramientas sobre mundos de ejemplo. Esta es la vara contra la que se miden las cuatro rondas del Plan 12.

## Cómo se midió

- **El coordinador** es `gpt-6-luna` (`COWORK_MODEL`). Corrió con texto en vivo (`--stream`), la Redactora y la Revisora encendidas (`--writer`) y el mismo bucle y esquema de producción.
- **El juez** es `gpt-6-sol`, un modelo distinto del que escribe. Califica cada respuesta en comprensión, veracidad, utilidad, claridad y fricción, y da un veredicto: «buena», «mejorable» o «mala». En AXIS además la compara con lo que logró la IA anterior.
- **Los corpus:**
  - **El de siempre:** 85 casos, 1 vez.
  - **El banco AXIS:** las 44 operaciones × 3.
  - **«Uso real», nuevo:** 20 casos × 3, en `scripts/fixtures/cowork-uso-real-corpus.ts`.
- **Gasto:** 695 llamadas del coordinador, la Redactora y la Revisora, más 409 del juez.
  - Fueron 13,8 millones de tokens de entrada, de los que 11,4 millones vinieron de caché, y 370 mil de salida.
  - **Cada decisión del coordinador lee unos 20.400 tokens de entrada:** son sus instrucciones, que pesan lo mismo para un «hola» que para un informe.

## El corpus «uso real»

Son 20 casos sacados de lo que el dueño pidió a Cowork en producción entre el 24 de septiembre y el 5 de octubre, sin datos reales y sobre el mundo de producción del corpus:

- **Conocer la app:** saludar, «¿qué haces?», «dime todo lo que puedes hacer» y «¿qué información tienes de mí?».
- **Buscar:** leads para Yago, cómo ofrecer la app, cargos altos de retail.
- **Contactos e investigación:** guardar, enriquecer e investigar; investigar a dos personas; «¿ya está la investigación?».
- **Correo:**
  - mejorar un correo;
  - escribirle a alguien sin correo;
  - una campaña desde una versión que se editó.
- **LinkedIn:** invitar por nombre, «¿a quién invito esta semana?».
- **Cifras e informes:** «¿cómo me ha ido?», un tablero del mes, el pipeline en gráfico y la ficha de una cuenta para una reunión.
- **Tarea larga:** buscar 25, guardar 10, buscar correos y escribir una secuencia.

Cada caso tiene sus verificaciones (qué lee, qué propone, qué no puede decir) más las comunes del corpus.

## Las cifras

| Corpus | Casos que pasan todo | Verificaciones | Juez: buena / mejorable / mala | Utilidad | Fricción | Veracidad | Mediana por turno |
|---|---|---|---|---|---|---|---|
| De siempre (85) | 75 de 85 | 939 de 958 (98,0 %) | 39 / 23 / 23 (27 % mala) | 4,02 | 4,16 | 4,42 | 12,6 s |
| Uso real (20 × 3) | 47 de 60 | 496 de 513 (96,7 %) | 14 / 11 / 35 (**58 % mala**) | 3,43 | 3,37 | 4,20 | 11,7 s |
| AXIS ★ (20 × 3) | 0 de 60 | 551 de 786 (70,1 %) | 8 / 19 / 33 (55 % mala) | 2,97 | 3,27 | 4,02 | 19,4 s |
| AXIS resto (24 × 3) | 0 de 72 | 750 de 1.095 (68,5 %) | 8 / 12 / 52 (72 % mala) | 2,83 | 2,75 | 3,97 | 16,1 s |
| **AXIS, las 44** | 0 de 132 | **1.301 de 1.881 (69,2 %)** | 16 / 31 / 85 (**64 % mala**) | 2,89 | 2,98 | 3,99 | |

- **Contra el 30 de septiembre, AXIS mejoró poco:**
  - verificaciones de 66,9 % a 69,2 %;
  - «mala» de 61 % a 64 %, que está dentro del ruido;
  - frente a la IA anterior: supera 4, iguala 3, queda por debajo en 99 y fuera de alcance en 26 (antes 1 / 2 / 109 / 20).
- **Ningún turno falló por error:** 0 de 337.
- **La primera palabra aparece a los 3,4 s** en «uso real» (mediana) y a los 6,5–7,2 s en AXIS. La respuesta completa tarda 7,5 s (mediana) en el corpus de siempre.
- **Las verificaciones no ven lo que ve el juez.** «Uso real» pasa el 97 % de sus verificaciones y aun así el juez califica «mala» el 58 %: las verificaciones miran que la respuesta diga lo correcto, y el juez mira si avanzó el trabajo.

## Qué falla (los problemas que anotó el juez)

| Tipo de falla | Uso real | AXIS ★ | AXIS resto | De siempre |
|---|---|---|---|---|
| **Devuelve el trabajo:** pregunta «¿quieres que…?» o pide permiso para algo que podía hacer | 32 % | 37 % | 47 % | 18 % |
| **No usa la tarjeta:** pregunta sí o no por una acción en vez de proponerla con aprobación | 23 % | 8 % | 19 % | 5 % |
| **No entrega lo pedido:** ficha, gráfico, priorización | 23 % | 15 % | 13 % | 5 % |
| **Dato sin respaldo** | 12 % | 12 % | 13 % | 8 % |
| **Fechas y horas** | 3 % | 3 % | 13 % | 2 % |
| **Cifras o conteos mal leídos** | 8 % | 3 % | 8 % | 4 % |
| **Formato y extensión** (JSON en la tarjeta, se repite, muy largo) | 7 % | 7 % | 1 % | 9 % |

Cada porcentaje es la parte de las respuestas con al menos un problema de ese tipo. Una respuesta puede tener varios.

### Ejemplos

- **Devuelve el trabajo:**
  - Pregunta «¿qué información tienes de mí?» → responde «¿Reviso el resto de tu perfil?» en vez de leerlo (`ur-perfil-info`, «mala» las 3 veces).
  - Pregunta «¿a quién invito esta semana?» → «¿Por cuál quieres que empiece?» sin recomendar a nadie (`ur-invitar-semana`, 3 de 3 «mala»).
  - Pide investigar a Carlos y a Nehal → «necesito que me indiques cuál es Nehal», cuando la lectura trae a Nehal Pa\*\*\*a por su nombre (`ur-investigar-dos`, 3 de 3).
- **No usa la tarjeta:** «¿Busco el correo de Carlos? (cuesta 1 crédito)» con un botón «Sí», en vez de la tarjeta que ya pide la aprobación y dice el costo (`ur-escribir-sin-correo`, `ur-dime-todo`).
- **No entrega lo pedido:**
  - Pide la ficha de Minera Centinela para el martes → «la ficha todavía no se puede completar… ¿Investigo?», sin una versión preliminar con lo que ya hay (`ur-ficha-cuenta`, 3 de 3).
  - Pide el pipeline en gráfico → explica que no hay registros y no muestra nada (`ur-pipeline-grafico`).
- **Dato sin respaldo:**
  - «la extensión envía los mensajes de LinkedIn», «usé Gmail como remitente», «cuesta aproximadamente 1 crédito» en una búsqueda;
  - «la investigación se registró a las 10:17», cuando son las 10:10.

### Las causas en el código

1. **La regla 4 de las instrucciones pide cerrar siempre con una pregunta cerrada** (`agent-instructions.ts`: «Cierra siempre con una pregunta cerrada en answer.question»).
   - El modelo la cumple preguntando por lo que podía hacer.
   - El «o, si el paso es obvio y seguro, proponlo directamente» queda enterrado al final de la regla.
   - **Es la causa principal de las dos primeras filas.**
2. **El techo de 3 lecturas por turno:** de las respuestas que devuelven el trabajo, el 45 % gastó las 3 lecturas (en AXIS, 25 de 56). El modelo quería leer más y terminó preguntando.
   - El otro 55 % usó 0 a 2 lecturas: ahí es la regla 4, no el techo.
3. **Las instrucciones pesan unos 20.400 tokens en cada decisión** (86.000 caracteres, con unas 40 reglas y todas las recetas), aunque el pedido sea «hola».
   - Con tantas reglas a la vez, el modelo prioriza mal (la regla 4 gana a «propón el efecto»).
   - Además, cada turno tarda y cuesta más.
4. **Lo visual depende de recetas sueltas:** el gráfico del pipeline, la ficha y el tablero no tienen una lectura de datos para dibujar ni un artefacto.
   - Sin datos, el modelo explica en vez de mostrar.
   - Lo resuelven los artefactos con código (3a/3b) y las lecturas `data.*`.
5. **Datos sin respaldo:** las instrucciones mencionan la extensión, Gmail y los costos.
   - El modelo los repite como hechos de la cuenta sin haberlos leído.

## Qué sigue (Plan 12, 4a)

- **Regla 4 nueva:**
  - si el siguiente paso es una lectura gratis, hacerla antes de responder;
  - si el usuario pidió una acción, proponerla con su tarjeta;
  - preguntar solo cuando falta una decisión que es del usuario.
- **Instrucciones por intención:** un núcleo de reglas siempre, y las recetas de cada intención (buscar, escribir, LinkedIn, cifras e informes, oportunidades, ayuda, archivos) solo cuando el pedido las necesita.
  - Meta: −50 % de tokens por decisión, sin bajar en ningún corpus.
- **Techo de lecturas:** medir 4 lecturas por turno, sin cambiar el cupo de llamadas.
- **Las causas sueltas:**
  - no afirmar el remitente ni los costos sin leerlos;
  - la hora del mundo en las fechas;
  - encadenar «guarda y enriquece» en una sola tarjeta.

## Para repetirlo

```bash
# corpus de siempre, AXIS y uso real (cada uno en su proceso)
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer --repeat=1 --max-calls=400 --output=base-default.json
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer --cases=axis:star --repeat=3 --max-calls=400 --output=base-axis-star.json
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer --cases=axis:rest --repeat=3 --max-calls=400 --output=base-axis-rest.json
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer --cases='ur-*' --repeat=3 --max-calls=400 --output=base-ur.json
# el juez, con otro modelo
node --loader ./scripts/ts-test-loader.mjs scripts/judge-cowork-conversations.ts --live --judge-model=gpt-6-sol --input=base-ur.json --max-calls=400 --output=base-ur-judged.json
```

Con `OPENAI_API_KEY` y `COWORK_MODEL=gpt-6-luna` en el entorno. Nunca se cargan archivos `.env` y nada sale de los mundos de ejemplo.
