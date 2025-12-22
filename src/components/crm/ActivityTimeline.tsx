'use client';

import { Activity } from '@/lib/crm-types';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Mail, Phone, FileText, CheckCircle, Reply } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
    activities: Activity[];
}

function ActivityIcon({ type }: { type: Activity['type'] }) {
    switch (type) {
        case 'email': return <Mail className="h-4 w-4" />;
        case 'call': return <Phone className="h-4 w-4" />;
        case 'note': return <FileText className="h-4 w-4" />;
        case 'enrichment': return <CheckCircle className="h-4 w-4" />;
        default: return <FileText className="h-4 w-4" />;
    }
}

export function ActivityTimeline({ activities }: Props) {
    if (activities.length === 0) {
        return <div className="text-sm text-muted-foreground text-center py-4">No hay actividad registrada.</div>;
    }

    return (
        <div className="space-y-6 ml-2 border-l-2 border-muted pl-4 relative">
            {activities.map((act) => (
                <div key={act.id} className="relative">
                    <span className={cn(
                        "absolute -left-[25px] top-1 bg-background border-2 rounded-full p-1 text-muted-foreground",
                        act.type === 'email' ? 'border-blue-200 text-blue-500' :
                            act.type === 'note' ? 'border-yellow-200 text-yellow-500' : 'border-gray-200'
                    )}>
                        <ActivityIcon type={act.type} />
                    </span>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold">{act.title}</span>
                            <span className="text-xs text-muted-foreground" title={format(new Date(act.createdAt), 'PPpp', { locale: es })}>
                                {formatDistanceToNow(new Date(act.createdAt), { addSuffix: true, locale: es })}
                            </span>
                        </div>
                        {act.description && (
                            <div className="text-sm text-gray-700 bg-muted/30 p-2 rounded-md whitespace-pre-wrap">
                                {act.description}
                            </div>
                        )}
                        {act.metadata && Object.keys(act.metadata).length > 0 && (
                            <div className="text-xs text-muted-foreground font-mono">
                                {JSON.stringify(act.metadata).slice(0, 100)}...
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
