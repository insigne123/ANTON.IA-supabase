# Cowork · la respuesta aparece mientras se escribe (28 sep 2026)

Tercer PR de la Ola V del plan 2 de Cowork (punto V2). Depende de la migración de insigne123/ANTON.IA-supabase#21 (`cowork_run_drafts`). Sin ella, o sin el flag, todo funciona como antes.

> **30 sep:** con `COWORK_ANSWER_HOLD_ENABLED` (encendido en `apphosting.yaml`) el texto ya no se transmite: la página solo muestra la fase en que va la respuesta y esta aparece una vez, ya revisada. Sin ese flag, todo lo de abajo sigue igual. Detalle en `docs/cowork-una-respuesta.md`.

## Qué cambia para el usuario

- **Las primeras palabras aparecen antes:** en cuanto Cowork empieza a escribir la respuesta, el texto aparece y crece. Un cursor marca dónde sigue y cada párrafo nuevo entra con un fundido corto. Antes, la respuesta aparecía entera recién al terminar.
- **El texto en vivo ya viene limpio:** pasa por el mismo pulido que la respuesta final. No aparecen códigos internos ni IDs entre paréntesis.
- **Las tarjetas se anuncian:** si la respuesta trae una secuencia, una tabla, un correo o cifras, aparece una tarjeta en construcción que dice cuánto lleva, por ejemplo «Armando la secuencia · correo 2». Al terminar, la tarjeta real ocupa su lugar.
- **Sin salto al terminar:** la respuesta final reemplaza a la que se estaba escribiendo en el mismo lugar, sin volver a animarse.
- **Si Cowork corrige su respuesta al revisarla:**
  - el texto ya escrito se queda, el cursor se va y aparece «Revisando la respuesta…», en vez de borrarse y escribirse de nuevo;
  - si la versión final cambió alguna palabra, entra con un fundido y dice «Ajusté la respuesta al revisarla».
  - Si solo se agregó la pregunta final, no se muestra ningún aviso.
- **Con «reducir movimiento»:** los párrafos nuevos aparecen sin fundido y los esqueletos no laten.
- **Lectores de pantalla:**
  - el texto en construcción no se anuncia por partes (`aria-busy`);
  - el estado del trabajo anuncia cuando termina, como antes.

## Cómo funciona

1. **El modelo transmite su respuesta:**
   - `generateStructuredWithTelemetry` acepta `onPartial` (`src/ai/openai-json.ts`);
   - con él, la llamada a OpenAI usa `stream: true` e `include_usage`;
   - el resultado es el mismo JSON validado de siempre, con el mismo modelo, el mismo uso y el mismo cacheo.
2. **Se lee el JSON a medio escribir** (`src/lib/cowork/partial-json.ts`):
   - `coworkRepairJson` cierra cualquier prefijo para que se pueda leer;
   - `coworkLiveDraft` solo devuelve algo cuando la decisión es una respuesta: su texto, pulido con `polishCoworkText`, y cuánto lleva cada tarjeta;
   - una consulta o una propuesta no muestran nada.
3. **El worker escribe el borrador** (`coworkDraftWriter` en `src/lib/server/cowork/live-draft.ts`):
   - guarda el último texto y lo escribe a lo sumo cada 400 ms con `cowork_write_run_draft`, nunca dos escrituras a la vez;
   - al terminar la decisión escribe el último estado;
   - en la corrección de cierre (la decisión que recibe un rechazo de tipo `answer`), no transmite: marca el borrador con `reviewing` y deja el texto;
   - si la escritura falla (lease perdido o tabla que todavía no existe), se apaga para ese turno con un aviso en el log, y el turno sigue como antes.
4. **El stream lleva el texto** (`coworkStreamFrames` en `src/lib/server/cowork/run-stream.ts`):
   - mientras el turno corre, la ruta `GET /api/cowork/runs/[id]/stream` lee el borrador cada 400 ms con la sesión del usuario (RLS) y envía frames `draft`;
   - cada frame lleva solo lo que cambió (`from` + `text`), las tarjetas y `reviewing`; una reescritura empieza donde cambió;
   - el turno en sí se sigue leyendo una vez por segundo.
5. **La página arma el texto:**
   - `CoworkWorkspace` junta los frames;
   - `CoworkTurn` muestra `LiveAnswerView` (Markdown con cursor y tarjetas en construcción) hasta que llega `run.completed`;
   - `coworkAnswerChanged` decide si la versión final cambió alguna palabra de la que se vio.

| Pieza | Dónde |
|---|---|
| Streaming con `onPartial` | `src/ai/openai-json.ts` |
| Lectura del JSON parcial | `src/lib/cowork/partial-json.ts` |
| Escritor del borrador y lectura por RLS | `src/lib/server/cowork/live-draft.ts` |
| El worker transmite y escribe | `decide` en `src/lib/server/cowork/worker.ts` |
| Frames `draft` con solo lo nuevo | `src/lib/server/cowork/run-stream.ts`, `src/app/api/cowork/runs/[id]/stream/route.ts` |
| Respuesta en construcción, tarjetas que se anuncian y aviso de ajuste | `LiveAnswerView` y `LiveCard` en `src/components/cowork/CoworkTurn.tsx`, `coworkAnswerChanged` en `src/lib/cowork/presentation.ts`, cursor y fundidos en `src/styles/cowork.css` |
| Prueba del worker con el flag | `scripts/test-cowork-live-draft.mjs` (dentro de `verify-cowork`) |
| Medición del primer texto con el modelo real | `--stream` en `scripts/evaluate-cowork-conversations.ts` |

## Cómo se activa

1. Aplicar la migración de insigne123/ANTON.IA-supabase#21 y verificar el esquema, la RLS y los logs.
2. Definir `COWORK_STREAMING_ENABLED=true` en el entorno del worker y de la app.

Sin el flag, o si la tabla no existe, no se escribe ni se lee ningún borrador y Cowork se comporta como hoy.

## Validación

**Pruebas sin modelo:**
- `partial-json.test.ts`:
  - cualquier corte de un JSON se puede leer;
  - los textos, claves, literales y números a medio escribir se cierran o se quitan;
  - solo una respuesta muestra algo, con su texto pulido.
- `live-draft.test.ts`:
  - a lo sumo una escritura por intervalo, con el último texto;
  - la marca de revisión, también con una escritura en curso;
  - una escritura rechazada o fallida apaga el borrador;
  - la lectura propia por RLS.
- `run-stream.test.ts`: solo lo que cambió, un frame por cambio, el frame de revisión y, sin tabla, solo el aviso de cambios.
- `openai-json.test.ts`: la llamada con streaming, el texto acumulado, el modelo, el uso y un error dentro del stream.
- `presentation.test.ts`: cuándo la versión final cuenta como ajustada.
- `scripts/test-cowork-live-draft.mjs`, el worker completo con dobles:
  - sin el flag, no transmite ni escribe;
  - con el flag, escribe mientras transmite, bajo el lease del turno;
  - en la corrección de cierre no transmite y marca la revisión;
  - sin la tabla, sigue igual con un solo aviso.

**Modelo real** (gpt-6-luna, los 40 casos del corpus de conversación, las dos corridas seguidas el 28 sep):

| | `main`, sin streaming | Este PR, `--stream` |
|---|---|---|
| Casos | 40/40 | 40/40 |
| Verificaciones | 356/356 | 356/356 |
| Llamadas | 84 (2,1 por caso) | 94 (2,35 por caso) |
| Duración de cada llamada, mediana / p90 | 5,8 s / 10,6 s | 5,2 s / 9,9 s |
| Llamadas con entrada cacheada | 82/83 | 91/92 |

- El streaming no hace más lenta la llamada ni cambia el cacheo. La diferencia de llamadas es variación del modelo entre corridas: la lógica de decisión es la misma.
- **Primer texto:** las 29 respuestas mostraron texto antes de terminar.
  - Desde que empieza la llamada que responde, el texto aparece a los 6,3 s (mediana) y a los 8,5 s (p90).
  - La respuesta completa llega a los 8,2 s y a los 11,9 s.
  - El texto empieza a verse unos 2 s antes en la mediana y 3,4 s antes en el p90, y desde ahí se ve crecer.
- **La meta de menos de 3 s no se cumple:**
  - casi toda la espera ocurre antes del primer token del modelo: la llamada lleva unos 15 000 tokens de entrada y el modelo razona antes de escribir;
  - además, `answer` es el último campo del esquema;
  - subirlo quedó fuera a propósito, porque cambia el orden en que el modelo escribe las propuestas.

**Navegador** (Playwright contra el build de producción local, con `COWORK_STREAMING_ENABLED=true` y un Supabase simulado solo en local que escribe el borrador de a poco en `cowork_run_drafts`; la página lo recibe por la ruta real del stream):
- **Claro y oscuro a 1440 px, claro a 390 px y con reducción de movimiento:**
  - el texto aparece a los 9,2 s de abrir (el simulado empieza a escribir a los 8,4 s) y crece en 9 o 10 tamaños distintos en 3,5 s;
  - el cursor está quieto;
  - cada párrafo nuevo entra con `cw-fade`, y sin animación con reducción de movimiento;
  - `aria-busy`;
  - la tarjeta dice «Armando la secuencia · correo N»;
  - al terminar, la respuesta final ocupa su lugar sin volver a subir, con la pregunta y las respuestas sugeridas;
  - llegaron 12 frames `draft`;
  - sin errores de página y sin scroll horizontal.
- **Corrección de cierre** (claro a 1440 px y oscuro a 390 px):
  - aparece «Revisando la respuesta…», el cursor se va y el texto se queda;
  - llega la versión final con «Ajusté la respuesta al revisarla.».
- **Sin el flag:**
  - el stream no lleva ningún frame `draft`;
  - la respuesta aparece al terminar y sube como antes;
  - sin errores.
- **Peso:** `/cowork` queda en 243 KB de carga inicial, 1 KB más que el PR anterior.
