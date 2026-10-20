'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { DEFAULT_GOALS, GOAL_MAX, type GoalTargets } from '@/lib/weekly-goals';

type Settings = { team: GoalTargets | null; people: Array<{ userId: string; targets: GoalTargets }>; members: Array<{ userId: string; name: string; email: string | null }> };
type Draft = { contacted: string; found: string };

const toDraft = (targets: GoalTargets | null | undefined): Draft => targets ? { contacted: String(targets.contacted), found: String(targets.found) } : { contacted: '', found: '' };
/** A whole number from 0 to GOAL_MAX, null when blank, NaN when it is not one. */
const parse = (value: string) => { const text = value.trim(); if (!text) return null; const number = Number(text); return Number.isInteger(number) && number >= 0 && number <= GOAL_MAX ? number : Number.NaN; };

/**
 * «Metas del equipo» (src/lib/weekly-goals.ts), for owners and admins: the team's weekly goal and, for whoever needs
 * another, their own. A person left blank follows the team's goal.
 */
export function GoalsEditor({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const { organizationId } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [team, setTeam] = useState<Draft>(toDraft(DEFAULT_GOALS));
  const [people, setPeople] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const call = useCallback((init?: RequestInit, query = '') => authenticatedApiFetch(`/api/weekly-goals${query}`, {
    cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(organizationId ? { 'x-organization-id': organizationId } : {}) },
  }), [organizationId]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await call(undefined, '?settings=1');
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.settings) throw new Error(body?.error || 'No pudimos leer las metas.');
      const loaded = body.settings as Settings;
      setSettings(loaded);
      setTeam(toDraft(loaded.team || DEFAULT_GOALS));
      setPeople(Object.fromEntries(loaded.people.map(person => [person.userId, toDraft(person.targets)])));
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos leer las metas.'); }
    finally { setLoading(false); }
  }, [call]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const teamTargets = { contacted: parse(team.contacted), found: parse(team.found) };
  const invalid = (draft: Draft) => [draft.contacted, draft.found].some(value => Number.isNaN(parse(value)));
  const teamInvalid = invalid(team) || teamTargets.contacted === null || teamTargets.found === null;
  const peopleInvalid = Object.values(people).some(invalid);

  const save = async () => {
    if (teamInvalid || peopleInvalid) { setError(`Usa números enteros entre 0 y ${GOAL_MAX}.`); return; }
    const base = { contacted: teamTargets.contacted as number, found: teamTargets.found as number };
    const own = Object.entries(people).flatMap(([userId, draft]) => {
      const contacted = parse(draft.contacted), found = parse(draft.found);
      if (contacted === null && found === null) return [];
      return [{ userId, targets: { contacted: contacted ?? base.contacted, found: found ?? base.found } }];
    });
    setSaving(true); setError('');
    try {
      const response = await call({ method: 'POST', body: JSON.stringify({ team: base, people: own }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos guardar las metas.');
      onOpenChange(false);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos guardar las metas.'); }
    finally { setSaving(false); }
  };

  const numberField = (id: string, label: string, value: string, onChange: (value: string) => void, placeholder?: string, srOnlyLabel = false) => <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id} className={srOnlyLabel ? 'sr-only' : 'text-xs font-normal text-muted-foreground'}>{label}</Label>
    <Input id={id} inputMode="numeric" pattern="[0-9]*" value={value} placeholder={placeholder} aria-invalid={Number.isNaN(parse(value)) || undefined}
      onChange={event => onChange(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className="h-9 tabular-nums" />
  </div>;

  return <Sheet open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-md">
      <SheetHeader>
        <SheetTitle>Metas del equipo</SheetTitle>
        <SheetDescription>Cada persona ve su avance en «Hoy» y lo recibe en sus avisos. Una meta simple se cumple más: parte con pocas.</SheetDescription>
      </SheetHeader>
      {loading && !settings ? <p role="status" className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Cargando metas…</p> : null}
      {!loading && !settings && error ? <div className="mt-6 space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />Reintentar</Button></div> : null}
      {settings ? <div className="mt-6 space-y-8">
        <section className="space-y-3" aria-labelledby="goals-team">
          <h3 id="goals-team" className="text-sm font-medium">Cada semana, por persona</h3>
          <div className="grid grid-cols-2 gap-3">
            {numberField('goal-team-contacted', 'Personas contactadas', team.contacted, value => setTeam(current => ({ ...current, contacted: value })))}
            {numberField('goal-team-found', 'Contactos nuevos con correo', team.found, value => setTeam(current => ({ ...current, found: value })))}
          </div>
          {teamInvalid ? <p role="alert" className="text-xs text-destructive">Escribe en ambas un número entero de 0 a {GOAL_MAX}.</p> : null}
          <p className="text-xs leading-5 text-muted-foreground">Contactar cuenta un correo enviado, un mensaje de LinkedIn o una llamada hecha. Pon 0 en ambas para no usar metas.</p>
        </section>
        <section className="space-y-3" aria-labelledby="goals-people">
          <div>
            <h3 id="goals-people" className="text-sm font-medium">Metas personales</h3>
            <p className="text-xs leading-5 text-muted-foreground">Solo para quien necesite otra. En blanco, sigue la del equipo.</p>
            {peopleInvalid ? <p role="alert" className="mt-1 text-xs text-destructive">Revisa las metas personales: números enteros de 0 a {GOAL_MAX}.</p> : null}
          </div>
          <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2 px-3 text-xs text-muted-foreground">
            <span>Persona</span><span>Contactar</span><span>Con correo</span>
          </div>
          <ul className="divide-y rounded-2xl border">{settings.members.map(member => {
            const draft = people[member.userId] || { contacted: '', found: '' };
            const set = (field: keyof Draft) => (value: string) => setPeople(current => ({ ...current, [member.userId]: { ...draft, [field]: value } }));
            return <li key={member.userId} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-2 px-3 py-2.5">
              <span className="min-w-0"><span className="block truncate text-sm">{member.name}</span>{member.email ? <span className="block truncate text-xs text-muted-foreground">{member.email}</span> : null}</span>
              {numberField(`goal-${member.userId}-contacted`, `Personas contactadas de ${member.name}`, draft.contacted, set('contacted'), team.contacted || '0', true)}
              {numberField(`goal-${member.userId}-found`, `Contactos nuevos con correo de ${member.name}`, draft.found, set('found'), team.found || '0', true)}
            </li>;
          })}</ul>
        </section>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div> : null}
      <SheetFooter className="mt-6">
        <Button disabled={!settings || saving || teamInvalid || peopleInvalid} onClick={() => void save()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Guardar metas</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
