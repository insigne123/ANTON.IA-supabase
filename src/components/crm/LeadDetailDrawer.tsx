'use client';

import { useEffect, useState } from 'react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription
} from '@/components/ui/sheet';
import { UnifiedRow } from '@/lib/unified-sheet-types';
import { activityService } from '@/lib/services/activity-service';
import { Activity } from '@/lib/crm-types';
import { ActivityTimeline } from './ActivityTimeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mail, Phone, Calendar } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Link from 'next/link';

interface Props {
    lead: UnifiedRow | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function LeadDetailDrawer({ lead, open, onOpenChange }: Props) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (lead && open) {
            // Fetch activities
            setLoading(true);
            // determine leadId: sourceId is mostly the one used for logic, but unifiedGid is good for notes
            const leadId = lead.sourceId;
            activityService.getLeadActivities(leadId, lead.gid)
                .then(setActivities)
                .catch(console.error)
                .finally(() => setLoading(false));
        } else {
            setActivities([]);
        }
    }, [lead, open]);

    if (!lead) return null;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
                <SheetHeader className="mb-6">
                    <div className="flex items-start gap-4">
                        <Avatar className="h-12 w-12">
                            <AvatarFallback>{lead.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="space-y-1">
                            <SheetTitle>{lead.name}</SheetTitle>
                            <SheetDescription>
                                {lead.title} at {lead.company}
                            </SheetDescription>
                            <div className="flex items-center gap-2 mt-2">
                                {lead.email && (
                                    <Link href={`/contact/compose?id=${lead.sourceId}&email=${lead.email}`}>
                                        <Button size="sm" variant="outline" className="h-7 text-xs">
                                            <Mail className="h-3 w-3 mr-1" /> Email
                                        </Button>
                                    </Link>
                                )}
                                {lead.linkedinUrl && (
                                    <a href={lead.linkedinUrl} target="_blank" rel="noreferrer">
                                        <Button size="sm" variant="outline" className="h-7 text-xs">
                                            <span className="text-blue-600 font-bold mr-1">in</span> LinkedIn
                                        </Button>
                                    </a>
                                )}
                                <Badge variant="secondary">{lead.stage || 'Inbox'}</Badge>
                            </div>
                        </div>
                    </div>
                </SheetHeader>

                {/* AI Next Best Action Placeholder */}
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6">
                    <h4 className="text-sm font-semibold text-blue-900 mb-1 flex items-center gap-2">
                        ✨ Sugerencia de IA
                    </h4>
                    <p className="text-sm text-blue-800">
                        Este lead envió un correo hace 2 días. Sería buen momento para programar una llamada de seguimiento.
                    </p>
                    <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="default" className="bg-blue-600 hover:bg-blue-700 h-8 text-xs">
                            Agendar llamada
                        </Button>
                        <Button size="sm" variant="ghost" className="text-blue-600 h-8 text-xs hover:text-blue-800 hover:bg-blue-100">
                            Generar respuesta
                        </Button>
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="font-semibold text-lg border-b pb-2">Actividad Reciente</h3>
                    {loading ? (
                        <div className="flex justify-center p-4"><span className="animate-pulse text-muted-foreground">Cargando historia...</span></div>
                    ) : (
                        <ActivityTimeline activities={activities} />
                    )}
                </div>

            </SheetContent>
        </Sheet>
    );
}
