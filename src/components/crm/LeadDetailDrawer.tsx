'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription
} from '@/components/ui/sheet';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import { activityService } from '@/lib/services/activity-service';
import type { Activity } from '@/lib/crm-types';
import { CommercialTimeline } from '@/components/commercial/CommercialTimeline';
import { ContactabilityStatusCard } from '@/components/commercial/ContactabilityStatusCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Calendar, Clock3, Loader2, Mail, MessageSquare, MessageSquareWarning, RotateCcw, UserRound, UsersRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
    collaborationMemberName,
    contactThreadConflictsWithLead,
    isContactThreadActive,
    isCollaborationUnavailable,
    isLeadClaimActive,
    leadCollaborationService,
    resolveLeadUuid,
    type LeadCollaborationResult,
    type LeadContactState,
} from '@/lib/services/lead-collaboration-service';
import Link from 'next/link';

interface Props {
    lead: UnifiedRow | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function getAISuggestion(lead: UnifiedRow, activities: Activity[]): string {
    const stage = lead.stage || 'inbox';
    const hasEmail = activities.some(a => a.type === 'email');
    const lastEmail = activities.find(a => a.type === 'email' && a.title.includes('enviado'));
    const hasReply = activities.some(a => a.type === 'email' && a.title.includes('Respuesta'));

    // Calculate days since last contact
    let daysSinceContact = 0;
    if (lastEmail) {
        const lastContactDate = new Date(lastEmail.createdAt);
        daysSinceContact = Math.floor((Date.now() - lastContactDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Generate suggestion based on stage and activity
    if (stage === 'inbox' || stage === 'qualified') {
        if (!hasEmail) {
            return `Este lead aún no ha sido contactado. Es un buen momento para enviar el primer email de presentación.`;
        }
    }

    if (stage === 'contacted') {
        if (hasReply) {
            return `¡El lead respondió! Revisa su mensaje y programa una llamada o reunión para avanzar.`;
        }
        if (daysSinceContact >= 3) {
            return `Han pasado ${daysSinceContact} días desde el último contacto sin respuesta. Considera enviar un follow-up o intentar por otro canal.`;
        }
        return `Email enviado hace ${daysSinceContact} día(s). Espera 2-3 días antes del follow-up.`;
    }

    if (stage === 'engaged') {
        return `El lead está interesado. Agenda una demo o reunión para presentar tu solución en detalle.`;
    }

    if (stage === 'meeting') {
        return `Reunión agendada. Prepara la presentación y confirma la asistencia 24h antes.`;
    }

    return `Revisa el historial de actividad y decide el próximo paso según el contexto del lead.`;
}

function humanizeValue(value: string) {
    return value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

const CONTACT_STATE_LABELS: Record<LeadContactState, string> = {
    uncontacted: 'Sin contactar',
    reserved: 'En preparación',
    contacted: 'Contactado',
    replied: 'Respondió',
    suppressed: 'No contactar',
};

function formatCollaborationDate(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('es-ES', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

type PendingCollaborationAction = 'assign' | 'claim' | 'release' | 'reopen' | null;
type ContactAvailability = 'checking' | 'allowed' | 'blocked';
type ContactAvailabilityState = { leadKey: string; availability: ContactAvailability };

function LeadCollaborationPanel({
    lead,
    open,
    leadKey,
    onContactAvailabilityChange,
}: {
    lead: UnifiedRow;
    open: boolean;
    leadKey: string;
    onContactAvailabilityChange: (state: ContactAvailabilityState) => void;
}) {
    const { organizationId, user } = useAuth();
    const { toast } = useToast();
    const leadId = resolveLeadUuid(lead);
    const [data, setData] = useState<LeadCollaborationResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [pendingAction, setPendingAction] = useState<PendingCollaborationAction>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [selectedAssignee, setSelectedAssignee] = useState<string | undefined>();
    const [claimClock, setClaimClock] = useState(() => Date.now());
    const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
    const [reopenReason, setReopenReason] = useState('');
    const [reopenError, setReopenError] = useState<string | null>(null);
    const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);
    const reopenDialogOpenRef = useRef(false);

    const collaboration = data?.collaboration || null;
    const contactThread = data?.contactThread || null;
    const claimIsActive = isLeadClaimActive(collaboration, claimClock);
    const currentMember = data?.members.find((member) => member.user_id === user?.id);
    const assignedMemberIsActive = Boolean(data?.members.some((member) => member.user_id === collaboration?.assigned_to_user_id));
    const currentUserIsManager = currentMember?.role === 'owner' || currentMember?.role === 'admin';
    const claimBelongsToCurrentUser = claimIsActive && collaboration?.claimed_by_user_id === user?.id;
    const threadIsActive = isContactThreadActive(contactThread);
    const threadConflict = leadId ? contactThreadConflictsWithLead(contactThread, leadId, user?.id) : false;
    const contactIsSuppressed = collaboration?.contact_state === 'suppressed' || contactThread?.status === 'suppressed';
    const contactIsBlocked = threadConflict || contactIsSuppressed || contactThread?.status === 'closed';
    const collaborationScopeKey = organizationId && leadId ? `${organizationId}:${leadId}` : null;
    const collaborationIsCurrent = Boolean(data && collaborationScopeKey && loadedScopeKey === collaborationScopeKey);
    const canAssign = Boolean(data?.permissions.canAssign && currentUserIsManager);
    const canClaim = Boolean(data?.permissions.canClaim && !claimIsActive);
    const canReleaseClaim = Boolean(
        data?.permissions.canReleaseClaim
        && claimIsActive
        && (claimBelongsToCurrentUser || currentUserIsManager),
    );
    const canReopen = Boolean(
        data?.permissions.canReopen
        && currentUserIsManager
        && contactThread?.id,
    );

    useEffect(() => {
        setData(null);
        setLoading(false);
        setLoadError(false);
        setUnavailable(false);
        setPendingAction(null);
        setActionError(null);
        setSelectedAssignee(undefined);
        setReopenDialogOpen(false);
        setReopenReason('');
        setReopenError(null);
        setLoadedScopeKey(null);
        reopenDialogOpenRef.current = false;

        if (!open || !organizationId || !leadId) return;

        let cancelled = false;
        setLoading(true);
        const applyResult = (result: LeadCollaborationResult) => {
            if (cancelled) return;
            setData(result);
            setLoadedScopeKey(`${organizationId}:${leadId}`);
            setSelectedAssignee(result.collaboration?.assigned_to_user_id || undefined);
        };
        const unsubscribe = leadCollaborationService.subscribe(organizationId, leadId, applyResult);

        void leadCollaborationService.getCollaboration(organizationId, leadId, { force: true })
            .then(applyResult)
            .catch((error) => {
                if (cancelled) return;
                if (isCollaborationUnavailable(error)) setUnavailable(true);
                else setLoadError(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [leadId, open, organizationId, reloadKey]);

    useEffect(() => {
        if (!open) {
            onContactAvailabilityChange({ leadKey, availability: 'checking' });
            return;
        }
        if (unavailable) {
            onContactAvailabilityChange({ leadKey, availability: 'allowed' });
            return;
        }
        if (!organizationId || !leadId) {
            onContactAvailabilityChange({ leadKey, availability: 'blocked' });
            return;
        }
        if (!collaborationIsCurrent) {
            onContactAvailabilityChange({ leadKey, availability: 'checking' });
            return;
        }
        onContactAvailabilityChange({ leadKey, availability: contactIsBlocked ? 'blocked' : 'allowed' });
    }, [collaborationIsCurrent, contactIsBlocked, leadId, leadKey, onContactAvailabilityChange, open, organizationId, unavailable]);

    useEffect(() => {
        setClaimClock(Date.now());
        if (!collaboration?.claim_expires_at) return;
        const expiresAt = new Date(collaboration.claim_expires_at).getTime();
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
        const timeout = window.setTimeout(() => {
            setClaimClock(Date.now());
            if (open && organizationId && leadId) {
                void leadCollaborationService.getCollaboration(organizationId, leadId, { force: true }).catch(() => undefined);
            }
        }, expiresAt - Date.now() + 50);
        return () => window.clearTimeout(timeout);
    }, [collaboration?.claim_expires_at, leadId, open, organizationId]);

    if (!open || !organizationId || !leadId || unavailable) return null;

    function applyMutationResult(result: LeadCollaborationResult) {
        setData(result);
        setSelectedAssignee(result.collaboration?.assigned_to_user_id || undefined);
    }

    async function handleAssignment(nextUserId: string) {
        if (!canAssign || !organizationId || !leadId || pendingAction || nextUserId === collaboration?.assigned_to_user_id) return;
        const previousAssignee = collaboration?.assigned_to_user_id || undefined;
        setSelectedAssignee(nextUserId);
        setPendingAction('assign');
        setActionError(null);
        try {
            applyMutationResult(await leadCollaborationService.assign(organizationId, leadId, nextUserId));
            toast({ title: 'Responsable actualizado', description: 'El equipo ya puede ver quién continúa con este lead.' });
        } catch {
            setSelectedAssignee(previousAssignee);
            setActionError('No pudimos cambiar el responsable. Inténtalo de nuevo.');
        } finally {
            setPendingAction(null);
        }
    }

    async function handleClaim() {
        if (!canClaim || !organizationId || !leadId || pendingAction) return;
        setPendingAction('claim');
        setActionError(null);
        try {
            applyMutationResult(await leadCollaborationService.claim(organizationId, leadId, 15));
            toast({ title: 'Lead reservado', description: 'Tienes 15 minutos para prepararlo.' });
        } catch {
            setActionError('No pudimos reservar este lead. Puede que otra persona ya lo esté preparando.');
        } finally {
            setPendingAction(null);
        }
    }

    async function handleReleaseClaim() {
        if (!canReleaseClaim || !organizationId || !leadId || pendingAction) return;
        setPendingAction('release');
        setActionError(null);
        try {
            applyMutationResult(await leadCollaborationService.releaseClaim(organizationId, leadId));
            toast({ title: 'Preparación liberada', description: 'Otro miembro ya puede preparar este lead.' });
        } catch {
            setActionError('No pudimos liberar la preparación. Inténtalo de nuevo.');
        } finally {
            setPendingAction(null);
        }
    }

    async function handleReopen(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const reason = reopenReason.trim();
        if (!canReopen || !organizationId || !leadId || !contactThread?.id || pendingAction) return;
        if (reason.length < 3) {
            setReopenError('Escribe un motivo de al menos 3 caracteres.');
            return;
        }

        setPendingAction('reopen');
        setReopenError(null);
        try {
            applyMutationResult(await leadCollaborationService.reopen(organizationId, leadId, contactThread.id, reason));
            setReopenDialogOpen(false);
            setReopenReason('');
            toast({ title: 'Contacto reabierto', description: 'El equipo puede volver a trabajar este contacto.' });
        } catch {
            setReopenError('No pudimos reabrir el contacto. Revisa el motivo e inténtalo de nuevo.');
            if (!reopenDialogOpenRef.current) {
                toast({
                    title: 'No pudimos reabrir el contacto',
                    description: 'Abre el formulario e inténtalo de nuevo.',
                    variant: 'destructive',
                });
            }
        } finally {
            setPendingAction(null);
        }
    }

    const threadOwnerId = contactThread?.last_sent_by_user_id || contactThread?.opened_by_user_id;
    const threadOwnerName = collaborationMemberName(data?.members || [], threadOwnerId, user?.id);
    const lastContactedAt = formatCollaborationDate(contactThread?.last_contacted_at);

    return (
        <>
            <section aria-labelledby="lead-collaboration-heading" className="mb-6 rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                        <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div>
                            <h3 id="lead-collaboration-heading" className="text-sm font-semibold text-foreground">Colaboración</h3>
                            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Responsabilidad y contacto compartidos con tu equipo.</p>
                        </div>
                    </div>
                    {pendingAction && (
                        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Guardando cambios de colaboración" />
                    )}
                </div>

                {loading && !data ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2" role="status" aria-live="polite" aria-busy="true">
                        <span className="sr-only">Cargando colaboración.</span>
                        <Skeleton className="h-11 w-full" />
                        <Skeleton className="h-11 w-full" />
                        <Skeleton className="h-11 w-full" />
                        <Skeleton className="h-11 w-full" />
                    </div>
                ) : loadError && !data ? (
                    <div className="mt-4 rounded-lg border border-border/70 bg-background/70 px-3 py-3">
                        <p className="text-sm text-muted-foreground" role="alert">No pudimos cargar la colaboración de este lead.</p>
                        <Button type="button" variant="ghost" size="sm" className="mt-2 px-2 text-xs" onClick={() => setReloadKey((key) => key + 1)}>
                            Reintentar
                        </Button>
                    </div>
                ) : !collaboration || !data ? (
                    <p className="mt-4 text-sm text-muted-foreground">Este lead aún no tiene información de colaboración compartida.</p>
                ) : (
                    <>
                        <dl className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                            <div className="min-w-0">
                                <dt className="text-xs font-medium text-muted-foreground">Descubierto por</dt>
                                <dd className="mt-1 truncate text-sm font-medium text-foreground">
                                    {collaborationMemberName(data.members, collaboration.discovered_by_user_id, user?.id)}
                                </dd>
                                {formatCollaborationDate(collaboration.discovered_at) && (
                                    <dd className="mt-0.5 text-xs text-muted-foreground">
                                        <time dateTime={collaboration.discovered_at}>{formatCollaborationDate(collaboration.discovered_at)}</time>
                                    </dd>
                                )}
                            </div>

                            {canAssign ? (
                                <div className="min-w-0">
                                    <dt><Label htmlFor={`lead-assignee-${leadId}`} className="text-xs font-medium text-muted-foreground">Responsable</Label></dt>
                                    <dd>
                                        <Select value={selectedAssignee} onValueChange={handleAssignment} disabled={Boolean(pendingAction)}>
                                            <SelectTrigger id={`lead-assignee-${leadId}`} className="mt-1 h-9 bg-background text-sm">
                                                <SelectValue placeholder="Sin responsable" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {collaboration.assigned_to_user_id && !assignedMemberIsActive && (
                                                    <SelectItem value={collaboration.assigned_to_user_id} disabled>Miembro sin acceso</SelectItem>
                                                )}
                                                {data.members.map((member) => (
                                                    <SelectItem key={member.user_id} value={member.user_id}>
                                                        {collaborationMemberName(data.members, member.user_id, user?.id)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </dd>
                                </div>
                            ) : (
                                <div className="min-w-0">
                                    <dt className="text-xs font-medium text-muted-foreground">Responsable</dt>
                                    <dd className="mt-1 truncate text-sm font-medium text-foreground">
                                        {collaboration.assigned_to_user_id
                                            ? collaborationMemberName(data.members, collaboration.assigned_to_user_id, user?.id)
                                            : 'Sin asignar'}
                                    </dd>
                                </div>
                            )}

                            <div className="min-w-0">
                                <dt className="text-xs font-medium text-muted-foreground">Preparación</dt>
                                <dd className="mt-1 text-sm font-medium text-foreground">
                                    {claimIsActive && collaboration.claimed_by_user_id
                                        ? collaborationMemberName(data.members, collaboration.claimed_by_user_id, user?.id)
                                        : 'Sin preparación activa'}
                                </dd>
                                {claimIsActive && collaboration.claim_expires_at && (
                                    <dd className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Vence <time dateTime={collaboration.claim_expires_at}>{formatCollaborationDate(collaboration.claim_expires_at)}</time></span>
                                    </dd>
                                )}
                            </div>

                            <div className="min-w-0">
                                <dt className="text-xs font-medium text-muted-foreground">Estado de contacto</dt>
                                <dd className="mt-1 text-sm font-medium text-foreground">{CONTACT_STATE_LABELS[collaboration.contact_state]}</dd>
                            </div>
                        </dl>

                        {(threadIsActive || contactIsSuppressed || contactThread?.status === 'closed') && (
                            <div className={`mt-4 flex gap-2.5 rounded-lg border px-3 py-3 ${contactIsBlocked ? 'border-amber-300/70 bg-amber-50/70 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100' : 'border-border/70 bg-background/70 text-foreground'}`}>
                                {contactIsBlocked
                                    ? <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                    : <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                                <div className="min-w-0">
                                    <h4 className="text-sm font-medium">
                                        {contactIsSuppressed
                                            ? 'Contacto bloqueado'
                                            : threadConflict
                                                ? 'Este contacto ya tiene un hilo activo'
                                                : contactThread?.status === 'closed'
                                                    ? 'Hilo de contacto cerrado'
                                                    : 'Hilo de contacto activo'}
                                    </h4>
                                    <p className="mt-1 text-xs leading-5 opacity-80">
                                        {contactThread
                                            ? `${threadOwnerId ? `Gestionado por ${threadOwnerName}` : 'Responsable del hilo no disponible'}${lastContactedAt ? ` · Último contacto ${lastContactedAt}` : ''}`
                                            : 'No se pueden iniciar nuevos envíos.'}
                                    </p>
                                    {threadConflict && <p className="mt-1 text-xs leading-5 opacity-80">No inicies otro envío mientras este hilo siga activo.</p>}
                                    {contactThread?.status === 'closed' && !canReopen && <p className="mt-1 text-xs leading-5 opacity-80">Este contacto todavía no se puede reabrir.</p>}
                                </div>
                            </div>
                        )}

                        {(canClaim || canReleaseClaim || canReopen) && (
                            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                                {canClaim && (
                                    <Button type="button" variant="outline" size="sm" className="text-xs" onClick={handleClaim} disabled={Boolean(pendingAction)}>
                                        {pendingAction === 'claim' ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <UserRound />}
                                        Preparar este lead
                                    </Button>
                                )}
                                {canReleaseClaim && (
                                    <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={handleReleaseClaim} disabled={Boolean(pendingAction)}>
                                        {pendingAction === 'release' && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                                        Liberar preparación
                                    </Button>
                                )}
                                {canReopen && (
                                    <Button type="button" variant={contactIsBlocked ? 'default' : 'outline'} size="sm" className="text-xs" onClick={() => setReopenDialogOpen(true)} disabled={Boolean(pendingAction)}>
                                        <RotateCcw />
                                        Reabrir contacto
                                    </Button>
                                )}
                            </div>
                        )}

                        {actionError && <p className="mt-3 text-sm text-destructive" role="alert">{actionError}</p>}
                    </>
                )}
            </section>

            {canReopen && (
                <Dialog
                    open={reopenDialogOpen}
                    onOpenChange={(nextOpen) => {
                        setReopenDialogOpen(nextOpen);
                        reopenDialogOpenRef.current = nextOpen;
                        if (!nextOpen && pendingAction !== 'reopen') {
                            setReopenReason('');
                            setReopenError(null);
                        }
                    }}
                >
                    <DialogContent className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] overflow-y-auto rounded-xl sm:max-w-md">
                        <form className="space-y-4" onSubmit={handleReopen}>
                            <DialogHeader>
                                <DialogTitle>Reabrir contacto</DialogTitle>
                                <DialogDescription>
                                    Indica por qué es necesario volver a contactar. El motivo quedará visible en el historial del equipo.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                <Label htmlFor="lead-reopen-reason">Motivo</Label>
                                <Textarea
                                    id="lead-reopen-reason"
                                    value={reopenReason}
                                    onChange={(event) => {
                                        setReopenReason(event.target.value);
                                        if (event.target.value.trim().length >= 3) setReopenError(null);
                                    }}
                                    placeholder="Ej. El contacto solicitó retomar la conversación."
                                    maxLength={1000}
                                    disabled={pendingAction === 'reopen'}
                                    aria-invalid={Boolean(reopenError)}
                                    aria-describedby={reopenError ? 'lead-reopen-help lead-reopen-error' : 'lead-reopen-help'}
                                    autoFocus
                                />
                                <p id="lead-reopen-help" className="text-xs text-muted-foreground">Mínimo 3 caracteres.</p>
                                {reopenError && <p id="lead-reopen-error" className="text-sm text-destructive" role="alert">{reopenError}</p>}
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button type="button" variant="outline">Cancelar</Button>
                                </DialogClose>
                                <Button type="submit" disabled={pendingAction === 'reopen' || reopenReason.trim().length < 3}>
                                    {pendingAction === 'reopen' && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                                    Reabrir contacto
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}


export function LeadDetailDrawer({ lead, open, onOpenChange }: Props) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [activitiesLoading, setActivitiesLoading] = useState(false);
    const [activitiesError, setActivitiesError] = useState(false);
    const [contactAvailabilityState, setContactAvailabilityState] = useState<ContactAvailabilityState>({ leadKey: '', availability: 'checking' });
    const leadKey = lead ? `${lead.gid || ''}:${lead.sourceId || ''}` : '';
    const contactAvailability = contactAvailabilityState.leadKey === leadKey
        ? contactAvailabilityState.availability
        : 'checking';

    useEffect(() => {
        if (lead && open) {
            setActivitiesLoading(true);
            setActivitiesError(false);
            const leadId = lead.sourceId;
            activityService.getLeadActivities(leadId, lead.gid, lead.email || undefined)
                .then(setActivities)
                .catch((error) => {
                    console.error(error);
                    setActivitiesError(true);
                })
                .finally(() => setActivitiesLoading(false));
        } else {
            setActivities([]);
            setActivitiesLoading(false);
            setActivitiesError(false);
        }
    }, [lead, open]);

    useEffect(() => {
        if (!open || !leadKey) {
            setContactAvailabilityState({ leadKey: '', availability: 'checking' });
        }
    }, [leadKey, open]);

    if (!lead) return null;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-[540px]">
                <SheetHeader className="mb-5">
                    <div className="flex items-start gap-4">
                        <Avatar className="h-12 w-12">
                            <AvatarFallback>{lead.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 space-y-1">
                            <SheetTitle>{lead.name || 'Lead sin nombre'}</SheetTitle>
                            <SheetDescription>
                                {[lead.title, lead.company].filter(Boolean).join(' · ') || 'Sin cargo o empresa'}
                            </SheetDescription>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                {lead.email && (
                                    contactAvailability !== 'allowed' ? (
                                        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled>
                                            <Mail className="mr-1 h-3 w-3" /> {contactAvailability === 'checking' ? 'Verificando email…' : 'Email no disponible'}
                                        </Button>
                                    ) : (
                                        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                                          <Link href={`/contact/compose?id=${lead.sourceId}&email=${lead.email}`}>
                                                <Mail className="mr-1 h-3 w-3" /> Email
                                          </Link>
                                        </Button>
                                    )
                                )}
                                {lead.linkedinUrl && (
                                    <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                                      <a href={lead.linkedinUrl} target="_blank" rel="noreferrer">
                                        <span className="mr-1 font-bold text-sky-700 dark:text-sky-300">in</span> LinkedIn
                                      </a>
                                    </Button>
                                )}
                                <Badge variant="secondary">{humanizeValue(String(lead.stage || 'inbox'))}</Badge>
                                {lead.autopilotStatus && <Badge variant="outline">{humanizeValue(lead.autopilotStatus)}</Badge>}
                            </div>
                        </div>
                    </div>
                </SheetHeader>

                <div className="mb-6">
                    <ContactabilityStatusCard email={lead.email} compact />
                </div>

                <LeadCollaborationPanel
                    lead={lead}
                    open={open}
                    leadKey={leadKey}
                    onContactAvailabilityChange={setContactAvailabilityState}
                />

                {(lead.nextAction || lead.nextActionDueAt || lead.meetingLink) && (
                    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                        <h4 className="mb-1 text-sm font-semibold text-amber-900 dark:text-amber-100">Próxima acción registrada</h4>
                        {lead.nextAction && <p className="text-sm text-amber-800 dark:text-amber-100/80">{lead.nextAction}</p>}
                        {lead.nextActionDueAt && (
                            <p className="mt-2 text-xs text-amber-700 dark:text-amber-200/80">
                                Vence: {new Date(lead.nextActionDueAt).toLocaleString()}
                            </p>
                        )}
                        {lead.meetingLink && (
                            <Button asChild size="sm" variant="outline" className="mt-3 h-8 text-xs">
                              <a href={lead.meetingLink} target="_blank" rel="noreferrer">
                                    <Calendar className="h-3 w-3 mr-1" /> Abrir booking link
                              </a>
                            </Button>
                        )}
                    </div>
                )}

                <div className="mb-6 rounded-lg border border-border/70 bg-muted/30 p-4">
                    <h4 className="mb-1 text-sm font-semibold text-foreground">
                        Siguiente paso sugerido
                    </h4>
                    {activitiesLoading ? (
                        <p className="text-sm text-muted-foreground">Revisando actividad…</p>
                    ) : activitiesError ? (
                        <p className="text-sm text-muted-foreground">No se pudo revisar la actividad. Puedes abrir el historial más abajo.</p>
                    ) : (
                        <p className="text-sm text-muted-foreground">{getAISuggestion(lead, activities)}</p>
                    )}
                    <div className="mt-3 flex gap-2">
                        {lead.email && (
                            contactAvailability !== 'allowed' ? (
                                <Button type="button" size="sm" className="h-8 text-xs" disabled>
                                    {contactAvailability === 'checking' ? 'Verificando envío…' : 'Envío no disponible'}
                                </Button>
                            ) : (
                                <Button asChild size="sm" className="h-8 text-xs">
                                  <Link href={`/contact/compose?id=${lead.sourceId}&email=${lead.email}`}>
                                        Enviar email
                                  </Link>
                                </Button>
                            )
                        )}
                    </div>
                </div>

                <CommercialTimeline
                    leadId={lead.sourceId}
                    gid={lead.gid}
                    email={lead.email}
                    name={lead.name}
                    company={lead.company}
                />

            </SheetContent>
        </Sheet>
    );
}
