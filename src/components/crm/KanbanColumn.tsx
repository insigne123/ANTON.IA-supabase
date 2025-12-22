'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { LeadCard } from './LeadCard';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import type { PipelineStage } from '@/lib/crm-types';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
    id: PipelineStage;
    title: string;
    count: number;
    leads: UnifiedRow[];
    colorClass: string;
    onLeadClick?: (lead: UnifiedRow) => void;
}

export function KanbanColumn({ id, title, count, leads, colorClass, onLeadClick }: Props) {
    const { setNodeRef } = useDroppable({ id });

    return (
        <div className="flex flex-col h-full min-w-[280px] w-[280px] bg-muted/30 rounded-lg border border-border/50">
            {/* Header */}
            <div className={`p-3 border-b flex items-center justify-between ${colorClass} bg-opacity-20 rounded-t-lg`}>
                <h3 className="font-semibold text-sm">{title}</h3>
                <span className="bg-background/50 text-xs px-2 py-0.5 rounded-full font-mono">{count}</span>
            </div>

            {/* Cards Area */}
            <ScrollArea className="flex-1 p-2">
                <div ref={setNodeRef} className="space-y-2 min-h-[100px]">
                    <SortableContext items={leads.map(l => l.gid)} strategy={verticalListSortingStrategy}>
                        {leads.map(lead => (
                            <LeadCard key={lead.gid} lead={lead} onClick={() => onLeadClick?.(lead)} />
                        ))}
                    </SortableContext>
                </div>
            </ScrollArea>
        </div>
    );
}
