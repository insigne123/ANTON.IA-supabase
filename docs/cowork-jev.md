# Jev (TypeSafe) en ANTON.IA · calibración (30 sep 2026)

Jev es el modelo «System One» de TypeSafe (docs.typesafe.ai). No escribe texto: responde preguntas tipadas sobre un estado, con probabilidades.
- **Tipos de pregunta:** `noul` (probabilidad de que algo sea cierto), `choice` (una opción de un conjunto) y `score` (niveles ordenados).
- **Latencia medida aquí:** mediana de 145 ms.
- **Costo:** 0,042 USD por millón de tokens de entrada; la salida no se cobra.

El usuario pidió probarlo para juzgar y en otras partes de la app. El primer PR trajo el cliente, la calibración y lo que se aprendió; el segundo lo conecta a la revisión del turno (ver «Jev en la revisión del turno»), apagado por defecto: sin `COWORK_REVIEW_ENGINE` ni `COWORK_JEV_SHADOW`, nada llama a Jev.

## Lo que se probó

**Solo con casos inventados:** respuestas del corpus de Cowork y respuestas de prospectos escritas para esto. Ningún dato real viajó a TypeSafe.

### 1. Revisar respuestas de Cowork, como la Jueza

**Qué se hizo:**
- **Datos:** 1.576 respuestas del corpus ya juzgadas por gpt-6-sol, el juez offline de las evaluaciones anteriores; 138 quedaron fuera porque su caso ya no está en el corpus.
- **Qué vio Jev:** lo mismo que vio el juez (`coworkJudgePrompt`), con claves en inglés.
- **Qué se le preguntó:** preguntas atómicas en inglés, una por cada falla que el juez encuentra seguido (`src/lib/cowork/jev-review.ts`).
- **Umbrales:** se ajustaron con el 70 % de las respuestas, y la tabla informa el 30 % restante (484).
- **Cómo leer el AUC:** 1 separa perfecto y 0,5 es azar. Se descarta una pregunta con AUC menor a 0,8.

| Pregunta a Jev | Contra qué se midió | AUC |
|---|---|---|
| **Ofrece una consulta o preparación que podía hacer** | el juez lo nombra entre los problemas | **0,89** |
| | fricción ≤ 2 | 0,76 |
| Pide un dato que ya tiene | el juez lo nombra / fricción ≤ 2 | 0,60 / 0,51 |
| Niega algo que sí está en el contexto | el juez lo nombra / veracidad ≤ 3 | 0,49 / 0,53 |
| Cifra sin respaldo | el juez lo nombra / veracidad ≤ 3 | 0,48 / 0,59 |
| Nombre sin respaldo o apellido completado | el juez lo nombra / veracidad ≤ 3 | 0,54 / 0,47 |
| No responde lo pedido | comprensión ≤ 3 | 0,63 |
| Cualquiera de las anteriores | veredicto «mala» | 0,76 |

**Veredicto general** (buena, mejorable o mala):
- Casi no coincide con gpt-6-sol: κ = 0,04. Jev casi nunca dice «mala» (3 de 323).
- Sobre las 417 respuestas que también leyó la Jueza del turno (gpt-6-luna, la de producción), la Jueza coincide con gpt-6-sol con κ = 0,13 y Jev con κ = 0,06. Ninguna de las dos se acerca al juez offline.

**Otras formulaciones** (mismas 484 respuestas):

| Formulación | AUC |
|---|---|
| «La pregunta final ofrece revisar, consultar o preparar algo» (sin contar aprobar campañas o búsquedas) | 0,85 contra lo que nombra el juez; 0,77 contra fricción ≤ 2 |
| «Contradice los datos consultados» | 0,68 contra veracidad ≤ 2 |
| «Menciona algo que no está en los datos» | 0,50 |
| Fricción como escala de 3 niveles | 0,65 |
| Calidad general como escala | 0,54 |

**Latencia y costo:**
- 1.576 de 1.576 respuestas contestadas;
- mediana de 145 ms, p95 de 194 ms y máximo de 466 ms;
- 2,6 millones de tokens por 0,11 USD en total.

**Qué significa:**
- **Jev sirve** para una sola falla: «termina ofreciendo una consulta que Cowork podía hacer». Es la que más corregía la Jueza.
  - Con umbral 0,88, 9 de cada 10 respuestas que marca tienen fricción ≤ 2 según el juez.
  - A cambio, marca solo 1 de cada 5 de esas respuestas: poca cobertura.
- **No sirve todavía**, en respuestas en español con datos largos:
  - para cifras o nombres sin respaldo;
  - como veredicto general.
- **Por eso** `COWORK_JEV_DEFAULT_THRESHOLDS` solo activa esa pregunta. Las demás se siguen preguntando para medirlas, pero nunca disparan una corrección.
- **Para cifras sin respaldo** conviene un chequeo en código (las cifras de la respuesta contra las de los datos), no Jev.

### 2. Clasificar respuestas de prospectos

**Qué se hizo:**
- **Datos:** 43 respuestas etiquetadas (`scripts/fixtures/reply-intent-samples.ts`): las 13 del laboratorio de respuestas y 30 anonimizadas con los patrones de una operación real (objeciones, derivaciones, bajas, autorespuestas y rebotes).
- **Comparación:** los dos caminos parten con las mismas reglas (baja explícita y negativa dura). Después:
  - el clasificador actual (`classifyReply`, flujo con gpt-6-luna);
  - una pregunta `choice` a Jev con los 7 intents.
- **Repeticiones:** 2 veces cada una.

| | Jev | Clasificador actual |
|---|---|---|
| Aciertos | **93 %** (80 de 86) | 79 % (68 de 86) |
| Respuestas que piden parar (negativa, baja o rebote) clasificadas como «seguir escribiendo» | **0** | 6 |
| Marca «parar» cuando no correspondía | 0 | 0 |
| Seguridad ≥ 0,9: share y acierto | 81 %, que aciertan el 97 % | 94 %, que aciertan el 79 % |
| Latencia (mediana / máximo) | **162 ms** / 392 ms | 1.356 ms / 2.304 ms |

**Por intent:**

| | Jev | Actual |
|---|---|---|
| meeting_request | 10/10 | 10/10 |
| positive | 16/18 | 14/18 |
| neutral | 16/20 | 12/20 |
| unsubscribe | 8/8 | 8/8 |
| negative | 14/14 | 14/14 |
| delivery_failure | 6/6 | 0/6 |
| auto_reply | 10/10 | 10/10 |

**Lecturas a considerar:**
- **Rebotes:** los 6 errores del clasificador actual son rebotes que deja como `unknown`. En la app, la sincronización detecta los rebotes antes (`detectDeliveryFailure`), así que en el flujo real esos 6 no llegan al modelo. Sin rebotes, Jev acierta 74 de 80 (92,5 %) y el actual 68 de 80 (85 %).
- **Dónde falla cada uno:**
  - El actual lee como interés las preguntas de producto («¿cubre licencias?», «¿tienen caso en construcción?»).
  - Jev confunde «ya le respondí a tu colega, lo estamos evaluando» con interés.
- **Confianza:** la de Jev sirve para decidir (con ≥ 0,9 acierta el 97 %). La del clasificador actual no: dice ≥ 0,9 casi siempre.
- **Tamaño:** son 43 respuestas escritas para la prueba. Hay que confirmarlo con respuestas reales antes de cambiar el clasificador.

## Jev en la revisión del turno (apagado por defecto)

`COWORK_REVIEW_ENGINE` dice quién lee la respuesta final del coordinador antes de mostrarla. Sin valor sigue a `COWORK_JUDGE_ENABLED`, así que nada cambia para quien no lo toque.

| Motor | Quién revisa | Si Jev no contesta |
|---|---|---|
| `llm` | el modelo de la Jueza, como hasta ahora | (no aplica) |
| `jev` | Jev solo, con la pregunta calibrada y su umbral de precisión (0,88) | la respuesta sale sin revisión |
| `jev-llm` | Jev primero, con el umbral de cobertura (0,74): el modelo lee solo lo que Jev no despeja | el modelo la lee |
| `off` | nadie | (no aplica) |

**Cómo corrige.** Jev contesta preguntas, no escribe. Las preguntas que se activan se vuelven un juicio normal (`coworkJevJudgement`): cada una baja su dimensión a 2 y aporta su problema en español. Desde ahí es el mismo camino que con el modelo: `coworkJudgeFix` decide si vale una corrección, el coordinador edita su respuesta anterior y el bucle se queda con la primera si la corrección viene vacía, igual o con cifras sin respaldo.

**Falla abierto.** Sin clave, con timeout (1,5 s dentro del turno), error HTTP o respuesta ilegible, Jev no bloquea nada: con `jev` la respuesta sale como estaba, con `jev-llm` la lee el modelo. Una cancelación del trabajo sí se respeta.

**En sombra.** Con `COWORK_JEV_SHADOW=true` Jev contesta las mismas preguntas junto a la revisión y solo registra:
- con el modelo revisando (`llm`), Jev contesta mientras el modelo piensa: no suma espera;
- con la Jueza apagada (`off`, el estado de producción hoy), Jev contesta solo, sin tocar la página ni la respuesta: suma lo que tarda (mediana de 145 ms, máximo 1,5 s);
- el rastro es un paso `assistant.agent` con `agent: 'jev'` que la página no conoce y por eso ignora (ni fila, ni línea de actividad, ni consulta). Guarda la probabilidad de cada pregunta, cuáles se habrían activado, el estado de la llamada, la latencia, los tokens y el costo; **nunca** el estado que leyó Jev ni la clave.

**Sin migración.** Las llamadas a Jev no entran al libro de llamadas del modelo, y el paso es un evento más de la corrida.

**Lo que no hace todavía.** La regla de «no empeorar con Jev» del plan (volver a preguntarle a Jev por la respuesta corregida y quedarse con la primera si se activa algo nuevo) no está: hoy la corrección se acepta con las mismas guardas del modelo (vacía, igual, cifras nuevas). Y `jev-llm` solo cubre la falla calibrada: las demás preguntas se miden pero no disparan nada (ver «Lo que se probó»).

### Cómo se enciende (lo hace el mantenedor)

1. Crear el secreto `TYPESAFE_API_KEY` en App Hosting, con acceso de la app.
2. Un PR de una línea agrega la entrada `secret:` en `apphosting.yaml` y `COWORK_JEV_SHADOW="true"`. Con la Jueza apagada, eso solo registra.
3. Con latencia p95 ≤ 1,5 s y las probabilidades registradas de acuerdo con lo calibrado, `COWORK_REVIEW_ENGINE="jev-llm"` y, si el acuerdo se sostiene, `"jev"`. Volver atrás es quitar la variable.

### Medido con el modelo real

Con el modelo real (gpt-6-luna, con Redactora y texto retenido, como en producción), los 59 casos del corpus (producción, marketing, inicios, edición, archivos, importar, agenda e hilo) dos veces cada uno: 118 corridas por configuración, el mismo día. Juez fuera de línea gpt-6-sol. Las cuatro configuraciones usan `--review-engine` o `--judge-in-turn` de `scripts/evaluate-cowork-conversations.ts`; Jev recibió solo los casos del corpus (datos inventados).

| | Sin revisión | Jueza (`llm`) | `jev` | `jev-llm` |
|---|---|---|---|---|
| Corridas que pasan todas las verificaciones | 107 | 112 | 108 | 111 |
| Verificaciones | 1.208 de 1.220 | 1.213 | 1.202 | 1.210 |
| Veredictos del juez (buena / mejorable / mala) | 60 / 22 / 36 | 73 / 21 / 24 | 66 / 17 / 35 | 74 / 15 / 29 |
| Veracidad media (1 a 5) | 4,49 | 4,81 | 4,65 | 4,84 |
| Fricción media | 3,96 | 4,17 | 4,01 | 4,07 |
| Utilidad / claridad / comprensión | 4,01 / 4,80 / 4,75 | 4,10 / 4,81 / 4,81 | 4,06 / 4,82 / 4,77 | 4,07 / 4,83 / 4,80 |
| Respuestas que pidieron una corrección | (no aplica) | 12 | 1 | 9 |
| Lecturas del modelo en la revisión | 0 | 57 | 0 | 32 de 51 (Jev despejó 19) |
| Segundos por turno, mediana / p90 | 10,9 / 20,2 | 12,7 / 22,9 | 10,7 / 20,5 | 12,2 / 22,6 |
| Jev: latencia mediana / p95 | (no aplica) | (no aplica) | 184 ms / 514 ms | 194 ms / 475 ms |
| Jev: costo de la corrida | (no aplica) | (no aplica) | 0,0042 USD (53 respuestas) | 0,0040 USD (51 respuestas) |

**Cómo leerlo**
- **Jev solo casi no corrige:** pidió una corrección en 1 de 53 respuestas. Es lo calibrado (una sola pregunta, con precisión de 9 de cada 10 y cobertura de 1 de cada 5) y no mueve las medias del juez más allá del ruido. Como motor único no vale la pena; su valor es registrar en sombra.
- **`jev-llm` conserva casi todo lo que aporta la Jueza** (veracidad 4,84 frente a 4,81; 74 respuestas buenas frente a 73) con 44 % menos lecturas del modelo (32 frente a 57) y 0,5 s menos de espera en la mediana. A cambio, el juez marca algo más de respuestas «malas» (29 frente a 24) y la fricción queda algo más baja (4,07 frente a 4,17); una explicación posible es que Jev despeje alguna respuesta que el modelo habría corregido, y no se comprobó.
- **La revisión en sí sí aporta:** con la Jueza o con `jev-llm`, la veracidad sube de 4,49 a 4,8 y las respuestas «malas» bajan de 36 a entre 24 y 29, a cambio de 1,3 a 1,8 s más por turno.
- **Jev fue fiable en la medición:** contestó 104 de 104 veces, con p95 por debajo de 1 s y unos 0,00008 USD por respuesta.
- **Con el texto retenido nadie ve el reemplazo.** Sin retener, 9 de las respuestas (Jueza y `jev-llm`) y 1 (`jev`) se habrían reemplazado a la vista.
- **Son muestras chicas** (118 corridas por configuración, un solo juez): las diferencias de una décima o de pocas respuestas están dentro del ruido. La mejora de veracidad (+0,3 con la Jueza y con `jev-llm`) se ve en las dos mitades del corpus; la baja de respuestas «malas» y de fricción viene sobre todo de la primera mitad (23 «malas» sin revisión, 12 con la Jueza y 18 con `jev-llm`) y casi no aparece en la segunda (13, 12 y 11).


## Qué se envía a Jev

- **En estas pruebas:** solo casos inventados.
- **En producción, cuando se active (decisión del usuario, 30 sep):** la conversación sin ocultar.
  - En la revisión de respuestas: el pedido, el historial breve, quién es el usuario y qué vende, los datos consultados y la respuesta.
  - En la clasificación: el texto de la respuesta del prospecto.
- **Nunca:** la clave, tokens ni firmas de correo.

## Próximos pasos propuestos

1. **Jev en la revisión del turno:** hecho, apagado por defecto (ver la sección siguiente). Falta medirlo con conversaciones reales, en sombra.
2. **Jev para clasificar respuestas:**
   - primero en sombra junto al clasificador actual, registrando las dos;
   - después, Jev primero cuando su confianza sea ≥ 0,9, con el modelo como respaldo.

## Configuración

| Variable | Qué hace |
|---|---|
| `TYPESAFE_API_KEY` | Clave de Jev, como secreto de App Hosting. Sin ella, el cliente no llama y responde `disabled`. |
| `TYPESAFE_API_URL` | Por defecto `https://api.typesafe.ai/v1/systemone`. |
| `JEV_MODEL` | Por defecto `jev-latest` (hoy `jev-1.13.0`). |
| `COWORK_JEV_TIMEOUT_MS` | Por defecto 3000. |
| `COWORK_REVIEW_ENGINE` | Quién revisa la respuesta antes de mostrarla: `llm` (el modelo de la Jueza), `jev`, `jev-llm` u `off`. Sin valor, o con uno que no es ninguno de estos, sigue a `COWORK_JUDGE_ENABLED`. |
| `COWORK_JEV_SHADOW` | `true`: Jev contesta junto a la revisión (o solo, si nadie revisa) y solo registra. |

**El cliente** (`src/lib/server/jev.ts`):
- falla abierto: sin clave, con timeout, error HTTP o respuesta ilegible devuelve «sin respuestas» y la razón;
- nunca registra la clave ni el estado;
- recorta el estado a 60.000 caracteres.

**Este PR no agrega el secreto a `apphosting.yaml`:** el mantenedor lo crea cuando decida activarlo.

## Cómo repetir la calibración

```
TYPESAFE_API_KEY=… node --loader ./scripts/ts-test-loader.mjs scripts/calibrate-cowork-jev.ts --live \
  --inputs=corrida-a.json,corrida-b.json --max-requests=2000 --output=calibracion.json
TYPESAFE_API_KEY=… OPENAI_API_KEY=… OPENAI_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs \
  scripts/calibrate-reply-jev.ts --live --repeat=2 --output=respuestas.json
```

**Entradas:** cada corrida es una salida de `scripts/evaluate-cowork-conversations.ts` con su informe de `scripts/judge-cowork-conversations.ts` al lado (`<nombre>-judge.json`).
