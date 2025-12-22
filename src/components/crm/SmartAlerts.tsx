'use client';

import { UnifiedRow } from '@/lib/unified-sheet-types';
import { useMemo } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { differenceInDays } from 'date-fns';

interface Props {
    leads: UnifiedRow[];
    onAlertClick?: (stage: string) => void;
}

export function SmartAlerts({ leads, onAlertClick }: Props) {
    const alerts = useMemo(() => {
        const list = [];

        // Rule 1: Contacted > 3 days ago without reply
        const staleContacted = leads.filter(l =>
            l.stage === 'contacted' &&
            l.updatedAt &&
            differenceInDays(new Date(), new Date(l.updatedAt)) > 3
        );

        if (staleContacted.length > 0) {
            list.push({
                id: 'stale-contacted',
                type: 'warning',
                message: `${staleContacted.length} leads contactados sin respuesta hace +3 días.`,
                action: 'Ver leads',
                targetStage: 'contacted'
            });
        }

        // Rule 2: Qualified but no action for 5 days
        const staleQualified = leads.filter(l =>
            l.stage === 'qualified' &&
            l.updatedAt &&
            differenceInDays(new Date(), new Date(l.updatedAt)) > 5
        );

        if (staleQualified.length > 0) {
            list.push({
                id: 'stale-qualified',
                type: 'info',
                message: `${staleQualified.length} leads calificados esperan acción.`,
                action: 'Priorizar',
                targetStage: 'qualified'
            });
        }

        return list;
    }, [leads]);

    if (alerts.length === 0) return null;

    return (
        <div className="flex items-center gap-4 bg-orange-50/90 backdrop-blur border-b border-orange-100 px-6 py-3 sticky top-0 z-40">
            {alerts.map(alert => (
                <div key={alert.id} className="flex items-center gap-2 text-sm text-orange-900 bg-orange-100/50 px-3 py-1.5 rounded-full border border-orange-200">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <span className="font-medium">{alert.message}</span>
                    <button
                        onClick={() => onAlertClick?.(alert.targetStage)}
                        className="flex items-center hover:bg-orange-200/50 px-2 py-0.5 rounded transition-colors text-xs font-bold uppercase tracking-wider ml-1 text-orange-700 cursor-pointer"
                    >
                        {alert.action} <ArrowRight className="h-3 w-3 ml-1" />
                    </button>
                </div>
            ))}
        </div>
    );
}
