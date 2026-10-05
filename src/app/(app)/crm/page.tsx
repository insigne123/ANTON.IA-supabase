'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, BarChart3, Focus, LayoutGrid, Loader2, RefreshCw, Sparkles, Workflow } from 'lucide-react';

import { KanbanBoard } from '@/components/crm/KanbanBoard';
import { PipelineDashboard } from '@/components/crm/PipelineDashboard';
import { LeadDetailDrawer } from '@/components/crm/LeadDetailDrawer';
import { SmartAlerts } from '@/components/crm/SmartAlerts';
import { StageSuggestions } from '@/components/crm/StageSuggestions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DocumentTitle } from '@/components/document-title';
import Link from 'next/link';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { PIPELINE_STAGES, type PipelineStage } from '@/lib/crm-types';
import { stageDecisionNotice, type CrmStageSuggestion } from '@/lib/crm-stage-suggestions';
import { flowStage } from '@/lib/pipeline-flow';
import { unifiedSheetService } from '@/lib/services/unified-sheet-service';
import { loadUnifiedRows, unifiedFailureText } from '@/lib/unified-sheet-data';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

export default function CRMPage() {
    const { toast } = useToast();
    const [rows, setRows] = useState<UnifiedRow[]>([]);
    const rowsRef = useRef<UnifiedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    // Some reads failed but others answered: the board shows what it has and says what is missing.
    const [partialError, setPartialError] = useState<string | null>(null);
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
    const [focusMode, setFocusMode] = useState(false);
    const [focusedStage, setFocusedStage] = useState<PipelineStage>('contacted');
    const [movingLeadIds, setMovingLeadIds] = useState<Set<string>>(new Set());
    const [suggestions, setSuggestions] = useState<CrmStageSuggestion[]>([]);
    const [deciding, setDeciding] = useState(false);
    // «Panel» is the CRM dashboard (Plan 11, PR 4a; it replaces the flow graph of Plan 5); «Tablero» is the board to move
    // leads. The choice is remembered. null until it is read, so the toggle never shows «Panel» and then jumps to «Tablero».
    const [view, setView] = useState<'panel' | 'board' | null>(null);
    const [openStage, setOpenStage] = useState<PipelineStage | null>(null);
    const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
    useEffect(() => {
        let stored: 'panel' | 'board' = 'panel';
        try { if (window.localStorage.getItem('anton.crm.view') === 'board') stored = 'board'; } catch { /* storage unavailable */ }
        setView(stored);
    }, []);
    function chooseView(next: 'panel' | 'board') {
        setView(next);
        try { window.localStorage.setItem('anton.crm.view', next); } catch { /* storage unavailable */ }
    }

    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);

    // `silent` is the automatic refresh: it keeps the current render (no spinner, no error banner for a passing failure).
    const loadData = useCallback(async (silent = false) => {
        if (!silent) {
            setLoading(true);
            setLoadError(null);
            setPartialError(null);
        }
        try {
            const { rows: data, failed } = await loadUnifiedRows();
            // The automatic refresh keeps the last good render when a read fails, instead of emptying the board.
            if (silent && failed.length) return;
            // Nothing could be read: that is an error, not an empty pipeline.
            if (failed.length && !data.length) {
                setLoadError('No pudimos cargar el pipeline. Revisa tu conexión e inténtalo de nuevo.');
                return;
            }
            rowsRef.current = data;
            setRows(data);
            setRefreshedAt(Date.now());
            setPartialError(failed.length ? `${unifiedFailureText(failed)} Lo que ves puede estar incompleto.` : null);
        } catch (error) {
            console.error('[crm] load error', error);
            if (!silent) setLoadError('No pudimos cargar el pipeline. Revisa tu conexión e inténtalo de nuevo.');
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    // Stage suggestions (Plan 5, PR-10): events propose, the person confirms. If they cannot be read, the board still works.
    const loadSuggestions = useCallback(async () => {
        try {
            const response = await fetch('/api/crm/stage-suggestions', { cache: 'no-store' });
            const data = response.ok ? await response.json() : null;
            setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
        } catch {
            setSuggestions([]);
        }
    }, []);

    useEffect(() => {
        void loadData();
        void loadSuggestions();
    }, [loadData, loadSuggestions]);

    // Automatic: while the page is visible and nobody is moving a lead, it rereads every minute and when the person comes
    // back to the tab, so the panel follows sends, replies and accepted suggestions without a reload.
    const busyRef = useRef(false);
    useEffect(() => { busyRef.current = movingLeadIds.size > 0 || deciding; }, [movingLeadIds, deciding]);
    useEffect(() => {
        const refresh = () => {
            if (document.visibilityState !== 'visible' || busyRef.current) return;
            void loadData(true);
            void loadSuggestions();
        };
        const timer = window.setInterval(refresh, 60_000);
        document.addEventListener('visibilitychange', refresh);
        return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [loadData, loadSuggestions]);

    async function decideSuggestions(ids: string[], decision: 'accept' | 'dismiss') {
        if (!ids.length || deciding) return;
        setDeciding(true);
        try {
            const response = await fetch('/api/crm/stage-suggestions', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, decision }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'No pudimos guardar tu decisión.');
            toast({ title: decision === 'accept' ? 'Pipeline actualizado' : 'Sugerencias descartadas', description: stageDecisionNotice(data) });
            await Promise.all([loadData(), loadSuggestions()]);
        } catch (error) {
            toast({ variant: 'destructive', title: 'No se guardó la decisión', description: (error as Error).message });
        } finally {
            setDeciding(false);
        }
    }

    async function handleLeadMove(leadId: string, newStage: PipelineStage) {
        const previousStage = rowsRef.current.find((row) => row.gid === leadId)?.stage;
        if (previousStage === newStage || movingLeadIds.has(leadId)) return;

        setMovingLeadIds((current) => new Set(current).add(leadId));
        rowsRef.current = rowsRef.current.map((row) => row.gid === leadId ? { ...row, stage: newStage } : row);
        setRows((current) => current.map((row) => row.gid === leadId ? { ...row, stage: newStage } : row));

        try {
            await unifiedSheetService.setCustom(leadId, { stage: newStage });
        } catch (error) {
            console.error('[crm] stage save error', error);
            rowsRef.current = rowsRef.current.map((row) => row.gid === leadId ? { ...row, stage: previousStage } : row);
            setRows((current) => current.map((row) => row.gid === leadId ? { ...row, stage: previousStage } : row));
            toast({
                variant: 'destructive',
                title: 'No se guardó el cambio de etapa',
                description: 'Restauramos la etapa anterior para mantener el pipeline consistente.',
            });
        } finally {
            setMovingLeadIds((current) => {
                const next = new Set(current);
                next.delete(leadId);
                return next;
            });
        }
    }

    const selectedLead = rows.find((row) => row.gid === selectedLeadId) ?? null;
    const stageRows = openStage ? rows.filter((row) => flowStage(row) === openStage) : [];
    const pendingByStage = suggestions.reduce<Partial<Record<PipelineStage, number>>>((counts, suggestion) => ({
        ...counts, [suggestion.to_stage]: (counts[suggestion.to_stage] || 0) + 1,
    }), {});

    return (
        <div className="flex h-[calc(100dvh-5rem)] min-h-[480px] min-w-0 flex-col overflow-hidden bg-background md:h-[calc(100dvh-5.5rem)]">
            <header className="border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <DocumentTitle title="Pipeline" />
                        <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
                        <p className="mt-0.5 text-sm text-foreground/70">Prioriza oportunidades y mueve cada lead a su siguiente etapa.</p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-foreground/70">
                            <Sparkles className="h-3.5 w-3.5" />
                            Los envíos y las respuestas proponen cambios de etapa; nada se mueve hasta que los aceptes.
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <div role="group" aria-label="Vista del pipeline" className="flex rounded-full border p-0.5">
                            <Button size="sm" variant={view === 'panel' ? 'secondary' : 'ghost'} className="rounded-full" aria-pressed={view === 'panel'} onClick={() => chooseView('panel')}>
                                <BarChart3 className="h-4 w-4" /> Panel
                            </Button>
                            <Button size="sm" variant={view === 'board' ? 'secondary' : 'ghost'} className="rounded-full" aria-pressed={view === 'board'} onClick={() => chooseView('board')}>
                                <LayoutGrid className="h-4 w-4" /> Tablero
                            </Button>
                        </div>
                        {view === 'board' && <Button
                            variant={focusMode ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => setFocusMode((current) => !current)}
                            aria-pressed={focusMode}
                        >
                            <Focus className="h-4 w-4" /> {focusMode ? 'Ver todo' : 'Enfocar etapa'}
                        </Button>}
                        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => void loadData()} disabled={loading} aria-label="Actualizar pipeline">
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </div>
            </header>

            {!loading && <SmartAlerts leads={rows} onAlertClick={(stage) => { setFocusedStage(stage); setFocusMode(true); chooseView('board'); }} />}

            <StageSuggestions
                suggestions={suggestions}
                busy={deciding}
                nameFor={(crmId) => rows.find((row) => row.gid === crmId)?.name || 'Contacto'}
                onDecide={(ids, decision) => void decideSuggestions(ids, decision)}
            />

            {loadError && (
                <Alert variant="destructive" className="m-4 mb-0 w-auto">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Pipeline no disponible</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{loadError}</span><Button variant="outline" size="sm" onClick={() => void loadData()}>Reintentar</Button></AlertDescription>
                </Alert>
            )}
            {!loadError && partialError && (
                <Alert variant="warning" className="m-4 mb-0 w-auto">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Faltan datos</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{partialError}</span><Button variant="outline" size="sm" onClick={() => void loadData()}>Reintentar</Button></AlertDescription>
                </Alert>
            )}

            <div data-tour="crm-board" className="min-h-0 flex-1">
                {loading && rows.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Cargando pipeline…
                    </div>
                ) : rows.length === 0 && !loadError ? (
                    <EmptyState
                        className="h-full max-w-none justify-center"
                        icon={Workflow}
                        title="Aún no hay leads en el pipeline"
                        description="Cuando guardes o contactes leads, aparecerán aquí para que organices su avance."
                        action={<div className="flex flex-wrap justify-center gap-2"><Button asChild size="sm"><Link href="/search">Buscar prospectos</Link></Button><Button asChild size="sm" variant="outline"><Link href="/saved/leads/enriched">Ir a «Por escribir»</Link></Button></div>}
                    />
                ) : view !== 'board' ? (
                    <div className="h-full overflow-y-auto">
                        <PipelineDashboard rows={rows} onOpenStage={setOpenStage} pending={pendingByStage} refreshedAt={refreshedAt} />
                    </div>
                ) : (
                    <KanbanBoard
                        leads={rows}
                        onLeadMove={(leadId, stage) => void handleLeadMove(leadId, stage)}
                        onLeadClick={(lead) => setSelectedLeadId(lead.gid)}
                        movingLeadIds={movingLeadIds}
                        focusMode={focusMode}
                        setFocusMode={setFocusMode}
                        focusedStage={focusedStage}
                        setFocusedStage={setFocusedStage}
                    />
                )}
            </div>

            <Sheet open={Boolean(openStage)} onOpenChange={(open) => { if (!open) setOpenStage(null); }}>
                <SheetContent className="w-full overflow-y-auto sm:max-w-md">
                    <SheetHeader>
                        <SheetTitle>{PIPELINE_STAGES.find((stage) => stage.id === openStage)?.label || 'Etapa'}</SheetTitle>
                        <SheetDescription>{stageRows.length} {stageRows.length === 1 ? 'lead' : 'leads'} en esta etapa. Toca uno para ver su detalle.</SheetDescription>
                    </SheetHeader>
                    {stageRows.length ? <ul className="mt-4 space-y-1.5">
                        {stageRows.map((lead) => <li key={lead.gid}>
                            <button type="button" onClick={() => setSelectedLeadId(lead.gid)}
                                className="w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <span className="block truncate font-medium">{lead.name || lead.email || 'Sin nombre'}</span>
                                <span className="block truncate text-xs text-muted-foreground">{[lead.title, lead.company].filter(Boolean).join(' · ') || 'Sin cargo ni empresa'}</span>
                            </button>
                        </li>)}
                    </ul> : <p className="mt-4 text-sm text-muted-foreground">Aún no hay leads en esta etapa.</p>}
                </SheetContent>
            </Sheet>

            <LeadDetailDrawer
                lead={selectedLead}
                open={Boolean(selectedLead)}
                onOpenChange={(open) => { if (!open) setSelectedLeadId(null); }}
            />
        </div>
    );
}
