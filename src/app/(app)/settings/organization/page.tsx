'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MembersList } from '@/components/organization/MembersList';
import { InviteMemberDialog } from '@/components/organization/InviteMemberDialog';
import { organizationService } from '@/lib/services/organization-service';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export default function OrganizationSettingsPage() {
    const [orgDetails, setOrgDetails] = useState<any>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [newName, setNewName] = useState('');
    const { toast } = useToast();

    useEffect(() => {
        organizationService.getOrganizationDetails().then(data => {
            if (data && data.organization) {
                setOrgDetails(data.organization);
                setNewName(data.organization.name);
            }
        });
    }, []);

    const handleUpdateName = async () => {
        if (!orgDetails || !newName) return;
        const ok = await organizationService.updateOrganization(orgDetails.id, { name: newName });
        if (ok) {
            toast({ title: 'Nombre actualizado' });
        } else {
            toast({ variant: 'destructive', title: 'Error al actualizar' });
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-20">
            <PageHeader
                title="Configuración de Organización"
                description="Gestiona tu equipo y preferencias de la empresa."
            />

            <Card>
                <CardHeader>
                    <CardTitle>Perfil de Organización</CardTitle>
                    <CardDescription>Información básica visible para el equipo.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4 items-end max-w-md">
                        <div className="space-y-2 flex-1">
                            <label className="text-sm font-medium">Nombre de la Empresa</label>
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Mi Empresa Inc."
                            />
                        </div>
                        <Button onClick={handleUpdateName} disabled={newName === orgDetails?.name}>
                            Guardar
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Miembros del Equipo</CardTitle>
                        <CardDescription>Administra quién tiene acceso a este espacio de trabajo.</CardDescription>
                    </div>
                    <InviteMemberDialog onInviteSent={() => setRefreshKey(prev => prev + 1)} />
                </CardHeader>
                <CardContent>
                    <MembersList triggerRefresh={refreshKey} />
                </CardContent>
            </Card>
        </div>
    );
}
