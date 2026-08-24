# M9–M11 — Optimización GLM: context caching, thinking por tier y contexto 1M

**Fase:** 3 · **Depende de:** M1 · **Riesgo:** bajo
**Resuelve:** H15 (sin caching), H10 (tiers solo con temperature), H14 (endpoint mainland) y aprovecha el contexto de 1M (M11).

---

## 1. M9 — Context caching

GLM-5.2 soporta context caching automático por prefijo (documentado en docs.z.ai, sección Capabilities → Context Caching). La regla práctica: **el prefijo del array `messages` debe ser byte-idéntico entre llamadas** para lograr cache hit. Cambios:

### 1.1 Orden estable del prompt (en `suplia-agentic-runner.ts` / `suplia-agentic-prompt.ts`)

Orden obligatorio de `messages`:

1. `system` — `buildSupliaAgenticSystemPrompt()` **100 % estático** (verificar: sin fechas, sin datos de org). Si se necesita la fecha, va en el mensaje de contexto dinámico, no aquí.
2. El array `tools` también debe ser estable: `buildNativeToolCatalog()` debe devolver SIEMPRE el mismo orden (ordenar por `internalName` con `sort()` explícito) y sin valores dependientes del request.
3. Mensaje de contexto dinámico (cambia poco entre turnos de la misma org): construirlo determinístico — claves JSON ordenadas (helper `stableStringify` con `Object.keys(...).sort()`), sin timestamps de "ahora" salvo fecha del día (`YYYY-MM-DD`, no hora).
4. Resumen de compactación (estable hasta la próxima compactación).
5. Historial + mensaje nuevo (la cola variable).

### 1.2 Telemetría de cache

En `glm-chat.ts`, capturar del `usage` final los campos de caching si vienen (`prompt_tokens_details.cached_tokens` en formato OpenAI-compatible; loggear el objeto `usage` completo la primera semana para confirmar el nombre real del campo en GLM). Extender `buildOpenAiTelemetry` (`src/lib/server/suplia-observability.ts`) para incluir `cachedTokens: number | null`. Añadirlo al metadata del mensaje (ya viaja en `agenticTelemetry`).

### 1.3 Criterio de aceptación M9

En 2 mensajes consecutivos de la misma conversación, el segundo debe reportar `cachedTokens > 0` (verificar en metadata del mensaje o logs). Si GLM no reporta el campo, dejar el logging y anotar en el doc de seguimiento — el beneficio de latencia igualmente aplica.

---

## 2. M10 — Tiers → thinking / reasoning_effort

Parte ya quedó en M1 (`buildRequestBody`). Completar:

### 2.1 Router bilingüe y único

En `src/ai/model-router.ts`, `selectSupliaModelTier`:

1. Agregar equivalentes en inglés a las regex existentes (mismos grupos): high-risk (`send all|bulk|mass|everyone|auto[- ]?send`), tools (`send|contact|search|find|research|campaign|pipeline|follow.?up|automate`), reasoning (`strategy|plan|prioriti[sz]e|recommend|decide|analy[sz]e|segment|scor(e|ing)|icp|risk|compliance`). Mantener las españolas intactas.
2. Exportar los umbrales como constantes para test.
3. Eliminar la doble llamada: en el flujo agéntico el tier se calcula UNA vez en `processSupliaMessageAgentic` y se pasa al runner (M1 ya lo hace así; verificar que `runSupliaBrain` legacy siga calculándolo solo). En legacy no tocar.

### 2.2 Overrides por env

Soportar mapeo explícito de effort por tier (nuevas envs opcionales, leídas en `buildRequestBody`):

```
SUPLIA_GLM_EFFORT_REASONING="high"    # '', 'high' o 'max'
SUPLIA_GLM_EFFORT_CRITICAL="max"
SUPLIA_GLM_THINKING_FAST="disabled"   # 'enabled'|'disabled'
```

Defaults = los de M1. Documentar en `.env.example`.

### 2.3 Test

`src/ai/model-router.test.ts` (nuevo): mensajes en inglés equivalentes a los españoles devuelven el mismo tier ("send the campaign to everyone" → `critical`; "what's our icp strategy" → `reasoning`; "hola" → `fast`).

---

## 3. M11 — Aprovechar el contexto de 1M

1. `.env.example`: `SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS="400000"` (antes 150000). El default **en código** (`DEFAULT_SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS` en `src/lib/suplia/conversation-context.ts`) subirlo a `400_000`.
2. `SUPLIA_CONTEXT_RECENT_MESSAGES`: subir default a `24` (de 12) — con M8 el costo de cargar más recientes es bajo y mejora la continuidad.
3. `maxTokens` de salida por tier en `glm-chat.ts`: fast/balanced 4096, orchestrator 8192, reasoning 16384, critical 32768 (GLM-5.2 admite hasta 128K; no exagerar: costo). Env override opcional `SUPLIA_GLM_MAX_TOKENS_<TIER>`.
4. Razonamiento de costo en el doc: compactar menos = más tokens de entrada por turno pero menos llamadas de resumen y mejor memoria; con caching (M9) el prefijo repetido se abarata. Dejar el umbral configurable es la mitigación.

---

## 4. Endpoint internacional (H14)

1. `.env.example`: `GLM_BASE_URL="https://api.z.ai/api/paas/v4"` como valor sugerido, con comentario: `# Mainland China: https://open.bigmodel.cn/api/paas/v4`.
2. El default **en código** (`DEFAULT_GLM_BASE_URL` en `src/ai/openai-json.ts`) puede permanecer como está para no sorprender a despliegues existentes; solo documentación + env.
3. Verificación manual: con la key de Z.ai internacional, un mensaje responde OK y la latencia TTFB del POST a chat/completions baja respecto del endpoint mainland (medir con los logs de `durationMs` de telemetría, comparar p50 de 10 llamadas).

---

## 5. QA / aceptación consolidada

1. Typecheck + tests verdes (incluye el nuevo `model-router.test.ts`).
2. `cachedTokens` visible en telemetría (o logging de usage confirmando ausencia del campo).
3. Mensaje trivial ("hola") → request sin `reasoning_effort` y con `thinking: disabled` (verificar con log de request body en dev, quitarlo después).
4. Mensaje "arma la estrategia de priorizacion del pipeline" → `reasoning_effort: high`.
5. Conversación de 30+ mensajes con umbral default: no compacta hasta 400K tokens estimados.
