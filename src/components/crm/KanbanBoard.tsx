'use client';

import { useState, useMemo } from 'react';
import {
    DndContext,
    DragOverlay,
    closestCorners,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragStartEvent,
    DragOverEvent,
    DragEndEvent,
    defaultDropAnimationSideEffects,
    DragOverlayProps,
    DropAnimation
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { KanbanColumn } from './KanbanColumn';
import { LeadCard } from './LeadCard';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import { PIPELINE_STAGES, PipelineStage } from '@/lib/crm-types';

interface Props {
    leads: UnifiedRow[];
    onLeadMove: (leadId: string, newStage: PipelineStage) => void;
    onLeadClick: (lead: UnifiedRow) => void;
    focusMode?: boolean;
}

export function KanbanBoard({ leads, onLeadMove, onLeadClick, focusMode = false }: Props) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const [focusedStage, setFocusedStage] = useState<PipelineStage>('contacted'); // Default focus

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // Group leads by stage
    const columns = useMemo(() => {
        const map = new Map<PipelineStage, UnifiedRow[]>();
        PIPELINE_STAGES.forEach(s => map.set(s.id, []));

        leads.forEach(lead => {
            // Default to 'inbox' if no stage or invalid stage
            const stage = (lead.stage && map.has(lead.stage as PipelineStage))
                ? (lead.stage as PipelineStage)
                : 'inbox';
            map.get(stage)?.push(lead);
        });
        return map;
    }, [leads]);

    const activeLead = useMemo(() =>
        leads.find(l => l.gid === activeId),
        [activeId, leads]);

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        const activeLeadId = active.id as string;
        const overId = over.id as string;

        // Check if dropped on a column (stage)
        // Note: over.id could be a column ID (PipelineStage) or another Card ID (string)

        let newStage: PipelineStage | null = null;

        // Is overId a stage?
        if (PIPELINE_STAGES.some(s => s.id === overId)) {
            newStage = overId as PipelineStage;
        } else {
            // Must be dropped over another card, find that card's stage
            const overLead = leads.find(l => l.gid === overId);
            if (overLead) {
                const s = overLead.stage as PipelineStage;
                newStage = PIPELINE_STAGES.some(st => st.id === s) ? s : 'inbox';
            }
        }

        if (newStage) {
            onLeadMove(activeLeadId, newStage);
        }
    };

    const dropAnimation: DropAnimation = {
        sideEffects: defaultDropAnimationSideEffects({
            styles: {
                active: { opacity: '0.5' },
            },
        }),
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className={`flex bg-background h-full overflow-x-auto gap-4 p-4 items-start ${focusMode ? 'justify-center' : ''}`}>

                {/* Stage Selector for Focus Mode */}
                {focusMode && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 bg-white/90 backdrop-blur border rounded-full px-2 py-1 shadow-sm flex items-center gap-1">
                        {PIPELINE_STAGES.map(s => (
                            <button
                                key={s.id}
                                onClick={() => setFocusedStage(s.id)}
                                className={`text-xs px-2 py-1 rounded-full transition-colors ${focusedStage === s.id ? 'bg-black text-white' : 'hover:bg-gray-100 text-gray-500'}`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                )}

                {PIPELINE_STAGES.map(stage => {
                    if (focusMode && stage.id !== focusedStage) return null;

                    return (
                        <div key={stage.id} className={focusMode ? "w-[600px] h-full transition-all duration-300" : "h-full"}>
                            <KanbanColumn
                                id={stage.id}
                                title={stage.label}
                                colorClass={stage.color}
                                count={columns.get(stage.id)?.length || 0}
                                leads={columns.get(stage.id) || []}
                                onLeadClick={onLeadClick}
                            />
                        </div>
                    );
                })}
            </div>

            <DragOverlay dropAnimation={dropAnimation}>
                {activeLead ? <LeadCard lead={activeLead} /> : null}
            </DragOverlay>
        </DndContext>
    );
}
