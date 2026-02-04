'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { organizationService } from '@/lib/services/organization-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    const router = useRouter();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState('Verifying invitation...');
    const [token, setToken] = useState('');

    useEffect(() => {
        const accept = async () => {
            try {
                const resolved = await params;
                setToken(resolved.token);

                // Check if user is logged in
                const { data: { session } } = await supabase.auth.getSession();

                if (!session) {
                    setMessage('Debes iniciar sesión para aceptar la invitación.');
                    setStatus('error');
                    return;
                }

                await organizationService.acceptInvite(resolved.token);
                setStatus('success');
                setMessage('Invitation accepted! Redirecting to dashboard...');

                setTimeout(() => {
                    router.push('/dashboard');
                }, 2000);
            } catch (error: any) {
                console.error('Invite error:', error);
                setStatus('error');
                setMessage(error.message || 'Failed to accept invitation. It may be expired or invalid.');
            }
        };

        accept();
    }, [params, router]);

    return (
        <div className="flex items-center justify-center min-h-screen bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle>Organization Invitation</CardTitle>
                    <CardDescription>
                        {status === 'loading' && 'Processing your invitation...'}
                        {status === 'success' && 'Welcome to the team!'}
                        {status === 'error' && 'Something went wrong'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center p-6 space-y-4">
                    {status === 'loading' && (
                        <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    )}

                    {status === 'success' && (
                        <div className="flex flex-col items-center space-y-2 text-green-500">
                            <CheckCircle2 className="w-12 h-12" />
                            <p className="text-center text-foreground">{message}</p>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex flex-col items-center space-y-4">
                            <div className="text-destructive flex flex-col items-center space-y-2">
                                <XCircle className="w-12 h-12" />
                                <p className="text-center text-foreground">{message}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    onClick={() => router.push(`/login?next=${encodeURIComponent(`/invite/${token || ''}`)}`)}
                                    variant="outline"
                                >
                                    Ir a Login
                                </Button>
                                <Button onClick={() => router.push('/dashboard')} variant="ghost">
                                    Ir al Dashboard
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
