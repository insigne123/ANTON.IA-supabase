'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { KanbanBoard } from '@/components/crm/KanbanBoard';
import { buildUnifiedRows } from '@/lib/unified-sheet-data';
import { unifiedSheetService } from '@/lib/services/unified-sheet-service';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import type { PipelineStage } from '@/lib/crm-types';
import { useToast } from '@/hooks/use-toast';
import { RotateCw, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { SmartAlerts } from '@/components/crm/SmartAlerts';

import { LeadDetailDrawer } from '@/components/crm/LeadDetailDrawer';

export default function CRMPage() {
    const { toast } = useToast();
    const [rows, setRows] = useState<UnifiedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedLead, setSelectedLead] = useState<UnifiedRow | null>(null);

    // Todo: Switcher for List View vs Board View (future)
    const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
    const [focusMode, setFocusMode] = useState(false); // New Focus Mode state

    async function loadData() {
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
    }

    useEffect(() => {
        loadData();
    }, []);

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

    return (
        <div className="flex flex-col h-[calc(100vh-65px)] overflow-hidden">
            <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-4 pb-2">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">CRM / Pipeline</h1>
                        <p className="text-sm text-muted-foreground">Gestiona tus leads visualmente y toma acción.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" disabled>
                            <List className="h-4 w-4 mr-2" /> Lista
                        </Button>
                        <Button
                            variant={focusMode ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFocusMode(!focusMode)}
                            className={focusMode ? "bg-purple-600 hover:bg-purple-700" : ""}
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

            <SmartAlerts leads={rows} />
            <div className="flex-1 overflow-hidden">
                {loading && rows.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">Cargando pipeline...</div>
                ) : (
                    <KanbanBoard
                        leads={rows}
                        onLeadMove={handleLeadMove}
                        onLeadClick={handleLeadClick}
                        focusMode={focusMode} // Pass default focus props
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
