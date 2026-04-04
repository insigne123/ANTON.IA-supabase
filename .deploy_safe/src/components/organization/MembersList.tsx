'use client';

import { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { organizationService } from '@/lib/services/organization-service';
import { Trash2, Shield, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function MembersList({ triggerRefresh }: { triggerRefresh?: number }) {
    const [members, setMembers] = useState<any[]>([]);
    const [invites, setInvites] = useState<any[]>([]);
    const [currentUserRole, setCurrentUserRole] = useState<'owner' | 'admin' | 'member'>('member');
    const [userId, setUserId] = useState<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        loadData();
    }, [triggerRefresh]);

    async function loadData() {
        const details = await organizationService.getOrganizationDetails();
        if (details) {
            setMembers(details.members);
            // Encontrar rol del user actual
            // (Esto es un poco hacky si no tenemos el ID a mano, pero podemos inferirlo o buscarlo)
            // Por ahora asumimos que el usuario puede ver la lista.
        }
        const inv = await organizationService.getInvites();
        setInvites(inv);
    }

    const handleRevoke = async (inviteId: string) => {
        const ok = await organizationService.revokeInvite(inviteId);
        if (ok) {
            toast({ title: 'Invitación revocada' });
            loadData();
        }
    };

    const handleRemoveMember = async (targetUserId: string) => {
        // Falta implementar remove member en el servicio explícitamente, o usar updateRole->removed?
        // organization-service.ts tiene leaveOrganization pero no removeMemberByName.
        // Asumiremos que es una feature futura o requiere lógica backend estricta.
        toast({ variant: 'destructive', title: 'No implementado', description: 'Contacta al soporte para eliminar miembros.' });
    };

    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-lg font-medium mb-4">Miembros Activos</h3>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Usuario</TableHead>
                                <TableHead>Rol</TableHead>
                                <TableHead>Unido</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {members.map((m) => (
                                <TableRow key={m.user_id}>
                                    <TableCell className="flex items-center gap-3">
                                        <Avatar>
                                            <AvatarImage src={m.profiles?.avatar_url} />
                                            <AvatarFallback>{m.profiles?.full_name?.[0] || 'U'}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{m.profiles?.full_name || 'Desconocido'}</span>
                                            <span className="text-xs text-muted-foreground">{m.profiles?.email}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={m.role === 'owner' ? 'default' : (m.role === 'admin' ? 'secondary' : 'outline')}>
                                            {m.role === 'owner' && <Shield className="w-3 h-3 mr-1" />}
                                            {m.role}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {new Date(m.created_at).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell>
                                        {/* Solo mostrar acciones si tienes permisos */}
                                        {/* <Button variant="ghost" size="icon" onClick={() => handleRemoveMember(m.user_id)}>
                                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                                    </Button> */}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {invites.length > 0 && (
                <div>
                    <h3 className="text-lg font-medium mb-4">Invitaciones Pendientes</h3>
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Rol</TableHead>
                                    <TableHead>Enviada</TableHead>
                                    <TableHead className="w-[100px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {invites.map((inv) => (
                                    <TableRow key={inv.id}>
                                        <TableCell>{inv.email}</TableCell>
                                        <TableCell><Badge variant="outline">{inv.role}</Badge></TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{new Date(inv.created_at).toLocaleDateString()}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleRevoke(inv.id)}>
                                                Revocar
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}
        </div>
    );
}
