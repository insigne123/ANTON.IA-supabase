'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
    const { signInWithPassword, signUpWithPassword, signInWithGoogle } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();
    const router = useRouter();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            await signInWithPassword(email, password);
            router.push('/');
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Error al iniciar sesión',
                description: error.message || 'Credenciales inválidas',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            await signUpWithPassword(email, password);
            toast({
                title: 'Cuenta creada',
                description: 'Revisa tu correo para confirmar tu cuenta antes de iniciar sesión.',
            });
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Error al registrarse',
                description: error.message || 'No se pudo crear la cuenta',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setIsLoading(true);
        try {
            await signInWithGoogle();
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Error con Google',
                description: error.message,
            });
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-muted/50 px-4">
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold text-center">Bienvenido</CardTitle>
                    <CardDescription className="text-center">
                        Inicia sesión o crea una cuenta para continuar
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="login" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 mb-4">
                            <TabsTrigger value="login">Iniciar Sesión</TabsTrigger>
                            <TabsTrigger value="register">Registrarse</TabsTrigger>
                        </TabsList>

                        <TabsContent value="login">
                            <form onSubmit={handleLogin} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email-login">Email</Label>
                                    <Input
                                        id="email-login"
                                        type="email"
                                        placeholder="tu@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password-login">Contraseña</Label>
                                    <Input
                                        id="password-login"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                </div>
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Ingresar
                                </Button>
                            </form>
                        </TabsContent>

                        <TabsContent value="register">
                            <form onSubmit={handleSignUp} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email-register">Email</Label>
                                    <Input
                                        id="email-register"
                                        type="email"
                                        placeholder="tu@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password-register">Contraseña</Label>
                                    <Input
                                        id="password-register"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        minLength={6}
                                    />
                                </div>
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Crear Cuenta
                                </Button>
                            </form>
                        </TabsContent>
                    </Tabs>

                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-background px-2 text-muted-foreground">
                                O continúa con
                            </span>
                        </div>
                    </div>

                    <Button variant="outline" type="button" className="w-full" onClick={handleGoogleLogin} disabled={isLoading}>
                        <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
                            <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path>
                        </svg>
                        Google
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
