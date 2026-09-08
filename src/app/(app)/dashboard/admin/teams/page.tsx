'use client';

import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  CircleAlert,
  FilterX,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import type { AdminDashboardOverview, AdminReportingUser } from '@/lib/admin-dashboard-types';
import { cn } from '@/lib/utils';

type Period = '7' | '30' | '90';
const EMPTY_PEOPLE: AdminReportingUser[] = [];

function dateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

function rangeFor(days: number) {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: dateInput(from), to: dateInput(to) };
}

function formatNumber(value: number) {
  return value.toLocaleString('es-CL');
}

function formatPercent(value: number) {
  return `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || 'U').toUpperCase();
}

function TeamsLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Cargando equipos">
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-[360px] rounded-[24px]" />
      <Skeleton className="h-[420px] rounded-[24px]" />
    </div>
  );
}

function TeamsPageContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const requestedUserId = searchParams.get('userId') || '';
  const requestedTeamId = searchParams.get('teamId') || '';
  const [period, setPeriod] = useState<Period>('30');
  const [overview, setOverview] = useState<AdminDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(Boolean(requestedUserId));
  const [assignmentUserId, setAssignmentUserId] = useState(requestedUserId);
  const [assignmentTeamId, setAssignmentTeamId] = useState(requestedTeamId);
  const [assignmentPrimary, setAssignmentPrimary] = useState(true);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState(requestedTeamId || 'all');
  const requestRef = useRef(0);
  const range = useMemo(() => rangeFor(Number(period)), [period]);
  const managementDisabled = !overview || loading || refreshing || Boolean(loadError) || Boolean(mutationKey);

  async function loadTeams(options: { silent?: boolean } = {}) {
    const requestId = ++requestRef.current;
    if (options.silent) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch(`/api/dashboard/admin/overview?${new URLSearchParams(range).toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos cargar los equipos.');
      if (requestId === requestRef.current) {
        const nextOverview = payload as AdminDashboardOverview;
        setOverview(nextOverview);
        if (!assignmentTeamId && nextOverview.groups[0]?.id) setAssignmentTeamId(nextOverview.groups[0].id);
        if (!assignmentUserId && nextOverview.users[0]?.id) setAssignmentUserId(nextOverview.users[0].id);
      }
    } catch (error) {
      if (requestId === requestRef.current) {
        setOverview(null);
        setCreateOpen(false);
        setAssignOpen(false);
        setLoadError(error instanceof Error ? error.message : 'No pudimos cargar los equipos.');
      }
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void loadTeams();
    // The selected period intentionally controls this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (managementDisabled) return;
    const name = createName.trim();
    if (name.length < 2) {
      setCreateError('Escribe un nombre de al menos 2 caracteres.');
      return;
    }

    setMutationKey('create');
    setCreateError(null);
    try {
      const response = await fetch('/api/dashboard/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos crear el equipo.');
      setCreateName('');
      setCreateOpen(false);
      toast({ title: 'Equipo creado', description: `${name} ya está disponible para asignar personas.` });
      await loadTeams({ silent: true });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'No pudimos crear el equipo.');
    } finally {
      setMutationKey(null);
    }
  }

  async function assignPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (managementDisabled) return;
    if (!assignmentTeamId || !assignmentUserId) {
      setAssignmentError('Selecciona una persona y un equipo.');
      return;
    }

    setMutationKey('assign');
    setAssignmentError(null);
    try {
      const response = await fetch('/api/dashboard/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', groupId: assignmentTeamId, userId: assignmentUserId, isPrimary: assignmentPrimary }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos guardar la asignación.');
      setAssignOpen(false);
      toast({ title: 'Asignación guardada', description: 'La persona ya aparece en el equipo seleccionado.' });
      await loadTeams({ silent: true });
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : 'No pudimos guardar la asignación.');
    } finally {
      setMutationKey(null);
    }
  }

  async function removeAssignment(person: AdminReportingUser, teamId: string, teamName: string) {
    if (managementDisabled) return;
    const actionId = `remove:${person.id}:${teamId}`;
    setMutationKey(actionId);
    try {
      const response = await fetch('/api/dashboard/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', groupId: teamId, userId: person.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos quitar la asignación.');
      toast({ title: 'Asignación removida', description: `${person.name} ya no pertenece a ${teamName}.` });
      await loadTeams({ silent: true });
    } catch (error) {
      toast({ variant: 'destructive', title: 'No pudimos quitar la asignación', description: error instanceof Error ? error.message : 'Inténtalo nuevamente.' });
    } finally {
      setMutationKey(null);
    }
  }

  function openAssignment(person?: AdminReportingUser) {
    if (managementDisabled) return;
    if (person) setAssignmentUserId(person.id);
    if (!assignmentTeamId && overview?.groups[0]?.id) setAssignmentTeamId(overview.groups[0].id);
    setAssignmentError(null);
    setAssignOpen(true);
  }

  function viewTeamMembers(teamId: string) {
    setTeamFilter(teamId);
    window.requestAnimationFrame(() => {
      const assignments = document.getElementById('team-assignments');
      assignments?.scrollIntoView({ block: 'start' });
      assignments?.focus({ preventScroll: true });
    });
  }

  const teams = overview?.groups || [];
  const people = overview?.users || EMPTY_PEOPLE;
  const filteredPeople = useMemo(() => {
    const normalizedQuery = peopleQuery.trim().toLowerCase();
    return people.filter((person) => {
      if (normalizedQuery && !`${person.name} ${person.email}`.toLowerCase().includes(normalizedQuery)) return false;
      if (teamFilter !== 'all' && !person.groups.some((group) => group.id === teamFilter)) return false;
      return true;
    });
  }, [people, peopleQuery, teamFilter]);
  const assignedPeople = people.filter((person) => person.groups.length > 0).length;
  const primaryAssigned = people.filter((person) => person.groups.some((group) => group.primary)).length;

  return (
    <div className="mx-auto w-full max-w-[1320px] pb-10">
      <PageHeader title="Equipos" description="Organiza personas y compara el rendimiento de cada equipo.">
        <Button type="button" onClick={() => { setCreateError(null); setCreateOpen(true); }} className="rounded-xl" disabled={managementDisabled}><Plus aria-hidden="true" />Crear equipo</Button>
        <Button type="button" variant="outline" onClick={() => openAssignment()} className="rounded-xl" disabled={managementDisabled || teams.length === 0}><UserPlus aria-hidden="true" />Asignar persona</Button>
        <Button type="button" variant="ghost" size="icon" onClick={() => void loadTeams({ silent: true })} disabled={loading || refreshing} className="rounded-xl" aria-label="Actualizar equipos"><RefreshCw className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" /></Button>
      </PageHeader>

      {loading && !overview ? <TeamsLoading /> : null}

      {loadError ? (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="font-medium">No pudimos actualizar Equipos</p><p className="mt-1 text-muted-foreground">{loadError}</p></div>{!overview ? <Button type="button" variant="outline" size="sm" onClick={() => void loadTeams()} className="rounded-xl">Reintentar</Button> : null}</div>
      ) : null}

      {overview ? (
        <div className="space-y-5" aria-busy={refreshing || Boolean(mutationKey)}>
          {overview.coverage.note ? (
            <div role="status" className="flex items-start gap-3 rounded-2xl border border-amber-300/50 bg-amber-50/70 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{overview.coverage.sampled ? 'Este período tiene mucha actividad. Usa un rango menor para comparar con mayor precisión.' : 'Parte de la actividad no está disponible temporalmente. Las asignaciones están actualizadas.'}</p>
            </div>
          ) : null}
          <Card className="overflow-hidden rounded-2xl border-border/60 bg-card/80 shadow-none dark:bg-card/60">
            <CardContent className="grid grid-cols-3 p-0">
              {[{ label: 'Equipos activos', value: teams.length }, { label: 'Personas asignadas', value: assignedPeople }, { label: 'Con equipo principal', value: primaryAssigned }].map((item, index) => <div key={item.label} className={cn('px-4 py-4 text-center sm:px-6 sm:text-left', index > 0 && 'border-l border-border/60')}><p className="text-2xl font-semibold tabular-nums">{formatNumber(item.value)}</p><p className="mt-1 text-xs text-muted-foreground">{item.label}</p></div>)}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[24px] border-border/60 bg-card/90 dark:bg-card/75">
            <CardHeader className="flex flex-col gap-3 space-y-0 border-b border-border/60 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
              <div><CardTitle className="text-lg">Rendimiento por equipo</CardTitle><CardDescription className="mt-1">Los resultados se cuentan en el equipo principal de cada persona.</CardDescription></div>
              <div className="w-full space-y-1.5 sm:w-44"><Label htmlFor="teams-period">Período</Label><Select value={period} onValueChange={(value) => setPeriod(value as Period)}><SelectTrigger id="teams-period" className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">Últimos 7 días</SelectItem><SelectItem value="30">Últimos 30 días</SelectItem><SelectItem value="90">Últimos 90 días</SelectItem></SelectContent></Select></div>
            </CardHeader>
            {teams.length > 0 ? (
              <>
                <div className="divide-y divide-border/60 md:hidden">{teams.map((team) => <div key={team.id} className={cn('px-5 py-4', teamFilter === team.id && 'bg-primary/[0.04]')}><div className="flex items-center justify-between gap-3"><button type="button" onClick={() => viewTeamMembers(team.id)} className="flex min-w-0 items-center gap-2 rounded-lg text-left hover:underline"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: team.color || 'hsl(var(--primary))' }} aria-hidden="true" /><span className="truncate text-sm font-semibold">{team.name}</span></button><Badge variant="outline" className="font-normal">{team.memberCount} miembros</Badge></div><div className="mt-3 grid grid-cols-3 gap-3 text-xs"><span><strong className="block text-sm tabular-nums">{formatNumber(team.metrics.contacted)}</strong><span className="text-muted-foreground">Contactos</span></span><span><strong className="block text-sm tabular-nums">{formatNumber(team.metrics.replies)}</strong><span className="text-muted-foreground">Respuestas</span></span><span><strong className="block text-sm tabular-nums">{formatPercent(team.metrics.responseRate)}</strong><span className="text-muted-foreground">Tasa</span></span></div></div>)}</div>
                <div className="hidden md:block"><Table aria-label="Rendimiento por equipo"><TableHeader><TableRow><TableHead className="pl-6">Equipo</TableHead><TableHead>Miembros</TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right">Contactados</TableHead><TableHead className="text-right">Respuestas</TableHead><TableHead className="pr-6 text-right">Tasa</TableHead></TableRow></TableHeader><TableBody>{teams.map((team) => <TableRow key={team.id} className={cn(teamFilter === team.id && 'bg-primary/[0.04]')}><TableCell className="pl-6"><button type="button" onClick={() => viewTeamMembers(team.id)} className="flex items-center gap-2 rounded-lg font-medium hover:underline"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: team.color || 'hsl(var(--primary))' }} aria-hidden="true" />{team.name}</button></TableCell><TableCell className="tabular-nums">{formatNumber(team.memberCount)}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(team.metrics.leads)}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(team.metrics.contacted)}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(team.metrics.replies)}</TableCell><TableCell className="pr-6 text-right font-medium tabular-nums">{formatPercent(team.metrics.responseRate)}</TableCell></TableRow>)}</TableBody></Table></div>
              </>
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-12 text-center"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><UsersRound className="h-5 w-5" aria-hidden="true" /></span><h3 className="mt-4 text-sm font-semibold">Crea tu primer equipo</h3><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Agrupa personas para comparar resultados y administrar límites compartidos.</p><Button type="button" size="sm" onClick={() => setCreateOpen(true)} className="mt-4 rounded-xl" disabled={managementDisabled}><Plus aria-hidden="true" />Crear equipo</Button></div>
            )}
          </Card>

          <Card id="team-assignments" tabIndex={-1} className="scroll-mt-24 overflow-hidden rounded-[24px] border-border/60 bg-card/90 dark:bg-card/75">
            <CardHeader className="border-b border-border/60 px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div><CardTitle className="text-lg">Personas y asignaciones</CardTitle><CardDescription className="mt-1">Una persona puede participar en varios equipos y tener uno principal.</CardDescription></div>
                <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-[220px_190px]">
                  <div className="space-y-1.5"><Label htmlFor="team-people-search">Buscar persona</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="team-people-search" type="search" value={peopleQuery} onChange={(event) => setPeopleQuery(event.target.value)} placeholder="Nombre o correo" className="h-10 rounded-xl pl-9" /></div></div>
                  <div className="space-y-1.5"><Label htmlFor="team-people-filter">Equipo</Label><Select value={teamFilter} onValueChange={setTeamFilter}><SelectTrigger id="team-people-filter" className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los equipos</SelectItem>{teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select></div>
                </div>
              </div>
            </CardHeader>
            {filteredPeople.length > 0 ? (
              <div role="list">
                {filteredPeople.map((person) => {
                  const hasPrimary = person.groups.some((group) => group.primary);
                  return (
                    <div key={person.id} role="listitem" className="flex flex-col gap-4 border-b border-border/60 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:px-6">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar className="h-10 w-10 border border-border/60"><AvatarImage src={person.avatarUrl || undefined} alt="" /><AvatarFallback className="text-xs">{initials(person.name)}</AvatarFallback></Avatar>
                        <div className="min-w-0"><Link href={`/dashboard/admin/users/${person.id}`} className="block truncate text-sm font-medium hover:underline">{person.name}</Link><p className="truncate text-xs text-muted-foreground">{person.email}</p></div>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        {person.groups.length > 0 ? person.groups.map((group) => (
                          <Badge key={group.id} variant={group.primary ? 'default' : 'outline'} className="gap-1 rounded-full py-1 pl-2.5 pr-1 font-normal">
                            <span className="max-w-32 truncate">{group.name}{group.primary ? ' · Principal' : ''}</span>
                            <button type="button" onClick={() => void removeAssignment(person, group.id, group.name)} disabled={managementDisabled} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-background/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" aria-label={`Quitar a ${person.name} de ${group.name}`}>
                              {mutationKey === `remove:${person.id}:${group.id}` ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
                            </button>
                          </Badge>
                        )) : <span className="text-xs text-muted-foreground">Sin equipos asignados</span>}
                        {!hasPrimary && person.groups.length > 0 ? <span className="text-xs text-amber-700 dark:text-amber-300">Sin principal</span> : null}
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => openAssignment(person)} className="w-full rounded-xl sm:w-auto" disabled={teams.length === 0 || managementDisabled}><UserPlus aria-hidden="true" />Asignar</Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center px-6 py-10 text-center"><FilterX className="h-6 w-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No hay personas para este filtro</p><p className="mt-1 text-sm text-muted-foreground">Busca otro nombre o muestra todos los equipos.</p><Button type="button" variant="outline" size="sm" onClick={() => { setPeopleQuery(''); setTeamFilter('all'); }} className="mt-4 rounded-xl">Limpiar filtros</Button></div>
            )}
          </Card>
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={(open) => { if (!mutationKey) { setCreateOpen(open); if (!open) setCreateError(null); } }}>
        <DialogContent className="w-[calc(100%_-_2rem)] rounded-[24px] sm:max-w-md">
          <form onSubmit={createTeam} noValidate>
            <DialogHeader><DialogTitle>Crear equipo</DialogTitle><DialogDescription className="leading-6">Usa un nombre reconocible para organizar personas y resultados.</DialogDescription></DialogHeader>
            <div className="py-5"><div className="space-y-1.5"><Label htmlFor="new-team-name">Nombre</Label><Input id="new-team-name" value={createName} onChange={(event) => { setCreateName(event.target.value); setCreateError(null); }} placeholder="Ej. Equipo Chile" maxLength={80} disabled={Boolean(mutationKey)} aria-invalid={Boolean(createError)} aria-describedby={createError ? 'new-team-error' : 'new-team-help'} className="h-11 rounded-xl" autoFocus />{createError ? <p id="new-team-error" role="alert" className="text-sm text-destructive">{createError}</p> : <p id="new-team-help" className="text-xs leading-5 text-muted-foreground">Será visible para todas las personas de la organización.</p>}</div></div>
            <DialogFooter className="gap-2 sm:space-x-0"><Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={Boolean(mutationKey)} className="rounded-xl">Cancelar</Button><Button type="submit" disabled={managementDisabled} className="rounded-xl">{mutationKey === 'create' ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus aria-hidden="true" />}{mutationKey === 'create' ? 'Creando…' : 'Crear equipo'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={(open) => { if (!mutationKey) { setAssignOpen(open); if (!open) setAssignmentError(null); } }}>
        <DialogContent className="w-[calc(100%_-_2rem)] rounded-[24px] sm:max-w-md">
          <form onSubmit={assignPerson} noValidate>
            <DialogHeader><DialogTitle>Asignar persona</DialogTitle><DialogDescription className="leading-6">Agrega una persona a un equipo y decide dónde se contarán sus resultados.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-5"><div className="space-y-1.5"><Label htmlFor="assignment-person">Persona</Label><Select value={assignmentUserId} onValueChange={(value) => { setAssignmentUserId(value); setAssignmentError(null); }} disabled={Boolean(mutationKey)}><SelectTrigger id="assignment-person" className="h-11 rounded-xl"><SelectValue placeholder="Seleccionar persona" /></SelectTrigger><SelectContent>{people.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label htmlFor="assignment-team">Equipo</Label><Select value={assignmentTeamId} onValueChange={(value) => { setAssignmentTeamId(value); setAssignmentError(null); }} disabled={Boolean(mutationKey)}><SelectTrigger id="assignment-team" className="h-11 rounded-xl"><SelectValue placeholder="Seleccionar equipo" /></SelectTrigger><SelectContent>{teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select></div><div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/25 p-3.5"><Checkbox id="assignment-primary" checked={assignmentPrimary} onCheckedChange={(checked) => setAssignmentPrimary(checked === true)} disabled={Boolean(mutationKey)} className="mt-0.5" /><div><Label htmlFor="assignment-primary" className="cursor-pointer">Equipo principal</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">Los resultados de esta persona se contarán aquí y podrá usar el límite compartido del equipo.</p></div></div>{assignmentError ? <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{assignmentError}</p> : null}</div>
            <DialogFooter className="gap-2 sm:space-x-0"><Button type="button" variant="ghost" onClick={() => setAssignOpen(false)} disabled={Boolean(mutationKey)} className="rounded-xl">Cancelar</Button><Button type="submit" disabled={managementDisabled || !assignmentUserId || !assignmentTeamId} className="rounded-xl">{mutationKey === 'assign' ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}{mutationKey === 'assign' ? 'Guardando…' : 'Guardar asignación'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminTeamsPage() {
  return <Suspense fallback={<div className="mx-auto w-full max-w-[1320px] pb-10"><TeamsLoading /></div>}><TeamsPageContent /></Suspense>;
}
