'use client';

import { useState } from 'react';
import { Loader2, Mail, MoreHorizontal, Trash2, UserRound } from 'lucide-react';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { organizationService } from '@/lib/services/organization-service';

export type OrganizationRole = 'owner' | 'admin' | 'member';

export type OrganizationMember = {
    user_id: string;
    role: OrganizationRole;
    created_at?: string | null;
    profiles?: {
        full_name?: string | null;
        email?: string | null;
        avatar_url?: string | null;
    } | Array<{
        full_name?: string | null;
        email?: string | null;
        avatar_url?: string | null;
    }> | null;
};

export type OrganizationInvite = {
    id: string;
    email: string;
    role: 'admin' | 'member';
    created_at?: string | null;
    expires_at?: string | null;
    expiresAt?: string | null;
};

type MembersListProps = {
    organizationId: string;
    members: OrganizationMember[];
    invites: OrganizationInvite[];
    currentUserId: string | null;
    currentUserRole: OrganizationRole;
    refreshing?: boolean;
    onRefresh: () => Promise<void>;
};

const roleLabels: Record<OrganizationRole, string> = {
    owner: 'Propietario',
    admin: 'Administrador',
    member: 'Miembro',
};

const roleOptions: OrganizationRole[] = ['owner', 'admin', 'member'];

function profileFor(member: OrganizationMember) {
    return Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
}

function memberName(member: OrganizationMember) {
    const profile = profileFor(member);
    return profile?.full_name?.trim() || profile?.email?.trim() || 'Miembro del equipo';
}

function initialsFor(member: OrganizationMember) {
    return memberName(member)
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || 'M';
}

function formatDate(value?: string | null) {
    if (!value) return 'Fecha no disponible';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function roleBadgeVariant(role: OrganizationRole): 'default' | 'secondary' | 'outline' {
    if (role === 'owner') return 'default';
    if (role === 'admin') return 'secondary';
    return 'outline';
}

export function MembersList({
    organizationId,
    members,
    invites,
    currentUserId,
    currentUserRole,
    refreshing = false,
    onRefresh,
}: MembersListProps) {
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const [removeCandidate, setRemoveCandidate] = useState<OrganizationMember | null>(null);
    const { toast } = useToast();

    const canManagePeople = currentUserRole === 'owner' || currentUserRole === 'admin';
    const showInvites = canManagePeople || invites.length > 0;

    function canManageMember(member: OrganizationMember) {
        if (!canManagePeople || member.user_id === currentUserId) return false;
        if (currentUserRole === 'owner') return true;
        return member.role !== 'owner';
    }

    function availableRoles() {
        return currentUserRole === 'owner' ? roleOptions : roleOptions.filter((role) => role !== 'owner');
    }

    async function handleRoleChange(member: OrganizationMember, nextRole: OrganizationRole) {
        if (!canManageMember(member) || nextRole === member.role || pendingAction) return;
        if (currentUserRole === 'admin' && nextRole === 'owner') return;

        const actionId = `role:${member.user_id}`;
        setPendingAction(actionId);

        try {
            const updated = await organizationService.updateMemberRole(organizationId, member.user_id, nextRole);
            if (!updated) throw new Error('role-update-failed');

            toast({ title: 'Rol actualizado', description: `${memberName(member)} ahora tiene el rol ${roleLabels[nextRole].toLowerCase()}.` });
            await onRefresh();
        } catch {
            toast({ variant: 'destructive', title: 'No pudimos cambiar el rol', description: 'El rol no se modificó. Inténtalo de nuevo.' });
        } finally {
            setPendingAction(null);
        }
    }

    async function handleRemoveMember() {
        if (!removeCandidate || !canManageMember(removeCandidate) || pendingAction) return;

        const actionId = `remove:${removeCandidate.user_id}`;
        setPendingAction(actionId);

        try {
            const removed = await organizationService.removeMember(organizationId, removeCandidate.user_id);
            if (!removed) throw new Error('member-removal-failed');

            toast({ title: 'Miembro removido', description: `${memberName(removeCandidate)} ya no tiene acceso a este workspace.` });
            setRemoveCandidate(null);
            await onRefresh();
        } catch {
            toast({ variant: 'destructive', title: 'No pudimos remover al miembro', description: 'El acceso no cambió. Inténtalo de nuevo.' });
        } finally {
            setPendingAction(null);
        }
    }

    async function handleRevoke(inviteId: string) {
        if (!canManagePeople || pendingAction) return;

        const actionId = `invite:${inviteId}`;
        setPendingAction(actionId);

        try {
            const revoked = await organizationService.revokeInvite(inviteId);
            if (!revoked) throw new Error('invite-revoke-failed');

            toast({ title: 'Invitación revocada', description: 'El enlace de invitación dejó de estar activo.' });
            await onRefresh();
        } catch {
            toast({ variant: 'destructive', title: 'No pudimos revocar la invitación', description: 'El enlace sigue activo. Inténtalo de nuevo.' });
        } finally {
            setPendingAction(null);
        }
    }

    return (
        <>
            <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.35)] dark:bg-card/70">
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b border-border/60 px-5 py-5 sm:px-6">
                    <div className="space-y-1.5">
                        <h2 className="text-xl font-semibold tracking-tight text-foreground">Equipo</h2>
                        <CardDescription>Gestiona quién puede colaborar y qué permisos tiene.</CardDescription>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                        {refreshing ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-label="Actualizando equipo" /> : null}
                        <span>{members.length} {members.length === 1 ? 'miembro' : 'miembros'}</span>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    <section aria-labelledby="active-members-heading">
                        <div className="px-5 pb-2 pt-5 sm:px-6">
                            <h3 id="active-members-heading" className="text-sm font-medium text-foreground">Miembros activos</h3>
                        </div>

                        {members.length > 0 ? (
                            <Table aria-label="Miembros activos del workspace">
                                <TableHeader className="sr-only md:not-sr-only md:table-header-group">
                                    <TableRow>
                                        <TableHead>Persona</TableHead>
                                        <TableHead>Rol</TableHead>
                                        <TableHead>Se unió</TableHead>
                                        {canManagePeople ? <TableHead className="w-16"><span className="sr-only">Acciones</span></TableHead> : null}
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="block divide-y divide-border/60 md:table-row-group md:divide-y-0">
                                    {members.map((member) => {
                                        const profile = profileFor(member);
                                        const isCurrentUser = member.user_id === currentUserId;
                                        const memberIsPending = pendingAction?.endsWith(member.user_id) || false;

                                        return (
                                            <TableRow key={member.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-0 px-4 py-4 hover:bg-muted/30 md:table-row md:border-b md:px-0 md:py-0">
                                                <TableCell className="w-full min-w-0 flex-none p-0 md:table-cell md:w-auto md:p-4">
                                                    <div className="flex min-w-0 items-center gap-3">
                                                        <Avatar className="h-10 w-10 border border-border/60">
                                                            <AvatarImage src={profile?.avatar_url || undefined} alt="" />
                                                            <AvatarFallback className="text-xs font-medium">{initialsFor(member)}</AvatarFallback>
                                                        </Avatar>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="truncate font-medium text-foreground">{memberName(member)}</span>
                                                                {isCurrentUser ? <span className="shrink-0 text-xs text-muted-foreground">Tú</span> : null}
                                                            </div>
                                                            {profile?.email && profile.email !== memberName(member) ? (
                                                                <span className="block truncate text-xs text-muted-foreground">{profile.email}</span>
                                                            ) : null}
                                                            <span className="mt-1 block text-xs text-muted-foreground md:hidden">
                                                                Se unió {member.created_at ? <time dateTime={member.created_at}>{formatDate(member.created_at)}</time> : 'en una fecha no disponible'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="block p-0 md:table-cell md:p-4">
                                                    <Badge variant={roleBadgeVariant(member.role)} className="whitespace-nowrap font-medium">
                                                        {roleLabels[member.role]}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                                                    {member.created_at ? <time dateTime={member.created_at}>{formatDate(member.created_at)}</time> : 'Fecha no disponible'}
                                                </TableCell>
                                                {canManagePeople ? (
                                                    <TableCell className="ml-auto block p-0 pr-1 md:table-cell md:p-4">
                                                        {canManageMember(member) ? (
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        disabled={Boolean(pendingAction)}
                                                                        className="h-10 w-10 rounded-full"
                                                                        aria-label={`Gestionar a ${memberName(member)}`}
                                                                    >
                                                                        {memberIsPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                                                                    <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Cambiar rol</DropdownMenuLabel>
                                                                    <DropdownMenuRadioGroup value={member.role} onValueChange={(value) => void handleRoleChange(member, value as OrganizationRole)}>
                                                                        {availableRoles().map((role) => (
                                                                            <DropdownMenuRadioItem key={role} value={role} disabled={role === member.role || Boolean(pendingAction)} className="rounded-lg">
                                                                                {roleLabels[role]}
                                                                            </DropdownMenuRadioItem>
                                                                        ))}
                                                                    </DropdownMenuRadioGroup>
                                                                    <DropdownMenuSeparator />
                                                                    <DropdownMenuItem
                                                                        disabled={Boolean(pendingAction)}
                                                                        onSelect={() => setRemoveCandidate(member)}
                                                                        className="rounded-lg text-destructive focus:bg-destructive/10 focus:text-destructive"
                                                                    >
                                                                        <Trash2 aria-hidden="true" />
                                                                        Remover del workspace
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        ) : null}
                                                    </TableCell>
                                                ) : null}
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        ) : (
                            <div className="mx-5 mb-5 flex items-start gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 sm:mx-6">
                                <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <div>
                                    <p className="text-sm font-medium text-foreground">Aún no hay miembros visibles</p>
                                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Cuando alguien se una al workspace, aparecerá aquí.</p>
                                </div>
                            </div>
                        )}
                    </section>

                    {showInvites ? (
                        <section className="border-t border-border/60" aria-labelledby="pending-invites-heading">
                            <div className="px-5 pb-2 pt-5 sm:px-6">
                                <h3 id="pending-invites-heading" className="text-sm font-medium text-foreground">Invitaciones pendientes</h3>
                                <p className="mt-1 text-sm text-muted-foreground">Enlaces generados que todavía pueden utilizarse.</p>
                            </div>

                            {invites.length > 0 ? (
                                <Table aria-label="Invitaciones pendientes">
                                    <TableHeader className="sr-only md:not-sr-only md:table-header-group">
                                        <TableRow>
                                            <TableHead>Correo</TableHead>
                                            <TableHead>Rol</TableHead>
                                            <TableHead>Vencimiento</TableHead>
                                            {canManagePeople ? <TableHead className="w-28"><span className="sr-only">Acciones</span></TableHead> : null}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody className="block divide-y divide-border/60 md:table-row-group md:divide-y-0">
                                        {invites.map((invite) => {
                                            const expiration = invite.expires_at || invite.expiresAt;
                                            const inviteIsPending = pendingAction === `invite:${invite.id}`;

                                            return (
                                                <TableRow key={invite.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-0 px-4 py-4 hover:bg-muted/30 md:table-row md:border-b md:px-0 md:py-0">
                                                    <TableCell className="min-w-0 flex-1 break-all p-0 font-medium text-foreground md:table-cell md:p-4 md:break-normal">{invite.email}</TableCell>
                                                    <TableCell className="block p-0 md:table-cell md:p-4">
                                                        <Badge variant="outline" className="font-medium">{roleLabels[invite.role]}</Badge>
                                                    </TableCell>
                                                    <TableCell className="w-full p-0 text-xs text-muted-foreground md:table-cell md:w-auto md:p-4 md:text-sm">
                                                        {expiration ? <time dateTime={expiration}>Vence {formatDate(expiration)}</time> : 'Vencimiento no disponible'}
                                                    </TableCell>
                                                    {canManagePeople ? (
                                                        <TableCell className="block p-0 md:table-cell md:p-4">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={Boolean(pendingAction)}
                                                                onClick={() => void handleRevoke(invite.id)}
                                                                className="rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                            >
                                                                {inviteIsPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                                                                {inviteIsPending ? 'Revocando…' : 'Revocar'}
                                                            </Button>
                                                        </TableCell>
                                                    ) : null}
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            ) : (
                                <div className="mx-5 mb-5 flex items-start gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 sm:mx-6">
                                    <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <div>
                                        <p className="text-sm font-medium text-foreground">No hay invitaciones pendientes</p>
                                        <p className="mt-1 text-sm leading-6 text-muted-foreground">Las nuevas invitaciones aparecerán aquí hasta que se usen o se revoquen.</p>
                                    </div>
                                </div>
                            )}
                        </section>
                    ) : null}
                </CardContent>
            </Card>

            <AlertDialog open={Boolean(removeCandidate)} onOpenChange={(nextOpen) => {
                if (!nextOpen && !pendingAction) setRemoveCandidate(null);
            }}>
                <AlertDialogContent className="w-[calc(100%_-_2rem)] rounded-[24px] border-border/70 sm:max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Remover a {removeCandidate ? memberName(removeCandidate) : 'este miembro'}?</AlertDialogTitle>
                        <AlertDialogDescription className="leading-6">
                            Perderá el acceso a este workspace. Sus datos personales y su cuenta no se eliminarán.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2 sm:space-x-0">
                        <AlertDialogCancel disabled={Boolean(pendingAction)} className="rounded-xl">Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={Boolean(pendingAction)}
                            onClick={(event) => {
                                event.preventDefault();
                                void handleRemoveMember();
                            }}
                            className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {pendingAction?.startsWith('remove:') ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                            {pendingAction?.startsWith('remove:') ? 'Removiendo…' : 'Remover miembro'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
