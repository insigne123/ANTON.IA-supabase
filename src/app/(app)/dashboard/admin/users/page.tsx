'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CircleAlert,
  Clock3,
  FilterX,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react';

import { InviteMemberDialog } from '@/components/organization/InviteMemberDialog';
import { PageHeader } from '@/components/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { AdminDashboardOverview, AdminReportingUser } from '@/lib/admin-dashboard-types';
import { organizationService, type OrganizationRole } from '@/lib/services/organization-service';
import { cn } from '@/lib/utils';

type Period = '7' | '30' | '90';
type PersonStatus = 'all' | 'unverified' | 'no-team' | 'inactive';
type PersonSort = 'activity' | 'contacted' | 'replies' | 'name';

const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Miembro',
};
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

function formatActivity(value: string | null) {
  if (!value) return 'Sin actividad';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Sin actividad';
  const today = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((currentDay.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days > 1 && days < 7) return `Hace ${days} días`;
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || 'U').toUpperCase();
}

function primaryTeam(user: AdminReportingUser) {
  return user.groups.find((group) => group.primary) || null;
}

function roleBadgeVariant(role: OrganizationRole): 'default' | 'secondary' | 'outline' {
  if (role === 'owner') return 'default';
  if (role === 'admin') return 'secondary';
  return 'outline';
}

function PeopleLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando personas">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-[480px] rounded-[24px]" />
    </div>
  );
}

function PeoplePageContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const initialPeriod = searchParams.get('period');
  const initialStatus = searchParams.get('status');
  const initialSort = searchParams.get('sort');
  const [period, setPeriod] = useState<Period>(initialPeriod === '7' || initialPeriod === '90' ? initialPeriod : '30');
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [role, setRole] = useState(searchParams.get('role') || 'all');
  const [teamId, setTeamId] = useState(searchParams.get('teamId') || 'all');
  const [status, setStatus] = useState<PersonStatus>(initialStatus === 'unverified' || initialStatus === 'no-team' || initialStatus === 'inactive' ? initialStatus : 'all');
  const [sort, setSort] = useState<PersonSort>(initialSort === 'contacted' || initialSort === 'replies' || initialSort === 'name' ? initialSort : 'activity');
  const [overview, setOverview] = useState<AdminDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<AdminReportingUser | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestRef = useRef(0);
  const range = useMemo(() => rangeFor(Number(period)), [period]);

  useEffect(() => {
    const params = new URLSearchParams({ period });
    if (query.trim()) params.set('q', query.trim());
    if (role !== 'all') params.set('role', role);
    if (teamId !== 'all') params.set('teamId', teamId);
    if (status !== 'all') params.set('status', status);
    if (sort !== 'activity') params.set('sort', sort);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, period, query, role, router, sort, status, teamId]);

  async function loadPeople(options: { silent?: boolean } = {}) {
    const requestId = ++requestRef.current;
    if (options.silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams(range);
      const response = await fetch(`/api/dashboard/admin/overview?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos cargar las personas del equipo.');
      if (requestId === requestRef.current) setOverview(payload as AdminDashboardOverview);
    } catch (loadError) {
      if (requestId === requestRef.current) {
        setOverview(null);
        setRemoveCandidate(null);
        setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar las personas del equipo.');
      }
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void loadPeople();
    // The selected period intentionally controls this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const currentRole = overview?.users.find((person) => person.id === currentUser?.id)?.role || 'member';

  function canManagePerson(person: AdminReportingUser) {
    if (loading || refreshing || error) return false;
    if ((currentRole !== 'owner' && currentRole !== 'admin') || person.id === currentUser?.id) return false;
    return currentRole === 'owner' || person.role !== 'owner';
  }

  function availableRoles() {
    const roles: OrganizationRole[] = ['owner', 'admin', 'member'];
    return currentRole === 'owner' ? roles : roles.filter((item) => item !== 'owner');
  }

  async function updateRole(person: AdminReportingUser, nextRole: OrganizationRole) {
    if (!overview || !canManagePerson(person) || nextRole === person.role || pendingAction) return;
    const actionId = `role:${person.id}`;
    setPendingAction(actionId);
    try {
      const updated = await organizationService.updateMemberRole(overview.organization.id, person.id, nextRole);
      if (!updated) throw new Error('role-update-failed');
      toast({ title: 'Rol actualizado', description: `${person.name} ahora es ${ROLE_LABELS[nextRole].toLowerCase()}.` });
      await loadPeople({ silent: true });
    } catch {
      toast({ variant: 'destructive', title: 'No pudimos cambiar el rol', description: 'El acceso no se modificó. Inténtalo de nuevo.' });
    } finally {
      setPendingAction(null);
    }
  }

  async function removePerson() {
    if (!overview || !removeCandidate || !canManagePerson(removeCandidate) || pendingAction) return;
    const actionId = `remove:${removeCandidate.id}`;
    setPendingAction(actionId);
    try {
      const removed = await organizationService.removeMember(overview.organization.id, removeCandidate.id);
      if (!removed) throw new Error('member-removal-failed');
      toast({ title: 'Acceso removido', description: `${removeCandidate.name} ya no pertenece a esta organización.` });
      setRemoveCandidate(null);
      await loadPeople({ silent: true });
    } catch {
      toast({ variant: 'destructive', title: 'No pudimos remover a la persona', description: 'Su acceso no cambió. Inténtalo de nuevo.' });
    } finally {
      setPendingAction(null);
    }
  }

  const allPeople = overview?.users || EMPTY_PEOPLE;
  const filteredPeople = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = allPeople.filter((person) => {
      if (normalizedQuery && !`${person.name} ${person.email}`.toLowerCase().includes(normalizedQuery)) return false;
      if (role !== 'all' && person.role !== role) return false;
      if (teamId !== 'all' && !person.groups.some((group) => group.id === teamId)) return false;
      if (status === 'unverified' && person.emailConfirmed) return false;
      if (status === 'no-team' && primaryTeam(person)) return false;
      if (status === 'inactive' && person.metrics.activeDays > 0) return false;
      return true;
    });

    return filtered.sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name);
      if (sort === 'contacted') return right.metrics.contacted - left.metrics.contacted || left.name.localeCompare(right.name);
      if (sort === 'replies') return right.metrics.replies - left.metrics.replies || left.name.localeCompare(right.name);
      return String(right.lastActivityAt || '').localeCompare(String(left.lastActivityAt || '')) || left.name.localeCompare(right.name);
    });
  }, [allPeople, query, role, sort, status, teamId]);

  const summary = useMemo(() => ({
    members: allPeople.length,
    active: allPeople.filter((person) => person.metrics.activeDays > 0).length,
    withoutTeam: allPeople.filter((person) => !primaryTeam(person)).length,
    unverified: allPeople.filter((person) => !person.emailConfirmed).length,
  }), [allPeople]);
  const hasFilters = Boolean(query.trim() || role !== 'all' || teamId !== 'all' || status !== 'all' || sort !== 'activity');
  const advancedFilterCount = Number(role !== 'all') + Number(teamId !== 'all') + Number(status !== 'all') + Number(sort !== 'activity');

  function clearFilters() {
    setQuery('');
    setRole('all');
    setTeamId('all');
    setStatus('all');
    setSort('activity');
  }

  function PersonMenu({ person }: { person: AdminReportingUser }) {
    const manageable = canManagePerson(person);
    const personPending = pendingAction?.endsWith(person.id) || false;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" disabled={Boolean(pendingAction)} className="h-10 w-10 rounded-full" aria-label={`Gestionar a ${person.name}`}>
            {personPending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
          <DropdownMenuItem asChild className="rounded-lg"><Link href={`/dashboard/admin/users/${person.id}`}><UserRound aria-hidden="true" />Ver perfil</Link></DropdownMenuItem>
          <DropdownMenuItem asChild className="rounded-lg"><Link href={`/dashboard/admin/teams?userId=${person.id}`}><UsersRound aria-hidden="true" />Gestionar equipos</Link></DropdownMenuItem>
          {manageable ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Cambiar rol</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={person.role} onValueChange={(value) => void updateRole(person, value as OrganizationRole)}>
                {availableRoles().map((roleOption) => <DropdownMenuRadioItem key={roleOption} value={roleOption} disabled={roleOption === person.role} className="rounded-lg">{ROLE_LABELS[roleOption]}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setRemoveCandidate(person)} className="rounded-lg text-destructive focus:bg-destructive/10 focus:text-destructive"><Trash2 aria-hidden="true" />Remover de la organización</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1320px] pb-10">
      <PageHeader title="Personas" description={`Administra acceso y revisa el rendimiento de ${overview?.organization.name || 'la organización'}.`}>
        {overview && !loading && !refreshing && (currentRole === 'owner' || currentRole === 'admin') ? <InviteMemberDialog organizationId={overview.organization.id} onInviteSent={() => void loadPeople({ silent: true })} /> : null}
        <Button asChild variant="ghost" size="icon" className="rounded-xl"><Link href="/settings/organization" aria-label="Abrir configuración de la organización"><Settings aria-hidden="true" /></Link></Button>
        <Button type="button" variant="ghost" size="icon" onClick={() => void loadPeople({ silent: true })} disabled={loading || refreshing} className="rounded-xl" aria-label="Actualizar personas">
          <RefreshCw className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
        </Button>
      </PageHeader>

      {loading && !overview ? <PeopleLoading /> : null}

      {error ? (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="font-medium">No pudimos actualizar Personas</p><p className="mt-1 text-muted-foreground">{error}</p></div>
          {!overview ? <Button type="button" variant="outline" size="sm" onClick={() => void loadPeople()} className="rounded-xl">Reintentar</Button> : null}
        </div>
      ) : null}

      {overview ? (
        <div className="space-y-4" aria-busy={refreshing || Boolean(pendingAction)}>
          {overview.coverage.note ? (
            <div role="status" className="flex items-start gap-3 rounded-2xl border border-amber-300/50 bg-amber-50/70 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{overview.coverage.sampled ? 'Este período tiene mucha actividad. Usa un rango menor para comparar con mayor precisión.' : 'Parte de la actividad no está disponible temporalmente.'}</p>
            </div>
          ) : null}

          <section aria-labelledby="people-filters-title" className="rounded-2xl border border-border/60 bg-card/65 p-4 dark:bg-card/45">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h2 id="people-filters-title" className="text-sm font-semibold">Buscar y filtrar</h2><p className="mt-1 text-xs text-muted-foreground">Las métricas usan el período seleccionado.</p></div>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setFiltersOpen((open) => !open)} className="rounded-xl sm:hidden" aria-expanded={filtersOpen} aria-controls="people-advanced-filters"><SlidersHorizontal aria-hidden="true" />Filtros{advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ''}</Button>
                {hasFilters ? <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="rounded-xl" aria-label="Limpiar filtros"><FilterX aria-hidden="true" /><span className="hidden sm:inline">Limpiar</span></Button> : null}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-1.5">
                <Label htmlFor="people-search">Nombre o correo</Label>
                <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="people-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar persona" className="h-10 rounded-xl pl-9" /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="people-period">Período</Label><Select value={period} onValueChange={(value) => setPeriod(value as Period)}><SelectTrigger id="people-period" className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">7 días</SelectItem><SelectItem value="30">30 días</SelectItem><SelectItem value="90">90 días</SelectItem></SelectContent></Select></div>
            </div>
            <div id="people-advanced-filters" className={cn('mt-3 grid gap-3 border-t border-border/60 pt-3 sm:grid sm:grid-cols-2 lg:grid-cols-4', !filtersOpen && 'hidden sm:grid')}>
              <div className="space-y-1.5"><Label htmlFor="people-role">Rol</Label><Select value={role} onValueChange={setRole}><SelectTrigger id="people-role" className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="owner">Propietario</SelectItem><SelectItem value="admin">Administrador</SelectItem><SelectItem value="member">Miembro</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label htmlFor="people-team">Equipo</Label><Select value={teamId} onValueChange={setTeamId}><SelectTrigger id="people-team" className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem>{overview.filterOptions.groups.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label htmlFor="people-status">Estado</Label><Select value={status} onValueChange={(value) => setStatus(value as PersonStatus)}><SelectTrigger id="people-status" className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="inactive">Sin actividad</SelectItem><SelectItem value="no-team">Sin equipo</SelectItem><SelectItem value="unverified">Sin verificar</SelectItem></SelectContent></Select></div>
              <div className="min-w-0 space-y-1.5"><Label htmlFor="people-sort">Ordenar por</Label><Select value={sort} onValueChange={(value) => setSort(value as PersonSort)}><SelectTrigger id="people-sort" className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="activity">Actividad reciente</SelectItem><SelectItem value="contacted">Más contactados</SelectItem><SelectItem value="replies">Más respuestas</SelectItem><SelectItem value="name">Nombre</SelectItem></SelectContent></Select></div>
            </div>
          </section>

          <Card className="overflow-hidden rounded-[24px] border-border/60 bg-card/90 dark:bg-card/75">
            <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4 sm:px-6">
              <div><h2 className="font-semibold">Personas</h2><p className="mt-1 text-xs text-muted-foreground">{filteredPeople.length} de {summary.members} · {summary.active} activas · {summary.withoutTeam} sin equipo principal · {summary.unverified} con correo pendiente</p></div>
              {refreshing ? <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Actualizando</span> : null}
            </div>

            {filteredPeople.length > 0 ? (
              <>
                <div className="divide-y divide-border/60 xl:hidden">
                  {filteredPeople.map((person) => (
                    <div key={person.id} className="flex items-start gap-3 px-4 py-4">
                      <Avatar className="h-11 w-11 border border-border/60"><AvatarImage src={person.avatarUrl || undefined} alt="" /><AvatarFallback className="text-xs">{initials(person.name)}</AvatarFallback></Avatar>
                      <div className="min-w-0 flex-1">
                        <Link href={`/dashboard/admin/users/${person.id}`} className="block truncate text-sm font-semibold hover:underline">{person.name}</Link>
                        <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant={roleBadgeVariant(person.role)} className="font-normal">{ROLE_LABELS[person.role]}</Badge><span className="text-xs text-muted-foreground">{primaryTeam(person)?.name || 'Sin equipo principal'}</span></div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><span><strong className="block text-sm tabular-nums">{formatNumber(person.metrics.contacted)}</strong><span className="text-muted-foreground">Contactos</span></span><span><strong className="block text-sm tabular-nums">{formatNumber(person.metrics.replies)}</strong><span className="text-muted-foreground">Respuestas</span></span><span><strong className="block text-sm tabular-nums">{formatPercent(person.metrics.responseRate)}</strong><span className="text-muted-foreground">Tasa</span></span></div>
                      </div>
                      <PersonMenu person={person} />
                    </div>
                  ))}
                </div>
                <div className="hidden xl:block">
                  <Table aria-label="Personas de la organización">
                    <TableHeader><TableRow><TableHead className="pl-6">Persona</TableHead><TableHead>Rol</TableHead><TableHead>Equipo principal</TableHead><TableHead>Actividad</TableHead><TableHead className="text-right">Contactos</TableHead><TableHead className="text-right">Respuestas</TableHead><TableHead className="text-right">Tasa</TableHead><TableHead className="w-16"><span className="sr-only">Acciones</span></TableHead></TableRow></TableHeader>
                    <TableBody>{filteredPeople.map((person) => <TableRow key={person.id}><TableCell className="pl-6"><div className="flex min-w-[210px] items-center gap-3"><Avatar className="h-9 w-9 border border-border/60"><AvatarImage src={person.avatarUrl || undefined} alt="" /><AvatarFallback className="text-[11px]">{initials(person.name)}</AvatarFallback></Avatar><div className="min-w-0"><Link href={`/dashboard/admin/users/${person.id}`} className="block max-w-[210px] truncate font-medium hover:underline">{person.name}</Link><span className="block max-w-[210px] truncate text-xs text-muted-foreground">{person.email}</span>{!person.emailConfirmed ? <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-300">Correo pendiente</span> : null}</div></div></TableCell><TableCell><Badge variant={roleBadgeVariant(person.role)} className="font-normal">{ROLE_LABELS[person.role]}</Badge></TableCell><TableCell className="text-muted-foreground">{primaryTeam(person)?.name || 'Sin equipo'}</TableCell><TableCell><span className={cn('inline-flex items-center gap-1.5 text-sm', !person.lastActivityAt && 'text-muted-foreground')}><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{formatActivity(person.lastActivityAt)}</span></TableCell><TableCell className="text-right font-medium tabular-nums">{formatNumber(person.metrics.contacted)}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatNumber(person.metrics.replies)}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatPercent(person.metrics.responseRate)}</TableCell><TableCell><PersonMenu person={person} /></TableCell></TableRow>)}</TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><UserRound className="h-5 w-5" aria-hidden="true" /></span>
                <h3 className="mt-4 text-sm font-semibold">No encontramos personas</h3>
                <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Prueba con otro nombre o elimina algunos filtros.</p>
                {hasFilters ? <Button type="button" variant="outline" size="sm" onClick={clearFilters} className="mt-4 rounded-xl"><FilterX aria-hidden="true" />Limpiar filtros</Button> : null}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <AlertDialog open={Boolean(removeCandidate)} onOpenChange={(open) => { if (!open && !pendingAction) setRemoveCandidate(null); }}>
        <AlertDialogContent className="w-[calc(100%_-_2rem)] rounded-[24px] sm:max-w-md">
          <AlertDialogHeader><AlertDialogTitle>¿Remover a {removeCandidate?.name || 'esta persona'}?</AlertDialogTitle><AlertDialogDescription className="leading-6">Perderá el acceso a esta organización. Su cuenta y sus datos personales no se eliminarán.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0"><AlertDialogCancel disabled={Boolean(pendingAction)} className="rounded-xl">Cancelar</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void removePerson(); }} disabled={Boolean(pendingAction)} className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90">{pendingAction?.startsWith('remove:') ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}{pendingAction?.startsWith('remove:') ? 'Removiendo…' : 'Remover acceso'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function AdminPeoplePage() {
  return <Suspense fallback={<div className="mx-auto w-full max-w-[1320px] pb-10"><PeopleLoading /></div>}><PeoplePageContent /></Suspense>;
}
