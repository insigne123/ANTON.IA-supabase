'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Send,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

import { PageHeader } from '@/components/page-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AdminDashboardOverview, AdminReportingUser } from '@/lib/admin-dashboard-types';
import { cn } from '@/lib/utils';

type Period = '7' | '30' | '90' | 'custom';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const chartConfig = {
  leads: { label: 'Leads', color: 'hsl(var(--chart-1))' },
  contacted: { label: 'Contactados', color: 'hsl(var(--chart-2))' },
  replies: { label: 'Respuestas', color: 'hsl(var(--chart-3))' },
};
const EMPTY_USERS: AdminReportingUser[] = [];
const EMPTY_TEAMS: AdminDashboardOverview['groups'] = [];

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

function formatShortDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '')
    : value;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    : 'recién';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || 'U').toUpperCase();
}

function primaryTeam(user: AdminReportingUser) {
  return user.groups.find((group) => group.primary) || user.groups[0] || null;
}

function MetricCard({ label, value, note, icon: Icon, accent }: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <Card className="rounded-2xl border-border/60 bg-card/90 shadow-[0_16px_34px_-30px_rgba(15,23,42,0.45)] dark:bg-card/75">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl bg-muted/65', accent)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] tabular-nums">{value}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function OverviewLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Cargando resumen administrativo">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-2xl" />)}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(290px,0.65fr)]">
        <Skeleton className="h-[390px] rounded-2xl" />
        <Skeleton className="h-[390px] rounded-2xl" />
      </div>
    </div>
  );
}

function AdminOverview() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPeriod = searchParams.get('period');
  const normalizedInitialPeriod: Period = initialPeriod === '7' || initialPeriod === '90' || initialPeriod === 'custom' ? initialPeriod : '30';
  const defaultRange = useMemo(() => rangeFor(normalizedInitialPeriod === 'custom' ? 30 : Number(normalizedInitialPeriod)), [normalizedInitialPeriod]);
  const [period, setPeriod] = useState<Period>(normalizedInitialPeriod);
  const [from, setFrom] = useState(DATE_RE.test(searchParams.get('from') || '') ? String(searchParams.get('from')) : defaultRange.from);
  const [to, setTo] = useState(DATE_RE.test(searchParams.get('to') || '') ? String(searchParams.get('to')) : defaultRange.to);
  const [groupId, setGroupId] = useState(searchParams.get('groupId') || '');
  const [userId, setUserId] = useState(searchParams.get('userId') || '');
  const [overview, setOverview] = useState<AdminDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return;
    const params = new URLSearchParams({ period, from, to });
    if (groupId) params.set('groupId', groupId);
    if (userId) params.set('userId', userId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [from, groupId, pathname, period, router, to, userId]);

  async function loadOverview(options: { silent?: boolean } = {}) {
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      setError('Revisa el período seleccionado. La fecha inicial debe ser anterior a la fecha final.');
      setLoading(false);
      return;
    }

    const requestId = ++requestRef.current;
    if (options.silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    const params = new URLSearchParams({ from, to });
    if (groupId) params.set('groupId', groupId);
    if (userId) params.set('userId', userId);

    try {
      const response = await fetch(`/api/dashboard/admin/overview?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos cargar el resumen administrativo.');
      if (requestId === requestRef.current) setOverview(payload as AdminDashboardOverview);
    } catch (loadError) {
      if (requestId === requestRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar el resumen administrativo.');
      }
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void loadOverview();
    // These values intentionally define the data refresh boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, groupId, userId]);

  function changePeriod(nextPeriod: Period) {
    setPeriod(nextPeriod);
    if (nextPeriod !== 'custom') {
      const nextRange = rangeFor(Number(nextPeriod));
      setFrom(nextRange.from);
      setTo(nextRange.to);
    }
  }

  const users = overview?.users || EMPTY_USERS;
  const teams = overview?.groups || EMPTY_TEAMS;
  const selectedUserName = overview?.filterOptions.users.find((user) => user.id === userId)?.name || '';
  const attentionItems = useMemo(() => {
    const unverified = users.filter((user) => !user.emailConfirmed).length;
    const withoutTeam = users.filter((user) => !user.groups.some((group) => group.primary)).length;
    const inactive = users.filter((user) => user.metrics.activeDays === 0).length;
    const hrefFor = (status: string) => {
      if (period === 'custom') return null;
      const params = new URLSearchParams({ status, period });
      if (groupId) params.set('teamId', groupId);
      if (selectedUserName) params.set('q', selectedUserName);
      return `/dashboard/admin/users?${params.toString()}`;
    };
    return [
      { key: 'unverified', count: unverified, label: 'Correos pendientes de verificar', href: hrefFor('unverified') },
      { key: 'no-team', count: withoutTeam, label: 'Personas sin equipo principal', href: hrefFor('no-team') },
      { key: 'inactive', count: inactive, label: 'Sin actividad en el período', href: hrefFor('inactive') },
    ].filter((item) => item.count > 0);
  }, [groupId, period, selectedUserName, users]);

  const summary = overview?.summary;

  return (
    <div className="mx-auto w-full max-w-[1320px] pb-10">
      <PageHeader
        title="Resumen"
        description={`${overview?.organization.name || 'Organización'} · Actividad, resultados y señales del equipo en un solo lugar.`}
      >
        <Button type="button" variant="ghost" onClick={() => void loadOverview({ silent: true })} disabled={loading || refreshing} className="rounded-xl">
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
          {refreshing ? 'Actualizando' : 'Actualizar'}
        </Button>
      </PageHeader>

      <section aria-labelledby="overview-filters-title" className="mb-5 rounded-2xl border border-border/60 bg-card/65 p-4 dark:bg-card/45">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="overview-filters-title" className="text-sm font-semibold">Período y alcance</h2>
            <p className="mt-1 text-xs text-muted-foreground">Ajusta la lectura sin perder el contexto del equipo.</p>
          </div>
          {loading || refreshing ? <span className="text-xs text-muted-foreground" role="status">Actualizando…</span> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="admin-period">Período</Label>
            <Select value={period} onValueChange={(value) => changePeriod(value as Period)}>
              <SelectTrigger id="admin-period" className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 días</SelectItem>
                <SelectItem value="30">Últimos 30 días</SelectItem>
                <SelectItem value="90">Últimos 90 días</SelectItem>
                <SelectItem value="custom">Rango personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-team">Equipo</Label>
            <Select value={groupId || 'all'} onValueChange={(value) => {
              setGroupId(value === 'all' ? '' : value);
              setUserId('');
            }}>
              <SelectTrigger id="admin-team" className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los equipos</SelectItem>
                {(overview?.filterOptions.groups || []).map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
            <Label htmlFor="admin-user">Persona</Label>
            <Select value={userId || 'all'} onValueChange={(value) => setUserId(value === 'all' ? '' : value)}>
              <SelectTrigger id="admin-user" className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el equipo</SelectItem>
                {(overview?.filterOptions.users || []).map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {period === 'custom' ? (
          <div className="mt-3 grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="admin-from">Desde</Label>
              <Input id="admin-from" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-to">Hasta</Label>
              <Input id="admin-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-xl" />
            </div>
          </div>
        ) : null}
      </section>

      {error ? (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div><p className="font-medium">No pudimos actualizar el resumen</p><p className="mt-1 text-muted-foreground">{error}</p></div>
        </div>
      ) : null}

      {loading && !overview ? <OverviewLoading /> : null}

      {overview ? (
        <div className="space-y-5" aria-busy={loading || refreshing}>
          {overview.coverage.note ? (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-300/50 bg-amber-50/70 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" role="status">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
              <p>{overview.coverage.sampled ? 'Este período tiene mucha actividad. Usa un rango menor para ver cifras más precisas.' : 'Algunos datos no pudieron actualizarse. Inténtalo nuevamente en unos minutos.'}</p>
            </div>
          ) : null}

          <section aria-label="Indicadores principales" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Leads capturados" value={formatNumber(summary?.leadsCaptured || 0)} note="Nuevos en el período" icon={Search} accent="text-primary" />
            <MetricCard label="Leads contactados" value={formatNumber(summary?.leadsContacted || 0)} note="Con envío confirmado" icon={Send} accent="text-sky-600 dark:text-sky-300" />
            <MetricCard label="Respuestas" value={formatNumber(summary?.replies || 0)} note={`${formatNumber(summary?.emailsSent || 0)} emails enviados`} icon={Mail} accent="text-emerald-600 dark:text-emerald-300" />
            <MetricCard label="Tasa de respuesta" value={formatPercent(summary?.responseRate || 0)} note="Respuestas sobre emails enviados" icon={CheckCircle2} accent="text-amber-600 dark:text-amber-300" />
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(290px,0.65fr)]" aria-label="Tendencia y atención">
            <Card className="overflow-hidden rounded-[24px] border-border/60 bg-card/90 dark:bg-card/75">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 border-b border-border/60 px-5 py-5 sm:px-6">
                <div>
                  <CardTitle className="text-lg">Rendimiento del período</CardTitle>
                  <CardDescription className="mt-1">Leads, contactos y respuestas por día.</CardDescription>
                </div>
                <Badge variant="outline" className="rounded-full font-normal">{formatShortDate(overview.dateRange.from)} – {formatShortDate(overview.dateRange.to)}</Badge>
              </CardHeader>
              <CardContent className="px-3 pb-0 pt-4 sm:px-5">
                <ChartContainer config={chartConfig} className="h-[280px] w-full aspect-auto" aria-label="Tendencia diaria de leads, contactos y respuestas">
                  <AreaChart accessibilityLayer data={overview.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="adminLeads" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-leads)" stopOpacity={0.24} /><stop offset="95%" stopColor="var(--color-leads)" stopOpacity={0} /></linearGradient>
                      <linearGradient id="adminContacted" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-contacted)" stopOpacity={0.16} /><stop offset="95%" stopColor="var(--color-contacted)" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={formatShortDate} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} width={34} allowDecimals={false} />
                    <Tooltip content={<ChartTooltipContent labelFormatter={(value) => formatShortDate(String(value))} />} />
                    <Area type="monotone" dataKey="leads" stroke="var(--color-leads)" fill="url(#adminLeads)" strokeWidth={2} />
                    <Area type="monotone" dataKey="contacted" stroke="var(--color-contacted)" fill="url(#adminContacted)" strokeWidth={2} />
                    <Area type="monotone" dataKey="replies" stroke="var(--color-replies)" fill="transparent" strokeWidth={2} strokeDasharray="4 4" />
                  </AreaChart>
                </ChartContainer>
                <div className="grid border-t border-border/60 sm:grid-cols-4">
                  {[
                    { label: 'Investigaciones', value: summary?.investigations || 0, icon: BriefcaseBusiness },
                    { label: 'Con teléfono', value: summary?.phonesSearched || 0, icon: Phone },
                    { label: 'Emails', value: summary?.emailsSent || 0, icon: Mail },
                    { label: 'LinkedIn', value: summary?.linkedinConnections || 0, icon: Building2 },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 sm:block sm:border-b-0 sm:border-l sm:first:border-l-0">
                      <span className="flex items-center gap-2 text-xs text-muted-foreground"><item.icon className="h-3.5 w-3.5" aria-hidden="true" />{item.label}</span>
                      <span className="font-semibold tabular-nums sm:mt-1 sm:block">{formatNumber(item.value)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[24px] border-border/60 bg-card/90 dark:bg-card/75">
              <CardHeader className="border-b border-border/60 px-5 py-5">
                <CardTitle className="text-lg">Requiere atención</CardTitle>
                <CardDescription className="mt-1">Señales concretas para revisar ahora.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {attentionItems.length > 0 ? (
                  <div role="list">
                    {attentionItems.map((item) => (
                      item.href ? <Link key={item.key} href={item.href} role="listitem" className="flex min-h-16 items-center gap-3 border-b border-border/60 px-5 py-3.5 transition-colors last:border-b-0 hover:bg-muted/35">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 font-semibold tabular-nums text-amber-700 dark:text-amber-300">{item.count}</span>
                        <span className="min-w-0 flex-1 text-sm font-medium">{item.label}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </Link> : <div key={item.key} role="listitem" className="flex min-h-16 items-center gap-3 border-b border-border/60 px-5 py-3.5 last:border-b-0">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 font-semibold tabular-nums text-amber-700 dark:text-amber-300">{item.count}</span>
                        <span className="min-w-0 flex-1 text-sm font-medium">{item.label}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /></span>
                    <p className="mt-4 text-sm font-semibold">Todo está en orden</p>
                    <p className="mt-1 max-w-xs text-sm leading-6 text-muted-foreground">No hay señales pendientes para el alcance seleccionado.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-2" aria-label="Rendimiento por personas y equipos">
            <Card className="overflow-hidden rounded-[24px] border-border/60 bg-card/90 dark:bg-card/75">
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b border-border/60 px-5 py-5 sm:px-6">
                <div><CardTitle className="text-lg">Personas</CardTitle><CardDescription className="mt-1">Actividad y resultados del período.</CardDescription></div>
                <Button asChild variant="ghost" size="sm" className="rounded-xl"><Link href="/dashboard/admin/users">Ver todas<ChevronRight aria-hidden="true" /></Link></Button>
              </CardHeader>
              {users.length > 0 ? (
                <>
                  <div className="divide-y divide-border/60 md:hidden">
                    {users.slice(0, 6).map((user) => (
                      <Link key={user.id} href={`/dashboard/admin/users/${user.id}`} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/35">
                        <Avatar className="h-10 w-10 border border-border/60"><AvatarImage src={user.avatarUrl || undefined} alt="" /><AvatarFallback>{initials(user.name)}</AvatarFallback></Avatar>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{user.name}</span><span className="block truncate text-xs text-muted-foreground">{primaryTeam(user)?.name || 'Sin equipo'}</span></span>
                        <span className="text-right"><span className="block text-sm font-semibold tabular-nums">{formatNumber(user.metrics.contacted)}</span><span className="block text-[11px] text-muted-foreground">contactados</span></span>
                      </Link>
                    ))}
                  </div>
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader><TableRow><TableHead className="pl-6">Persona</TableHead><TableHead>Equipo</TableHead><TableHead>Contactados</TableHead><TableHead>Respuesta</TableHead></TableRow></TableHeader>
                      <TableBody>{users.slice(0, 6).map((user) => <TableRow key={user.id}><TableCell className="pl-6"><Link href={`/dashboard/admin/users/${user.id}`} className="flex min-w-0 items-center gap-3 rounded-lg font-medium hover:underline"><Avatar className="h-8 w-8 border border-border/60"><AvatarImage src={user.avatarUrl || undefined} alt="" /><AvatarFallback className="text-[10px]">{initials(user.name)}</AvatarFallback></Avatar><span className="min-w-0"><span className="block max-w-[180px] truncate">{user.name}</span><span className="block max-w-[180px] truncate text-xs font-normal text-muted-foreground">{user.email}</span></span></Link></TableCell><TableCell className="text-muted-foreground">{primaryTeam(user)?.name || 'Sin equipo'}</TableCell><TableCell className="tabular-nums">{formatNumber(user.metrics.contacted)}</TableCell><TableCell className="tabular-nums">{formatPercent(user.metrics.responseRate)}</TableCell></TableRow>)}</TableBody>
                    </Table>
                  </div>
                </>
              ) : <div className="px-6 py-12 text-center"><p className="text-sm font-medium">No hay personas para este alcance</p><p className="mt-1 text-sm text-muted-foreground">Cambia los filtros para volver a ver el equipo.</p></div>}
            </Card>

            <Card className="overflow-hidden rounded-[24px] border-border/60 bg-card/90 dark:bg-card/75">
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b border-border/60 px-5 py-5 sm:px-6">
                <div><CardTitle className="text-lg">Equipos</CardTitle><CardDescription className="mt-1">Resultados atribuidos al equipo principal.</CardDescription></div>
                <Button asChild variant="ghost" size="sm" className="rounded-xl"><Link href="/dashboard/admin/teams">Gestionar<ChevronRight aria-hidden="true" /></Link></Button>
              </CardHeader>
              {teams.length > 0 ? (
                <div role="list">
                  {teams.slice(0, 6).map((team) => (
                    <Link key={team.id} href={`/dashboard/admin/teams?teamId=${team.id}`} role="listitem" className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border/60 px-5 py-3.5 transition-colors last:border-b-0 hover:bg-muted/35 sm:grid-cols-[minmax(0,1fr)_80px_80px] sm:px-6">
                      <span className="min-w-0"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: team.color || 'hsl(var(--primary))' }} aria-hidden="true" /><span className="truncate text-sm font-medium">{team.name}</span></span><span className="mt-1 block text-xs text-muted-foreground">{team.memberCount} {team.memberCount === 1 ? 'miembro' : 'miembros'}</span></span>
                      <span className="text-right"><span className="block text-sm font-semibold tabular-nums">{formatNumber(team.metrics.contacted)}</span><span className="block text-[11px] text-muted-foreground">contactados</span></span>
                      <span className="hidden text-right sm:block"><span className="block text-sm font-semibold tabular-nums">{formatPercent(team.metrics.responseRate)}</span><span className="block text-[11px] text-muted-foreground">respuesta</span></span>
                    </Link>
                  ))}
                </div>
              ) : <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center"><UsersRound className="h-6 w-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">Aún no hay equipos</p><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Crea el primero para organizar personas y comparar resultados.</p><Button asChild variant="outline" size="sm" className="mt-4 rounded-xl"><Link href="/dashboard/admin/teams">Crear equipo</Link></Button></div>}
            </Card>
          </section>

          <footer className="flex flex-col gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Actualizado a las {formatUpdatedAt(overview.generatedAt)}</span>
            <span>Los resultados respetan el período y alcance seleccionados.</span>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1320px] pb-10"><OverviewLoading /></div>}>
      <AdminOverview />
    </Suspense>
  );
}
