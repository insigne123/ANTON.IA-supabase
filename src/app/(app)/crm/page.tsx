'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { KanbanBoard } from '@/components/crm/KanbanBoard';
import { buildUnifiedRows } from '@/lib/unified-sheet-data';
import { unifiedSheetService } from '@/lib/services/unified-sheet-service';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import type { PipelineStage } from '@/lib/crm-types';
import { useToast } from '@/hooks/use-toast';
import { RotateCw, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { SmartAlerts } from '@/components/crm/SmartAlerts';

import { LeadDetailDrawer } from '@/components/crm/LeadDetailDrawer';

export default function CRMPage() {
    const { toast } = useToast();
    const [rows, setRows] = useState<UnifiedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedLead, setSelectedLead] = useState<UnifiedRow | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    // Todo: Switcher for List View vs Board View (future)
    const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
    const [focusMode, setFocusMode] = useState(false); // New Focus Mode state
    const [focusedStage, setFocusedStage] = useState<PipelineStage>('contacted'); // Default for Focus Mode

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await buildUnifiedRows();
            setRows(data);
        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Error cargando CRM' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleLeadMove = async (leadId: string, newStage: PipelineStage) => {
        // 1. Optimistic Update
        setRows(prev => prev.map(r =>
            r.gid === leadId
                ? { ...r, stage: newStage }
                : r
        ));

        // 2. Persist
        try {
            await unifiedSheetService.setCustom(leadId, { stage: newStage });
        } catch (e) {
            console.error('Error saving stage:', e);
            toast({ variant: 'destructive', title: 'Error al guardar cambio' });
            // Revert? (Optional, usually strict revert is better but complex for brevity here)
        }
    };

    const handleLeadClick = (lead: UnifiedRow) => {
        setSelectedLead(lead);
    };

    const stageSummary = {
        contacted: rows.filter((row) => row.stage === 'contacted').length,
        engaged: rows.filter((row) => row.stage === 'engaged').length,
        meeting: rows.filter((row) => row.stage === 'meeting').length,
        closedLost: rows.filter((row) => row.stage === 'closed_lost').length,
        automated: rows.filter((row) => Boolean(row.lastAutopilotEvent || row.autopilotStatus)).length,
    };

    return (
        <div className="flex flex-col h-[calc(100vh-65px)] overflow-hidden">
            <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-4 pb-2">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">CRM / Pipeline</h1>
                        <p className="text-sm text-muted-foreground">Gestiona tus leads visualmente y toma acción.</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <Badge variant="outline">Automatización por eventos activa</Badge>
                            {focusMode ? <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Modo foco en {focusedStage}</Badge> : null}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" disabled>
                            <List className="h-4 w-4 mr-2" /> Lista
                        </Button>
                        <Button
                            variant={focusMode ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFocusMode(!focusMode)}
                            className={focusMode ? "bg-amber-600 hover:bg-amber-700" : ""}
                        >
                            {focusMode ? '🎯 Modo Normal' : '🎯 Modo Foco'}
                        </Button>
                        <Button variant="secondary" size="sm">
                            <LayoutGrid className="h-4 w-4 mr-2" /> Tablero
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => loadData()}>
                            <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Smart Alerts */}
            <div className="mb-6">
                <SmartAlerts
                    leads={rows}
                    onAlertClick={(stage) => {
                        setFocusedStage(stage as PipelineStage);
                        setFocusMode(true);
                    }}
                />
            </div>

            <div className="mb-4 grid gap-3 px-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-xl border bg-background p-4">
                    <div className="text-xs uppercase text-muted-foreground">Contactados</div>
                    <div className="mt-1 text-2xl font-semibold">{stageSummary.contacted}</div>
                </div>
                <div className="rounded-xl border bg-background p-4">
                    <div className="text-xs uppercase text-muted-foreground">Engaged</div>
                    <div className="mt-1 text-2xl font-semibold">{stageSummary.engaged}</div>
                </div>
                <div className="rounded-xl border bg-background p-4">
                    <div className="text-xs uppercase text-muted-foreground">Meeting</div>
                    <div className="mt-1 text-2xl font-semibold">{stageSummary.meeting}</div>
                </div>
                <div className="rounded-xl border bg-background p-4">
                    <div className="text-xs uppercase text-muted-foreground">Closed lost</div>
                    <div className="mt-1 text-2xl font-semibold">{stageSummary.closedLost}</div>
                </div>
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <div className="text-xs uppercase text-muted-foreground">Movidos por ANTONIA</div>
                    <div className="mt-1 text-2xl font-semibold">{stageSummary.automated}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Se actualizan automaticamente segun envio, aperturas, clicks y replies.</div>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="flex-1 min-h-0">
                {loading && rows.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">Cargando pipeline...</div>
                ) : (
                    <KanbanBoard
                        leads={rows}
                        onLeadMove={handleLeadMove}
                        onLeadClick={handleLeadClick}
                        focusMode={focusMode}
                        setFocusMode={setFocusMode}
                        focusedStage={focusedStage}
                        setFocusedStage={setFocusedStage}
                    />
                )}
            </div>

            <LeadDetailDrawer
                lead={selectedLead}
                open={!!selectedLead}
                onOpenChange={(v) => !v && setSelectedLead(null)}
            />
        </div>
    );
}
