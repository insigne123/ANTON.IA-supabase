'use client';

import { UnifiedRow } from '@/lib/unified-sheet-types';
import { useMemo } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { differenceInDays } from 'date-fns';

interface Props {
    leads: UnifiedRow[];
}

export function SmartAlerts({ leads }: Props) {
    const alerts = useMemo(() => {
        const list = [];

        // Rule 1: Contacted > 3 days ago without reply (assuming we can check reply status easily, simplified here)
        // We check if status is 'sent' and updatedAt > 3 days
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
                action: 'Ver leads'
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
                action: 'Priorizar'
            });
        }

        return list;
    }, [leads]);

    if (alerts.length === 0) return null;

    return (
        <div className="flex items-center gap-4 bg-orange-50/50 border-b border-orange-100 px-4 py-2">
            {alerts.map(alert => (
                <div key={alert.id} className="flex items-center gap-2 text-sm text-orange-800">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">{alert.message}</span>
                    <button className="flex items-center hover:underline text-xs font-bold uppercase tracking-wider ml-1">
                        {alert.action} <ArrowRight className="h-3 w-3 ml-1" />
                    </button>
                </div>
            ))}
        </div>
    );
}
