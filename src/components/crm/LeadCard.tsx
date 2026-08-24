'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Building2, CalendarClock, GripVertical, Loader2, Mail, MoveRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PIPELINE_STAGES, type PipelineStage } from '@/lib/crm-types';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

interface Props {
    lead: UnifiedRow;
    onClick?: () => void;
    onStageChange?: (stage: PipelineStage) => void;
    isSaving?: boolean;
}

function formatDueDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}

export function LeadCard({ lead, onClick, onStageChange, isSaving = false }: Props) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: lead.gid, data: { lead }, disabled: isSaving });

    const currentStage = PIPELINE_STAGES.some((stage) => stage.id === lead.stage)
        ? lead.stage as PipelineStage
        : 'inbox';
    const dueDate = lead.nextActionDueAt ? formatDueDate(lead.nextActionDueAt) : null;

    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.45 : 1,
            }}
        >
            <Card className="border-border/70 bg-card shadow-sm transition-[border-color,box-shadow] hover:border-border hover:shadow-md motion-reduce:transition-none">
                <CardContent className="space-y-3 p-3">
                    <div className="flex items-start gap-2">
                        <button
                            type="button"
                            onClick={onClick}
                            className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            <span className="block truncate text-sm font-semibold leading-5 text-foreground">{lead.name || 'Sin nombre'}</span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {[lead.title, lead.company].filter(Boolean).join(' · ') || 'Sin cargo o empresa'}
                            </span>
                        </button>
                        <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 cursor-grab text-muted-foreground active:cursor-grabbing"
                            disabled={isSaving}
                            aria-label={`Arrastrar ${lead.name || 'lead'}`}
                            {...attributes}
                            {...listeners}
                        >
                            <GripVertical className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="space-y-1.5 text-xs text-muted-foreground">
                        {lead.email && <div className="flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{lead.email}</span></div>}
                        {!lead.email && lead.company && <div className="flex min-w-0 items-center gap-1.5"><Building2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{lead.company}</span></div>}
                        {dueDate && <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><CalendarClock className="h-3.5 w-3.5" /><span>Próximo paso: {dueDate}</span></div>}
                    </div>

                    {lead.nextAction && (
                        <p className="line-clamp-2 rounded-md bg-muted/55 px-2 py-1.5 text-xs leading-4 text-foreground/80">
                            {lead.nextAction}
                        </p>
                    )}

                    <div className="flex items-center justify-between border-t border-border/60 pt-2">
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClick}>
                            Ver detalle
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={isSaving}>
                                    {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoveRight className="h-3.5 w-3.5" />}
                                    {isSaving ? 'Guardando' : 'Mover'}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel>Cambiar etapa</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuRadioGroup value={currentStage} onValueChange={(value) => onStageChange?.(value as PipelineStage)}>
                                    {PIPELINE_STAGES.map((stage) => (
                                        <DropdownMenuRadioItem key={stage.id} value={stage.id}>{stage.label}</DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
