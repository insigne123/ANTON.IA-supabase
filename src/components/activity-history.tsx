'use client';

import { useEffect, useState } from 'react';
import { activityLogService } from '@/lib/services/activity-log-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function ActivityHistory() {
    const [activities, setActivities] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadActivities();
    }, []);

    const loadActivities = async () => {
        const data = await activityLogService.getActivities(50);
        setActivities(data);
        setLoading(false);
    };

    if (loading) {
        return (
            <div className="flex justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Historial de Actividad</CardTitle>
                <CardDescription>
                    Registro de acciones recientes en la organización.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-4">
                        {activities.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                                No hay actividad reciente.
                            </p>
                        ) : (
                            activities.map((activity) => (
                                <div key={activity.id} className="flex items-start gap-4 text-sm">
                                    <Avatar className="h-8 w-8 mt-1">
                                        <AvatarImage src={activity.profiles?.avatar_url} />
                                        <AvatarFallback>
                                            {(activity.profiles?.full_name?.[0] || '?').toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <p className="font-medium">
                                                {activity.profiles?.full_name || 'Usuario desconocido'}
                                            </p>
                                            <span className="text-xs text-muted-foreground">
                                                {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true, locale: es })}
                                            </span>
                                        </div>
                                        <p className="text-muted-foreground">
                                            {formatAction(activity)}
                                        </p>
                                        {activity.details && Object.keys(activity.details).length > 0 && (
                                            <div className="mt-1">
                                                <Badge variant="outline" className="text-xs font-normal">
                                                    {JSON.stringify(activity.details)}
                                                </Badge>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}

function formatAction(activity: any): string {
    switch (activity.action) {
        case 'create_lead': return 'Creó un nuevo lead';
        case 'update_lead': return 'Actualizó un lead';
        case 'delete_lead': return 'Eliminó un lead';
        case 'create_campaign': return 'Creó una campaña';
        case 'invite_member': return `Invitó a ${activity.details?.email || 'un miembro'}`;
        case 'update_member': return `Actualizó el rol de un miembro a ${activity.details?.newRole}`;
        case 'remove_member': return 'Eliminó a un miembro';
        case 'join_organization': return 'Se unió a la organización';
        case 'leave_organization': return 'Dejó la organización';
        case 'create_organization': return 'Creó la organización';
        default: return activity.action;
    }
}
