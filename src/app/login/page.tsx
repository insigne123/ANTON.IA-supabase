'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Eye, EyeOff, Loader2, MailCheck } from 'lucide-react';

import Logo from '@/components/logo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { PASSWORD_RESET_SENT, authErrorMessage } from '@/lib/auth-messages';
import { safeNextPath } from '@/lib/safe-next-path';

type View = 'login' | 'recover';
type Notice = { tone: 'error' | 'success'; text: string } | null;

const HEADINGS: Record<View, { title: string; description: string }> = {
    login: { title: 'Entra a tu cuenta', description: 'Prospecta, escribe y da seguimiento desde un solo lugar.' },
    recover: { title: 'Recupera tu contraseña', description: 'Te enviamos un enlace para crear una contraseña nueva.' },
};

function PasswordField({ id, label, value, onChange, autoComplete, visible, onToggle, hint }: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    autoComplete: string;
    visible: boolean;
    onToggle?: () => void;
    hint?: string;
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>{label}</Label>
            <div className="relative">
                <Input
                    id={id}
                    type={visible ? 'text' : 'password'}
                    autoComplete={autoComplete}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    aria-describedby={hint ? `${id}-hint` : undefined}
                    className={onToggle ? 'pr-11' : undefined}
                    required
                />
                {onToggle && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={onToggle}
                        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        aria-pressed={visible}
                    >
                        {visible ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                )}
            </div>
            {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );
}

function LoginContent() {
    const { signInWithPassword, signInWithGoogle, requestPasswordReset } = useAuth();
    const searchParams = useSearchParams();
    // Only a path of this app: a link to the login page cannot hand the session off to another site.
    const redirectTo = safeNextPath(searchParams.get('next'), '/dashboard');
    const linkExpired = searchParams.get('enlace') === 'vencido';

    const [view, setView] = useState<View>(searchParams.get('recuperar') === '1' ? 'recover' : 'login');
    const [isLoading, setIsLoading] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const changeView = (next: View) => {
        setView(next);
        setNotice(null);
        setPassword('');
    };

    const run = async (action: () => Promise<void>, fallback?: string) => {
        setIsLoading(true);
        setNotice(null);
        try {
            await action();
        } catch (error) {
            setNotice({ tone: 'error', text: authErrorMessage(error, fallback) });
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = (event: FormEvent) => {
        event.preventDefault();
        void run(async () => {
            await signInWithPassword(email, password);
            // The SDK has persisted the session cookies. A fresh document request avoids
            // a stale unauthenticated router cache or a transition lost when AuthProvider remounts.
            window.location.replace(redirectTo);
        });
    };

    const handleRecover = (event: FormEvent) => {
        event.preventDefault();
        void run(async () => {
            await requestPasswordReset(email);
            setNotice({ tone: 'success', text: PASSWORD_RESET_SENT });
        });
    };

    const handleGoogleLogin = () => {
        void run(() => signInWithGoogle(redirectTo), 'No pudimos abrir Google. Intenta de nuevo.');
    };

    const heading = HEADINGS[view];
    const emailField = (id: string) => (
        <div className="space-y-2">
            <Label htmlFor={id}>Correo</Label>
            <Input id={id} type="email" autoComplete="email" placeholder="tu@empresa.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
    );
    const submit = (label: string) => (
        <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {label}
        </Button>
    );

    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/50 px-4 py-10">
            <Logo size="lg" showWordmark />
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1 text-center">
                    <h1 className="text-2xl font-semibold tracking-tight">{heading.title}</h1>
                    <CardDescription>{heading.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {linkExpired && view !== 'recover' && !notice && (
                        <Alert variant="warning">
                            <AlertCircle className="h-4 w-4" aria-hidden="true" />
                            <AlertDescription>
                                El enlace ya no sirve: venció o se abrió en otro navegador.{' '}
                                <button type="button" className="font-medium underline underline-offset-4" onClick={() => changeView('recover')}>
                                    Pedir un enlace nuevo
                                </button>
                            </AlertDescription>
                        </Alert>
                    )}
                    {notice && (
                        <Alert variant={notice.tone === 'error' ? 'destructive' : 'success'} role={notice.tone === 'error' ? 'alert' : 'status'}>
                            {notice.tone === 'error' ? <AlertCircle className="h-4 w-4" aria-hidden="true" /> : <MailCheck className="h-4 w-4" aria-hidden="true" />}
                            <AlertDescription>{notice.text}</AlertDescription>
                        </Alert>
                    )}

                    {view === 'recover' ? (
                        <form onSubmit={handleRecover} className="space-y-4">
                            {emailField('email-recover')}
                            {submit('Enviarme el enlace')}
                            <Button type="button" variant="ghost" className="w-full" onClick={() => changeView('login')}>
                                Volver a iniciar sesión
                            </Button>
                        </form>
                    ) : (
                        <form onSubmit={handleLogin} className="space-y-4">
                            {emailField('email-login')}
                            <PasswordField
                                id="password-login"
                                label="Contraseña"
                                value={password}
                                onChange={setPassword}
                                autoComplete="current-password"
                                visible={showPassword}
                                onToggle={() => setShowPassword((current) => !current)}
                            />
                            <div className="-mt-2 flex justify-end">
                                <button type="button" className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => changeView('recover')}>
                                    ¿Olvidaste tu contraseña?
                                </button>
                            </div>
                            {submit('Entrar')}
                        </form>
                    )}

                    {view !== 'recover' && (
                        <>
                            <div className="relative py-2">
                                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                                <div className="relative flex justify-center text-xs">
                                    <span className="bg-card px-2 text-muted-foreground">o continúa con</span>
                                </div>
                            </div>
                            <Button variant="outline" type="button" className="w-full" onClick={handleGoogleLogin} disabled={isLoading}>
                                <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" viewBox="0 0 488 512">
                                    <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z" />
                                </svg>
                                Google
                            </Button>
                        </>
                    )}

                    {view === 'login' && (
                        <p className="text-center text-sm text-muted-foreground">
                            Las cuentas las crea la administración de ANTON.IA. Usa el correo con el que te dieron acceso.
                        </p>
                    )}

                    <p className="text-center text-xs text-muted-foreground">
                        Al continuar, aceptas nuestra{' '}
                        <a href="/privacy" className="underline underline-offset-4 hover:text-primary" target="_blank" rel="noopener noreferrer">
                            Política de privacidad
                        </a>.
                    </p>
                </CardContent>
            </Card>
        </main>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted-foreground">Cargando…</div>}>
            <LoginContent />
        </Suspense>
    );
}
