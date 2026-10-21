'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { checkFullName, needsFullName } from '@/lib/profile/full-name';
import { profileService } from '@/lib/services/profile-service';

/**
 * Whether the signed-in person still has to give their name: 'checking' until the profile is read, 'missing' when it has none,
 * 'done' otherwise. A profile that cannot be read never blocks the app.
 */
export function useFullNamePrompt(userId: string | null | undefined) {
  const [state, setState] = useState<'checking' | 'missing' | 'done'>('checking');
  useEffect(() => {
    setState('checking');
    if (!userId) return;
    let cancelled = false;
    profileService.getCurrentProfile()
      .then(profile => { if (!cancelled) setState(needsFullName(profile) ? 'missing' : 'done'); })
      .catch(() => { if (!cancelled) setState('done'); });
    return () => { cancelled = true; };
  }, [userId]);
  return { state, onSaved: () => setState('done') };
}

const SAVE_ERROR = 'No pudimos guardar tu nombre. Revisa tu conexión e inténtalo de nuevo.';

/** Opens with the app for an account without a name and stays until it has one: the team finds each other by name. */
export function FullNamePrompt({ open, onSaved }: { open: boolean; onSaved: (name: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || saved.current) return;
    const check = checkFullName(value);
    if (!check.ok) { setError(check.error); return; }
    setError(null);
    setSaving(true);
    try {
      await profileService.updateProfile({ full_name: check.name });
      saved.current = true;
      onSaved(check.name);
    } catch {
      setError(SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        className="w-[calc(100%-2rem)] max-w-md gap-6 rounded-2xl p-6 sm:rounded-2xl"
        onEscapeKeyDown={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
      >
        <form onSubmit={submit} noValidate className="grid gap-6">
          <DialogHeader className="items-center gap-3 space-y-0 text-center sm:items-start sm:text-left">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UserRound className="size-5" aria-hidden />
            </span>
            <DialogTitle className="text-xl tracking-tight">¿Cómo te llamas?</DialogTitle>
            <DialogDescription className="leading-relaxed">
              Tu equipo te busca por nombre para asignarte oportunidades y tareas. Escribe tu nombre completo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="full-name-prompt">Nombre completo</Label>
            <Input
              id="full-name-prompt"
              name="name"
              autoComplete="name"
              placeholder="María González"
              value={value}
              onChange={event => { setValue(event.target.value); if (error) setError(null); }}
              disabled={saving}
              maxLength={120}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'full-name-prompt-error' : undefined}
            />
            {error && <p id="full-name-prompt-error" role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
            <Button type="submit" disabled={saving} className="w-full">
              {saving && <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
              {saving ? 'Guardando…' : 'Guardar y continuar'}
            </Button>
            <p className="text-center text-xs text-muted-foreground sm:text-left">Puedes cambiarlo cuando quieras en Perfil.</p>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
