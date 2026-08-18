'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Focus, Loader2, RefreshCw, Sparkles } from 'lucide-react';

import { KanbanBoard } from '@/components/crm/KanbanBoard';
import { LeadDetailDrawer } from '@/components/crm/LeadDetailDrawer';
import { SmartAlerts } from '@/components/crm/SmartAlerts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { PipelineStage } from '@/lib/crm-types';
import { unifiedSheetService } from '@/lib/services/unified-sheet-service';
import { buildUnifiedRows } from '@/lib/unified-sheet-data';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

export default function CRMPage() {
    const { toast } = useToast();
    const [rows, setRows] = useState<UnifiedRow[]>([]);
    const rowsRef = useRef<UnifiedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
    const [focusMode, setFocusMode] = useState(false);
    const [focusedStage, setFocusedStage] = useState<PipelineStage>('contacted');
    const [movingLeadIds, setMovingLeadIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);

    const loadData = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await buildUnifiedRows();
            rowsRef.current = data;
            setRows(data);
        } catch (error) {
            console.error('[crm] load error', error);
            setLoadError('No pudimos cargar el pipeline. Revisa tu conexión e inténtalo de nuevo.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

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

    return (
        <div className="flex h-[calc(100dvh-5rem)] min-h-[480px] min-w-0 flex-col overflow-hidden bg-background md:h-[calc(100dvh-5.5rem)]">
            <header className="border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
                        <p className="mt-0.5 text-sm text-muted-foreground">Prioriza oportunidades y mueve cada lead a su siguiente etapa.</p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Sparkles className="h-3.5 w-3.5" />
                            Las etapas pueden actualizarse cuando se registran eventos de contacto; revisa cada cambio antes de actuar.
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button
                            variant={focusMode ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => setFocusMode((current) => !current)}
                            aria-pressed={focusMode}
                        >
                            <Focus className="h-4 w-4" /> {focusMode ? 'Ver todo' : 'Enfocar etapa'}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => void loadData()} disabled={loading} aria-label="Actualizar pipeline">
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </div>
            </header>

            {!loading && <SmartAlerts leads={rows} onAlertClick={(stage) => { setFocusedStage(stage); setFocusMode(true); }} />}

            {loadError && (
                <Alert variant="destructive" className="m-4 mb-0 w-auto">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Pipeline no disponible</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{loadError}</span><Button variant="outline" size="sm" onClick={() => void loadData()}>Reintentar</Button></AlertDescription>
                </Alert>
            )}

            <main className="min-h-0 flex-1">
                {loading && rows.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Cargando pipeline…
                    </div>
                ) : rows.length === 0 && !loadError ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                        <p className="font-medium">Aún no hay leads en el pipeline</p>
                        <p className="max-w-sm text-sm text-muted-foreground">Cuando guardes o contactes leads, aparecerán aquí para que puedas organizar su avance.</p>
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
            </main>

            <LeadDetailDrawer
                lead={selectedLead}
                open={Boolean(selectedLead)}
                onOpenChange={(open) => { if (!open) setSelectedLeadId(null); }}
            />
        </div>
    );
}
