# M1 — Loop agéntico nativo con streaming real (GLM function calling)

**Fase:** 1 · **Prioridad:** máxima · **Flag:** `SUPLIA_BRAIN_MODE=agentic|legacy` (default `legacy`)
**Resuelve:** H1 (streaming simulado), H2 (JSON único, una sola ronda de tools), H8 (3 llamadas LLM por mensaje), parcialmente H10.

---

## 1. Objetivo

Reemplazar, detrás de un feature flag, el camino `processSupliaMessage → runSupliaBrain (JSON único) → 1 ronda de tools → segundo brain` por un **loop agéntico** que usa el API de GLM tal como está diseñado:

- `tools` / `tool_calls` nativos (function calling OpenAI-compatible).
- `stream: true` con `delta.content` (texto) y `delta.reasoning_content` (razonamiento).
- Múltiples rondas de herramientas en un mismo turno (encadenamiento).
- El texto llega al cliente token a token vía SSE; desaparecen las fases simuladas y el typewriter falso.

**Invariantes que NO cambian:** la capa de políticas (`suplia-policy.ts`), el flujo de aprobaciones (pending actions + endpoints approve/cancel), el registro de tool runs (`suplia-tool-runner.ts`), los artifacts versionados, la compactación de contexto, y el modo legacy completo (debe seguir funcionando idéntico con el flag apagado).

---

## 2. Arquitectura del cambio

```
POST /api/suplia/chat  (stream)
  └─ SUPLIA_BRAIN_MODE?
      ├─ legacy  → processSupliaMessage (actual, sin cambios)
      └─ agentic → processSupliaMessageAgentic   [NUEVO: suplia-orchestrator-agentic.ts]
            ├─ persistencia de mensaje usuario + conversación (igual que legacy)
            ├─ contexto: buildSupliaContext + ensureSupliaPromptConversationContext (reutilizados)
            └─ runSupliaAgenticTurn               [NUEVO: suplia-agentic-runner.ts]
                  loop (máx N iteraciones):
                    streamGlmChat(...)            [NUEVO: src/ai/glm-chat.ts]
                      → text.delta / thinking.delta → SSE
                      → tool_calls acumulados
                    por cada tool_call:
                      · interna (artifact_create/update, ask_user, create_workflow_plan, create_gmail_job)
                          → efecto local + tool message
                      · sin aprobación → runSupliaTool (existente) + tool message
                      · con aprobación → validar payload [NUEVO: suplia-action-validation.ts]
                          → pending action + tool run 'requires_approval' + SSE approval.requested
                          → tool message "registrada, NO ejecutada"
                    finish_reason=stop → salir
                  → persistir mensaje assistant con parts + telemetría
            └─ getSupliaState (existente) → SSE 'final'
```

Archivos nuevos: `src/ai/glm-chat.ts`, `src/lib/server/suplia-native-tools.ts`, `src/lib/server/suplia-action-validation.ts`, `src/lib/server/suplia-agentic-prompt.ts`, `src/lib/server/suplia-agentic-runner.ts`, `src/lib/server/suplia-orchestrator-agentic.ts` + sus `.test.ts`.

Archivos modificados: `src/ai/openai-json.ts` (exportar config), `src/lib/server/suplia-orchestrator.ts` (extraer validadores, exportar `persistWorkflowPlanApproval` y `persistPendingActions`), `src/app/api/suplia/chat/route.ts` (dispatch por flag + eventos nuevos), `src/components/suplia/SupliaWorkspace.tsx` (consumir `text.delta`), `.env.example`.

---

## 3. Cambios paso a paso

### Paso 3.1 — Exportar la configuración de proveedor

En `src/ai/openai-json.ts`, la función privada `getStructuredProviderConfig()` ya resuelve provider/apiKey/baseUrl/defaultModel para `glm` u `openai`. Renombrar el tipo y exportar:

```ts
// openai-json.ts — cambiar:
export type AiProviderRuntimeConfig = StructuredProviderConfig;      // alias exportado
export function getAiProviderRuntimeConfig(): AiProviderRuntimeConfig {
  return getStructuredProviderConfig();
}
```

No cambiar nada más de ese archivo (el camino legacy lo sigue usando).

### Paso 3.2 — Cliente de streaming: `src/ai/glm-chat.ts`

Cliente OpenAI-compatible con streaming y tool calls. Sin dependencias nuevas (usa `fetch` global de Node 18+/Next).

```ts
import { getAiProviderRuntimeConfig } from '@/ai/openai-json';
import type { OpenAiModelTier } from '@/ai/model-router';

export type GlmChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: GlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type GlmToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type GlmToolSpec = {
  type: 'function';
  function: {
    name: string;                       // solo [a-zA-Z0-9_-], máx 64 chars
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
};

export type GlmStreamCallbacks = {
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
};

export type GlmChatResult = {
  content: string;
  reasoningContent: string;
  toolCalls: GlmToolCall[];
  finishReason: string | null;          // 'stop' | 'tool_calls' | 'length' | ...
  usage: Record<string, unknown> | null;
  modelName: string;
  durationMs: number;
};

export type GlmChatOptions = {
  model: string;
  messages: GlmChatMessage[];
  tools?: GlmToolSpec[];
  toolChoice?: 'auto' | 'none';
  temperature?: number;
  maxTokens?: number;
  tier?: OpenAiModelTier;
  signal?: AbortSignal;
  callbacks?: GlmStreamCallbacks;
};
```

Cuerpo del request (importante — los campos `thinking`/`reasoning_effort` **solo** cuando el provider es `glm`; OpenAI los rechaza):

```ts
function buildRequestBody(opts: GlmChatOptions, provider: 'glm' | 'openai') {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 8192,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? 'auto';
  }
  if (provider === 'glm') {
    const tier = opts.tier || 'orchestrator';
    if (tier === 'fast') {
      body.thinking = { type: 'disabled' };
    } else {
      body.thinking = { type: 'enabled' };
      if (tier === 'reasoning') body.reasoning_effort = 'high';
      if (tier === 'critical') body.reasoning_effort = 'max';
    }
  }
  return body;
}
```

**Parser SSE + acumulador de tool calls.** Extraer el acumulador como función pura exportada para poder testearlo sin red:

```ts
export type GlmStreamAccumulator = {
  content: string;
  reasoningContent: string;
  toolCallsByIndex: Map<number, { id: string; name: string; arguments: string }>;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
};

export function createGlmAccumulator(): GlmStreamAccumulator { /* init vacío */ }

export function applyGlmChunk(
  acc: GlmStreamAccumulator,
  chunk: any,
  callbacks?: GlmStreamCallbacks
) {
  if (chunk?.usage) acc.usage = chunk.usage;
  const choice = chunk?.choices?.[0];
  if (!choice) return;
  if (choice.finish_reason) acc.finishReason = choice.finish_reason;
  const delta = choice.delta || {};
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
    acc.reasoningContent += delta.reasoning_content;
    callbacks?.onReasoningDelta?.(delta.reasoning_content);
  }
  if (typeof delta.content === 'string' && delta.content) {
    acc.content += delta.content;
    callbacks?.onTextDelta?.(delta.content);
  }
  for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
    const index = Number(tc.index ?? 0);
    const existing = acc.toolCallsByIndex.get(index) || { id: '', name: '', arguments: '' };
    if (tc.id) existing.id = tc.id;
    if (tc.function?.name) existing.name += tc.function.name;
    if (typeof tc.function?.arguments === 'string') existing.arguments += tc.function.arguments;
    acc.toolCallsByIndex.set(index, existing);
  }
}
```

`streamGlmChat(opts): Promise<GlmChatResult>`:

1. `const config = getAiProviderRuntimeConfig()`; si falta `config.apiKey`, lanzar error con el nombre de la env var (mismo mensaje que `generateStructuredWithTelemetry`).
2. `fetch(config.baseUrl + '/chat/completions', { method: 'POST', headers: { Authorization: Bearer, 'Content-Type': 'application/json' }, body, signal })` — normalizar baseUrl igual que `chatCompletionsUrl()` de openai-json.ts (reutilizar exportándola o duplicar 3 líneas).
3. Si `!res.ok`: leer texto, lanzar `Error('GLM_HTTP_' + status + ':' + txt.slice(0,400))`.
4. Leer `res.body.getReader()`, decodificar, bufferizar por líneas. Cada línea que empiece con `data: `: si el payload es `[DONE]`, terminar; si no, `JSON.parse` y `applyGlmChunk`. Líneas vacías o `: keep-alive` se ignoran. JSON inválido en una línea: acumular al buffer (chunk partido) — implementación: separar por `\n`, guardar la última línea incompleta en buffer.
5. Al terminar: construir `toolCalls` ordenados por index, filtrando entradas sin `name`; generar `id` sintético `call_<index>_<Date.now()>` si vino vacío.
6. Reintentos: **solo si no se emitió ningún delta todavía** (fallo antes del primer token): reutilizar el patrón `withRetries`/`isRetryableError` de openai-json.ts (exportarlos o duplicar). Si ya hubo deltas, propagar el error (el runner decide).

### Paso 3.3 — Validadores compartidos: `src/lib/server/suplia-action-validation.ts`

Mover (cortar y pegar, sin cambiar lógica) desde `suplia-orchestrator.ts` las funciones privadas: `isValidEmailAction`, `isValidProspectingAction`, `isValidCampaignAction`, `isValidBulkSendAction`, `isValidCrmAction`, `isValidFollowupAction`, `isValidThreadAction`, `isValidMemoryAction`, `isValidAntoniaAction`, `isValidGmailAction`, `isValidResearchAction`. Adaptarlas a una firma común y exportar:

```ts
export type PendingActionCandidate = {
  actionType: string;
  title: string;
  description?: string;
  payload: Record<string, unknown>;
};

export function validatePendingActionPayload(candidate: PendingActionCandidate): boolean {
  const a = candidate;
  if (a.actionType === 'email.send') return isValidEmailAction(a);
  if (a.actionType === 'email.bulk_send') return isValidBulkSendAction(a);
  if (a.actionType === 'prospecting.search_companies' || a.actionType === 'prospecting.search_people') return isValidProspectingAction(a);
  if (a.actionType.startsWith('campaign.')) return isValidCampaignAction(a);
  if (a.actionType.startsWith('crm.')) return isValidCrmAction(a);
  if (a.actionType === 'followup.create_tasks') return isValidFollowupAction(a);
  if (a.actionType === 'thread.reply_send') return isValidThreadAction(a);
  if (a.actionType === 'memory.save' || a.actionType === 'memory.forget') return isValidMemoryAction(a);
  if (a.actionType === 'antonia.create_mission') return isValidAntoniaAction(a);
  if (a.actionType.startsWith('gmail.')) return isValidGmailAction(a);
  if (a.actionType.startsWith('research.')) return isValidResearchAction(a);
  return false;
}
```

`suplia-orchestrator.ts` pasa a importar `validatePendingActionPayload` y su `sanitizeAgentOutput` la usa (mismo comportamiento; los tests existentes de policy/orchestrator deben seguir verdes). Atención: `isValidCampaignAction` hoy distingue create/update/launch/pause/resume internamente y devuelve `false` para otros `campaign.*` — conservar exactamente esa semántica.

### Paso 3.4 — Catálogo nativo: `src/lib/server/suplia-native-tools.ts`

**Mapeo de nombres.** Los nombres de function calling solo admiten `[a-zA-Z0-9_-]`. Los nombres internos usan puntos (`crm.search`).

```ts
export function toNativeToolName(name: string) { return name.replace(/\./g, '__'); }
export function fromNativeToolName(name: string) { return name.replace(/__/g, '.'); }
```

(Round-trip seguro: ningún nombre actual contiene `__`. Agregar test.)

**Schemas de parámetros.** `SupliaToolDefinition.inputSchema` es un string pseudo-JSON (ej. `'{ "query": string, "maxResults"?: number }'`), no JSON Schema. Estrategia: schemas curados para las tools de más uso + fallback permisivo para el resto:

```ts
const CURATED_PARAMETERS: Record<string, Record<string, unknown>> = {
  'crm.search': {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Texto libre: nombre, email o empresa' },
      company: { type: 'string' },
      status: { type: 'string' },
      limit: { type: 'number', maximum: 25 },
    },
    additionalProperties: false,
  },
  // Curar también (mínimo): crm.get_lead_detail, contacted.search, contacted.get_timeline,
  // campaigns.list, campaigns.get, metrics.overview, prospecting.suggest_segments,
  // prospecting.build_search_plan, research.similarweb, research.whois,
  // email.personalize_for_lead, followup.suggest, memory.search, pipeline.detect_stalled.
  // Fuente de verdad para propiedades: el string inputSchema de cada tool en suplia-tools.ts
  // y el parsing real que hace su handler (asText/asList/asLimit).
};

function fallbackParameters(inputSchema: string): Record<string, unknown> {
  return {
    type: 'object',
    description: `Input esperado (pseudo-schema): ${inputSchema}`,
    additionalProperties: true,
  };
}
```

**Tools internas nuevas** (no existen en `SUPLIA_TOOLS`; las ejecuta el runner directamente):

```ts
export const INTERNAL_TOOL_SPECS: GlmToolSpec[] = [
  { type: 'function', function: {
      name: 'artifact_create',
      description: 'Crea un artifact en el canvas (documento, lista de leads, borrador de correo, plan, research). Uselo para todo contenido largo o estructurado en vez de pegarlo en el chat. Tipos validos: plan, icp_strategy, search_plan, email_draft, lead_list, crm_summary, note, company_research, company_shortlist, person_shortlist, campaign_draft, campaign_preview, personalized_email_draft, pipeline_summary, reply_brief, thread_reply_draft, mission_draft, risk_report.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string', description: 'Markdown legible. NUNCA JSON serializado.' },
          data: { type: 'object', description: 'Datos estructurados segun el tipo (ej. lead_list: data.leads=[{fullName, companyName, title, email, score, status, nextAction, reasons}])', additionalProperties: true },
        },
        required: ['type', 'title'],
        additionalProperties: false,
      },
  }},
  { type: 'function', function: {
      name: 'artifact_update',
      description: 'Actualiza un artifact existente (nueva version). Usar cuando el usuario pide iterar sobre un artifact ya creado.',
      parameters: {
        type: 'object',
        properties: {
          artifactId: { type: 'string', description: 'Id del artifact. Si se omite, se usa el artifact activo del usuario.' },
          type: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
          changeSummary: { type: 'string' },
        },
        required: ['title'],
        additionalProperties: false,
      },
  }},
  { type: 'function', function: {
      name: 'ask_user',
      description: 'Hace una pregunta interactiva con opciones al usuario. Usar SOLO como ultima accion del turno, cuando falta una decision que bloquea seguridad, costo o calidad. Maximo 4 preguntas, 2-4 opciones cada una.',
      parameters: {
        type: 'object',
        properties: {
          questions: { type: 'array', items: { type: 'object', properties: {
            header: { type: 'string' }, question: { type: 'string' },
            options: { type: 'array', items: { type: 'object', properties: {
              label: { type: 'string' }, description: { type: 'string' } }, required: ['label'] } },
            multi: { type: 'boolean' }, allowOther: { type: 'boolean' },
          }, required: ['question'] } },
          submitLabel: { type: 'string' },
        },
        required: ['questions'],
        additionalProperties: false,
      },
  }},
  { type: 'function', function: {
      name: 'create_workflow_plan',
      description: 'Inicia un trabajo operativo multi-paso de prospeccion/investigacion/contacto: genera un plan que el usuario debe aprobar antes de ejecutar agentes o consumir creditos. Usar cuando el usuario pide buscar/contactar leads, encontrar empresas o armar campana end-to-end.',
      parameters: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'], additionalProperties: false },
  }},
  { type: 'function', function: {
      name: 'create_gmail_job',
      description: 'Crea un job para analizar el mailbox Gmail (lecturas quedan como aprobacion humana). Usar cuando el usuario pide revisar Gmail/contactados en profundidad.',
      parameters: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'], additionalProperties: false },
  }},
];
```

**Builder del catálogo completo:**

```ts
export type NativeToolCatalogEntry = {
  spec: GlmToolSpec;
  internalName: string;            // 'crm.search' | '__internal__'
  kind: 'auto' | 'approval' | 'internal';
};

export function buildNativeToolCatalog(): NativeToolCatalogEntry[] {
  const entries: NativeToolCatalogEntry[] = INTERNAL_TOOL_SPECS.map((spec) => ({
    spec, internalName: spec.function.name, kind: 'internal',
  }));
  for (const tool of listSupliaToolSummaries()) {
    const requiresApproval = tool.policy.requiresApproval;
    entries.push({
      internalName: tool.name,
      kind: requiresApproval ? 'approval' : 'auto',
      spec: { type: 'function', function: {
        name: toNativeToolName(tool.name),
        description: requiresApproval
          ? `[REQUIERE APROBACION HUMANA - al llamarla se registra para que el usuario apruebe, NO se ejecuta] ${tool.description} Motivo: ${tool.policy.approvalReason}`
          : tool.description,
        parameters: CURATED_PARAMETERS[tool.name] || fallbackParameters(tool.inputSchema),
      }},
    });
  }
  return entries;
}
```

Excluir del catálogo (no exponer al modelo): `workflow.approve_plan` (solo lo dispara el endpoint de aprobación) y `email.bulk_send` **sí se expone** pero su descripción debe incluir la regla del dry-run (copiar la regla actual del prompt del brain).

### Paso 3.5 — System prompt: `src/lib/server/suplia-agentic-prompt.ts`

`buildSupliaAgenticSystemPrompt(): string` — texto **estático** (sin datos de contexto; eso va en mensajes aparte para maximizar cache hit, ver M9). Contenido: portar de `buildSupliaBrainPrompt` (en `suplia-brain.ts`) las secciones "Principio operativo", las reglas de aprobación/honestidad ("Nunca inventes emails...", "No digas que ejecutaste algo..."), la guía de artifacts por tipo (ahora referida a `artifact_create`), la guía de `ask_user` y las reglas de `create_workflow_plan`/`create_gmail_job`. **Eliminar** todo lo relativo a "Devuelve JSON valido", tablas/codeBlocks del schema y el catálogo embebido de tools (ahora van por `tools`). Agregar:

```
Reglas del loop:
- Puedes llamar varias herramientas en secuencia antes de responder; encadena lecturas internas (crm, contactados, campanas, metricas) sin pedir permiso.
- Las herramientas marcadas [REQUIERE APROBACION HUMANA] no se ejecutan al llamarlas: quedan registradas para que el usuario las apruebe. Despues de llamarlas, explica en texto que dejaste la accion lista para aprobar y que hara exactamente.
- No llames ask_user junto con otras herramientas: es siempre tu ultima accion del turno.
- Responde en el idioma del usuario. Se breve en el chat; el contenido largo va en artifacts.
```

El **mensaje de contexto dinámico** (segundo mensaje, rol `user`, prefijo `"[CONTEXTO DE APP - no es un mensaje del usuario]"`) lo arma el runner con: `JSON.stringify(context)` (recortado a 6000 chars como hoy), resumen de compactación + lista de artifacts recientes `{id, type, title}` (ids reales para `artifact_update`). Mantener límites de tamaño actuales.

### Paso 3.6 — El runner: `src/lib/server/suplia-agentic-runner.ts`

```ts
export type AgenticTurnEvents = {
  onEvent?: (event: string, data: Record<string, unknown>) => void;
};

export type AgenticTurnDeps = {           // inyectables para tests
  chat: typeof streamGlmChat;
  executeTool: typeof runSupliaTool;
  persistPendingAction: (args: {...}) => Promise<{ id: string; title: string; approvalKind: string }>;
  insertArtifacts: typeof insertSupliaArtifacts;
  updateArtifact: typeof updateSupliaArtifact;
};

export type AgenticTurnResult = {
  replyText: string;                       // concatenación de segmentos de texto
  parts: SupliaMessagePart[];              // en orden real de emisión
  artifactIds: string[];
  pendingActionIds: string[];
  askRequested: boolean;
  workflowPlanGoal: string | null;         // si llamó create_workflow_plan
  gmailJobGoal: string | null;
  telemetry: Array<ReturnType<typeof buildOpenAiTelemetry>>;
  toolResults: Array<{ toolName: string; status: 'completed' | 'failed' | 'requires_approval' }>;
};

export async function runSupliaAgenticTurn(params: {
  auth: AuthContext;
  conversationId: string;
  userMessageId: string;
  message: string;
  history: GlmChatMessage[];               // ya construido por el orquestador agentic
  activeArtifactId?: string | null;
  artifacts: SupliaArtifact[];             // recientes, para resolver artifact_update sin id
  modelTier: OpenAiModelTier;
  signal?: AbortSignal;
  events?: AgenticTurnEvents;
  deps?: Partial<AgenticTurnDeps>;
}): Promise<AgenticTurnResult>
```

Lógica del loop (pseudocódigo estricto):

```
catalog = buildNativeToolCatalog(); byNativeName = index por spec.function.name
messages = [system(buildSupliaAgenticSystemPrompt()), ...params.history]
maxIterations = envInt('SUPLIA_AGENTIC_MAX_ITERATIONS', 6, 1, 12)
autoToolBudget = envInt('SUPLIA_AGENTIC_MAX_AUTO_TOOLS', 8, 1, 20)
parts = []; telemetry = []; ...

for iteration in 1..maxIterations:
  if signal?.aborted → break
  toolChoice = (iteration == maxIterations) ? 'none' : 'auto'   // fuerza cierre en texto
  result = deps.chat({ model: getOpenAiModelForTier(modelTier), messages,
                       tools: catalog.map(e => e.spec), toolChoice, tier: modelTier,
                       signal, callbacks: {
                         onTextDelta: d => events.onEvent('text.delta', { delta: d }),
                         onReasoningDelta: d => events.onEvent('thinking.delta', { delta: d }),
                       }})
  telemetry.push(buildOpenAiTelemetry({ modelTier, modelName: result.modelName,
                                        usage: result.usage, durationMs: result.durationMs }))
  if result.content.trim() → parts.push({ type: 'text', text: result.content })

  if result.toolCalls.length == 0 → break                        // turno terminado

  // registrar el assistant message con tool_calls en el historial del loop
  messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls })

  for toolCall of result.toolCalls:
    input = safeJsonParse(toolCall.function.arguments)  // {} si inválido + tool message de error
    entry = byNativeName[toolCall.function.name]
    if !entry → toolMessage(error 'herramienta desconocida'); continue

    switch entry.kind:
      'internal'  → handleInternalTool(...)      // ver abajo
      'auto':
        if autoToolBudget-- <= 0 → toolMessage('presupuesto de herramientas agotado; responde con lo que tienes')
        else:
          events.onEvent('tool.started', { toolName: entry.internalName, label: 'Ejecutando ...' })
          try { { output } = deps.executeTool({ auth, conversationId, messageId: userMessageId,
                                                toolName: entry.internalName, input, modelTier })
                parts.push({ type: 'tool-call', toolName: entry.internalName, status: 'completed' })
                toolMessage(JSON.stringify(clampToolOutput(output)))          // ver límites abajo
                events.onEvent('tool.completed', {...}) }
          catch (e) { toolMessage(JSON.stringify({ error: e.message }))
                      parts.push({ type: 'tool-call', toolName, status: 'failed' })
                      events.onEvent('tool.failed', {...}) }
      'approval':
        candidate = { actionType: entry.internalName, title: titleForAction(entry, input), payload: input }
        if !validatePendingActionPayload(candidate)
          → toolMessage(JSON.stringify({ error: 'payload incompleto para esta accion; pide los datos faltantes o corrige el input' }))
        else:
          action = deps.persistPendingAction(...)   // inserta suplia_pending_actions +
                                                    // recordSupliaToolPendingApproval + tool_run_id
          parts.push({ type: 'approval-request', actionId: action.id, title: action.title, approvalKind: action.approvalKind })
          pendingActionIds.push(action.id)
          events.onEvent('approval.requested', { actionId: action.id, ... })
          toolMessage(JSON.stringify({ status: 'requires_approval', actionId: action.id,
            note: 'Accion registrada para aprobacion humana. NO ejecutada. Explica al usuario que hara y como aprobarla.' }))

  if askRequested or workflowPlanGoal or gmailJobGoal → break     // acciones terminales
```

`handleInternalTool`:

- `artifact_create`: normalizar `type` contra la lista de `SupliaArtifactType` (fallback `note`, igual que `normalizeArtifactType` del brain). `deps.insertArtifacts(auth, [{ conversationId, sourceMessageId: null, type, title, content, data, changeSummary: 'Creado desde el chat de SUPL.IA.' }])`. Push `{ type: 'artifact-card', artifactId, artifactType, title }` a parts, `artifactIds.push`, emitir `artifact.created`, tool message `{ artifactId, status: 'created' }`.
- `artifact_update`: resolver target: `input.artifactId` || `params.activeArtifactId` || primer artifact de `params.artifacts`. Si no hay target → tool message de error. Si hay: `deps.updateArtifact(...)` con `changeSummary` (default `buildSupliaArtifactChangeSummary(params.message)` de `@/lib/suplia/artifacts`). Parts/eventos igual que create.
- `ask_user`: normalizar preguntas (reusar la forma de `normalizeAskQuestions` del orquestador: máx 4 preguntas, máx 4 opciones, `allowOther` default true). Push part `{ type: 'ask', askId: `${conversationId}:ask:${Date.now()}`, questions, submitLabel }`. `askRequested = true`. Tool message `{ status: 'ask_registered' }`. **No** romper el loop inmediatamente: dejar que el stream actual ya terminó; el break ocurre al final de la iteración (regla: acciones terminales).
- `create_workflow_plan` / `create_gmail_job`: guardar `goal` (fallback `params.message`), tool message `{ status: 'accepted' }`, terminal.

`clampToolOutput(output)`: `JSON.stringify` y si supera **24.000 chars**, truncar con sufijo `"...[truncado]"` (los outputs de tools ya vienen acotados por sus handlers, esto es cinturón de seguridad). En M13 esta función además envuelve contenido externo.

`titleForAction(entry, input)`: título humano corto, ej. `email.send` → `'Enviar email a ' + input.to`; genérico: `'Aprobar ' + entry.internalName`. Tabla de títulos por actionType incluida en el archivo (una función `switch` simple).

### Paso 3.7 — Orquestador agentic: `src/lib/server/suplia-orchestrator-agentic.ts`

`processSupliaMessageAgentic(auth, input, events): Promise<SupliaChatResponse>` — misma firma que `processSupliaMessage`. Reutiliza de `suplia-orchestrator.ts` (exportar lo necesario):

1. **Idéntico a legacy:** resolución/creación de conversación, inserción del mensaje de usuario con parts, `buildSupliaContext`, `loadConversationMessagesForPrompt`, `ensureSupliaPromptConversationContext`, `selectSupliaModelTier`.
2. **Sin** `classifySupliaIntentHybrid` (el loop decide; ahorro de 1 llamada LLM). `artifactUpdateTargetId` se resuelve dentro del runner vía `activeArtifactId`.
3. Construir `history: GlmChatMessage[]`:
   - Mensaje de contexto dinámico (paso 3.5).
   - Si hay compactación: `{ role: 'user', content: '[RESUMEN DE CONVERSACION PREVIA]\n' + compaction.summary }`.
   - Mensajes recientes del `promptContext` (los que no fueron compactados): map `role === 'user' ? 'user' : 'assistant'`, `content` plano (ignorar parts). Omitir mensajes de rol `system`/`tool` persistidos.
   - Último: `{ role: 'user', content: message }`.
4. `runSupliaAgenticTurn(...)`.
5. **Persistencia del mensaje assistant:**
   ```ts
   content: result.replyText || fallbackPorTipo(result)  // si solo hubo artifacts: 'Deje el resultado como artifact.'
   metadata: {
     generatedBy: 'suplia-agentic',
     mode: 'agentic',
     reasoningSummary: null,
     modelTelemetry: result.telemetry[result.telemetry.length - 1] || null,
     agenticTelemetry: result.telemetry,
     toolResults: result.toolResults,
     promptContext: {...igual que legacy...},
     parts: result.parts.length ? result.parts : [textPart(content)],
   }
   ```
   Después de insertar: `update suplia_artifacts set source_message_id = <msgId>` para `result.artifactIds` (mismo patrón que legacy en `persistWorkflowPlanApproval`).
6. **Post-procesos terminales:**
   - `workflowPlanGoal` → llamar `persistWorkflowPlanApproval({ auth, conversationId, goal, context, brainOutput: null, events })` (exportarla desde `suplia-orchestrator.ts` agregando `export`).
   - `gmailJobGoal` → replicar el bloque `gmail_job` de legacy: `createSupliaJobFromMessage` + mensaje con part `job-progress` + `runSupliaJob(auth, job.id, { maxSteps: 3 })` + evento `job.started`.
   - Red de seguridad anti no-op: si `result.parts` no contiene tool-call/approval/artifact/ask Y `isOperationalProspectingRequest(message)` (exportarla desde `suplia-brain.ts`) → ejecutar el camino `persistWorkflowPlanApproval` con `goal = message` (equivalente al `repairSupliaNoOpOperationalOutput` legacy).
7. `update suplia_conversations.updated_at` y `return getSupliaState(auth, activeConversationId)`.

**Manejo de error del loop:** si `runSupliaAgenticTurn` lanza y no se persistió nada del assistant, persistir mensaje de fallo con el texto de `buildSupliaBrainFailureOutput().reply` y `metadata.generatedBy='suplia-agentic-error'`; devolver estado. El route ya emite `error` si la promesa revienta antes.

### Paso 3.8 — Route: `src/app/api/suplia/chat/route.ts`

1. Dispatch:
   ```ts
   const agentic = String(process.env.SUPLIA_BRAIN_MODE || 'legacy').toLowerCase() === 'agentic';
   const processor = agentic ? processSupliaMessageAgentic : processSupliaMessage;
   ```
2. En modo agentic **no iniciar** el `setInterval` de fases (mantenerlo para legacy). Emitir `start` con `{ mode: 'agentic' }`.
3. El `send` actual ya reenvía cualquier evento de `onEvent`; los nuevos (`text.delta`, `thinking.delta`, `approval.requested`, `artifact.created`, `tool.*`) fluyen sin cambios. En el evento `final` agregar `mode: agentic ? 'agentic' : 'legacy'`.
4. **Throttling de `text.delta`:** para no saturar SSE, agrupar deltas en el route con un micro-buffer de 40 ms o 24 chars (lo que ocurra primero). Implementar en el wrapper `send` solo para `text.delta`/`thinking.delta` (acumular y flush con `setTimeout`). Flush pendiente antes de `final`/`error`/`close`.

### Paso 3.9 — Frontend mínimo: `src/components/suplia/SupliaWorkspace.tsx`

Cambios acotados (el refactor grande es M7):

1. Estado nuevo: `const [liveStream, setLiveStream] = useState<{ text: string; thinking: string } | null>(null);`
2. En el parser SSE de `sendMessage` agregar casos:
   ```ts
   if (parsed.event === 'text.delta') setLiveStream((prev) => ({ text: (prev?.text || '') + eventData.delta, thinking: prev?.thinking || '' }));
   if (parsed.event === 'thinking.delta') setLiveStream((prev) => ({ text: prev?.text || '', thinking: (prev?.thinking || '') + eventData.delta }));
   ```
3. Render: mientras `sending && liveStream?.text`, renderizar una burbuja assistant "en vivo" al final del transcript usando el mismo markup de mensaje (`renderRichText(liveStream.text)`) con el indicador de actividad encima. Si hay `liveStream.thinking` y no hay texto aún, mostrar el label de actividad `'Pensando...'` (el contenido del thinking NO se muestra en M1; se guarda para una mejora futura).
4. En `final`: `setLiveStream(null)`; si `eventData.mode === 'agentic'` → `applyResponse(finalState)` **sin** llamar `animateAssistantMessage` (el texto ya se vio en vivo). Legacy conserva la animación.
5. Auto-scroll: incluir `liveStream?.text` en las dependencias del efecto de scroll.

### Paso 3.10 — `.env.example`

Agregar bajo la sección GLM:

```
# SUPL.IA brain: "legacy" (JSON unico) o "agentic" (function calling + streaming)
SUPLIA_BRAIN_MODE="legacy"
SUPLIA_AGENTIC_MAX_ITERATIONS="6"
SUPLIA_AGENTIC_MAX_AUTO_TOOLS="8"
```

---

## 4. Tests (obligatorios)

`src/ai/glm-chat.test.ts` — sobre `createGlmAccumulator`/`applyGlmChunk`:
1. Deltas de content concatenan y disparan `onTextDelta`.
2. `reasoning_content` va al canal correcto.
3. Tool call con `arguments` partido en 3 chunks reconstruye el JSON completo.
4. Dos tool calls con `index` 0 y 1 producen 2 entradas ordenadas.
5. Chunk con `usage` la captura; `finish_reason` se guarda.

`src/lib/server/suplia-native-tools.test.ts`:
1. Round-trip `toNativeToolName`/`fromNativeToolName` para todos los nombres de `listSupliaToolSummaries()`.
2. Nombres nativos cumplen `/^[a-zA-Z0-9_-]{1,64}$/`.
3. Tools con `requiresApproval` llevan el prefijo `[REQUIERE APROBACION HUMANA` en description.
4. `workflow.approve_plan` no aparece en el catálogo.
5. Fallback de parameters incluye el `inputSchema` original en description.

`src/lib/server/suplia-action-validation.test.ts`: portar los casos implícitos hoy cubiertos por el orquestador — `email.send` sin `to` → false; `prospecting.search_people` con `companyNames` → true; `crm.update_stage` sin `stage` → false; actionType desconocido → false.

`src/lib/server/suplia-agentic-runner.test.ts` — con `deps` falsos (sin red ni DB):
1. Chat devuelve solo texto → 1 part text, 0 tools, termina en 1 iteración.
2. Chat devuelve tool_call auto (`crm__search`) y luego texto → `executeTool` llamado con `crm.search`, tool message agregado, 2 iteraciones, parts `[tool-call, text]`.
3. Tool_call de aprobación (`email__send` con payload válido) → `persistPendingAction` llamado, part `approval-request`, tool message con `requires_approval`.
4. `email__send` con payload inválido (sin `to`) → NO se persiste acción; tool message con error.
5. `ask_user` → part ask, `askRequested=true`, loop termina.
6. `artifact_create` → `insertArtifacts` llamado, part artifact-card.
7. Presupuesto de auto tools agotado → tool message de presupuesto, sin ejecutar.
8. `maxIterations` alcanzado → última llamada va con `toolChoice: 'none'`.

Correr también la suite completa: los tests existentes de `suplia-brain.test.ts` y `suplia-policy.test.ts` deben seguir verdes (el camino legacy no cambia).

---

## 5. Criterios de aceptación

1. Con `SUPLIA_BRAIN_MODE=legacy` (default): comportamiento byte-a-byte igual al actual (QA de regresión: enviar mensaje simple, crear artifact, aprobar una acción).
2. Con `SUPLIA_BRAIN_MODE=agentic`:
   - "hola, que puedes hacer?" → primer token visible < 2 s (red normal), sin fases simuladas, sin typewriter posterior.
   - "busca en mi crm los leads de empresas de seguridad y dime cual tiene el ultimo contacto mas viejo" → encadena ≥2 tools internas (`crm.search` + `contacted.get_timeline` o similar) y responde con análisis en el mismo turno.
   - "envia un correo a X" → tarjeta de aprobación aparece; el texto explica qué se aprobará; nada se envía.
   - "arma una lista de 20 empresas mineras en Antofagasta" → plan aprobable (`create_workflow_plan` o red de seguridad).
   - "crea un artifact con un borrador de correo para un gerente de RRHH" → artifact aparece en el canvas durante el turno (evento `artifact.created` en vivo).
   - Botón detener (Square) → aborta el stream sin dejar la conversación corrupta (el mensaje de usuario queda, no hay assistant fantasma).
3. Un turno con 2 tools consume exactamente N+1 llamadas LLM (N iteraciones), nunca el doble-JSON legacy, y **cero** llamadas al clasificador de intent.
4. `suplia_tool_runs` registra cada ejecución auto con `messageId` del mensaje de usuario; las de aprobación quedan `requires_approval` (verificar en la tabla).

## 6. Rollback

`SUPLIA_BRAIN_MODE=legacy` en env y redeploy. No hay migraciones de datos: los mensajes agentic persisten con parts compatibles con el renderer actual.
