# Jev lee las respuestas de los prospectos (30 sep 2026)

Cuando un prospecto responde, la app clasifica qué quiso decir (quiere reunión, tiene interés, no le interesa, pidió la baja, es una respuesta automática o es neutral) y con eso decide si los seguimientos siguen o se detienen. Hoy lo hace un modelo de lenguaje (`classifyReply`). Este cambio deja que Jev (TypeSafe) lea la misma respuesta, **apagado por defecto**: sin la variable, la app hace exactamente lo de antes.

La calibración (`docs/cowork-jev.md`, sección 2) fue la mejor de todas las pruebas con Jev: acierta más, responde 8 veces más rápido y su seguridad sirve para decidir.

| | Jev | Clasificador actual |
|---|---|---|
| Aciertos (43 respuestas, 2 veces) | **93 %** | 79 % |
| Respuestas que piden parar clasificadas como «seguir escribiendo» | **0** | 6 (rebotes) |
| Con seguridad ≥ 0,9: parte de las respuestas y acierto | 81 %, acierta el **97 %** | 94 %, acierta el 79 % |
| Latencia (mediana) | **162 ms** | 1.356 ms |

**Pero son 43 respuestas escritas para la prueba.** Antes de dejar que Jev decida hay que confirmarlo con respuestas reales; por eso el primer paso es el modo sombra.

## Cómo se activa

`REPLY_CLASSIFIER_ENGINE` (sin valor o con uno desconocido: `llm`).

| Valor | Qué pasa |
|---|---|
| `llm` | El modelo clasifica, como hoy. Jev no se consulta. |
| `shadow` | El modelo clasifica y decide. Jev responde al lado y solo se registra si coinciden. Nada de lo que diga Jev se usa. |
| `jev-first` | Decide Jev cuando está seguro (0,9 o más). Si no lo está, o no hay clave, o tarda más de 3 s, o falla, lee el modelo. |

**Qué pasa siempre, en los tres modos:**
- Antes: una baja explícita se clasifica por regla y una respuesta vacía queda como desconocida; Jev no las ve.
- Después: si la respuesta trae un rechazo claro («no estoy interesado», «no me contacten»), nunca queda como «seguir escribiendo», la haya leído quien la haya leído.

## Qué ve Jev

El texto de la respuesta del prospecto (limpio de citas, hasta 3.000 caracteres) y una pregunta de opción con los siete significados. Nada más: ni la clave, ni tokens, ni firmas, ni datos de la campaña ni del usuario. Jev recibe el texto sin ocultar nada, como se decidió el 30 de septiembre para cuando se active en producción.

## Qué hace la app con su respuesta

Las mismas reglas que se le dan al modelo (`src/ai/flows/classify-reply.ts`): interés o una petición detienen los seguimientos automáticos para que lo tome una persona; un rechazo los detiene; una respuesta automática o neutral deja que sigan. Jev no escribe texto, así que el resumen es una frase fija por significado.

| Significado | Sentimiento | ¿Siguen los seguimientos? | Resumen |
|---|---|---|---|
| `meeting_request` | positivo | no | Pidió o aceptó una reunión |
| `positive` | positivo | no | Mostró interés |
| `negative` | negativo | no | No está interesado |
| `unsubscribe` | negativo | no | Pidió no recibir más correos |
| `auto_reply` | neutral | sí | Respuesta automática |
| `neutral` | neutral | sí | Respuesta sin interés ni rechazo claro |
| `delivery_failure` | neutral | no | El correo no se entregó |

**La seguridad de 0,9:** en la calibración Jev acertó el 97 % de las veces desde 0,9, y sus errores estaban entre 0,54 y 0,64, salvo una muestra ambigua. Bajo 0,9 lee el modelo.

## Cómo medirlo: el modo sombra

Cada respuesta deja **una línea** en los registros (`[reply-classifier] jev shadow`):

```json
{"model":"neutral","jev":"neutral","agree":true,"trusted":true,"confidence":0.95,"status":"ok","ms":148,"costUsd":0.0000034}
```

Nunca lleva la respuesta, su resumen ni la clave. Sirve para medir, no para auditar un caso.

**Pasos propuestos para el mantenedor** (esta PR no toca `apphosting.yaml` ni crea el secreto):
1. Crear el secreto `TYPESAFE_API_KEY` con acceso de App Hosting y agregarlo a `apphosting.yaml`.
2. Poner `REPLY_CLASSIFIER_ENGINE=shadow` y dejar correr unos días.
3. Mirar las líneas: parte que coincide, parte con `trusted: true`, estados (`ok`, `timeout`, `disabled`…), latencia y costo.
4. Pasar a `jev-first` si entre las respuestas con `trusted: true` coinciden el 95 % o más y ninguna es una que Jev deja seguir (`neutral`, `auto_reply`) y el modelo detiene (`negative`, `unsubscribe`).
5. Volver a `llm` es cambiar la variable; no hay datos que migrar.

**Costo:** 0,042 USD por millón de tokens de entrada; una respuesta son unos cientos de tokens.

## Cómo verificarlo

1. `node --loader ./scripts/ts-test-loader.mjs --test src/lib/reply-classifier.test.ts`: los tres modos, el umbral, las fallas de Jev (sin clave, tiempo, error HTTP, respuesta ilegible, excepción), las reglas que van primero, el rechazo claro y que el registro no lleva texto. Sin red.
2. Con las claves en el entorno: `node --loader ./scripts/ts-test-loader.mjs scripts/calibrate-reply-jev.ts --live --repeat=2` repite la comparación con la misma pregunta y el mismo umbral que usa la app.

## Límites

- **Solo 43 respuestas de prueba.** Hay que confirmar con respuestas reales; para eso es el modo sombra.
- **El resumen es una frase fija.** Una respuesta positiva clasificada por Jev pierde el resumen específico que escribe el modelo («pide cotización para 50 personas»). Si eso pesa, el modelo puede seguir escribiendo el resumen de las respuestas de interés.
- **Jev confunde «ya le respondí a tu colega, lo estamos evaluando» con interés**, y el modelo lee como interés las preguntas de producto.
- **En modo sombra la latencia no cambia:** Jev responde mientras el modelo trabaja; si Jev tarda más, la respuesta espera hasta 3 s.
