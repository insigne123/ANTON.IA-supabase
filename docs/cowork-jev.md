# Jev (TypeSafe) en ANTON.IA · calibración (30 sep 2026)

Jev es el modelo «System One» de TypeSafe (docs.typesafe.ai). No escribe texto: responde preguntas tipadas sobre un estado, con probabilidades.
- **Tipos de pregunta:** `noul` (probabilidad de que algo sea cierto), `choice` (una opción de un conjunto) y `score` (niveles ordenados).
- **Latencia medida aquí:** mediana de 145 ms.
- **Costo:** 0,042 USD por millón de tokens de entrada; la salida no se cobra.

El usuario pidió probarlo para juzgar y en otras partes de la app. Este PR trae el cliente, la calibración y lo que se aprendió. No cambia el comportamiento de la app: nada llama a Jev todavía.

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

## Qué se envía a Jev

- **En estas pruebas:** solo casos inventados.
- **En producción, cuando se active (decisión del usuario, 30 sep):** la conversación sin ocultar.
  - En la revisión de respuestas: el pedido, el historial breve, quién es el usuario y qué vende, los datos consultados y la respuesta.
  - En la clasificación: el texto de la respuesta del prospecto.
- **Nunca:** la clave, tokens ni firmas de correo.

## Próximos pasos propuestos

1. **Jev en la revisión del turno** (después de que la respuesta se revise antes de mostrarse):
   - solo la pregunta calibrada, con umbral 0,88;
   - primero en sombra (`COWORK_JEV_SHADOW`: registra sin decidir) para medir con conversaciones reales.
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
