'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, Copy, Loader2, Plus } from 'lucide-react';
import { organizationService } from '@/lib/services/organization-service';
import { useToast } from '@/hooks/use-toast';

type InviteRole = 'admin' | 'member';

type InviteResult = {
    inviteUrl: string;
    expiresAt: string;
};

function validateEmail(value: string) {
    if (!value) return 'Ingresa el correo de la persona que quieres invitar.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Ingresa un correo válido, por ejemplo nombre@empresa.com.';
    return null;
}

function formatExpiration(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'La fecha de vencimiento no está disponible.';

    return `El enlace vence el ${new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'long',
        timeStyle: 'short',
    }).format(date)}.`;
}

export function InviteMemberDialog({ onInviteSent }: { onInviteSent?: () => void }) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<InviteRole>('member');
    const [loading, setLoading] = useState(false);
    const [emailError, setEmailError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [invite, setInvite] = useState<InviteResult | null>(null);
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
    const openRef = useRef(false);

    function resetDialog() {
        setEmail('');
        setRole('member');
        setEmailError(null);
        setSubmitError(null);
        setInvite(null);
        setCopyState('idle');
    }

    function handleOpenChange(nextOpen: boolean) {
        openRef.current = nextOpen;
        setOpen(nextOpen);
        if (!nextOpen && !loading) resetDialog();
    }

    async function handleInvite(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const normalizedEmail = email.trim().toLowerCase();
        const nextEmailError = validateEmail(normalizedEmail);

        setEmailError(nextEmailError);
        setSubmitError(null);
        if (nextEmailError) return;

        setLoading(true);
        try {
            const result = await organizationService.createInvite(normalizedEmail, role);
            if (!result?.inviteUrl || !result.expiresAt) throw new Error('invalid-invite-result');

            setEmail(normalizedEmail);
            setInvite(result);
            onInviteSent?.();
            if (!openRef.current) {
                toast({ title: 'Invitación lista', description: 'Abre Invitar miembro para copiar el enlace.' });
            }
        } catch {
            setSubmitError('No pudimos generar la invitación. Revisa el correo e inténtalo de nuevo.');
            if (!openRef.current) {
                toast({
                    title: 'No pudimos generar la invitación',
                    description: 'Abre el formulario e inténtalo de nuevo.',
                    variant: 'destructive',
                });
            }
        } finally {
            setLoading(false);
        }
    }

    async function handleCopy() {
        if (!invite) return;

        try {
            await navigator.clipboard.writeText(invite.inviteUrl);
            setCopyState('copied');
        } catch {
            setCopyState('error');
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button className="min-h-10 rounded-xl">
                    <Plus aria-hidden="true" /> Invitar miembro
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100%_-_2rem)] max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-[24px] border-border/70 p-5 shadow-2xl motion-reduce:duration-0 sm:max-w-[480px] sm:p-6">
                {invite ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Invitación lista</DialogTitle>
                            <DialogDescription className="leading-6">
                                Comparte este enlace con {email}. Solo esa persona debería recibirlo.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-3 py-2">
                            <Label htmlFor="invite-url">Enlace de invitación</Label>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <Input id="invite-url" value={invite.inviteUrl} readOnly className="min-w-0 bg-muted/35 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
                                <Button type="button" onClick={() => void handleCopy()} className="shrink-0 rounded-xl">
                                    {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                                    {copyState === 'copied' ? 'Copiado' : 'Copiar'}
                                </Button>
                            </div>
                            <p className="text-sm leading-6 text-muted-foreground">{formatExpiration(invite.expiresAt)}</p>
                            {copyState === 'error' ? (
                                <p className="text-sm leading-6 text-destructive" role="alert">No pudimos copiar el enlace. Selecciónalo y cópialo manualmente.</p>
                            ) : null}
                            {copyState === 'copied' ? (
                                <p className="text-sm leading-6 text-emerald-700 dark:text-emerald-400" role="status">Enlace copiado al portapapeles.</p>
                            ) : null}
                        </div>

                        <DialogFooter className="gap-2 sm:space-x-0">
                            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="rounded-xl">Cerrar</Button>
                        </DialogFooter>
                    </>
                ) : (
                    <form onSubmit={handleInvite} noValidate>
                        <DialogHeader>
                            <DialogTitle>Invitar al equipo</DialogTitle>
                            <DialogDescription className="leading-6">
                                Genera un enlace personal para sumar a alguien a este workspace.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-5 py-5">
                            <div className="space-y-2">
                                <Label htmlFor="invite-email">Correo electrónico</Label>
                                <Input
                                    id="invite-email"
                                    type="email"
                                    inputMode="email"
                                    autoComplete="email"
                                    placeholder="nombre@empresa.com"
                                    value={email}
                                    onChange={(event) => {
                                        setEmail(event.target.value);
                                        setEmailError(null);
                                        setSubmitError(null);
                                    }}
                                    disabled={loading}
                                    aria-invalid={Boolean(emailError)}
                                    aria-describedby={emailError ? 'invite-email-error' : undefined}
                                    className="h-11 rounded-xl"
                                    autoFocus
                                />
                                {emailError ? <p id="invite-email-error" className="text-sm leading-5 text-destructive" role="alert">{emailError}</p> : null}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="invite-role">Rol</Label>
                                <Select value={role} onValueChange={(value) => setRole(value as InviteRole)} disabled={loading}>
                                    <SelectTrigger id="invite-role" aria-describedby="invite-role-help" className="h-11 rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="member">Miembro</SelectItem>
                                        <SelectItem value="admin">Administrador</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p id="invite-role-help" className="text-sm leading-6 text-muted-foreground">
                                    {role === 'admin'
                                        ? 'Puede invitar personas, gestionar roles y remover integrantes que no sean propietarios.'
                                        : 'Puede colaborar en el workspace, pero no gestionar personas ni invitaciones.'}
                                </p>
                            </div>

                            {submitError ? <p className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-destructive" role="alert">{submitError}</p> : null}
                        </div>

                        <DialogFooter className="gap-2 sm:space-x-0">
                            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} className="rounded-xl">Cancelar</Button>
                            <Button type="submit" disabled={loading} className="rounded-xl">
                                {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                                {loading ? 'Generando…' : 'Generar invitación'}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
