'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OrganizationInvite } from '@/components/organization/MembersList';
import { organizationService } from '@/lib/services/organization-service';

export function PendingInvitations({ organizationId }: { organizationId: string }) {
  const [invites, setInvites] = useState<OrganizationInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void organizationService.getOrganizationDetails(organizationId).then((data) => {
      if (!data) throw new Error('Unavailable');
      if (active) setInvites(data.invites);
    }).catch(() => {
      if (active) setError('No pudimos cargar las invitaciones. Intenta nuevamente.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, attempt]);

  async function revoke(invite: OrganizationInvite) {
    if (pending || !window.confirm(`Revocar la invitacion de ${invite.email}? El enlace dejara de funcionar.`)) return;
    setPending(invite.id);
    setError('');
    try {
      if (!await organizationService.revokeInvite(invite.id, organizationId)) throw new Error('Unavailable');
      setInvites((current) => current.filter((item) => item.id !== invite.id));
    } catch {
      setError('No pudimos revocar la invitacion. Intenta nuevamente.');
    } finally { setPending(null); }
  }

  return (
    <Card className="rounded-[24px] border-border/60 bg-card/90 dark:bg-card/75">
      <CardHeader><CardTitle className="text-base">Invitaciones pendientes</CardTitle></CardHeader>
      <CardContent aria-busy={loading || Boolean(pending)} className="space-y-3">
        {error ? <div role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" onClick={() => setAttempt((value) => value + 1)} disabled={Boolean(pending)}>Reintentar</Button></div> : null}
        {loading ? <p role="status" className="text-sm text-muted-foreground">Cargando invitaciones...</p> : !error && invites.length === 0 ? <p className="text-sm text-muted-foreground">No hay invitaciones pendientes.</p> : null}
        {!loading && invites.map((invite) => (
          <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0">
            <div className="min-w-0"><p className="break-all text-sm font-medium">{invite.email}</p><p className="text-xs text-muted-foreground">{invite.role === 'admin' ? 'Administrador' : 'Miembro'}</p></div>
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={Boolean(pending)} onClick={() => void revoke(invite)} aria-label={`Revocar invitacion de ${invite.email}`}>{pending === invite.id ? 'Revocando...' : 'Revocar'}</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
