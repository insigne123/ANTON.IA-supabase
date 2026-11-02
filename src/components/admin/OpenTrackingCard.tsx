'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type State = { enabled: boolean; canEdit: boolean; available: boolean };

/**
 * «Medir aperturas» in Administración › Empresa (plan de uso M4, src/lib/server/open-tracking.ts): the open pixel in the emails the
 * team sends one by one. Off by default; only owners and administrators change it. It never rewrites links.
 */
export function OpenTrackingCard() {
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/api/admin/open-tracking', { cache: 'no-store' }).then(response => response.ok ? response.json() : null)
      .then(body => { if (active && body) setState({ enabled: body.enabled === true, canEdit: body.canEdit === true, available: body.available !== false }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const change = useCallback(async (enabled: boolean) => {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/admin/open-tracking', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos guardar el cambio.');
      setState(current => current && { ...current, enabled: body.enabled === true });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No pudimos guardar el cambio.');
    } finally {
      setSaving(false);
    }
  }, []);
  // Read for everyone, shown to whoever may change it: a member has nothing to do with it. Before its column exists, nobody can.
  if (!state?.canEdit || !state.available) return null;
  return <div className="mx-auto mt-6 max-w-5xl">
    <Card className="rounded-2xl">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="open-tracking" className="text-sm font-medium">Medir aperturas de los correos individuales</Label>
          <p className="text-xs leading-5 text-muted-foreground">
            Agrega una imagen invisible a los correos que tu equipo envía uno a uno desde ANTON.IA, para ver quién los abrió. No cambia los enlaces.
            Es una señal aproximada: algunos correos bloquean imágenes y otros las cargan solos. Las respuestas y las reuniones siguen siendo lo principal.
          </p>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </div>
        <Switch id="open-tracking" checked={state.enabled} disabled={saving} onCheckedChange={value => void change(value)} />
      </CardContent>
    </Card>
  </div>;
}
