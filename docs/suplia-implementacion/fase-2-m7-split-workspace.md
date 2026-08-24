# M7 — Partir el monolito `SupliaWorkspace.tsx`

**Fase:** 2 · **Depende de:** M1, M3, M4 ya integrados (para no migrar dos veces) · **Riesgo:** medio (refactor grande sin cambio funcional)
**Resuelve:** H11 (2.470 líneas en un archivo: shell, sidebar, transcript, composer, canvas, SSE, helpers).

---

## 1. Regla de oro

**Cero cambios de comportamiento y cero cambios de markup/clases CSS.** Es un refactor mecánico de extracción. Si durante la extracción se detecta un bug, anotarlo en el commit pero NO arreglarlo aquí (salvo que bloquee la compilación).

## 2. Estructura destino

```
src/components/suplia/
  SupliaWorkspace.tsx          // ~150 líneas: composición + wiring de hooks
  MessageMarkdown.tsx          // (ya existe desde M4)
  workspace/
    types.ts                   // WorkspaceState, ComposerMode, ComposerAttachment, etc. (mover tal cual)
    constants.ts               // starters, activityPhases, composerModes, readableAttachmentExtensions
    format.ts                  // formatRelativeDate, formatElapsed, formatBytes, cleanText, previewJson,
                               // getConversationBucket, groupConversations, safeHref, parseSseMessage
    artifact-preview.ts        // getDocumentSummary, getStructuredItems, formatInlineList y todo helper
                               // usado solo por el canvas de artifacts
    SupliaMark.tsx             // logo
    SupliaSidebar.tsx          // sidebar: conversaciones agrupadas, quick actions, memorias
    SupliaTranscript.tsx       // lista de mensajes + streaming en vivo + scroll anchor
    MessageBubble.tsx          // burbuja user/assistant: parts → texto (MessageMarkdown), tablas, code
    MessageActions.tsx         // copiar / feedback / retry (de M3)
    ToolRunCard.tsx            // tarjeta de tool run (mover tal cual)
    ApprovalCard.tsx           // renderActionControls + tarjetas de pending actions + strong confirmation
    AskCard.tsx                // formulario de askRequests (preguntas/opciones/otro)
    JobProgressCard.tsx        // job steps, agent runs, eventos, pausa/reanudar/cancelar/reintentar
    ArtifactCanvas.tsx         // panel derecho: tabs preview/versions, download, copy,
                               //   StructuredDocumentPreview + subcomponentes
    SupliaComposer.tsx         // textarea, adjuntos, modos, dictado, enviar/detener
  hooks/
    use-suplia-chat.ts         // estado WorkspaceState + sendMessage + SSE + liveStream +
                               //   loadWorkspace + applyResponse + approve/cancel/feedback
    use-suplia-dictation.ts    // toggleDictation + estado
    use-suplia-realtime.ts     // (ya existe desde M6, mover aquí si se creó en src/hooks)
```

Criterio: los componentes reciben **props explícitas** (datos + callbacks), sin context provider en esta pasada (el árbol es poco profundo; un provider se puede evaluar después).

## 3. Procedimiento (orden obligatorio, un commit por paso)

1. **Extraer puros sin JSX:** `types.ts`, `constants.ts`, `format.ts`, `artifact-preview.ts`. Solo mover + exportar + importar. Typecheck verde.
2. **Extraer componentes hoja** (sin estado compartido): `SupliaMark`, `ToolRunCard`, `MessageActions`, `MessageTable`/`MessageCode` (dentro de `MessageBubble.tsx` o archivo propio si superan 100 líneas). Typecheck verde.
3. **Extraer `use-suplia-chat.ts`:** mover `state`, `sending`, `liveStream`, `activity*`, `sendMessage`, `loadWorkspace`, `applyResponse`, `animateAssistantMessage` (legacy), `cancelActiveRequest`, `approveAction`, `cancelAction`, `submitPlanEdit`, `submitFeedback`. El hook devuelve un objeto con todo lo que el árbol consume. Es el paso más delicado: verificar que TODOS los `useRef` (`requestAbortRef`, `streamingTimerRef`, `workspaceRequestSeqRef`, `artifactCountRef`) se muevan juntos.
4. **Extraer paneles grandes:** `SupliaSidebar`, `ArtifactCanvas`, `SupliaComposer`, `SupliaTranscript` (+ `MessageBubble`, `ApprovalCard`, `AskCard`, `JobProgressCard`). Uno por commit, typecheck verde entre cada uno.
5. **Reducir `SupliaWorkspace.tsx`** a composición: fuentes (`supliaSans`/`supliaSerif`), tema, hook de chat, hook realtime, y layout de los 3 paneles.
6. Pasada final: eliminar imports muertos, correr `npm run lint`, `npm run typecheck`, `npm run test`.

## 4. Firmas de referencia (contrato entre piezas)

```ts
// use-suplia-chat.ts
export function useSupliaChat(): {
  state: WorkspaceState;
  loading: boolean;
  sending: boolean;
  liveStream: { text: string; thinking: string } | null;
  activity: { label: string | null; phaseIndex: number; elapsedMs: number };
  input: string; setInput: (v: string) => void;
  composerMode: ComposerMode; setComposerMode: (m: ComposerMode) => void;
  attachments: ComposerAttachment[]; setAttachments: React.Dispatch<...>;
  activeArtifactId: string | null; setActiveArtifactId: (id: string | null) => void;
  artifactPanelOpen: boolean; setArtifactPanelOpen: (v: boolean) => void;
  messageFeedback: Record<string, 'up' | 'down'>;
  sendMessage: (text: string, options?: SendMessageOptions) => Promise<void>;
  cancelActiveRequest: () => void;
  loadWorkspace: (conversationId?: string | null, options?: { silent?: boolean }) => Promise<void>;
  selectConversation: (id: string | null) => void;
  startNewConversation: () => void;
  approveAction: (action: SupliaPendingAction) => Promise<void>;
  cancelAction: (action: SupliaPendingAction) => Promise<void>;
  submitPlanEdit: (action: SupliaPendingAction) => Promise<void>;
  submitFeedback: (message: SupliaMessage, rating: 'up' | 'down') => Promise<void>;
  strongConfirmations: Record<string, string>; setStrongConfirmation: (id: string, v: string) => void;
  planEditText: Record<string, string>; setPlanEditTextFor: (id: string, v: string) => void;
};

// SupliaTranscript
type SupliaTranscriptProps = {
  messages: SupliaMessage[];
  toolRuns: SupliaToolRun[];
  pendingActions: SupliaPendingAction[];
  activeJob: SupliaJob | null; jobSteps: SupliaJobStep[]; jobEvents: SupliaJobEvent[];
  liveStream: { text: string; thinking: string } | null;
  sending: boolean;
  activity: { label: string | null; phaseIndex: number; elapsedMs: number };
  messageFeedback: Record<string, 'up' | 'down'>;
  onRetry: (message: SupliaMessage) => void;
  onFeedback: (message: SupliaMessage, rating: 'up' | 'down') => void;
  onAnswerAsk: (payload: SupliaAskAnswerPayload, text: string) => void;
  onApprove: (action: SupliaPendingAction) => void;
  onDeny: (action: SupliaPendingAction) => void;
  // ... resto de callbacks de aprobación/edición de plan tal como existen hoy
};
```

(Las demás firmas se derivan mecánicamente de las props que cada bloque JSX consume hoy; el agente debe derivarlas del código, no inventar estado nuevo.)

## 5. Verificación

1. `npm run typecheck` y `npm run test` verdes tras CADA paso.
2. Diff visual: capturar screenshot de la pantalla SUPL.IA antes y después (desktop y móvil, light y dark) y compararlos — deben ser idénticos. Guía del repo: `docs/ui-ux/release-audit-checklist.md`.
3. QA funcional completo: enviar mensaje (streaming M1), crear artifact, abrir canvas, cambiar versión de artifact, aprobar/denegar acción con confirmación fuerte, editar plan, contestar un ask, adjuntar archivo, dictar, cambiar de conversación, crear conversación nueva, feedback (M3).
4. `grep -c "líneas" SupliaWorkspace.tsx` → objetivo ≤ 200 líneas.

## 6. Rollback

Revert del merge (los commits por paso permiten bisect si algo se rompe).
