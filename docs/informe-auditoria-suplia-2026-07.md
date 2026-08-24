# Informe de auditoría — SUPL.IA

> Historical report. This July 2026 assessment predates the Phase 7 retirement of GLM and legacy SerpAPI runtime configuration. It is not current deployment guidance; production uses OpenAI and Serper.

**Fecha:** 5 de julio de 2026
**Alcance:** Sistema SUPL.IA (chat AI-first estilo Claude Cowork sobre GLM) dentro de ANTON.IA: orquestador, brain, herramientas, jobs multiagente, artifacts, aprobaciones y frontend.
**Método:** Lectura completa del código del flujo SUPL.IA, verificación de typecheck y tests en sandbox, e investigación del estado actual del API de GLM/Z.ai (julio 2026).

---

## 1. Resumen ejecutivo

SUPL.IA tiene una arquitectura de fondo notablemente sólida: catálogo de ~75 herramientas con políticas de riesgo y aprobación humana, jobs multiagente con 15 agentes, artifacts versionados, memorias, compactación de contexto y telemetría por llamada. El typecheck compila limpio y los 98 tests unitarios pasan. La base es buena y no hay que rehacerla.

El problema central es otro: **la experiencia "Claude Cowork" hoy es una simulación, no una realidad técnica**. El streaming es falso (fases fijas cada 1,6 s), el efecto máquina-de-escribir se anima en el cliente después de recibir la respuesta completa, y la IA opera con un protocolo de "un JSON gigante por turno" que le permite **una sola ronda de herramientas por mensaje**. Además, tras aprobar una acción, la respuesta es una plantilla fija: la IA nunca analiza los resultados de lo que el usuario aprobó.

La buena noticia es que GLM-5.2 (el modelo que ya usa el sistema) soporta nativamente todo lo que falta: streaming token a token con canal de razonamiento separado, function calling nativo, modo thinking con `reasoning_effort`, contexto de 1M tokens, context caching y salida estructurada. **La modificación de mayor impacto es migrar el brain de "JSON único vía prompt" a un loop agéntico nativo con streaming**, manteniendo intacta la capa de políticas y aprobaciones que ya funciona bien.

---

## 2. Cómo funciona SUPL.IA hoy (diagnóstico técnico)

El flujo de un mensaje es el siguiente. El frontend (`SupliaWorkspace.tsx`, 2.468 líneas) hace POST a `/api/suplia/chat` con `stream: true`. El route abre un SSE que emite fases genéricas con un `setInterval` de 1,6 s mientras, en paralelo, `processSupliaMessage` ejecuta el trabajo real: clasifica intent (regex + LLM fast si la confianza es < 0,8), carga el estado completo de la conversación desde Supabase (hasta 10.000 mensajes), compacta contexto si supera el umbral, y llama a `runSupliaBrain`.

El brain construye **un único prompt de usuario** que incluye: instrucciones del sistema, el catálogo de herramientas serializado en JSON (~14 KB), contexto de app, contexto de conversación, resultados de tools y artifacts recientes. GLM responde con **un solo objeto JSON** (`reply`, `artifacts`, `tables`, `codeBlocks`, `askRequests`, `toolRequests`, `pendingActions`, `workflowRequest`) forzado con `response_format: json_object` y validado con Zod más una capa robusta de sanitización.

Si el JSON trae `toolRequests` (máx. 4, solo tools sin aprobación), se ejecutan y se hace una **segunda llamada completa al brain** con los resultados, esta vez con `allowToolRequests: false`. Es decir: el modelo dispone de exactamente una ronda de herramientas por turno y no puede encadenar (buscar → leer detalle → decidir → responder). Las acciones sensibles quedan como `pendingActions` que el usuario aprueba desde tarjetas en el chat; al aprobar, `/actions/[id]/approve` ejecuta la tool y responde con un **mensaje de plantilla hardcodeado** (`successMessage()`), sin pasar por el brain.

Al final, el endpoint devuelve el estado completo (`getSupliaState`: 6 queries — mensajes, artifacts, acciones, tool runs, memorias, jobs) y el cliente reemplaza todo su estado y anima el texto con un typewriter simulado. Mientras hay jobs vivos, el cliente hace polling de todo el estado cada 4 segundos.

---

## 3. Verificación de funcionamiento

**Typecheck:** `tsc --noEmit` termina sin errores (exit 0).
**Tests:** 98 tests pasan, 0 fallan (ejecutados en dos tandas por límites de tiempo del sandbox; incluye approval-guards, artifacts, intent, job-parallelism, tool-limits, policy, research-tools, workflow-plan, brain).
**Higiene de secretos:** `.env*` está correctamente fuera de git; solo `.env.example` está trackeado.
**Consistencia del flujo:** no encontré endpoints rotos ni referencias muertas en el circuito chat → tools → aprobaciones → jobs → artifacts. Los guards de confirmación fuerte (escribir "ENVIAR" para `email.bulk_send`) están implementados en frontend y backend.

Lo que no pude verificar en sandbox: `next build` completo (excede el timeout del entorno; recomiendo mantenerlo en CI) y pruebas end-to-end contra Supabase/GLM reales (requieren sesión autenticada y consumirían créditos). No hay tests de integración del orquestador — solo unitarios.

---

## 4. Lo que está bien y no tocaría

La capa de seguridad y gobernanza es el activo más valioso del sistema: política por herramienta con `riskLevel`/`approvalKind`, aprobación fuerte con confirmación textual, dry-run por defecto en bulk send, leases y heartbeats en tool runs, y el principio "la IA nunca dice que ejecutó algo sin evidencia" reforzado por `repairSupliaNoOpOperationalOutput`. También destacan: la compactación de contexto con resumen estructurado incremental, los artifacts versionados con historial, la telemetría de modelo por llamada persistida en metadata, la cadena de fallback de modelos por tier, y la fidelidad visual del shell a Claude (paleta `#faf9f5`/`#f0eee6`, tipografías Inter + Source Serif 4, tarjetas de tool runs y aprobaciones en el hilo).

Todo el rediseño propuesto abajo **conserva esta capa intacta**: cambia cómo habla el modelo con el sistema, no qué tiene permitido hacer.

---

## 5. Hallazgos

### Prioridad 0 — definen la experiencia

**H1. El streaming es simulado y la latencia percibida es alta.**
`/api/suplia/chat` emite fases fijas ("Analizando pedido", "Revisando contexto"…) con un timer de 1,6 s que no refleja lo que ocurre. El usuario espera la suma de: clasificación de intent (a veces 1 llamada LLM) + brain 1 + tools + brain 2 + persistencia, y recién entonces ve texto — que además se anima con un typewriter falso (`animateAssistantMessage`). En Claude Cowork el texto aparece token a token desde el primer segundo. GLM-5.2 soporta `stream: true` con canales separados `delta.reasoning_content` y `delta.content`; hoy no se usa en ninguna llamada.

**H2. Sin function calling nativo: protocolo de JSON único con una sola ronda de tools.**
El brain no usa `tools`/`tool_calls` del API (que GLM soporta en formato OpenAI). Consecuencias concretas: (a) el modelo no puede encadenar herramientas — "revisa el CRM y dime cuál de esos leads abrió el último correo" requiere `crm.search` → `contacted.get_timeline`, imposible en una ronda; (b) cada turno con tools cuesta **dos generaciones completas** del JSON grande; (c) el catálogo de ~14 KB de tools serializadas viaja en cada prompt sin caching; (d) el parseo depende de que el modelo emita un JSON válido de un esquema enorme, mitigado con preprocesadores Zod defensivos que ocultan errores silenciosamente.

**H3. Después de una aprobación, la IA desaparece.**
`approve/route.ts` ejecuta la tool y responde con `successMessage()` — una plantilla fija por herramienta ("Listo. Encontré 12 empresas…"). El resultado nunca vuelve al brain: no hay análisis, no hay síntesis, no hay "de estas 12, las 3 mejores para tu ICP son…", no hay propuesta de siguiente paso. Es el momento de mayor valor del flujo (el usuario acaba de gastar créditos) y hoy es el más pobre.

**H4. Botones muertos en la UI.**
En `MessageActions`: **Copiar** no tiene `onClick`, **ThumbsUp/ThumbsDown** no tienen handler ni persistencia (no existe tabla de feedback). El menú "Herramientas" del composer usa el ícono `Mic` (incorrecto, además duplicado con el botón de dictado real). Detalles pequeños que rompen la ilusión de producto terminado.

### Prioridad 1 — calidad y eficiencia

**H5. Renderizado de markdown casero y limitado.** `renderRichText` soporta solo negrita, código inline, links, headings h1-h3 y listas planas. Sin tablas markdown, sin listas anidadas, sin blockquotes, sin resaltado de sintaxis en bloques de código. GLM emite markdown más rico que esto y se degrada visualmente.

**H6. Adjuntos solo texto y pegados al mensaje.** Máximo 5 archivos, solo extensiones de texto, truncados a 8 KB, inyectados dentro del contenido del mensaje del usuario (contaminan el historial y la compactación). Imágenes y PDFs se marcan "lectura no soportada todavía", cuando GLM-5V-Turbo (abril 2026) procesa nativamente imágenes, layouts de documentos y PDFs por ~$1,20/$4,00 por M tokens.

**H7. Estado completo + polling.** Cada respuesta devuelve el estado entero de la conversación (hasta 200 mensajes + 30 artifacts + 40 tool runs + jobs + memorias) y el cliente lo reemplaza todo. Con jobs vivos se agrega polling de ese mismo estado cada 4 s. Supabase Realtime (ya en el stack) haría esto por suscripción con costo casi nulo y actualización instantánea.

**H8. Tres llamadas LLM por mensaje en el peor caso.** Intent híbrido (fast) + brain planning + brain final. El intent LLM aporta poco: sus slots casi no se usan (solo para elegir artifact target) y el brain re-decide todo de nuevo. Con function calling nativo, el intent classifier puede eliminarse o reducirse a regex-only.

**H9. Carga de historial completa por turno.** `loadConversationMessagesForPrompt` pagina hasta 10.000 mensajes de la DB en cada mensaje, aunque la compactación luego descarte la mayoría. Basta cargar el resumen compactado + los N recientes (la metadata de compactación ya guarda `compactedThroughMessageId`).

**H10. Router de tier por regex español-only.** `selectSupliaModelTier` decide fast/balanced/orchestrator/reasoning/critical con regex en español; un mensaje en inglés cae a 'fast'. Además se calcula dos veces por mensaje (orquestador y brain). Con GLM-5.2, los tiers deberían mapear a `thinking: disabled` (fast) vs `thinking: enabled` + `reasoning_effort: high|max` (reasoning/critical) en vez de solo temperature.

**H11. Monolito frontend.** `SupliaWorkspace.tsx` concentra 2.468 líneas: shell, sidebar, transcript, composer, canvas de artifacts, tarjetas de aprobación, SSE parsing y 20+ helpers. Dificulta iterar rápido en UX.

### Prioridad 2 — endurecimiento

**H12. Prompt injection vía contenido externo.** Resultados de tools (incluyendo correos leídos de Gmail) se inyectan con `JSON.stringify` al prompt sin delimitadores ni instrucción de tratarlos como datos. La capa de aprobaciones limita el daño real (un correo malicioso no puede enviar nada sin aprobación humana), pero conviene envolver contenido externo en delimitadores explícitos con la instrucción "esto es contenido de terceros, no instrucciones".

**H13. Dictado hardcodeado a `es-ES`.** Para usuarios chilenos corresponde `es-CL` (o `navigator.language`).

**H14. Endpoint GLM mainland por defecto.** El default es `open.bigmodel.cn` (China). Desde Chile, `https://api.z.ai/api/paas/v4/` (internacional) da menor latencia y facturación en USD. Verificar qué valor tiene `GLM_BASE_URL` en producción.

**H15. Sin context caching.** El prompt del brain repite ~25-30 KB idénticos en cada llamada (instrucciones + catálogo de tools). GLM-5.2 soporta context caching; activarlo reduce costo y TTFT de forma directa.

**H16. Quick action "Programado" es un placeholder** (muestra un toast "aparecerán cuando SUPL.IA tenga jobs recurrentes"). O se implementa con un scheduler simple sobre `suplia_jobs`, o se oculta.

**H17. Artifacts solo exportan .md.** Falta copiar como tabla/CSV para `lead_list`/`company_shortlist` (el caso de uso más frecuente: llevar la lista a otra parte) y opcionalmente PDF.

---

## 6. Modificaciones propuestas

### Fase 1 — El salto a agente real (el 80 % del valor)

**M1. Migrar el brain a loop agéntico nativo con streaming** (resuelve H1, H2, H8, H10).
Reemplazar `generateStructuredWithTelemetry` en el camino del chat por un runner que use el API de GLM tal como está diseñado:

```
messages = [system, ...historial compactado, user]
loop (máx 6 iteraciones):
  POST /chat/completions { model, messages, tools: catálogoNativo,
    thinking: {type: según tier}, reasoning_effort: según tier, stream: true }
  → streamear delta.content al cliente vía SSE (evento 'text.delta')
  → si delta.reasoning_content: emitir 'thinking.delta' (colapsable en UI, como Claude)
  → si tool_calls:
      · tool sin aprobación → ejecutarla, emitir 'tool.started/completed',
        append {role:'tool', content: resultado} y continuar el loop
      · tool con aprobación → registrar pendingAction (flujo actual intacto),
        append resultado "requiere aprobación humana" y continuar
  → si finish_reason == 'stop': persistir mensaje y salir
```

Claves de la migración: (a) el catálogo se declara una vez en formato JSON Schema de function calling — se puede generar desde el registro actual de tools; (b) `sanitizeToolRequests`, políticas y validaciones por acción **se mantienen tal cual** como capa de defensa; (c) los artifacts pasan a ser una tool más (`artifact.create`, `artifact.update`) para que el modelo pueda crearlos a mitad del razonamiento, exactamente como Claude Cowork; (d) las askRequests también pueden ser una tool (`ask.user`) que corta el loop; (e) usar historial como `messages` nativos con roles en vez de un prompt único mejora el cache hit y el seguimiento de instrucciones.

El SSE del route pasa de fases falsas a eventos reales: `text.delta`, `thinking.delta`, `tool.started`, `tool.completed`, `artifact.created`, `approval.requested`, `final`. El cliente elimina `animateAssistantMessage` y las `activityPhases` — el streaming real las reemplaza. Riesgo bajo: se puede feature-flaggear (`SUPLIA_BRAIN_MODE=agentic|legacy`) y mantener el camino actual como fallback.

**M2. Continuación post-aprobación** (resuelve H3).
Al ejecutar una acción aprobada, en vez de `successMessage()`, invocar el mismo loop agéntico con el resultado como mensaje de tool: "el usuario aprobó y ejecuté X, este es el resultado; analízalo y propone el siguiente paso". El costo es una llamada más, el valor es el momento "wow" del producto. Mantener la plantilla como fallback si el modelo falla.

**M3. Reparar la superficie muerta de la UI** (resuelve H4, H13, H16).
Copiar con `navigator.clipboard` + estado copiado; ThumbsUp/Down persistiendo en una tabla `suplia_message_feedback` (org, user, message, rating, comentario opcional) — ese feedback luego alimenta evals; ícono correcto para "Herramientas" (`SlidersHorizontal` o `Wrench`); dictado con `navigator.language` y fallback `es-CL`; ocultar o implementar "Programado".

### Fase 2 — Fidelidad Cowork y percepción de calidad

**M4. Renderizado de mensajes de nivel Claude** (resuelve H5): `react-markdown` + `remark-gfm` (tablas, strikethrough, task lists) + `shiki` para syntax highlighting, con sanitización (sin HTML crudo). Renderizar el stream markdown de forma incremental. Mantener los estilos `suplia-*` actuales aplicándolos a los componentes de react-markdown.

**M5. Adjuntos multimodales** (resuelve H6): imágenes y PDFs → GLM-5V-Turbo como tool interna (`attachment.analyze`) o como llamada previa que convierte el documento en texto estructurado para el brain; adjuntos como parts del mensaje (no concatenados al texto); límite por tamaño real y no solo 8 KB.

**M6. Supabase Realtime en vez de polling** (resuelve H7): suscripción a `suplia_jobs`, `suplia_job_steps`, `suplia_pending_actions`, `suplia_artifacts` filtrada por conversación; el POST de chat responde solo con los deltas del turno (mensajes nuevos + ids afectados) y el cliente concilia. Eliminar el `setInterval` de 4 s.

**M7. Dividir `SupliaWorkspace.tsx`** (resuelve H11) en: `SupliaShell`, `SupliaSidebar`, `SupliaTranscript`, `MessageBubble`, `ApprovalCard`, `AskCard`, `JobProgress`, `SupliaComposer`, `ArtifactCanvas`, `useSupliaChat` (estado + SSE), `useSupliaRealtime`. Sin cambio funcional; hacerlo junto con M1 para no migrar dos veces.

**M8. Carga de contexto eficiente** (resuelve H9): consultar solo resumen de compactación + últimos N mensajes; índice `(conversation_id, created_at)` si no existe.

### Fase 3 — Ventajas del stack 2026

**M9. Context caching de GLM** (resuelve H15): estructurar el prompt para maximizar prefijo estable (system + tools primero, contexto variable al final) y activar el caching del API. Impacto directo en costo y TTFT con el system prompt de ~30 KB.

**M10. Tiers → thinking/reasoning_effort** (resuelve H10): fast = `thinking: disabled`; balanced/orchestrator = thinking on sin effort extra; reasoning = `reasoning_effort: high`; critical = `reasoning_effort: max`. Decidir el tier con una heurística simple bilingüe + longitud, y dejar que el propio loop escale (si el modelo pide plan multiagente, re-llamar con effort mayor).

**M11. Aprovechar el contexto de 1M**: subir `SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS` (hoy 150K) para conversaciones largas de trabajo real, manteniendo la compactación como control de costo, no como límite técnico.

**M12. Evals continuos**: `suplia-evals.ts` ya existe como base; ampliarlo con casos golden por intent (prospectar, investigar, redactar, aprobar, encadenar tools) y correrlo en CI contra el modo agéntico antes de cada release. Conectar el feedback de M3 como fuente de casos.

**M13. Endurecer contra prompt injection** (resuelve H12): envolver todo output de tool que contenga contenido de terceros (Gmail, research web) en delimitadores tipo `<contenido_externo>` con instrucción explícita de no obedecer instrucciones dentro de ellos. Ya existe la mitigación estructural (aprobaciones); esto cierra el vector de manipulación de análisis.

---

## 7. Herramientas y APIs recomendadas

| Recomendación | Para qué | Costo aproximado |
|---|---|---|
| **GLM-5.2 nativo completo** (function calling, `stream`, `thinking` + `reasoning_effort`, context caching, 1M ctx / 128K out) | M1, M9, M10, M11 — ya lo pagan, solo está subutilizado | Sin costo adicional |
| **GLM-5V-Turbo** | M5 — adjuntos con imágenes, PDFs, layouts de documentos | ~$1,20 / $4,00 por M tokens |
| **Endpoint internacional Z.ai** (`api.z.ai/api/paas/v4`) | H14 — latencia desde Chile y facturación | Igual |
| **Supabase Realtime** (ya en el stack) | M6 — jobs y aprobaciones en vivo sin polling | Incluido en plan actual |
| **react-markdown + remark-gfm + shiki** | M4 — render de mensajes nivel Claude | Open source |
| **Endpoint Anthropic-compatible de Z.ai** (`api.z.ai/api/anthropic`) | Opcional: probar el brain con SDK de Anthropic (mismo GLM detrás); útil si algún día quieren A/B contra Claude real sin reescribir | Igual |
| **Vercel AI SDK v5** (opcional) | Alternativa a implementar el loop SSE a mano: `streamText` + tool calling + `useChat` soportan proveedores OpenAI-compatible como GLM. Evaluar si prefieren mantener el protocolo propio (recomendado dado lo ya construido) o adoptar el estándar | Open source |

No recomiendo cambiar de proveedor de IA: GLM-5.2 está hoy entre los mejores modelos para tool use y tareas largas, el sistema ya está configurado para él, y todas las brechas detectadas son de integración, no del modelo.

---

## 8. Métricas de éxito sugeridas

Tiempo hasta el primer token visible: de 10-30 s actuales a < 2 s (M1). Tokens por turno con tools: −30 a −50 % (elimina la doble generación del JSON completo; M1 + M9). Turnos que requieren re-pregunta del usuario por falta de encadenamiento: medible con evals, esperable −50 % (M1). Tasa de aprobaciones seguidas de análisis útil: de 0 % a 100 % (M2). Feedback explícito por mensaje: nuevo dato para iterar (M3).

---

## 9. Fuentes consultadas

- [Z.ai — GLM-5.2 (documentación oficial: capacidades, streaming, function calling, context caching, quick start)](https://docs.z.ai/guides/llm/glm-5.2)
- [MarkTechPost — GLM-5.2 OpenAI-Compatible API: reasoning effort, function calling y long-context (jun 2026)](https://www.marktechpost.com/2026/06/22/glm-5-2-openai-compatible-api-a-hands-on-guide-to-reasoning-effort-function-calling-and-long-context-retrieval/)
- [Z.ai — GLM-5V-Turbo (modelo de visión multimodal)](https://docs.z.ai/guides/vlm/glm-5v-turbo)
- [DataCamp — GLM-5.2: features, setup y benchmarks](https://www.datacamp.com/blog/glm-5-2)
- [Z.ai — API Platform](https://z.ai/model-api)
- [Z.ai — endpoint Anthropic-compatible / Claude Code](https://docs.z.ai/scenario-example/develop-tools/claude)
- [OpenRouter — Z.ai (precios GLM-5V-Turbo)](https://openrouter.ai/z-ai)
