'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity,
  BriefcaseBusiness,
  Building2,
  Check,
  CircleAlert,
  Globe2,
  LogOut,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

import { useAuth } from '@/context/AuthContext';
import type { AdminDashboardOverview, AdminDimension } from '@/lib/admin-dashboard-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const chartConfig = {
  leads: { label: 'Leads', color: 'hsl(var(--chart-1))' },
  contacted: { label: 'Contactados', color: 'hsl(var(--chart-2))' },
  replies: { label: 'Respuestas', color: 'hsl(var(--chart-3))' },
};

function inputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function initialRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: inputDate(from), to: inputDate(to) };
}

function number(value: number) {
  return value.toLocaleString('es-CL');
}

function percent(value: number) {
  return `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
}

function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '')
    : value;
}

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  accent = 'text-primary',
}: {
  label: string;
  value: string;
  note?: string;
  icon: LucideIcon;
  accent?: string;
}) {
  return (
    <Card className="rounded-2xl border-border/60 bg-card/90 shadow-[0_16px_34px_-30px_rgba(15,23,42,0.45)]">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
          <Icon className={cn('h-4 w-4 shrink-0', accent)} aria-hidden="true" />
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p>
        {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}

function DimensionList({ title, items, empty }: { title: string; items: AdminDimension[]; empty: string }) {
  return (
    <Card className="rounded-2xl border-border/60 bg-card/90">
      <CardHeader className="px-5 pb-2 pt-5">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Lo más representativo del período seleccionado.</CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {items.length === 0 ? (
          <p className="rounded-xl bg-muted/30 px-3 py-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className="space-y-3" role="list" aria-label={title}>
            {items.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 text-sm" role="listitem">
                <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{number(item.value)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminDashboardPage() {
  const { signOut } = useAuth();
  const range = useMemo(initialRange, []);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [groupId, setGroupId] = useState('');
  const [userId, setUserId] = useState('');
  const [overview, setOverview] = useState<AdminDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupCountry, setNewGroupCountry] = useState('');
  const [assignmentGroupId, setAssignmentGroupId] = useState('');
  const [assignmentUserId, setAssignmentUserId] = useState('');
  const [assignmentPrimary, setAssignmentPrimary] = useState(false);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function loadOverview(options: { silent?: boolean } = {}) {
    if (options.silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to });
    if (groupId) params.set('groupId', groupId);
    if (userId) params.set('userId', userId);

    try {
      const response = await fetch(`/api/dashboard/admin/overview?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos cargar el panel administrativo.');
      setOverview(payload as AdminDashboardOverview);
      if (!assignmentGroupId && payload.groups?.[0]?.id) setAssignmentGroupId(payload.groups[0].id);
      if (!assignmentUserId && payload.users?.[0]?.id) setAssignmentUserId(payload.users[0].id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar el panel administrativo.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadOverview();
    // Filters are the intentional reload boundary for this dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, groupId, userId]);

  async function mutateGroups(event: FormEvent) {
    event.preventDefault();
    setMutationMessage(null);
    setMutationError(null);
    try {
      const response = await fetch('/api/dashboard/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName, countryCode: newGroupCountry }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos crear el grupo.');
      setNewGroupName('');
      setNewGroupCountry('');
      setMutationMessage('Grupo creado.');
      await loadOverview({ silent: true });
    } catch (mutationLoadError) {
      setMutationError(mutationLoadError instanceof Error ? mutationLoadError.message : 'No pudimos crear el grupo.');
    }
  }

  async function assignUser(event: FormEvent) {
    event.preventDefault();
    setMutationMessage(null);
    setMutationError(null);
    try {
      const response = await fetch('/api/dashboard/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assign',
          groupId: assignmentGroupId,
          userId: assignmentUserId,
          isPrimary: assignmentPrimary,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos asignar el usuario.');
      setMutationMessage('Asignación actualizada.');
      await loadOverview({ silent: true });
    } catch (mutationLoadError) {
      setMutationError(mutationLoadError instanceof Error ? mutationLoadError.message : 'No pudimos asignar el usuario.');
    }
  }

  async function removeAssignment(groupIdToRemove: string, userIdToRemove: string) {
    setMutationMessage(null);
    setMutationError(null);
    try {
      const response = await fetch('/api/dashboard/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', groupId: groupIdToRemove, userId: userIdToRemove }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos quitar la asignación.');
      setMutationMessage('Asignación quitada.');
      await loadOverview({ silent: true });
    } catch (mutationLoadError) {
      setMutationError(mutationLoadError instanceof Error ? mutationLoadError.message : 'No pudimos quitar la asignación.');
    }
  }

  const summary = overview?.summary;
  const activeGroups = overview?.groups || [];
  const users = overview?.users || [];

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex flex-col gap-5 border-b border-border/60 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>Espacio administrativo</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{overview?.organization.name || 'GrupoExpro'}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Observa cómo trabaja el equipo, dónde se concentra el uso y qué resultados está generando.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void loadOverview({ silent: true })} disabled={loading || refreshing}>
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
              Actualizar
            </Button>
            <Button type="button" variant="ghost" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Salir
            </Button>
          </div>
        </header>

        <section aria-labelledby="filters-title" className="mt-5 rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 id="filters-title" className="text-sm font-semibold">Período y alcance</h2>
              <p className="mt-1 text-xs text-muted-foreground">Las cifras se recalculan para el rango y la segmentación elegidos.</p>
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="admin-from">Desde</Label>
                <Input id="admin-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-to">Hasta</Label>
                <Input id="admin-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-group">Grupo</Label>
                <select id="admin-group" value={groupId} onChange={(event) => setGroupId(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Todos los grupos</option>
                  {activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-user">Usuario</Label>
                <select id="admin-user" value={userId} onChange={(event) => setUserId(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Todo el equipo</option>
                  {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <div><p className="font-medium">No se pudo cargar el panel</p><p className="mt-1 text-muted-foreground">{error}</p></div>
          </div>
        ) : null}

        {loading && !overview ? (
          <div className="mt-5 space-y-5" aria-busy="true" aria-label="Cargando panel administrativo">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-2xl" />)}</div>
            <Skeleton className="h-80 rounded-2xl" />
          </div>
        ) : overview ? (
          <div className="mt-5 space-y-5">
            {overview.coverage.note ? (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-300/50 bg-amber-50/70 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                <p className="text-amber-950 dark:text-amber-100">{overview.coverage.note}</p>
              </div>
            ) : null}

            <section aria-label="Indicadores principales" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="Leads capturados" value={number(summary?.leadsCaptured || 0)} note="Leads únicos nuevos" icon={Search} />
              <MetricCard label="Leads contactados" value={number(summary?.leadsContacted || 0)} note="Contactos únicos" icon={Send} accent="text-sky-600 dark:text-sky-300" />
              <MetricCard label="Investigaciones" value={number(summary?.investigations || 0)} note="Solicitadas o completadas" icon={BriefcaseBusiness} accent="text-violet-600 dark:text-violet-300" />
              <MetricCard label="Teléfonos buscados" value={number(summary?.phonesSearched || 0)} note="Resultados con teléfono" icon={Phone} accent="text-emerald-600 dark:text-emerald-300" />
              <MetricCard label="Tasa de respuesta" value={percent(summary?.responseRate || 0)} note={`${number(summary?.replies || 0)} respuestas`} icon={Mail} accent="text-amber-600 dark:text-amber-300" />
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]" aria-label="Tendencia y lectura ejecutiva">
              <Card className="rounded-2xl border-border/60 bg-card/90">
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 px-5 pb-1 pt-5">
                  <div><CardTitle className="text-base">Ritmo de operación</CardTitle><CardDescription>Actividad diaria entre {overview.dateRange.from} y {overview.dateRange.to}.</CardDescription></div>
                  <Badge variant="outline" className="rounded-full font-normal">Proyección mensual: {number(summary?.monthlyProjection || 0)}</Badge>
                </CardHeader>
                <CardContent className="px-3 pb-4 pt-4 sm:px-5">
                  <ChartContainer config={chartConfig} className="h-[280px] w-full aspect-auto" aria-label="Tendencia diaria de leads, contactos y respuestas">
                    <AreaChart accessibilityLayer data={overview.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="adminLeads" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-leads)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--color-leads)" stopOpacity={0} /></linearGradient>
                        <linearGradient id="adminContacted" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-contacted)" stopOpacity={0.18} /><stop offset="95%" stopColor="var(--color-contacted)" stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={shortDate} minTickGap={24} />
                      <YAxis tickLine={false} axisLine={false} width={34} allowDecimals={false} />
                      <Tooltip content={<ChartTooltipContent labelFormatter={(value) => shortDate(String(value))} />} />
                      <Area type="monotone" dataKey="leads" stroke="var(--color-leads)" fill="url(#adminLeads)" strokeWidth={2} />
                      <Area type="monotone" dataKey="contacted" stroke="var(--color-contacted)" fill="url(#adminContacted)" strokeWidth={2} />
                      <Area type="monotone" dataKey="replies" stroke="var(--color-replies)" fill="transparent" strokeWidth={2} strokeDasharray="4 4" />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border/60 bg-card/90">
                <CardHeader className="px-5 pb-2 pt-5"><CardTitle className="text-base">Lectura rápida</CardTitle><CardDescription>Señales del período actual.</CardDescription></CardHeader>
                <CardContent className="space-y-4 px-5 pb-5">
                  <div className="rounded-xl bg-muted/30 p-3.5"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="h-4 w-4" aria-hidden="true" />Uso total proyectado</div><p className="mt-2 text-xl font-semibold tabular-nums">{number(summary?.monthlyProjection || 0)}</p><p className="mt-1 text-xs text-muted-foreground">operaciones estimadas para el mes</p></div>
                  <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-border/60 p-3"><p className="text-xs text-muted-foreground">Emails enviados</p><p className="mt-1 text-lg font-semibold tabular-nums">{number(summary?.emailsSent || 0)}</p></div><div className="rounded-xl border border-border/60 p-3"><p className="text-xs text-muted-foreground">LinkedIn</p><p className="mt-1 text-lg font-semibold tabular-nums">{number(summary?.linkedinConnections || 0)}</p></div></div>
                  <div className="rounded-xl border border-border/60 p-3.5"><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Filas de eventos leídas</p><span className="text-sm font-medium tabular-nums">{number(overview.coverage.eventRows)}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-full rounded-full bg-primary/70" /></div><p className="mt-2 text-xs text-muted-foreground">Los datos históricos se irán enriqueciendo con nuevas atribuciones.</p></div>
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="groups-title" className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
              <Card className="rounded-2xl border-border/60 bg-card/90">
                <CardHeader className="px-5 pb-2 pt-5"><div className="flex items-start justify-between gap-3"><div><CardTitle id="groups-title" className="text-base">Rendimiento por grupo</CardTitle><CardDescription>La atribución usa el grupo principal del usuario para evitar doble conteo.</CardDescription></div><Globe2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" /></div></CardHeader>
                <CardContent className="px-0 pb-2">
                  <Table><TableHeader><TableRow><TableHead className="pl-5">Grupo</TableHead><TableHead>Miembros</TableHead><TableHead>Leads</TableHead><TableHead>Contactados</TableHead><TableHead>Respuesta</TableHead></TableRow></TableHeader><TableBody>{activeGroups.length ? activeGroups.map((group) => <TableRow key={group.id}><TableCell className="pl-5"><button type="button" onClick={() => setGroupId(group.id)} className="flex items-center gap-2 font-medium hover:underline"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color || 'hsl(var(--primary))' }} aria-hidden="true" />{group.name}</button></TableCell><TableCell className="tabular-nums">{number(group.memberCount)}</TableCell><TableCell className="tabular-nums">{number(group.metrics.leads)}</TableCell><TableCell className="tabular-nums">{number(group.metrics.contacted)}</TableCell><TableCell className="tabular-nums">{percent(group.metrics.responseRate)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Aún no hay grupos creados.</TableCell></TableRow>}</TableBody></Table>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border/60 bg-card/90">
                <CardHeader className="px-5 pb-2 pt-5"><CardTitle className="text-base">Personas y empresas</CardTitle><CardDescription>Concentración del outreach en el período.</CardDescription></CardHeader>
                <CardContent className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-1"><div className="flex items-center justify-between rounded-xl bg-muted/30 p-3"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Building2 className="h-4 w-4" aria-hidden="true" />Empresas capturadas</span><span className="font-semibold tabular-nums">{number(overview.companies.reduce((sum, item) => sum + item.value, 0))}</span></div><div className="flex items-center justify-between rounded-xl bg-muted/30 p-3"><span className="flex items-center gap-2 text-sm text-muted-foreground"><UserRound className="h-4 w-4" aria-hidden="true" />Seniorities detectados</span><span className="font-semibold tabular-nums">{number(overview.seniorities.reduce((sum, item) => sum + item.value, 0))}</span></div></CardContent>
              </Card>
            </section>

            <section aria-labelledby="team-title" className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
              <Card className="rounded-2xl border-border/60 bg-card/90">
                <CardHeader className="px-5 pb-2 pt-5"><CardTitle id="team-title" className="text-base">Actividad del equipo</CardTitle><CardDescription>Usuarios ordenados por actividad del período.</CardDescription></CardHeader>
                <CardContent className="px-0 pb-2"><Table><TableHeader><TableRow><TableHead className="pl-5">Usuario</TableHead><TableHead>Grupos</TableHead><TableHead>Leads</TableHead><TableHead>Contactados</TableHead><TableHead>Respuestas</TableHead></TableRow></TableHeader><TableBody>{users.length ? users.slice(0, 12).map((user) => <TableRow key={user.id}><TableCell className="pl-5"><div className="flex min-w-0 items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{user.name.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-medium">{user.name}</p><p className="max-w-[180px] truncate text-xs text-muted-foreground">{user.email}</p></div></div></TableCell><TableCell><div className="flex max-w-[240px] flex-wrap gap-1">{user.groups.length ? user.groups.map((group) => <span key={group.id} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', group.primary ? 'border-transparent bg-primary text-primary-foreground' : 'border-border text-foreground')}><span>{group.name}</span><button type="button" onClick={() => void removeAssignment(group.id, user.id)} className="rounded-full p-0.5 opacity-70 transition-opacity hover:bg-background/20 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring" aria-label={`Quitar ${user.name} del grupo ${group.name}`}><X className="h-3 w-3" aria-hidden="true" /></button></span>) : <span className="text-xs text-muted-foreground">Sin grupo</span>}</div></TableCell><TableCell className="tabular-nums">{number(user.metrics.leads)}</TableCell><TableCell className="tabular-nums">{number(user.metrics.contacted)}</TableCell><TableCell className="tabular-nums">{number(user.metrics.replies)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No hay usuarios para este filtro.</TableCell></TableRow>}</TableBody></Table></CardContent>
              </Card>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1"><DimensionList title="Seniorities" items={overview.seniorities} empty="Sin datos de seniority." /><DimensionList title="Cargos" items={overview.titles} empty="Sin datos de cargos." /></div>
            </section>

            <section aria-labelledby="groups-management-title" className="grid gap-5 lg:grid-cols-2">
              <Card className="rounded-2xl border-border/60 bg-card/90"><CardHeader className="px-5 pb-2 pt-5"><CardTitle id="groups-management-title" className="text-base">Crear grupo</CardTitle><CardDescription>Agrega una nueva región o equipo operativo.</CardDescription></CardHeader><CardContent className="px-5 pb-5"><form onSubmit={mutateGroups} className="grid gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end"><div className="space-y-1.5"><Label htmlFor="new-group-name">Nombre</Label><Input id="new-group-name" value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Ej. México" required /></div><div className="space-y-1.5"><Label htmlFor="new-group-country">Código</Label><Input id="new-group-country" value={newGroupCountry} onChange={(event) => setNewGroupCountry(event.target.value.toUpperCase().slice(0, 3))} placeholder="MX" maxLength={3} /></div><Button type="submit" className="sm:mb-0"><Plus className="h-4 w-4" aria-hidden="true" />Crear</Button></form></CardContent></Card>
              <Card className="rounded-2xl border-border/60 bg-card/90"><CardHeader className="px-5 pb-2 pt-5"><CardTitle className="text-base">Asignar usuario</CardTitle><CardDescription>Un usuario puede pertenecer a varios grupos y tener uno principal.</CardDescription></CardHeader><CardContent className="px-5 pb-5"><form onSubmit={assignUser} className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="assignment-group">Grupo</Label><select id="assignment-group" value={assignmentGroupId} onChange={(event) => setAssignmentGroupId(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" required><option value="">Seleccionar grupo</option>{activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor="assignment-user">Usuario</Label><select id="assignment-user" value={assignmentUserId} onChange={(event) => setAssignmentUserId(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" required><option value="">Seleccionar usuario</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></div><label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2"><input type="checkbox" checked={assignmentPrimary} onChange={(event) => setAssignmentPrimary(event.target.checked)} className="h-4 w-4 rounded border-input accent-primary" />Marcar como grupo principal</label><Button type="submit" variant="outline" className="sm:col-span-2"><Check className="h-4 w-4" aria-hidden="true" />Guardar asignación</Button></form></CardContent></Card>
            </section>

            {mutationMessage ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{mutationMessage}</p> : null}
            {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}

            <footer className="flex flex-col gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>Actualizado {new Date(overview.generatedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span><span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Datos restringidos a administradores de la organización</span></footer>
          </div>
        ) : null}
      </div>
    </main>
  );
}
