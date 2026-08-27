'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { InviteMemberDialog } from '@/components/organization/InviteMemberDialog';
import {
    MembersList,
    type OrganizationInvite,
    type OrganizationMember,
    type OrganizationRole,
} from '@/components/organization/MembersList';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { organizationService } from '@/lib/services/organization-service';

type Organization = {
    id: string;
    name: string;
};

type WorkspaceData = {
    organization: Organization;
    members: OrganizationMember[];
    invites: OrganizationInvite[];
    currentUserRole: OrganizationRole;
};

const roleLabels: Record<OrganizationRole, string> = {
    owner: 'Propietario',
    admin: 'Administrador',
    member: 'Miembro',
};

async function fetchWorkspaceData(organizationId: string): Promise<WorkspaceData | null> {
    const details = await organizationService.getOrganizationDetails(organizationId);
    if (!details?.organization) return null;

    return {
        organization: details.organization,
        members: details.members,
        invites: details.invites,
        currentUserRole: details.currentUserRole,
    };
}

export default function OrganizationSettingsPage() {
    const { user, organizationId, loading: authLoading } = useAuth();
    const { toast } = useToast();
    const [data, setData] = useState<WorkspaceData | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [pageError, setPageError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const [newName, setNewName] = useState('');
    const [nameError, setNameError] = useState<string | null>(null);
    const [savingName, setSavingName] = useState(false);

    useEffect(() => {
        if (authLoading) return;

        if (!user?.id || !organizationId) {
            setPageError('No pudimos identificar tu sesión. Vuelve a iniciar sesión e inténtalo de nuevo.');
            setStatus('error');
            return;
        }

        let cancelled = false;
        setStatus('loading');
        setPageError('');

        void fetchWorkspaceData(organizationId)
            .then((result) => {
                if (cancelled) return;
                setData(result);
                setNewName(result?.organization.name || '');
                setStatus('ready');
            })
            .catch(() => {
                if (cancelled) return;
                setPageError('No pudimos cargar la organización. Inténtalo de nuevo.');
                setStatus('error');
            });

        return () => {
            cancelled = true;
        };
    }, [authLoading, organizationId, user?.id, reloadKey]);

    async function refreshWorkspaceData() {
        if (!organizationId) return;

        setRefreshing(true);
        try {
            const result = await fetchWorkspaceData(organizationId);
            if (!result) throw new Error('workspace-not-found');
            setData(result);
        } catch {
            toast({
                variant: 'destructive',
                title: 'No pudimos actualizar el equipo',
                description: 'Los cambios pueden tardar en aparecer. Inténtalo de nuevo.',
            });
        } finally {
            setRefreshing(false);
        }
    }

    async function handleUpdateName(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!data || data.currentUserRole !== 'owner' || savingName) return;

        const normalizedName = newName.trim();
        if (!normalizedName) {
            setNameError('Ingresa un nombre para el workspace.');
            return;
        }

        setSavingName(true);
        setNameError(null);

        try {
            const updated = await organizationService.updateOrganization(data.organization.id, { name: normalizedName });
            if (!updated) throw new Error('organization-update-failed');

            setData((current) => current ? {
                ...current,
                organization: { ...current.organization, name: normalizedName },
            } : current);
            setNewName(normalizedName);
            toast({ title: 'Nombre actualizado', description: 'El nuevo nombre ya está visible para el equipo.' });
        } catch {
            setNameError('No pudimos guardar el nombre. Inténtalo de nuevo.');
        } finally {
            setSavingName(false);
        }
    }

    const canInviteMembers = data?.currentUserRole === 'owner' || data?.currentUserRole === 'admin';
    const canRenameWorkspace = data?.currentUserRole === 'owner';
    const nameChanged = Boolean(data && newName.trim() !== data.organization.name);

    return (
        <div className="mx-auto max-w-5xl space-y-8 pb-20">
            <PageHeader
                title="Organización"
                description="Gestiona el workspace, sus miembros y las invitaciones pendientes."
            >
                {status === 'ready' && data && canInviteMembers ? (
                    <InviteMemberDialog onInviteSent={() => void refreshWorkspaceData()} />
                ) : null}
            </PageHeader>

            {status === 'loading' ? (
                <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
                    <span className="sr-only">Cargando organización.</span>
                    {[0, 1].map((item) => (
                        <Card key={item} className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 dark:bg-card/70">
                            <CardHeader className="space-y-3 border-b border-border/60 px-5 py-5 sm:px-6">
                                <Skeleton className="h-6 w-48" />
                                <Skeleton className="h-4 w-full max-w-md" />
                            </CardHeader>
                            <CardContent className="space-y-3 px-5 py-5 sm:px-6">
                                <Skeleton className="h-11 w-full max-w-lg" />
                                <Skeleton className="h-4 w-52" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : null}

            {status === 'error' ? (
                <Card className="rounded-[28px] border-border/60 bg-card/85 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)] dark:bg-card/70" role="alert">
                    <CardContent className="flex flex-col items-start gap-4 p-6 sm:p-8">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">No pudimos abrir este workspace</h2>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{pageError}</p>
                        </div>
                        <Button type="button" variant="outline" onClick={() => setReloadKey((key) => key + 1)} className="rounded-xl">
                            <RefreshCw aria-hidden="true" /> Reintentar
                        </Button>
                    </CardContent>
                </Card>
            ) : null}

            {status === 'ready' && !data ? (
                <Card className="rounded-[28px] border-border/60 bg-card/85 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)] dark:bg-card/70">
                    <CardContent className="p-6 sm:p-8">
                        <h2 className="text-lg font-semibold text-foreground">No hay un workspace activo</h2>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Selecciona un workspace desde la barra lateral para gestionar su equipo.</p>
                    </CardContent>
                </Card>
            ) : null}

            {status === 'ready' && data ? (
                <>
                    <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)] dark:bg-card/70">
                        <CardHeader className="border-b border-border/60 px-5 py-5 sm:px-6">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                                <div className="space-y-1.5">
                                    <h2 className="text-xl font-semibold tracking-tight text-foreground">Información del workspace</h2>
                                    <CardDescription>Este nombre identifica el espacio para todos sus miembros.</CardDescription>
                                </div>
                                <p className="shrink-0 text-sm text-muted-foreground">Tu rol: <span className="font-medium text-foreground">{roleLabels[data.currentUserRole]}</span></p>
                            </div>
                        </CardHeader>
                        <CardContent className="px-5 py-5 sm:px-6 sm:py-6">
                            <form onSubmit={handleUpdateName} noValidate className="max-w-2xl">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                                    <div className="min-w-0 flex-1 space-y-2">
                                        <Label htmlFor="organization-name">Nombre del workspace</Label>
                                        <Input
                                            id="organization-name"
                                            value={newName}
                                            onChange={(event) => {
                                                setNewName(event.target.value);
                                                setNameError(null);
                                            }}
                                            readOnly={!canRenameWorkspace}
                                            aria-invalid={Boolean(nameError)}
                                            aria-describedby={nameError ? 'organization-name-error' : 'organization-name-help'}
                                            className="h-11 rounded-xl read-only:cursor-default read-only:bg-muted/35"
                                        />
                                    </div>
                                    {canRenameWorkspace ? (
                                        <Button type="submit" variant="outline" disabled={savingName || !nameChanged} className="h-11 rounded-xl sm:min-w-28">
                                            {savingName ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                                            {savingName ? 'Guardando…' : 'Guardar'}
                                        </Button>
                                    ) : null}
                                </div>
                                {nameError ? (
                                    <p id="organization-name-error" className="mt-2 text-sm leading-5 text-destructive" role="alert">{nameError}</p>
                                ) : (
                                    <p id="organization-name-help" className="mt-2 text-sm leading-5 text-muted-foreground">
                                        {canRenameWorkspace ? 'Los cambios se aplican a todo el equipo.' : 'Solo el propietario puede cambiar este nombre.'}
                                    </p>
                                )}
                            </form>
                        </CardContent>
                    </Card>

                    <MembersList
                        organizationId={data.organization.id}
                        members={data.members}
                        invites={data.invites}
                        currentUserId={user?.id || null}
                        currentUserRole={data.currentUserRole}
                        refreshing={refreshing}
                        onRefresh={refreshWorkspaceData}
                    />
                </>
            ) : null}
        </div>
    );
}
