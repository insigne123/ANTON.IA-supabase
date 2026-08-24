# M2 — Continuación con brain después de aprobar una acción

**Fase:** 1 · **Depende de:** M1 (usa `runSupliaAgenticTurn` y `glm-chat`) · **Flag:** `SUPLIA_POST_APPROVAL_BRAIN` (default `false`)
**Resuelve:** H3 (tras aprobar, la IA responde una plantilla fija y nunca analiza los resultados).

---

## 1. Objetivo

Hoy `POST /api/suplia/actions/[actionId]/approve` ejecuta la tool aprobada y persiste un mensaje generado por `successMessage(toolName, result)` — una plantilla hardcodeada ("Listo. Encontre 12 empresas..."). El resultado nunca vuelve al modelo.

Con este cambio, tras ejecutar la acción aprobada, el sistema invoca el brain agéntico con el resultado como contexto para que **analice, sintetice y proponga el siguiente paso** ("De las 12 empresas, estas 3 calzan mejor con tu ICP porque...; ¿preparo los correos?"). La plantilla actual queda como fallback si el modelo falla o el flag está apagado.

**Invariantes:** la ejecución de la tool, el registro en `suplia_pending_actions`/`suplia_tool_runs`, la creación del artifact de resultado (`artifactForResult`) y el manejo de `workflow.approve_plan` **no cambian**. Solo cambia el mensaje que se persiste después.

---

## 2. Archivos

| Archivo | Acción |
|---|---|
| `src/lib/server/suplia-approval-continuation.ts` | NUEVO — lógica de continuación |
| `src/app/api/suplia/actions/[actionId]/approve/route.ts` | MODIFICAR — hook tras ejecutar |
| `src/lib/server/suplia-approval-continuation.test.ts` | NUEVO |
| `.env.example` | MODIFICAR |

---

## 3. Diseño

### 3.1 Nuevo módulo `src/lib/server/suplia-approval-continuation.ts`

```ts
import type { AuthContext } from '@/lib/server/auth-utils';
import { selectSupliaModelTier } from '@/ai/model-router';
import { runSupliaAgenticTurn } from '@/lib/server/suplia-agentic-runner';
// + imports de getSupabaseAdminClient, tipos, etc.

export function isPostApprovalBrainEnabled() {
  return String(process.env.SUPLIA_POST_APPROVAL_BRAIN || 'false').toLowerCase() === 'true';
}

export type ApprovalContinuationResult = {
  message: string;                       // texto final a persistir
  parts: SupliaMessagePart[];
  generatedBy: 'suplia-approval-brain' | 'suplia-approval-template';
  telemetry: unknown[] | null;
};

export async function buildApprovalContinuation(params: {
  auth: AuthContext;
  conversationId: string;
  toolName: string;                      // ej. 'prospecting.search_companies'
  actionTitle: string;
  result: Record<string, unknown>;       // output ya ejecutado de la tool
  artifactId?: string | null;            // artifact creado por artifactForResult, si hubo
  fallbackMessage: string;               // successMessage(toolName, result) — SIEMPRE calculado por el caller
  events?: { onEvent?: (event: string, data: Record<string, unknown>) => void };
}): Promise<ApprovalContinuationResult>
```

Comportamiento:

1. Si `!isPostApprovalBrainEnabled()` → devolver de inmediato `{ message: fallbackMessage, parts: [textPart(fallbackMessage)], generatedBy: 'suplia-approval-template', telemetry: null }`.
2. Cargar historial breve para contexto: últimos **12** mensajes de `suplia_messages` de la conversación (orden asc), mapeados a `GlmChatMessage` (igual criterio que M1 paso 3.7.3, sin compactación — es una continuación corta).
3. Construir el turno sintético. El "mensaje de usuario" del turno es un bloque de sistema-operativo (rol `user`, pero claramente etiquetado):

```
[EVENTO DEL SISTEMA - no es un mensaje del usuario]
El usuario APROBO y el sistema YA EJECUTO la accion "<actionTitle>" (tool: <toolName>).
Resultado de la ejecucion (datos reales, no inventar nada fuera de esto):
<JSON.stringify(clampToolOutput(result))>            // mismo clamp de M1 (24k chars)
<artifactId ? 'El resultado completo quedo guardado en el artifact <artifactId>.' : ''>

Tu tarea ahora:
1. Confirma en una linea que la accion se ejecuto.
2. Analiza el resultado con criterio comercial (calidad, fit con el perfil de la empresa, alertas).
3. Propone el siguiente paso concreto. Si el siguiente paso requiere aprobacion, deja la accion registrada llamando la herramienta correspondiente.
No repitas el contenido completo del artifact en el chat.
```

4. Llamar `runSupliaAgenticTurn` con: `modelTier: selectSupliaModelTier({ message: actionTitle, messages: [] })` forzado a mínimo `'orchestrator'` (nunca `fast`: el análisis es el valor), `history` = historial breve + bloque anterior, límites reducidos vía deps/params: **máx 3 iteraciones, máx 3 auto tools** (pasar por parámetro nuevo opcional `limits?: { maxIterations?: number; maxAutoTools?: number }` en `runSupliaAgenticTurn` — agregar ese parámetro en M1 si no existe, respetando defaults de env).
5. Éxito → `{ message: result.replyText || fallbackMessage, parts: result.parts.length ? result.parts : [textPart(fallbackMessage)], generatedBy: 'suplia-approval-brain', telemetry: result.telemetry }`.
6. Cualquier excepción → `console.warn('[SUPLIA/approval-continuation] fallback:', error)` y devolver el fallback de plantilla. **Nunca** propagar: la aprobación ya se ejecutó y debe responder 200.

### 3.2 Cambios en `approve/route.ts`

En el bloque de éxito (donde hoy se hace `admin.from('suplia_messages').insert({ content: successMessage(...) })`, aprox. líneas 475–482):

```ts
const fallback = successMessage(toolName, result);
const artifact = artifactForResult(toolName, result);
let persistedArtifactId: string | null = null;
if (artifact) {
  const inserted = await insertSupliaArtifacts(auth, [{ ...artifact, conversationId: action.conversation_id, jobId: action.job_id || null, sourceMessageId: null, changeSummary: `Resultado de accion aprobada: ${toolName}` }]);
  persistedArtifactId = inserted[0]?.id || null;   // mover la inserción ANTES del mensaje
}

const continuation = await buildApprovalContinuation({
  auth, conversationId: action.conversation_id, toolName,
  actionTitle: action.title || toolName, result,
  artifactId: persistedArtifactId, fallbackMessage: fallback,
});

await admin.from('suplia_messages').insert({
  conversation_id: action.conversation_id,
  organization_id: auth.organizationId,
  user_id: auth.user.id,
  role: 'assistant',
  content: continuation.message,
  metadata: {
    actionId: action.id,
    result,
    generatedBy: continuation.generatedBy,
    approvalContinuationTelemetry: continuation.telemetry,
    parts: [
      ...(persistedArtifactId && artifact ? [{ type: 'artifact-card', artifactId: persistedArtifactId, artifactType: artifact.type, title: artifact.title }] : []),
      ...continuation.parts,
    ],
  },
});
```

Notas de orden: hoy el artifact se inserta **después** del mensaje; este cambio lo mueve **antes** para poder referenciarlo. El `toast` de la respuesta sigue siendo `fallback` (corto, apto para toast). El caso `workflow.approve_plan` (bloque separado del route) **no se toca**. El caso de error de ejecución (catch) **no se toca**.

Si la continuación registró nuevas pending actions (parts `approval-request`), `getSupliaState` final ya las incluye — el cliente las renderiza sin cambios.

### 3.3 `.env.example`

```
# Analisis del brain despues de ejecutar una accion aprobada (requiere SUPLIA_BRAIN_MODE=agentic operativo)
SUPLIA_POST_APPROVAL_BRAIN="false"
```

---

## 4. Tests

`src/lib/server/suplia-approval-continuation.test.ts` (con `runSupliaAgenticTurn` inyectado/mocked vía un parámetro `deps` opcional del módulo — agregar seam igual que en M1):

1. Flag apagado → devuelve fallback con `generatedBy: 'suplia-approval-template'` sin llamar al brain.
2. Flag prendido, brain responde texto → `generatedBy: 'suplia-approval-brain'`, message = replyText.
3. Brain lanza excepción → fallback, sin throw.
4. Brain devuelve replyText vacío → message = fallbackMessage.
5. El bloque sintético incluye el JSON del resultado clampeado y el artifactId cuando existe.

---

## 5. Criterios de aceptación

1. Flag apagado: aprobación se comporta exactamente igual que hoy (mensaje plantilla).
2. Flag prendido: aprobar una búsqueda de empresas produce un mensaje que (a) confirma ejecución, (b) comenta la calidad/fit de resultados reales, (c) propone siguiente paso; y si propone enviar correos, aparece una nueva tarjeta de aprobación.
3. Si GLM está caído, la aprobación **no falla**: responde 200 con la plantilla.
4. Latencia añadida aceptable: la continuación usa tier orchestrator con thinking estándar (sin `reasoning_effort: max`).

## 6. Rollback

`SUPLIA_POST_APPROVAL_BRAIN=false`.
