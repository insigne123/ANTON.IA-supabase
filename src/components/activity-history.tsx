'use client';

import { useEffect, useState, useCallback } from 'react';
import { activityLogService } from '@/lib/services/activity-log-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

import Link from 'next/link';

export function ActivityHistory() {
    const [activities, setActivities] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [members, setMembers] = useState<any[]>([]);
    const [selectedUser, setSelectedUser] = useState<string>('all');
    const [selectedAction, setSelectedAction] = useState<string>('all');

    const loadMembers = useCallback(async () => {
        // We need a way to get organization members. 
        // Assuming we can get them from a service or context.
        // For now, let's try to fetch unique users from the activities themselves if we can't get members easily,
        // OR better, let's use the organizationService if it has a method, or just fetch profiles linked to the org.
        // Since we don't have a direct "getMembers" in organizationService visible here, 
        // let's assume we can fetch them or just rely on the user IDs present in the logs if we want to be lazy, 
        // BUT for a proper filter we want all members.
        // Let's try to import organizationService and see if we can add a getMembers there or if it exists.
        // Actually, let's just fetch from 'organization_members' table via supabase for now.

        // Wait, we can't import supabase directly here easily without making it a client component (it is).
        // Let's import supabase from lib.
        const { supabase } = await import('@/lib/supabase');
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Get current org
        const { data: orgMember } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).single();
        if (!orgMember) return;

        const { data: memberData } = await supabase
            .from('organization_members')
            .select('user_id, profiles(full_name)')
            .eq('organization_id', orgMember.organization_id);

        if (memberData) {
            setMembers(memberData.map((m: any) => ({ id: m.user_id, name: m.profiles?.full_name || 'Unknown' })));
        }
    }, []);

    const loadActivities = useCallback(async () => {
        setLoading(true);
        const filters: any = {};
        if (selectedUser !== 'all') filters.userId = selectedUser;
        if (selectedAction !== 'all') filters.action = selectedAction;

        const data = await activityLogService.getActivities(50, filters);
        setActivities(data);
        setLoading(false);
    }, [selectedUser, selectedAction]);

    useEffect(() => {
        loadMembers();
    }, [loadMembers]);

    useEffect(() => {
        loadActivities();
    }, [loadActivities]);

    const actionTypes = [
        { value: 'all', label: 'Todas las acciones' },
        { value: 'create_lead', label: 'Crear Lead' },
        { value: 'update_lead', label: 'Actualizar Lead' },
        { value: 'delete_lead', label: 'Eliminar Lead' },
        { value: 'create_campaign', label: 'Crear Campaña' },
        { value: 'invite_member', label: 'Invitar Miembro' },
        { value: 'update_member', label: 'Actualizar Miembro' },
        { value: 'create_organization', label: 'Crear Organización' },
        { value: 'update_organization', label: 'Actualizar Organización' },
    ];

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Historial de Actividad</CardTitle>
                        <CardDescription>
                            Registro de acciones recientes en la organización.
                        </CardDescription>
                    </div>
                    {/* Filters */}
                    <div className="flex gap-2">
                        <select
                            className="h-8 w-[150px] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={selectedUser}
                            onChange={(e) => setSelectedUser(e.target.value)}
                        >
                            <option value="all">Todos los usuarios</option>
                            {members.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                        <select
                            className="h-8 w-[150px] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={selectedAction}
                            onChange={(e) => setSelectedAction(e.target.value)}
                        >
                            {actionTypes.map(a => (
                                <option key={a.value} value={a.value}>{a.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[400px] pr-4">
                    {loading ? (
                        <div className="flex justify-center p-4">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {activities.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">
                                    No hay actividad reciente con estos filtros.
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
                                            <div className="text-muted-foreground">
                                                {renderActionContent(activity)}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </ScrollArea>
            </CardContent>
        </Card>
    );
}

function renderActionContent(activity: any) {
    const { action, details, entity_type, entity_id } = activity;

    const getLink = () => {
        if (entity_type === 'campaign' && entity_id) return `/campaigns/${entity_id}`;
        if (entity_type === 'lead') return `/saved/leads`;
        if (entity_type === 'member' || entity_type === 'organization') return `/settings/organization`;
        return null;
    };

    const LinkWrapper = ({ children }: { children: React.ReactNode }) => {
        const href = getLink();
        if (href) {
            return <Link href={href} className="font-medium text-primary hover:underline">{children}</Link>;
        }
        return <span className="font-medium">{children}</span>;
    };

    switch (action) {
        case 'create_lead':
            return (
                <>
                    Creó el lead <LinkWrapper>{details?.name || 'Nuevo Lead'}</LinkWrapper>
                    {details?.company && <span className="text-muted-foreground"> de {details.company}</span>}
                </>
            );
        case 'update_lead':
            return <>Actualizó el lead <LinkWrapper>{details?.name || 'Lead'}</LinkWrapper></>;
        case 'delete_lead':
            return <>Eliminó un lead</>; // No link since it's deleted
        case 'create_campaign':
            return <>Creó la campaña <LinkWrapper>{details?.name || 'Nueva Campaña'}</LinkWrapper></>;
        case 'invite_member':
            return <>Invitó a <span className="font-medium">{details?.email}</span></>;
        case 'update_member':
            return <>Actualizó el rol de <span className="font-medium">{details?.email || 'miembro'}</span> a {details?.newRole}</>;
        case 'remove_member':
            return <>Eliminó a un miembro</>;
        case 'join_organization':
            return <>Se unió a la organización</>;
        case 'leave_organization':
            return <>Dejó la organización</>;
        case 'create_organization':
            return <>Creó la organización <LinkWrapper>{details?.name}</LinkWrapper></>;
        case 'update_organization':
            return <>Actualizó la organización a <LinkWrapper>{details?.name}</LinkWrapper></>;
        default:
            return action;
    }
}
