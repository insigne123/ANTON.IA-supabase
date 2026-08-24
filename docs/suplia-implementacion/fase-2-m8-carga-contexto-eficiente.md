# M8 — Carga de contexto eficiente (no leer 10.000 mensajes por turno)

**Fase:** 2 · **Independiente** · **Riesgo:** medio (toca el armado del prompt — validar con cuidado)
**Resuelve:** H9 (`loadConversationMessagesForPrompt` pagina hasta 10×1000 mensajes de Supabase en cada mensaje, aunque la compactación descarte la mayoría).

---

## 1. Contexto actual

- `src/lib/server/suplia-orchestrator.ts` → `loadConversationMessagesForPrompt(conversationId, organizationId)`: pagina TODOS los mensajes asc (pageSize 1000, maxPages 10).
- `src/lib/server/suplia-conversation-context.ts` → `ensureSupliaPromptConversationContext({ auth, conversation, messages })`: estima tokens del total, si supera `SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS` compacta los mensajes anteriores a los `SUPLIA_CONTEXT_RECENT_MESSAGES` (default 12) más recientes, guarda el resumen en `suplia_conversations.metadata.compaction` (`compactedThroughMessageId`, `compactedThroughCreatedAt`, `sourceMessageCount`, `sourceTokenEstimate`).
- `src/lib/suplia/conversation-context.ts` (lib compartida): `estimateSupliaMessagesTokens`, `getSupliaCompactionFromMetadata`, `getSupliaMessagesNeedingCompaction`, `buildSupliaPromptConversationContext`, `DEFAULT_SUPLIA_CONTEXT_*`.

El problema: la conversación entera viaja de la DB al server en cada turno solo para volver a decidir lo mismo.

## 2. Diseño

Cargar únicamente: (a) los mensajes **posteriores** al límite ya compactado, con tope duro, y (b) apoyarse en `compaction.sourceTokenEstimate` para el estimado acumulado. La compactación incremental sigue funcionando: si los mensajes no compactados vuelven a superar el umbral, se compacta el tramo nuevo (la función `summarizeConversationChunk` ya soporta `existingSummary`).

### 2.1 Nueva firma en `suplia-orchestrator.ts`

```ts
const PROMPT_MESSAGES_HARD_LIMIT = 400;   // mensajes máximos post-compactación

async function loadConversationMessagesForPrompt(
  conversationId: string,
  organizationId: string,
  compaction: SupliaConversationCompaction | null
) {
  const admin = getSupabaseAdminClient();
  let query = admin
    .from('suplia_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true })
    .limit(PROMPT_MESSAGES_HARD_LIMIT + 1);

  if (compaction?.compactedThroughCreatedAt) {
    query = query.gt('created_at', compaction.compactedThroughCreatedAt);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const overflow = rows.length > PROMPT_MESSAGES_HARD_LIMIT;   // señal para compactar ya
  return { messages: rows.slice(0, PROMPT_MESSAGES_HARD_LIMIT).map(mapMessage), overflow };
}
```

Caso borde: mensajes con el MISMO `created_at` que el límite quedarían fuera con `.gt`. Aceptable (el resumen los cubre), pero documentarlo en un comentario. Si `compactedThroughCreatedAt` es null pero hay `compaction.summary` (dato corrupto), tratar como sin compactación.

### 2.2 Call-site en `processSupliaMessage` (y en el agentic de M1)

```ts
const compaction = getSupliaCompactionFromMetadata(stateBefore.conversation!.metadata);
const { messages: promptMessages, overflow } = await loadConversationMessagesForPrompt(activeConversationId, auth.organizationId, compaction);
const conversationContext = await ensureSupliaPromptConversationContext({
  auth,
  conversation: stateBefore.conversation!,
  messages: promptMessages,
  precomputed: { compaction, overflow },
});
```

### 2.3 Ajustes en `ensureSupliaPromptConversationContext`

Agregar parámetro opcional `precomputed?: { compaction: SupliaConversationCompaction | null; overflow?: boolean }` y cambiar la aritmética:

```ts
const compaction = params.precomputed?.compaction ?? getSupliaCompactionFromMetadata(params.conversation.metadata);
const freshTokens = estimateSupliaMessagesTokens(params.messages);          // solo lo cargado
const baseTokens = Number(compaction?.sourceTokenEstimate || 0);            // histórico ya compactado
const tokenEstimate = baseTokens + freshTokens;
const mustCompact = tokenEstimate > thresholdTokens || params.precomputed?.overflow === true;
```

`getSupliaMessagesNeedingCompaction(messages, compaction, recentMessageCount)` ya opera sobre la lista dada (los posteriores al límite): verificar en `src/lib/suplia/conversation-context.ts` que su lógica sea "todo menos los N recientes, excluyendo los ≤ compactedThrough" — con la lista parcial el resultado es el mismo conjunto. Al escribir la nueva compactación, `sourceMessageCount` pasa a ser `(compaction?.sourceMessageCount || 0) + messagesToCompact.length` y `sourceTokenEstimate` = `baseTokens + estimate(messagesToCompact)` (semántica acumulada — documentar en comentario que desde esta versión es acumulado, no total re-escaneado).

`buildSupliaPromptConversationContext` recibe los mensajes parciales; revisar que `omittedMessageCount` use `compaction.sourceMessageCount` en vez de `messages.length` para no reportar 0.

### 2.4 Migración de índice `supabase/migrations/20260707T0002_suplia_messages_index.sql`

```sql
create index if not exists idx_suplia_messages_conversation_created
  on public.suplia_messages (conversation_id, created_at);
```

(Verificar antes con `select indexname from pg_indexes where tablename = 'suplia_messages'` que no exista ya un índice equivalente; si existe, la migración es no-op gracias al `if not exists`.)

## 3. Tests

Actualizar/crear `src/lib/suplia/conversation-context.test.ts` (ya existe — extender):
1. Sin compactación previa y pocos mensajes → no compacta, `tokenEstimate` = fresh.
2. Con compactación previa (`sourceTokenEstimate` grande) + pocos mensajes nuevos → `tokenEstimate` acumulado correcto; no re-compacta si no supera umbral.
3. `overflow: true` fuerza compactación aunque los tokens no superen el umbral.
4. `getSupliaMessagesNeedingCompaction` con lista parcial produce el mismo conjunto que con lista completa equivalente (armar fixture con 20 mensajes, compactedThrough en el 10º, recent=5 → deben compactarse los mensajes 11..15).

Para el orquestador: test unitario del helper de query no es viable sin DB; cubrir con QA manual.

## 4. QA manual

1. Conversación corta (< umbral): responder funciona igual; log de queries (Supabase dashboard) muestra 1 select acotado en vez de paginación.
2. Conversación larga ya compactada: el prompt incluye el resumen + recientes; la respuesta mantiene referencias a hechos del resumen ("como te dije antes...").
3. Forzar compactación bajando `SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS=2000` en dev: enviar ~15 mensajes, verificar que `suplia_conversations.metadata.compaction` se crea y que los turnos siguientes solo leen los posteriores.

## 5. Rollback

Revertir commit (la firma vieja se restaura). La metadata `compaction` escrita con semántica acumulada sigue siendo compatible con el código viejo (usa los mismos campos).
