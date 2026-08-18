'use client';

import { useMemo } from 'react';
import { differenceInDays } from 'date-fns';
import { AlertCircle, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { PipelineStage } from '@/lib/crm-types';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

interface Props {
    leads: UnifiedRow[];
    onAlertClick?: (stage: PipelineStage) => void;
}

type PriorityAlert = {
    id: string;
    priority: number;
    message: string;
    detail: string;
    action: string;
    targetStage: PipelineStage;
};

function safeDaysSince(value: UnifiedRow['updatedAt']) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return differenceInDays(new Date(), date);
}

export function SmartAlerts({ leads, onAlertClick }: Props) {
    const alert = useMemo(() => {
        const alerts: PriorityAlert[] = [];
        const urgentReplies = leads.filter((lead) =>
            (lead.autopilotStatus === 'positive_reply' || lead.autopilotStatus === 'meeting_requested') &&
            lead.nextActionDueAt &&
            new Date(lead.nextActionDueAt).getTime() <= Date.now(),
        );
        if (urgentReplies.length > 0) {
            alerts.push({
                id: 'urgent-replies',
                priority: 3,
                message: `${urgentReplies.length} ${urgentReplies.length === 1 ? 'lead necesita' : 'leads necesitan'} respuesta hoy`,
                detail: 'Hay una respuesta positiva o solicitud de reunión pendiente.',
                action: 'Priorizar',
                targetStage: 'engaged',
            });
        }

        const staleQualified = leads.filter((lead) => lead.stage === 'qualified' && (safeDaysSince(lead.updatedAt) ?? 0) > 5);
        if (staleQualified.length > 0) {
            alerts.push({
                id: 'stale-qualified',
                priority: 2,
                message: `${staleQualified.length} ${staleQualified.length === 1 ? 'lead calificado espera' : 'leads calificados esperan'} acción`,
                detail: 'No registran actividad reciente desde hace más de cinco días.',
                action: 'Ver calificados',
                targetStage: 'qualified',
            });
        }

        const staleContacted = leads.filter((lead) => lead.stage === 'contacted' && (safeDaysSince(lead.updatedAt) ?? 0) > 3);
        if (staleContacted.length > 0) {
            alerts.push({
                id: 'stale-contacted',
                priority: 1,
                message: `${staleContacted.length} ${staleContacted.length === 1 ? 'contactado lleva' : 'contactados llevan'} más de 3 días sin respuesta`,
                detail: 'Conviene revisar el seguimiento antes de que pierdan prioridad.',
                action: 'Revisar',
                targetStage: 'contacted',
            });
        }

        return alerts.sort((a, b) => b.priority - a.priority)[0] ?? null;
    }, [leads]);

    if (!alert) return null;

    return (
        <div className="border-b border-amber-200/70 bg-amber-50/80 px-4 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2.5">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-amber-950 dark:text-amber-100">{alert.message}</p>
                        <p className="truncate text-xs text-amber-800/80 dark:text-amber-200/75">{alert.detail}</p>
                    </div>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 justify-start text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:text-amber-100 dark:hover:bg-amber-500/15"
                    onClick={() => onAlertClick?.(alert.targetStage)}
                >
                    {alert.action} <ArrowRight className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}
