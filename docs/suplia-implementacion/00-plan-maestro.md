# SUPL.IA — Plan maestro de implementación

> Archived pre-retirement plan. Do not configure GLM or SerpAPI from this document; the current production runtime uses OpenAI and Serper. The phase documents remain only as historical implementation context.

**Fecha:** julio 2026
**Base:** `docs/informe-auditoria-suplia-2026-07.md`
**Audiencia:** agente de código (OpenCode). Cada documento de esta carpeta es una tarea autónoma y autocontenida.

---

## 1. Cómo usar estos documentos

Cada archivo `fase-X-mN-*.md` es una especificación ejecutable: contiene contexto del código actual (rutas y funciones reales), diseño, cambios paso a paso, migraciones SQL, variables de entorno, criterios de aceptación y plan de pruebas. Entregar al agente **un documento por sesión**, en el orden de la sección 3.

Reglas globales para el agente (aplican a TODAS las tareas):

1. **No modificar la capa de políticas ni de aprobaciones** (`src/lib/server/suplia-policy.ts`, `src/lib/suplia/approval-guards.ts`) salvo que el documento lo pida explícitamente. Es la capa de seguridad del producto.
2. Al terminar cada tarea, ejecutar `npm run typecheck` y `npm run test`. Ambos deben quedar en verde. Si un test existente falla por un cambio intencional de comportamiento, actualizar el test y documentarlo en el commit.
3. **Convención de strings del repo:** el texto en español dentro del código va **sin acentos ni eñes** (ej. `'Aprobacion requerida'`, `'conversacion'`). Mantenerla en todo string nuevo.
4. **Convención de imports:** `zod` se importa como `import { z } from 'genkit'` (así lo hace todo el repo). Alias de paths: `@/*` → `./src/*`.
5. Todo comportamiento nuevo de riesgo se protege con **feature flag por variable de entorno**, con default en el comportamiento actual (legacy). Actualizar `.env.example` en el mismo commit.
6. No introducir dependencias nuevas salvo las listadas en el documento correspondiente.
7. Para trabajo visual (M3, M4, M7): respetar `AGENTS.md` (direccion visual Apple-like y criterios UI de OpenCode) y **no cambiar las clases CSS `suplia-*`** existentes salvo indicacion explicita.
8. Los endpoints del API server-side usan `requireAuth()` de `src/lib/server/auth-utils.ts` y el cliente admin `getSupabaseAdminClient()` con filtro explícito por `organization_id` en cada query. Replicar ese patrón en endpoints nuevos.

---

## 2. Estado actual (resumen para contexto)

- Frontend: `src/components/suplia/SupliaWorkspace.tsx` (monolito de ~2.470 líneas), página en `src/app/(app)/suplia/page.tsx`.
- API chat: `src/app/api/suplia/chat/route.ts` (GET estado, POST mensaje con SSE de fases simuladas).
- Orquestador: `src/lib/server/suplia-orchestrator.ts` (`processSupliaMessage`, `getSupliaState`).
- Brain: `src/lib/server/suplia-brain.ts` (`runSupliaBrain` → un JSON único vía `generateStructuredWithTelemetry`).
- Cliente LLM: `src/ai/openai-json.ts` (chat completions no-stream, `response_format: json_object`, GLM u OpenAI según `AI_PROVIDER`).
- Router de modelos: `src/ai/model-router.ts` (tiers fast/balanced/orchestrator/reasoning/critical).
- Tools: `src/lib/server/suplia-tools.ts` (~75 tools, `SupliaToolDefinition { name, description, inputSchema: string, handler }`).
- Ejecución de tools: `src/lib/server/suplia-tool-runner.ts` (`runSupliaTool`, leases, heartbeats, `recordSupliaToolPendingApproval`).
- Políticas: `src/lib/server/suplia-policy.ts` (`getSupliaPolicy`, `canRunWithoutApproval`).
- Aprobaciones: `src/app/api/suplia/actions/[actionId]/approve/route.ts` y `.../cancel/route.ts`.
- Jobs multiagente: `src/lib/server/suplia-job-runner.ts` + `src/lib/server/suplia-agent-registry.ts`.
- Artifacts: `src/lib/server/suplia-artifacts.ts` (`insertSupliaArtifacts`, `updateSupliaArtifact`, versionado).
- Compactación: `src/lib/server/suplia-conversation-context.ts` + `src/lib/suplia/conversation-context.ts`.
- Tipos compartidos: `src/lib/suplia/types.ts`.
- Tests: `node --test` vía `npm run test` (`scripts/run-node-tests.mjs`), archivos `*.test.ts` junto al código.

Proveedor IA: GLM (Z.ai / BigModel), OpenAI-compatible. Modelo por defecto `glm-5.2`. El API soporta (verificado en docs oficiales julio 2026): `stream: true` con `delta.reasoning_content` + `delta.content`, function calling (`tools` / `tool_calls`), `thinking: { type: 'enabled'|'disabled' }`, `reasoning_effort: 'high'|'max'`, context caching, 1M de contexto y 128K de salida.

---

## 3. Orden de ejecución y dependencias

| Orden | Doc | Tarea | Depende de | Riesgo |
|---|---|---|---|---|
| 1 | `fase-1-m1-loop-agentico-streaming.md` | Loop agéntico nativo con streaming real | — | Alto (flag) |
| 2 | `fase-1-m2-continuacion-post-aprobacion.md` | El brain analiza resultados tras aprobar | M1 | Medio (flag) |
| 3 | `fase-1-m3-reparacion-ui.md` | Copiar/feedback/íconos/dictado + tabla feedback | — | Bajo |
| 4 | `fase-2-m4-markdown-renderer.md` | react-markdown + GFM + shiki | — (mejor tras M1) | Bajo |
| 5 | `fase-2-m8-carga-contexto-eficiente.md` | No cargar 10.000 mensajes por turno | — | Medio |
| 6 | `fase-2-m6-supabase-realtime.md` | Realtime en vez de polling | — | Medio (flag) |
| 7 | `fase-2-m7-split-workspace.md` | Partir el monolito frontend | M1, M3, M4 | Medio |
| 8 | `fase-2-m5-adjuntos-multimodales.md` | Imágenes/PDF con GLM-5V-Turbo | M1 | Medio (flag) |
| 9 | `fase-3-m9-m11-glm-optimizacion.md` | Caching, thinking por tier, umbral 1M | M1 | Bajo |
| 10 | `fase-3-m13-prompt-injection.md` | Delimitadores de contenido externo | M1 | Bajo |
| 11 | `fase-3-m12-evals.md` | Evals golden + runner CI | M1 | Bajo |

M3, M4, M6 y M8 son independientes entre sí y de M1: pueden adelantarse si se quiere valor rápido con menos riesgo.

---

## 4. Feature flags y variables de entorno nuevas (consolidado)

| Variable | Doc | Default | Efecto |
|---|---|---|---|
| `SUPLIA_BRAIN_MODE` | M1 | `legacy` | `agentic` activa el loop nativo con streaming |
| `SUPLIA_AGENTIC_MAX_ITERATIONS` | M1 | `6` | Máx. vueltas del loop por turno |
| `SUPLIA_AGENTIC_MAX_AUTO_TOOLS` | M1 | `8` | Máx. tools auto-ejecutadas por turno |
| `SUPLIA_POST_APPROVAL_BRAIN` | M2 | `false` | `true` activa análisis post-aprobación |
| `NEXT_PUBLIC_SUPLIA_SCHEDULED_ENABLED` | M3 | `false` | Muestra/oculta quick action "Programado" |
| `NEXT_PUBLIC_SUPLIA_REALTIME` | M6 | `false` | `true` usa Supabase Realtime y apaga polling |
| `GLM_VISION_MODEL` | M5 | `glm-5v-turbo` | Modelo de visión para adjuntos |
| `SUPLIA_ATTACHMENTS_VISION` | M5 | `false` | Activa análisis multimodal de adjuntos |
| `SUPLIA_EXTERNAL_CONTENT_GUARD` | M13 | `true` | Envuelve contenido externo con delimitadores |

Cambios de default recomendados en `.env.example` (M9-M11): `SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS="400000"`, `GLM_BASE_URL="https://api.z.ai/api/paas/v4"` (endpoint internacional; mantener el de BigModel comentado como alternativa mainland).

---

## 5. Migraciones SQL (consolidado)

| Archivo | Doc | Contenido |
|---|---|---|
| `supabase/migrations/20260707T0001_suplia_message_feedback.sql` | M3 | Tabla `suplia_message_feedback` + índices + RLS |
| `supabase/migrations/20260707T0002_suplia_messages_index.sql` | M8 | Índice `(conversation_id, created_at)` en `suplia_messages` |
| `supabase/migrations/20260707T0003_suplia_realtime.sql` | M6 | Publicación realtime + políticas RLS de lectura |

Aplicarlas con el dashboard o la CLI de Supabase. El MCP configurado en `opencode.json` es de solo lectura y se limita a consultas de inspeccion; nunca ejecutar DDL destructivo desde el MCP.

---

## 6. Definición de terminado (global)

Una tarea se considera terminada cuando: (1) typecheck y tests en verde; (2) criterios de aceptación del documento cumplidos; (3) flags nuevos documentados en `.env.example`; (4) comportamiento legacy intacto con el flag apagado; (5) sin cambios en políticas/aprobaciones no solicitados; (6) el QA manual del documento pasa en dev (`npm run dev`, puerto 9003).
