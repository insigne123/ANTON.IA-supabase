'use client';

import { useMemo, useState } from 'react';
import {
    closestCorners,
    defaultDropAnimationSideEffects,
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    DropAnimation,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PIPELINE_STAGES, type PipelineStage } from '@/lib/crm-types';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import { KanbanColumn } from './KanbanColumn';
import { LeadCard } from './LeadCard';

interface Props {
    leads: UnifiedRow[];
    onLeadMove: (leadId: string, newStage: PipelineStage) => void;
    onLeadClick: (lead: UnifiedRow) => void;
    movingLeadIds?: Set<string>;
    focusMode?: boolean;
    setFocusMode?: (mode: boolean) => void;
    focusedStage?: PipelineStage;
    setFocusedStage?: (stage: PipelineStage) => void;
}

const CLOSED_STAGES = new Set<PipelineStage>(['closed_won', 'closed_lost']);

function normalizedStage(lead: UnifiedRow): PipelineStage {
    return PIPELINE_STAGES.some((stage) => stage.id === lead.stage) ? lead.stage as PipelineStage : 'inbox';
}

export function KanbanBoard({
    leads,
    onLeadMove,
    onLeadClick,
    movingLeadIds = new Set(),
    focusMode = false,
    setFocusMode,
    focusedStage: controlledFocusedStage,
    setFocusedStage: setControlledFocusedStage,
}: Props) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const [localFocusedStage, setLocalFocusedStage] = useState<PipelineStage>('contacted');
    const focusedStage = controlledFocusedStage ?? localFocusedStage;
    const setFocusedStage = setControlledFocusedStage ?? setLocalFocusedStage;

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const columns = useMemo(() => {
        const map = new Map<PipelineStage, UnifiedRow[]>();
        PIPELINE_STAGES.forEach((stage) => map.set(stage.id, []));
        leads.forEach((lead) => map.get(normalizedStage(lead))?.push(lead));
        map.forEach((items) => items.sort((a, b) => {
            const aDue = a.nextActionDueAt ? new Date(a.nextActionDueAt).getTime() : Number.POSITIVE_INFINITY;
            const bDue = b.nextActionDueAt ? new Date(b.nextActionDueAt).getTime() : Number.POSITIVE_INFINITY;
            if (aDue !== bDue) return aDue - bDue;
            return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
        }));
        return map;
    }, [leads]);

    const activeLead = useMemo(() => leads.find((lead) => lead.gid === activeId), [activeId, leads]);
    const visibleStages = focusMode
        ? PIPELINE_STAGES.filter((stage) => stage.id === focusedStage)
        : PIPELINE_STAGES;

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        setActiveId(null);
        if (!over) return;

        const leadId = active.id as string;
        const overId = over.id as string;
        const targetStage = PIPELINE_STAGES.some((stage) => stage.id === overId)
            ? overId as PipelineStage
            : normalizedStage(leads.find((lead) => lead.gid === overId) || {} as UnifiedRow);
        const lead = leads.find((item) => item.gid === leadId);
        if (lead && normalizedStage(lead) !== targetStage) onLeadMove(leadId, targetStage);
    }

    const dropAnimation: DropAnimation = {
        sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }),
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={(event: DragStartEvent) => setActiveId(event.active.id as string)}
            onDragCancel={() => setActiveId(null)}
            onDragEnd={handleDragEnd}
        >
            <div className="flex h-full min-h-0 flex-col">
                {focusMode && (
                    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-4 py-2">
                        <span className="text-xs font-medium text-muted-foreground">Etapa prioritaria</span>
                        <Select value={focusedStage} onValueChange={(value) => setFocusedStage(value as PipelineStage)}>
                            <SelectTrigger className="h-8 w-44 bg-background"><SelectValue /></SelectTrigger>
                            <SelectContent>{PIPELINE_STAGES.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button variant="ghost" size="sm" className="h-8" onClick={() => setFocusMode?.(false)}>Ver pipeline completo</Button>
                    </div>
                )}

                <div className="flex h-full min-h-0 items-stretch gap-3 overflow-x-auto overscroll-x-contain bg-muted/10 p-3 sm:p-4">
                    {visibleStages.map((stage, index) => {
                        const closed = CLOSED_STAGES.has(stage.id);
                        const showClosedDivider = !focusMode && closed && index > 0 && !CLOSED_STAGES.has(visibleStages[index - 1].id);
                        return (
                            <div key={stage.id} className="flex h-full items-stretch gap-3">
                                {showClosedDivider && <div className="my-2 w-px shrink-0 bg-border" aria-hidden="true" />}
                                <KanbanColumn
                                    id={stage.id}
                                    title={stage.label}
                                    count={columns.get(stage.id)?.length || 0}
                                    leads={columns.get(stage.id) || []}
                                    closed={closed}
                                    movingLeadIds={movingLeadIds}
                                    onLeadClick={onLeadClick}
                                    onLeadMove={onLeadMove}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            <DragOverlay dropAnimation={dropAnimation}>
                {activeLead ? <div className="w-[280px]"><LeadCard lead={activeLead} /></div> : null}
            </DragOverlay>
        </DndContext>
    );
}
