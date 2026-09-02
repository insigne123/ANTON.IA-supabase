'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CheckCircle2, CircleStop, Loader2, Plus, RefreshCw, Save, Sparkles } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  loadFirstContactFollowUpPlan,
  retryFirstContactFollowUpDraft,
  saveFirstContactFollowUpPlan,
  stopFirstContactFollowUpPlan,
  type FirstContactFollowUpPlan,
  type FirstContactFollowUpStep,
} from '@/lib/campaigns-v2-client';
import type { StyleProfile } from '@/lib/types';
import { cn } from '@/lib/utils';

type FirstContactFollowUpPlanProps = {
  draftId: string;
  versionId: string;
  styleProfiles?: StyleProfile[];
  disabled?: boolean;
  className?: string;
  disabledReason?: string | null;
  onPlanChange?: (plan: FirstContactFollowUpPlan | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
};

type DraftEditor = {
  draftId: string;
  subject: string;
  body: string;
  savedSubject: string;
  savedBody: string;
  saving: boolean;
  error: string | null;
  feedback: string | null;
};

type AiNoteTarget =
  | { kind: 'step'; stepId: string; label: string }
  | { kind: 'all'; label: 'Toda la secuencia' };

const USE_INITIAL_STYLE = '__initial_email_style__';
const FOLLOW_UP_OFFSETS = [3, 4, 5, 7] as const;
const FOLLOW_UP_NAMES = ['Primer seguimiento', 'Segundo seguimiento', 'Tercer seguimiento', 'Último seguimiento'] as const;
const FOLLOW_UP_INSTRUCTIONS = [
  'Continúa desde el correo inicial sin resumirlo. Usa un solo detalle factual y ve directo a una acción concreta.',
  'Describe una acción concreta del remitente sin repetir la descripción de ninguna empresa.',
  'Explica con un ejemplo breve qué podría encontrar, responder o actualizar el equipo.',
  'Mantén el cierre corto y directo. Reconoce que puede no ser prioridad y deja la puerta abierta.',
] as const;
const GLOBAL_COHERENCE_NOTE = 'Mantén coherencia entre todos los seguimientos, usa un tema concreto distinto en cada mensaje y no repitas frases.';

function buildFollowUpSteps(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: FOLLOW_UP_NAMES[index],
    offsetDays: FOLLOW_UP_OFFSETS[index],
    instruction: FOLLOW_UP_INSTRUCTIONS[index],
  }));
}

function cumulativeDays(offsets: readonly number[], index: number) {
  return offsets.slice(0, index + 1).reduce((total, offset) => total + offset, 0);
}

function cadenceDays(count: number) {
  return Array.from({ length: count }, (_, index) => cumulativeDays(FOLLOW_UP_OFFSETS, index));
}

function isEditorDirty(editor?: DraftEditor) {
  return Boolean(editor && (editor.subject !== editor.savedSubject || editor.body !== editor.savedBody));
}

function editorFromStep(step: FirstContactFollowUpStep): DraftEditor | null {
  if (!step.draft) return null;
  return {
    draftId: step.draft.draftId,
    subject: step.draft.subject,
    body: step.draft.body,
    savedSubject: step.draft.subject,
    savedBody: step.draft.body,
    saving: false,
    error: null,
    feedback: null,
  };
}

function stateLabel(value?: string | null) {
  const labels: Record<string, string> = {
    pending_initial_send: 'Se activará después del envío inicial',
    active: 'Seguimiento activo',
    completed: 'Seguimiento completado',
    stopped: 'Seguimiento detenido',
    blocked: 'Seguimiento bloqueado',
  };
  return labels[String(value || '').toLowerCase()] || 'Seguimiento preparado';
}

function approvalLabel(step: FirstContactFollowUpStep) {
  if (!step.draft) return null;
  if (step.draft.lifecycle === 'archived') return 'Borrador archivado';
  if (step.draft.approval.status === 'approved') return 'Revisión aprobada';
  if (step.draft.approval.status === 'rejected') return 'Revisión rechazada';
  return 'Revisión pendiente';
}

function apiMessage(payload: any, fallback: string) {
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
  return fallback;
}

function globalRewriteInstruction(instruction: string) {
  const suffix = `\n\n${GLOBAL_COHERENCE_NOTE}`;
  return `${instruction.slice(0, Math.max(1, 1_000 - suffix.length)).trim()}${suffix}`;
}

function GenerationSkeleton({ count }: { count: number }) {
  return (
    <Card className="overflow-hidden border-border/60 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.32)]" aria-busy="true">
      <div className="border-b border-border/60 px-4 py-5 sm:px-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
      </div>
      <ol className="divide-y divide-border/60">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className="space-y-5 px-4 py-6 sm:px-5">
            <div className="flex items-start gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="space-y-2"><Skeleton className="h-3 w-16" /><Skeleton className="h-11 w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-52 w-full" /></div>
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">Generando los seguimientos.</p>
    </Card>
  );
}

export function FirstContactFollowUpPlan({
  draftId,
  versionId,
  styleProfiles = [],
  disabled = false,
  className,
  disabledReason,
  onPlanChange,
  onDirtyChange,
  onBusyChange,
}: FirstContactFollowUpPlanProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<FirstContactFollowUpPlan | null>(null);
  const planRef = useRef<FirstContactFollowUpPlan | null>(null);
  const [editors, setEditors] = useState<Record<string, DraftEditor>>({});
  const editorsRef = useRef<Record<string, DraftEditor>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [setupOpen, setSetupOpen] = useState(false);
  const [followUpCount, setFollowUpCount] = useState(2);
  const [sequenceInstruction, setSequenceInstruction] = useState('');
  const [styleProfileId, setStyleProfileId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const [retryingStepIds, setRetryingStepIds] = useState<Record<string, boolean>>({});
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const [planFeedback, setPlanFeedback] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);

  const [noteTarget, setNoteTarget] = useState<AiNoteTarget | null>(null);
  const [noteInstruction, setNoteInstruction] = useState('');
  const [noteStyleProfileId, setNoteStyleProfileId] = useState('');
  const [applyingNote, setApplyingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSuccess, setNoteSuccess] = useState<string | null>(null);
  const [noteProgress, setNoteProgress] = useState<string | null>(null);

  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const setupInstructionRef = useRef<HTMLTextAreaElement | null>(null);
  const sequenceHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusSequenceAfterGenerationRef = useRef(false);

  const selectableStyleProfiles = styleProfiles.filter((profile) => Boolean(profile.id));
  const hasDirtyEditors = Object.values(editors).some(isEditorDirty);
  const isBusy = generating
    || applyingNote
    || stopping
    || Object.values(retryingStepIds).some(Boolean)
    || Object.values(editors).some((editor) => editor.saving);

  useEffect(() => {
    onDirtyChange?.(hasDirtyEditors);
  }, [hasDirtyEditors, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  useEffect(() => {
    if (setupOpen) window.requestAnimationFrame(() => setupInstructionRef.current?.focus());
  }, [setupOpen]);

  useEffect(() => {
    if (!generating && plan && focusSequenceAfterGenerationRef.current) {
      focusSequenceAfterGenerationRef.current = false;
      window.requestAnimationFrame(() => sequenceHeadingRef.current?.focus());
    }
  }, [generating, plan]);

  const setEditorState = useCallback((stepId: string, changes: Partial<DraftEditor>) => {
    const current = editorsRef.current[stepId];
    if (!current) return;
    const next = { ...editorsRef.current, [stepId]: { ...current, ...changes } };
    editorsRef.current = next;
    setEditors(next);
  }, []);

  const syncEditorsFromPlan = useCallback((nextPlan: FirstContactFollowUpPlan | null) => {
    const current = editorsRef.current;
    const next: Record<string, DraftEditor> = {};
    for (const step of nextPlan?.steps || []) {
      const fromStep = editorFromStep(step);
      if (!fromStep) continue;
      const existing = current[step.id];
      next[step.id] = existing?.draftId === fromStep.draftId && isEditorDirty(existing)
        ? existing
        : fromStep;
    }
    editorsRef.current = next;
    setEditors(next);
  }, []);

  const commitPlan = useCallback((nextPlan: FirstContactFollowUpPlan | null, syncEditors = true) => {
    planRef.current = nextPlan;
    setPlan(nextPlan);
    if (syncEditors) syncEditorsFromPlan(nextPlan);
    onPlanChange?.(nextPlan);
  }, [onPlanChange, syncEditorsFromPlan]);

  const loadPlan = useCallback(async (signal?: AbortSignal, surfaceError = true) => {
    if (surfaceError) setLoadError(null);
    try {
      const result = await loadFirstContactFollowUpPlan(draftId, signal);
      setEnabled(result.enabled);
      commitPlan(result.plan);
      return result.plan;
    } catch (error: any) {
      if (error?.name === 'AbortError') return null;
      if (surfaceError) setLoadError(error?.message || 'No pudimos cargar los seguimientos.');
      throw error;
    }
  }, [commitPlan, draftId]);

  useEffect(() => {
    const controller = new AbortController();
    setEnabled(null);
    commitPlan(null);
    setGenerationError(null);
    setPlanFeedback(null);
    void loadPlan(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [commitPlan, loadPlan, reloadKey]);

  function updatePlanWithNativeDraft(stepId: string, nativeDraft: any) {
    const currentPlan = planRef.current;
    const currentStep = currentPlan?.steps.find((step) => step.id === stepId);
    if (!currentPlan || !currentStep?.draft || !nativeDraft) throw new Error('No pudimos actualizar este seguimiento.');

    const summary: NonNullable<FirstContactFollowUpStep['draft']> = {
      ...currentStep.draft,
      draftId: String(nativeDraft.draftId || currentStep.draft.draftId),
      versionId: String(nativeDraft.versionId || currentStep.draft.versionId),
      subject: String(nativeDraft?.content?.subject || currentStep.draft.subject),
      body: String(nativeDraft?.content?.text || currentStep.draft.body),
      lifecycle: nativeDraft?.lifecycle || currentStep.draft.lifecycle,
      approval: nativeDraft?.approval || currentStep.draft.approval,
    };
    setEditorState(stepId, {
      draftId: summary.draftId,
      subject: summary.subject,
      body: summary.body,
      savedSubject: summary.subject,
      savedBody: summary.body,
      error: null,
    });
    const nextPlan = {
      ...currentPlan,
      steps: currentPlan.steps.map((step) => step.id === stepId ? { ...step, nativeDraftId: summary.draftId, draft: summary } : step),
    };
    commitPlan(nextPlan, false);
    return summary;
  }

  async function patchDraft(stepId: string) {
    const editor = editorsRef.current[stepId];
    const step = planRef.current?.steps.find((item) => item.id === stepId);
    if (!editor || !step?.draft) throw new Error('Este correo todavía no tiene un borrador editable.');
    if (!editor.subject.trim() || !editor.body.trim()) throw new Error('Completa el asunto y el mensaje antes de guardar.');
    if (!isEditorDirty(editor)) return step.draft;

    const response = await fetch(`/api/native-drafts/${encodeURIComponent(editor.draftId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: editor.subject.trim(), text: editor.body.trim() }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.draft) throw new Error(apiMessage(payload, 'No pudimos guardar este correo.'));
    return updatePlanWithNativeDraft(stepId, payload.draft);
  }

  async function saveDraft(stepId: string) {
    const editor = editorsRef.current[stepId];
    if (!editor || editor.saving || applyingNote) return;
    setEditorState(stepId, { saving: true, error: null, feedback: null });
    try {
      await patchDraft(stepId);
      setEditorState(stepId, { feedback: 'Cambios guardados.', error: null });
    } catch (error: any) {
      setEditorState(stepId, { error: error?.message || 'No pudimos guardar este correo.' });
    } finally {
      setEditorState(stepId, { saving: false });
    }
  }

  async function rewriteDraft(stepId: string, instruction: string, selectedStyleId: string) {
    await patchDraft(stepId);
    const step = planRef.current?.steps.find((item) => item.id === stepId);
    if (!step?.draft) throw new Error('Este seguimiento todavía no tiene un borrador editable.');

    const response = await fetch(`/api/native-drafts/${encodeURIComponent(step.draft.draftId)}/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction,
        styleProfileId: selectedStyleId || null,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.draft) throw new Error(apiMessage(payload, 'No pudimos aplicar el cambio.'));
    updatePlanWithNativeDraft(stepId, payload.draft);
  }

  async function generatePlan() {
    const instruction = sequenceInstruction.trim();
    if (!instruction || generating || disabled || !versionId) return;
    setGenerating(true);
    focusSequenceAfterGenerationRef.current = true;
    setGenerationError(null);
    try {
      const result = await saveFirstContactFollowUpPlan({
        draftId,
        versionId,
        styleProfileId: styleProfileId || null,
        sequenceInstruction: instruction,
        steps: buildFollowUpSteps(followUpCount),
      });
      setEnabled(true);
      commitPlan(result.plan);
      setSetupOpen(false);
    } catch (error: any) {
      setGenerationError(error?.message || 'No pudimos generar los seguimientos.');
    } finally {
      setGenerating(false);
    }
  }

  async function retryDraft(stepId: string) {
    if (retryingStepIds[stepId] || disabled) return;
    setRetryingStepIds((current) => ({ ...current, [stepId]: true }));
    setRetryErrors((current) => {
      const next = { ...current };
      delete next[stepId];
      return next;
    });
    try {
      const result = await retryFirstContactFollowUpDraft({ draftId, stepId });
      commitPlan(result.plan);
    } catch (error: any) {
      setRetryErrors((current) => ({ ...current, [stepId]: error?.message || 'No pudimos generar este seguimiento.' }));
    } finally {
      setRetryingStepIds((current) => ({ ...current, [stepId]: false }));
    }
  }

  function openNote(target: AiNoteTarget) {
    setNoteTarget(target);
    setNoteInstruction('');
    setNoteStyleProfileId(styleProfileId);
    setNoteError(null);
    setNoteSuccess(null);
    setNoteProgress(null);
  }

  async function applyAiNote() {
    const instruction = noteInstruction.trim();
    if (!noteTarget || !instruction || applyingNote) return;
    setApplyingNote(true);
    setNoteError(null);
    setNoteSuccess(null);

    try {
      if (noteTarget.kind === 'step') {
        await rewriteDraft(noteTarget.stepId, instruction, noteStyleProfileId);
        setNoteSuccess('Cambio aplicado. El correo quedó como una nueva revisión pendiente.');
        await loadPlan(undefined, false).catch(() => undefined);
        return;
      }

      const generatedSteps = (planRef.current?.steps || []).filter((step) => Boolean(step.draft));
      const failures: string[] = [];
      let successCount = 0;
      const coherentInstruction = globalRewriteInstruction(instruction);
      for (const [index, step] of generatedSteps.entries()) {
        setNoteProgress(`Actualizando ${index + 1} de ${generatedSteps.length} seguimientos…`);
        try {
          await rewriteDraft(step.id, coherentInstruction, noteStyleProfileId);
          successCount += 1;
        } catch (error) {
          failures.push(step.name);
        }
      }
      await loadPlan(undefined, false).catch(() => undefined);
      if (successCount > 0) {
        setNoteSuccess(`Cambio aplicado a ${successCount} de ${generatedSteps.length} seguimientos.`);
      }
      if (failures.length > 0) {
        setNoteError(`No pudimos actualizar: ${failures.join(', ')}. Los demás seguimientos conservaron sus cambios.`);
      }
      if (generatedSteps.length === 0) setNoteError('Todavía no hay seguimientos generados para ajustar.');
    } catch (error: any) {
      setNoteError(error?.message || 'No pudimos aplicar el cambio. Inténtalo nuevamente.');
    } finally {
      setApplyingNote(false);
      setNoteProgress(null);
    }
  }

  function handleNoteKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void applyAiNote();
    }
  }

  async function stopPlan() {
    const currentPlan = planRef.current;
    if (!currentPlan || stopping) return;
    if (hasDirtyEditors) {
      setPlanFeedback('Guarda los cambios pendientes antes de detener los seguimientos.');
      setStopConfirmOpen(false);
      return;
    }
    setStopping(true);
    setStopError(null);
    setPlanFeedback(null);
    try {
      await stopFirstContactFollowUpPlan({
        campaignId: currentPlan.campaignId,
        enrollmentId: currentPlan.enrollmentId,
      });
      const stoppedPlan: FirstContactFollowUpPlan = {
        ...currentPlan,
        lifecycleState: 'stopped',
        enrollmentState: 'stopped',
        nextDueAt: null,
      };
      commitPlan(stoppedPlan, false);
      setStopConfirmOpen(false);
      setPlanFeedback('No se prepararán ni enviarán más correos de este seguimiento.');
      await loadPlan(undefined, false).catch(() => undefined);
    } catch (error: any) {
      setStopError(error?.message || 'No pudimos detener los seguimientos.');
    } finally {
      setStopping(false);
    }
  }

  if (enabled === null && !loadError) {
    return (
      <div className={cn('flex flex-col items-center', className)} aria-busy="true">
        <div className="h-8 w-px bg-border/70" aria-hidden="true" />
        <div className="w-full rounded-xl border border-border/60 bg-card px-4 py-5">
          <div className="flex items-center gap-3" role="status" aria-label="Cargando seguimientos">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64 max-w-full" /></div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={cn('flex flex-col items-center', className)}>
        <div className="h-8 w-px bg-border/70" aria-hidden="true" />
        <div className="w-full rounded-xl border border-border/60 bg-card px-4 py-5">
          <p className="text-sm font-medium">No pudimos cargar los seguimientos</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{loadError}</p>
          <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => setReloadKey((value) => value + 1)}>
            <RefreshCw aria-hidden="true" /> Reintentar
          </Button>
        </div>
      </div>
    );
  }

  if (enabled === false) return null;

  if (generating) {
    return (
      <div className={cn('flex flex-col items-center', className)}>
        <div className="h-8 w-px bg-border/70" aria-hidden="true" />
        <div className="w-full"><GenerationSkeleton count={followUpCount} /></div>
      </div>
    );
  }

  if (!plan) {
    const days = cadenceDays(followUpCount);
    return (
      <div className={cn('flex flex-col items-center', className)}>
        <div className="h-8 w-px bg-border/70" aria-hidden="true" />
        {!setupOpen ? (
          <Button
            ref={addButtonRef}
            type="button"
            variant="outline"
            className="min-h-11 rounded-full border-dashed bg-background px-5 text-muted-foreground hover:text-foreground"
            onClick={() => { setSetupOpen(true); setGenerationError(null); }}
            disabled={disabled}
            aria-describedby={disabledReason ? 'follow-up-disabled-reason' : undefined}
          >
            <Plus aria-hidden="true" /> Añadir seguimientos
          </Button>
        ) : (
          <Card className="w-full border-border/60 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.32)]">
            <form
              className="space-y-6 p-4 sm:p-6"
              onSubmit={(event) => { event.preventDefault(); void generatePlan(); }}
            >
              <div>
                <h2 className="text-base font-semibold tracking-[-0.01em]">Preparar seguimientos</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Se crearán como borradores para que puedas revisarlos uno a uno.</p>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Cantidad de correos</legend>
                <div className="grid grid-cols-4 rounded-xl border border-border/60 bg-muted/30 p-1" aria-label="Cantidad de seguimientos">
                  {[1, 2, 3, 4].map((count) => (
                    <Button
                      key={count}
                      type="button"
                      variant={followUpCount === count ? 'secondary' : 'ghost'}
                      className="min-h-11 rounded-lg"
                      aria-pressed={followUpCount === count}
                      onClick={() => setFollowUpCount(count)}
                      disabled={disabled}
                    >
                      {count}
                    </Button>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="follow-up-sequence-instruction">¿Cómo deberían sentirse?</Label>
                <Textarea
                  ref={setupInstructionRef}
                  id="follow-up-sequence-instruction"
                  value={sequenceInstruction}
                  onChange={(event) => { setSequenceInstruction(event.target.value); setGenerationError(null); }}
                  rows={4}
                  maxLength={1_000}
                  placeholder="Ej. breves, consultivos y sin presión; que cada correo aporte algo nuevo."
                  className="min-h-28 resize-y border-slate-400 text-[15px] leading-6 dark:border-slate-500"
                  disabled={disabled}
                  required
                  aria-required="true"
                  aria-describedby="follow-up-sequence-hint"
                />
                <p id="follow-up-sequence-hint" className="text-xs leading-5 text-muted-foreground">Usaremos esta guía en todos los seguimientos.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="follow-up-style">Estilo o plantilla <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                <Select
                  value={styleProfileId || USE_INITIAL_STYLE}
                  onValueChange={(value) => setStyleProfileId(value === USE_INITIAL_STYLE ? '' : value)}
                  disabled={disabled || selectableStyleProfiles.length === 0}
                >
                  <SelectTrigger id="follow-up-style" className="h-11 border-slate-400 dark:border-slate-500">
                    <SelectValue placeholder="Mantener el estilo del correo inicial" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={USE_INITIAL_STYLE} className="min-h-11">Mantener el estilo del correo inicial</SelectItem>
                    {selectableStyleProfiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id!} className="min-h-11">
                        {profile.name}{profile.isDefault ? ' · Predeterminado' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectableStyleProfiles.length === 0 ? <p className="text-xs text-muted-foreground">No hay estilos guardados disponibles.</p> : null}
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Cadencia sugerida</p>
                <p className="mt-1.5 text-sm font-medium">{days.map((day) => `Día ${day}`).join('  →  ')}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Cada plazo se cuenta después del correo anterior.</p>
              </div>

              {generationError ? (
                <Alert variant="destructive">
                  <AlertTitle>No se pudieron generar</AlertTitle>
                  <AlertDescription>{generationError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => {
                  setSetupOpen(false);
                  setGenerationError(null);
                  window.requestAnimationFrame(() => addButtonRef.current?.focus());
                }} disabled={disabled}>
                  Cancelar
                </Button>
                <Button type="submit" className="min-h-11" disabled={disabled || !versionId || !sequenceInstruction.trim()}>
                  Generar {followUpCount} {followUpCount === 1 ? 'seguimiento' : 'seguimientos'}
                </Button>
              </div>
            </form>
          </Card>
        )}
        {disabledReason ? <p id="follow-up-disabled-reason" className="mt-3 text-center text-xs leading-5 text-muted-foreground">{disabledReason}</p> : null}
      </div>
    );
  }

  const offsets = plan.steps.map((step) => step.offsetDays);
  const canStopPlan = ['pending_initial_send', 'active'].includes(plan.enrollmentState);
  const planReadOnly = ['completed', 'stopped', 'blocked'].includes(plan.enrollmentState);
  const generatedSteps = plan.steps.filter((step) => Boolean(step.draft));

  return (
    <>
      <div className={cn('flex flex-col items-center', className)}>
        <div className="h-8 w-px bg-border/70" aria-hidden="true" />
        <Card className="w-full overflow-hidden border-border/60 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.32)]">
          <div className="flex flex-col gap-4 border-b border-border/60 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 ref={sequenceHeadingRef} tabIndex={-1} className="text-base font-semibold tracking-[-0.01em] outline-none">Seguimientos</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{stateLabel(plan.enrollmentState)} · {plan.steps.length} {plan.steps.length === 1 ? 'correo' : 'correos'}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => openNote({ kind: 'all', label: 'Toda la secuencia' })}
              disabled={disabled || planReadOnly || generatedSteps.length === 0 || applyingNote}
            >
              <Sparkles aria-hidden="true" /> Toda la secuencia
            </Button>
          </div>
          {disabledReason ? <p className="border-b border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">{disabledReason}</p> : null}

          <ol className="divide-y divide-border/60">
            {plan.steps.map((step, index) => {
              const editor = editors[step.id];
              const dirty = isEditorDirty(editor);
              const retrying = Boolean(retryingStepIds[step.id]);
              const busy = Boolean(editor?.saving || retrying || applyingNote);
              const day = cumulativeDays(offsets, index);
              const subjectId = `follow-up-subject-${step.id}`;
              const bodyId = `follow-up-body-${step.id}`;
              const feedbackId = `follow-up-feedback-${step.id}`;

              return (
                <li key={step.id} className="px-4 py-6 sm:px-5" aria-busy={busy}>
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/30 text-sm font-semibold" aria-hidden="true">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold">{step.name}</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">Día {day} · {step.offsetDays} {step.offsetDays === 1 ? 'día' : 'días'} después del correo anterior{approvalLabel(step) ? ` · ${approvalLabel(step)}` : ''}</p>
                    </div>
                  </div>

                  {step.draftGeneration.status === 'error' || !step.draft || !editor ? (
                    <div className="mt-5 rounded-xl border border-rose-400/60 bg-rose-50/70 px-4 py-4 dark:border-rose-500/50 dark:bg-rose-500/10" role="alert">
                      <p className="text-sm font-medium text-rose-800 dark:text-rose-200">No pudimos generar este correo</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{retryErrors[step.id] || step.draftGeneration.error || 'El borrador no está disponible.'}</p>
                      <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => void retryDraft(step.id)} disabled={disabled || planReadOnly || retrying}>
                        {retrying ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                        {retrying ? 'Generando…' : 'Reintentar generación'}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-5">
                      <div className="space-y-2">
                        <Label htmlFor={subjectId} className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Asunto</Label>
                        <Input
                          id={subjectId}
                          value={editor.subject}
                          maxLength={998}
                          onChange={(event) => setEditorState(step.id, { subject: event.target.value, error: null, feedback: null })}
                          className="h-11 border-slate-400 dark:border-slate-500"
                          disabled={disabled || planReadOnly || busy || step.draft.lifecycle === 'archived'}
                          aria-describedby={feedbackId}
                          aria-invalid={Boolean(editor.error && !editor.subject.trim())}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={bodyId} className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Mensaje</Label>
                        <Textarea
                          id={bodyId}
                          value={editor.body}
                          maxLength={100_000}
                          rows={9}
                          onChange={(event) => setEditorState(step.id, { body: event.target.value, error: null, feedback: null })}
                          className="min-h-52 resize-y border-slate-400 text-[15px] leading-7 dark:border-slate-500"
                          disabled={disabled || planReadOnly || busy || step.draft.lifecycle === 'archived'}
                          aria-describedby={feedbackId}
                          aria-invalid={Boolean(editor.error && !editor.body.trim())}
                        />
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div id={feedbackId} className="min-h-5 text-xs leading-5" aria-live="polite">
                          {editor.error ? <span className="text-rose-700 dark:text-rose-300">{editor.error}</span> : null}
                          {!editor.error && editor.feedback ? <span className="text-emerald-700 dark:text-emerald-300">{editor.feedback}</span> : null}
                          {!editor.error && !editor.feedback && dirty ? <span className="text-amber-700 dark:text-amber-300">Cambios sin guardar</span> : null}
                        </div>
                        <div className="flex flex-col-reverse gap-2 sm:flex-row">
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11"
                            onClick={() => openNote({ kind: 'step', stepId: step.id, label: `${step.name} · Día ${day}` })}
                            disabled={disabled || planReadOnly || busy || step.draft.lifecycle === 'archived'}
                          >
                            <Sparkles aria-hidden="true" /> Nota para IA
                          </Button>
                          <Button
                            type="button"
                            variant={dirty ? 'default' : 'outline'}
                            className="min-h-11"
                            onClick={() => void saveDraft(step.id)}
                            disabled={disabled || planReadOnly || busy || !dirty || step.draft.lifecycle === 'archived'}
                          >
                            {editor.saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save aria-hidden="true" />}
                            {editor.saving ? 'Guardando…' : 'Guardar cambios'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {planFeedback || canStopPlan ? (
            <div className="border-t border-border/60 px-4 py-4 sm:px-5">
              {planFeedback ? (
                <p className="mb-3 text-sm leading-6 text-muted-foreground" role="status">{planFeedback}</p>
              ) : null}
              {canStopPlan ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                  onClick={() => {
                    setStopError(null);
                    if (hasDirtyEditors) {
                      setPlanFeedback('Guarda los cambios pendientes antes de detener los seguimientos.');
                      return;
                    }
                    setStopConfirmOpen(true);
                  }}
                  disabled={disabled || stopping || applyingNote}
                >
                  <CircleStop aria-hidden="true" /> Detener seguimientos
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      <Sheet
        open={Boolean(noteTarget)}
        onOpenChange={(open) => {
          if (!open) setNoteTarget(null);
        }}
      >
        <SheetContent
          side="bottom"
          className="flex max-h-[92dvh] w-full flex-col gap-0 rounded-t-2xl p-0 sm:inset-x-auto sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-full sm:max-w-lg sm:rounded-none sm:border-l sm:border-t-0 [&>button]:right-2.5 [&>button]:top-2.5 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center"
        >
          <SheetHeader className="border-b border-border/60 px-5 py-5 pr-14 sm:px-6">
            <SheetTitle>Nota para IA</SheetTitle>
            <SheetDescription className="leading-6">
              {noteTarget?.kind === 'all'
                ? 'Aplicaremos la nota, uno por uno, a todos los seguimientos. El correo inicial no cambiará.'
                : `Aplicaremos la nota a ${noteTarget?.label || 'este seguimiento'}.`}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Correo objetivo</p>
              <p className="mt-1 text-sm font-medium">{noteTarget?.label}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="follow-up-ai-note">Qué quieres cambiar</Label>
              <Textarea
                id="follow-up-ai-note"
                value={noteInstruction}
                onChange={(event) => { setNoteInstruction(event.target.value); setNoteError(null); setNoteSuccess(null); }}
                onKeyDown={handleNoteKeyDown}
                rows={7}
                maxLength={1_000}
                placeholder="Ej. hazlo más directo y añade una pregunta fácil de responder."
                className="min-h-40 resize-y border-slate-400 text-[15px] leading-6 dark:border-slate-500"
                disabled={applyingNote}
                required
                aria-required="true"
                aria-describedby="follow-up-ai-note-hint"
                autoFocus
              />
              <p id="follow-up-ai-note-hint" className="text-xs leading-5 text-muted-foreground">Pulsa ⌘/Ctrl + Enter para aplicar el cambio.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="follow-up-note-style">Estilo <span className="font-normal text-muted-foreground">(opcional)</span></Label>
              <Select
                value={noteStyleProfileId || USE_INITIAL_STYLE}
                onValueChange={(value) => setNoteStyleProfileId(value === USE_INITIAL_STYLE ? '' : value)}
                disabled={applyingNote || selectableStyleProfiles.length === 0}
              >
                <SelectTrigger id="follow-up-note-style" className="h-11 border-slate-400 dark:border-slate-500">
                  <SelectValue placeholder="Conservar el estilo actual" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={USE_INITIAL_STYLE} className="min-h-11">Conservar el estilo actual</SelectItem>
                  {selectableStyleProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id!} className="min-h-11">{profile.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div aria-live="polite" className="space-y-3">
              {noteProgress ? <p className="text-sm text-muted-foreground" role="status">{noteProgress}</p> : null}
              {noteSuccess ? (
                <Alert className="border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  <AlertTitle>Cambio aplicado</AlertTitle>
                  <AlertDescription>{noteSuccess}</AlertDescription>
                </Alert>
              ) : null}
              {noteError ? (
                <Alert variant="destructive">
                  <AlertTitle>No se completó el cambio</AlertTitle>
                  <AlertDescription>{noteError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </div>

          <SheetFooter className="border-t border-border/60 bg-background px-5 py-4 sm:px-6">
            <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => void applyAiNote()} disabled={applyingNote || !noteInstruction.trim()}>
              {applyingNote ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
              {applyingNote ? 'Aplicando…' : 'Aplicar cambio'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={stopConfirmOpen}
        onOpenChange={(open) => {
          setStopConfirmOpen(open);
          if (open) setStopError(null);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Detener estos seguimientos?</AlertDialogTitle>
            <AlertDialogDescription className="leading-6">Los correos pendientes no se prepararán ni enviarán. Los mensajes ya enviados no cambiarán.</AlertDialogDescription>
          </AlertDialogHeader>
          {stopError ? (
            <Alert variant="destructive">
              <AlertTitle>No pudimos detenerlos</AlertTitle>
              <AlertDescription>{stopError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="min-h-11" disabled={stopping}>Conservar seguimientos</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={stopping}
              onClick={(event) => { event.preventDefault(); void stopPlan(); }}
            >
              {stopping ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CircleStop aria-hidden="true" />}
              {stopping ? 'Deteniendo…' : 'Detener seguimientos'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
