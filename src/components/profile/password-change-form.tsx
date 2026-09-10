'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { passwordChangeError, validatePasswordChange } from '@/lib/profile/password-change';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PasswordChangeForm() {
  const { user, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nonce, setNonce] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const hasEmailIdentity = user?.identities?.some((identity) => identity.provider === 'email');

  async function sendCode() {
    const { error } = await supabase.auth.reauthenticate();
    if (error) setError('No pudimos enviar el codigo. Intenta nuevamente en unos minutos.');
    else setMessage('Enviamos un codigo de verificacion al correo o telefono de tu cuenta.');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy.current) return;
    setMessage('');
    const validation = validatePasswordChange(password, confirmation);
    if (validation) { setError(validation); return; }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const attributes = { password, ...(currentPassword ? { current_password: currentPassword } : {}), ...(needsCode ? { nonce: nonce.trim() } : {}) };
      const { error } = await supabase.auth.updateUser(attributes);
      if (error?.code === 'reauthentication_needed') {
        setNeedsCode(true);
        await sendCode();
      } else if (error) {
        setError(passwordChangeError(error.code));
      } else {
        setPassword(''); setConfirmation(''); setCurrentPassword(''); setNonce(''); setNeedsCode(false);
        setMessage('Contrasena actualizada. Usala la proxima vez que inicies sesion con tu correo.');
      }
    } catch {
      setError('No pudimos conectar. Revisa tu conexion e intenta nuevamente.');
    } finally { busy.current = false; setPending(false); }
  }

  return (
    <Card className="mt-6 rounded-[28px] border-border/60 bg-card/90 dark:bg-card/75">
      <CardHeader><CardTitle className="text-xl tracking-tight">Seguridad</CardTitle><CardDescription>{hasEmailIdentity ? 'Cambia la contrasena de tu cuenta ANTON.IA.' : 'Puedes crear una contrasena para entrar con tu correo. Esto no cambia tu contrasena de Google o Microsoft.'}</CardDescription></CardHeader>
      <CardContent>
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={loading || !user || pending} className="min-w-0 space-y-4">
            {hasEmailIdentity ? <div className="space-y-2"><Label htmlFor="current-password">Contrasena actual</Label><Input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="h-11 rounded-xl" /></div> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="new-password">Nueva contrasena</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="password-help password-error" className="h-11 rounded-xl" /><p id="password-help" className="text-xs text-muted-foreground">Al menos 8 caracteres. Usa una contrasena unica.</p></div>
              <div className="space-y-2"><Label htmlFor="confirm-password">Confirmar contrasena</Label><Input id="confirm-password" type="password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-describedby="password-error" aria-invalid={Boolean(confirmation && confirmation !== password)} className="h-11 rounded-xl" /></div>
            </div>
            {needsCode ? <div className="space-y-2"><Label htmlFor="password-code">Codigo de verificacion</Label><Input id="password-code" autoComplete="one-time-code" required value={nonce} onChange={(event) => setNonce(event.target.value)} className="h-11 rounded-xl" /><Button type="button" variant="ghost" onClick={async () => { if (busy.current) return; busy.current = true; setPending(true); setError(''); try { await sendCode(); } catch { setError('No pudimos enviar el codigo.'); } finally { busy.current = false; setPending(false); } }}>Enviar otro codigo</Button></div> : null}
            <p id="password-error" role="alert" className="text-sm text-destructive">{error}</p>
            {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
            <Button type="submit" className="w-full rounded-xl sm:w-auto">{pending ? 'Actualizando...' : 'Actualizar contrasena'}</Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
