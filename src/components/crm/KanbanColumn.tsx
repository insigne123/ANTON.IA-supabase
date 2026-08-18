'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import type { PipelineStage } from '@/lib/crm-types';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import { LeadCard } from './LeadCard';

interface Props {
    id: PipelineStage;
    title: string;
    count: number;
    leads: UnifiedRow[];
    closed?: boolean;
    movingLeadIds?: Set<string>;
    onLeadClick?: (lead: UnifiedRow) => void;
    onLeadMove?: (leadId: string, stage: PipelineStage) => void;
}

const STAGE_ACCENT: Record<PipelineStage, string> = {
    inbox: 'bg-slate-400',
    qualified: 'bg-sky-500',
    contacted: 'bg-indigo-500',
    engaged: 'bg-violet-500',
    meeting: 'bg-pink-500',
    negotiation: 'bg-amber-500',
    closed_won: 'bg-emerald-500',
    closed_lost: 'bg-slate-400',
};

export function KanbanColumn({
    id,
    title,
    count,
    leads,
    closed = false,
    movingLeadIds = new Set(),
    onLeadClick,
    onLeadMove,
}: Props) {
    const { setNodeRef, isOver } = useDroppable({ id });

    return (
        <section
            aria-labelledby={`stage-${id}`}
            className={`flex h-full min-h-[360px] flex-col overflow-hidden rounded-xl border transition-colors motion-reduce:transition-none ${
                closed
                    ? 'w-[248px] min-w-[248px] border-border/50 bg-muted/15'
                    : 'w-[288px] min-w-[288px] border-border/70 bg-muted/25'
            } ${isOver ? 'border-primary/50 bg-primary/5' : ''}`}
        >
            <header className="flex h-11 items-center justify-between border-b border-border/60 px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_ACCENT[id]}`} aria-hidden="true" />
                    <h2 id={`stage-${id}`} className={`truncate text-sm ${closed ? 'font-medium text-muted-foreground' : 'font-semibold'}`}>{title}</h2>
                </div>
                <span className="min-w-6 rounded-full bg-background px-1.5 py-0.5 text-center text-xs tabular-nums text-muted-foreground" aria-label={`${count} leads`}>{count}</span>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div ref={setNodeRef} className="min-h-[160px] space-y-2 p-2.5">
                    <SortableContext items={leads.map((lead) => lead.gid)} strategy={verticalListSortingStrategy}>
                        {leads.map((lead) => (
                            <LeadCard
                                key={lead.gid}
                                lead={lead}
                                isSaving={movingLeadIds.has(lead.gid)}
                                onClick={() => onLeadClick?.(lead)}
                                onStageChange={(stage) => onLeadMove?.(lead.gid, stage)}
                            />
                        ))}
                    </SortableContext>
                    {leads.length === 0 && (
                        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-border/70 px-4 text-center text-xs leading-5 text-muted-foreground">
                            Mueve un lead aquí para cambiar su etapa.
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
