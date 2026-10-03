'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, UsersRound } from 'lucide-react';

import Logo from '@/components/logo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { formatDate } from '@/lib/dates';
import { INVITE_ROLE_LABELS, inviteAcceptErrorMessage, type InvitePreview } from '@/lib/organization-invite-preview';
import { organizationService } from '@/lib/services/organization-service';
import { supabase } from '@/lib/supabase';

type ValidPreview = Exclude<InvitePreview, { status: 'invalid' }>;

const CLOSED: Record<Exclude<ValidPreview['status'], 'valid'>, string> = {
    expired: 'venció',
    used: 'ya se usó',
    revoked: 'fue revocada',
};

/**
 * An invitation link shows what it is for and waits for the person to accept it. Opening the link no longer joins the
 * organization on its own; the accept API checks the invited address again.
 */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();
    const [token, setToken] = useState('');
    const [preview, setPreview] = useState<InvitePreview | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [accepting, setAccepting] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [acceptError, setAcceptError] = useState<string | null>(null);
    const sessionEmail = user?.email ?? null;

    useEffect(() => {
        let active = true;
        void params.then(({ token: value }) => { if (active) setToken(value); });
        return () => { active = false; };
    }, [params]);

    useEffect(() => {
        if (!token || authLoading) return;
        const controller = new AbortController();
        setLoadError(false);
        // Asked again when the session changes, so «es para tu cuenta» follows who is signed in.
        fetch('/api/organizations/invites/preview', { cache: 'no-store', headers: { 'x-invite-token': token }, signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error(String(response.status));
                return response.json() as Promise<InvitePreview>;
            })
            .then((data) => { if (!controller.signal.aborted) setPreview(data); })
            .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
        return () => controller.abort();
    }, [token, authLoading, sessionEmail]);

    const loginHref = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;

    const accept = async () => {
        setAccepting(true);
        setAcceptError(null);
        try {
            await organizationService.acceptInvite(token);
            setAccepted(true);
        } catch (error) {
            setAcceptError(inviteAcceptErrorMessage(error instanceof Error ? error.message : null));
        } finally {
            setAccepting(false);
        }
    };

    const switchAccount = async () => {
        await supabase.auth.signOut();
        window.location.assign(loginHref);
    };

    let title = 'Invitación a un equipo';
    let description: string | null = null;
    let body: React.ReactNode;

    if (loadError) {
        body = (
            <Alert variant="destructive" role="alert">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>No pudimos revisar la invitación. Recarga la página para intentarlo de nuevo.</AlertDescription>
            </Alert>
        );
    } else if (!preview || authLoading) {
        body = (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Revisando la invitación…
            </div>
        );
    } else if (preview.status === 'invalid') {
        description = 'Este enlace no corresponde a ninguna invitación.';
        body = (
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Revisa que el enlace esté completo o pide uno nuevo a quien te invitó.</p>
                <Button asChild className="w-full"><Link href={user ? '/dashboard' : '/login'}>{user ? 'Ir a Hoy' : 'Iniciar sesión'}</Link></Button>
            </div>
        );
    } else if (accepted) {
        title = `Ya eres parte de ${preview.organizationName}`;
        description = `Entraste como ${INVITE_ROLE_LABELS[preview.role]}.`;
        body = (
            <div className="space-y-4">
                <Alert variant="success" role="status">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    <AlertDescription>Tu espacio de trabajo cambió a {preview.organizationName}. Puedes cambiarlo desde el menú.</AlertDescription>
                </Alert>
                <Button className="w-full" onClick={() => router.push('/dashboard')}>Ir a Hoy</Button>
            </div>
        );
    } else if (preview.status !== 'valid') {
        title = `Invitación a ${preview.organizationName}`;
        description = `Esta invitación ${CLOSED[preview.status]}.`;
        body = (
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Pide una nueva a quien te invitó. Las invitaciones duran 7 días y sirven una sola vez.</p>
                <Button asChild variant="outline" className="w-full"><Link href={user ? '/dashboard' : '/login'}>{user ? 'Ir a Hoy' : 'Iniciar sesión'}</Link></Button>
            </div>
        );
    } else {
        title = `Te invitaron a ${preview.organizationName}`;
        description = `Como ${INVITE_ROLE_LABELS[preview.role]}${preview.expiresAt ? ` · vence el ${formatDate(preview.expiresAt)}` : ''}.`;
        const recipient = preview.emailHint ? <span className="font-medium text-foreground">{preview.emailHint}</span> : 'otra cuenta';
        if (!preview.signedIn) {
            body = (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">Es para {recipient}. Inicia sesión o crea tu cuenta con ese correo para aceptarla.</p>
                    <Button asChild className="w-full"><Link href={loginHref}>Iniciar sesión para aceptar</Link></Button>
                </div>
            );
        } else if (preview.matchesSession === false) {
            body = (
                <div className="space-y-4">
                    <Alert variant="warning">
                        <AlertCircle className="h-4 w-4" aria-hidden="true" />
                        <AlertDescription>
                            Esta invitación es para {recipient} y entraste como <span className="font-medium">{sessionEmail}</span>. Cierra sesión y entra con el correo invitado.
                        </AlertDescription>
                    </Alert>
                    <Button className="w-full" onClick={() => void switchAccount()}>Cambiar de cuenta</Button>
                    <Button asChild variant="ghost" className="w-full"><Link href="/dashboard">Ahora no</Link></Button>
                </div>
            );
        } else {
            body = (
                <div className="space-y-4">
                    {acceptError && (
                        <Alert variant="destructive" role="alert">
                            <AlertCircle className="h-4 w-4" aria-hidden="true" />
                            <AlertDescription>{acceptError}</AlertDescription>
                        </Alert>
                    )}
                    <p className="text-sm text-muted-foreground">
                        Vas a entrar con <span className="font-medium text-foreground">{sessionEmail}</span> y trabajarás en el espacio de {preview.organizationName}.
                    </p>
                    <Button className="w-full" onClick={() => void accept()} disabled={accepting}>
                        {accepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        Aceptar invitación
                    </Button>
                    <Button asChild variant="ghost" className="w-full"><Link href="/dashboard">Ahora no</Link></Button>
                </div>
            );
        }
    }

    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/50 px-4 py-10">
            <Logo size="lg" showWordmark />
            <Card className="w-full max-w-md">
                <CardHeader className="items-center space-y-2 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <UsersRound className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                    {description && <CardDescription>{description}</CardDescription>}
                </CardHeader>
                <CardContent>{body}</CardContent>
            </Card>
        </main>
    );
}
