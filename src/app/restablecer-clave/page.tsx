'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';

import Logo from '@/components/logo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { PASSWORD_MIN_LENGTH, authErrorMessage, newPasswordProblem } from '@/lib/auth-messages';

/**
 * The end of «¿Olvidaste tu contraseña?»: the email link signs the person in through /api/auth/callback and lands here.
 * Without that session (an old link, or one opened in another browser) the page says so and offers a new link.
 */
export default function ResetPasswordPage() {
  const { session, loading, updatePassword } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = newPasswordProblem(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updatePassword(password);
      setSaved(true);
    } catch (updateError) {
      setError(authErrorMessage(updateError, 'No pudimos guardar la contraseña. Intenta de nuevo.'));
    } finally {
      setSaving(false);
    }
  };

  let content;
  if (loading) {
    content = (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Revisando tu enlace…
      </div>
    );
  } else if (saved) {
    content = (
      <div className="space-y-4">
        <Alert variant="success" role="status">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>Listo: tu contraseña nueva quedó guardada. Úsala la próxima vez que entres.</AlertDescription>
        </Alert>
        <Button className="w-full" onClick={() => router.push('/dashboard')}>Ir a Hoy</Button>
      </div>
    );
  } else if (!session) {
    content = (
      <div className="space-y-4">
        <Alert variant="warning">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            Este enlace ya no sirve: venció, ya se usó o se abrió en otro navegador. Pide uno nuevo y ábrelo en este mismo navegador.
          </AlertDescription>
        </Alert>
        <Button asChild className="w-full"><Link href="/login?recuperar=1">Pedir un enlace nuevo</Link></Button>
      </div>
    );
  } else {
    content = (
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          Cuenta: <span className="font-medium text-foreground">{session.user.email}</span>
        </p>
        <div className="space-y-2">
          <Label htmlFor="new-password">Contraseña nueva</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={visible ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="new-password-hint"
              className="pr-11"
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              onClick={() => setVisible((current) => !current)}
              aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={visible}
            >
              {visible ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
            </Button>
          </div>
          <p id="new-password-hint" className="text-xs text-muted-foreground">Al menos {PASSWORD_MIN_LENGTH} caracteres.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password-confirmation">Repite la contraseña</Label>
          <Input
            id="new-password-confirmation"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Guardar contraseña
        </Button>
      </form>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/50 px-4 py-10">
      <Logo size="lg" showWordmark />
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Crea tu contraseña nueva</h1>
          <CardDescription>Después entras con tu correo y esta contraseña.</CardDescription>
        </CardHeader>
        <CardContent>{content}</CardContent>
      </Card>
    </main>
  );
}
