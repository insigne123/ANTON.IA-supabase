'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Mail, Linkedin, Calendar, Phone } from 'lucide-react';

interface Props {
    lead: UnifiedRow;
    onClick?: () => void;
}

export function LeadCard({ lead, onClick }: Props) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: lead.gid, data: { lead } });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="mb-2">
            <Card
                className="cursor-pointer hover:shadow-md transition-shadow bg-card"
                onClick={onClick}
            >
                <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between">
                        <div className="space-y-0.5">
                            <h4 className="text-sm font-semibold line-clamp-1 leading-tight">{lead.name || 'Sin nombre'}</h4>
                            <p className="text-xs text-muted-foreground line-clamp-1">{lead.title || lead.company}</p>
                            {lead.title && lead.company && <p className="text-[10px] text-muted-foreground line-clamp-1">{lead.company}</p>}
                        </div>
                        {lead.kind === 'opportunity' && <Badge variant="outline" className="text-[9px] h-4 px-1">Opp</Badge>}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {lead.email && <Mail className="h-3 w-3" />}
                        {lead.linkedinUrl && <Linkedin className="h-3 w-3" />}
                    </div>

                    {/* Last Activity Preview could go here */}
                </CardContent>
            </Card>
        </div>
    );
}
