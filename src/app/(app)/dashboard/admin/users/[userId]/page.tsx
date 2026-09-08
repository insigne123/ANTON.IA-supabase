'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  Mail,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  AdminUserProfile,
  AdminUserTimelineItem,
  AdminUserTimelineSource,
} from '@/lib/admin-user-profile-types';
import { cn } from '@/lib/utils';

const SOURCE_LABELS: Record<AdminUserTimelineSource, string> = {
  antonia_event_ledger: 'Antonia',
  activity_logs: 'Actividad',
  leads: 'Leads',
  contacted_leads: 'Contactos',
  lead_research_jobs: 'Investigación',
};

const ROLE_LABELS = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Miembro',
};

const MODE_LABELS = {
  user: 'Individual',
  team: 'Equipo',
  hybrid: 'Híbrido',
};

const CATEGORY_ICONS: Record<AdminUserTimelineItem['category'], LucideIcon> = {
  lead: UserPlus,
  outreach: Send,
  reply: MessageCircle,
  research: Search,
  account: UsersRound,
  system: Activity,
};

function formatNumber(value: number) {
  return value.toLocaleString('es-CL');
}

function formatDateTime(value: string | null, fallback = 'Sin registro') {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace('.', '');
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || 'U').toUpperCase();
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (['completed', 'sent', 'delivered', 'replied', 'success', 'positive'].some((value) => normalized.includes(value))) {
    return 'border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200';
  }
  if (['failed', 'bounced', 'error', 'negative', 'denied'].some((value) => normalized.includes(value))) {
    return 'border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200';
  }
  if (['queued', 'running', 'pending', 'partial'].some((value) => normalized.includes(value))) {
    return 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
  }
  return 'border-border bg-muted/30 text-muted-foreground';
}

function statusLabel(status: string) {
  const normalized = status.toLowerCase();
  const labels: Record<string, string> = {
    bounced: 'Rebotado',
    cancelled: 'Cancelado',
    completed: 'Completado',
    delivered: 'Entregado',
    failed: 'Fallido',
    insufficient_data: 'Datos insuficientes',
    partial: 'Parcial',
    positive: 'Positivo',
    queued: 'En espera',
    replied: 'Respondido',
    running: 'En curso',
    sent: 'Enviado',
    success: 'Completado',
  };
  return labels[normalized] || status.replace(/[._-]+/g, ' ');
}

function ProfileLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Cargando perfil del usuario">
      <Skeleton className="h-52 rounded-[28px]" />
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.65fr)]">
        <Skeleton className="h-[560px] rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/15">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-semibold tracking-tight tabular-nums">{formatNumber(value)}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function Timeline({ items }: { items: AdminUserTimelineItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center px-6 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Clock3 className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-sm font-semibold">Sin actividad en este período</h3>
        <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
          Cuando esta persona capture leads, contacte prospectos o inicie investigaciones, aparecerán aquí.
        </p>
      </div>
    );
  }

  return (
    <div tabIndex={0} role="region" aria-label="Actividad de la persona" className="lg:max-h-[760px] lg:overflow-y-auto">
      <ol className="px-5 pb-6 pt-2 sm:px-6" aria-label="Actividad cronológica, más reciente primero">
        {items.map((item, index) => {
          const Icon = CATEGORY_ICONS[item.category];
          return (
            <li key={item.id} className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-3 pb-6 last:pb-1">
              {index < items.length - 1 ? <span className="absolute bottom-0 left-[17px] top-9 w-px bg-border/80" aria-hidden="true" /> : null}
              <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground shadow-sm">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 pt-0.5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-5">{item.title}</p>
                    {item.detail ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{item.detail}</p> : null}
                  </div>
                  <time dateTime={item.occurredAt} className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(item.occurredAt)}
                  </time>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">{SOURCE_LABELS[item.source]}</span>
                  {item.status ? (
                    <Badge variant="outline" className={cn('px-2 py-0 text-[10px] font-medium', statusClass(item.status))}>
                      {statusLabel(item.status)}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function AdminUserProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = String(params?.userId || '');
  const [profile, setProfile] = useState<AdminUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!userId) {
      setError('El usuario seleccionado no es válido.');
      setLoading(false);
      return;
    }
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/dashboard/admin/users/${encodeURIComponent(userId)}`, {
        cache: 'no-store',
        signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No pudimos cargar el perfil del usuario.');
      if (!signal?.aborted) setProfile(payload as AdminUserProfile);
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar el perfil del usuario.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(false, controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  const creditPercent = useMemo(() => {
    if (!profile) return 0;
    if (profile.credit.limit <= 0) return 100;
    return Math.min(100, Math.round((profile.credit.used / profile.credit.limit) * 100));
  }, [profile]);

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-[1240px] pb-10 pt-1">
        <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground hover:text-foreground">
          <Link href="/dashboard/admin/users">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Volver a Personas
          </Link>
        </Button>

        {loading && !profile ? <ProfileLoading /> : null}

        {error && !profile ? (
          <Alert variant="destructive" className="rounded-2xl">
            <CircleAlert className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>No se pudo abrir este perfil</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void loadProfile()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
                Intentar de nuevo
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {profile ? (
          <div className="space-y-5">
            <header className="relative overflow-hidden rounded-[28px] border border-border/60 bg-card/90 p-5 shadow-[0_24px_55px_-45px_rgba(15,23,42,0.55)] sm:p-7">
              <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-primary/[0.06] blur-3xl dark:bg-primary/[0.09]" aria-hidden="true" />
              <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
                <Avatar className="h-16 w-16 border border-border/60 shadow-sm sm:h-20 sm:w-20">
                  <AvatarImage src={profile.user.avatarUrl || undefined} alt="" />
                  <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">{initials(profile.user.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="min-w-0 break-words text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{profile.user.name}</h1>
                    <Badge variant="secondary" className="font-medium">{ROLE_LABELS[profile.user.role]}</Badge>
                  </div>
                  <p className="mt-1 break-all text-sm text-muted-foreground">{profile.user.email}</p>
                  <div className="mt-4 flex flex-wrap gap-2" aria-label="Grupos activos">
                    {profile.groups.length > 0 ? profile.groups.map((group) => (
                      <Badge key={group.id} variant="outline" className={cn('font-medium', group.primary && 'border-primary/30 bg-primary/5 text-primary')}>
                        {group.name}{group.primary ? ' · Principal' : ''}
                      </Badge>
                    )) : <span className="text-xs text-muted-foreground">Sin grupos activos</span>}
                  </div>
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground sm:min-w-[210px]">
                  <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" aria-hidden="true" />Miembro desde {formatDate(profile.user.memberSince)}</span>
                  <span className="flex items-center gap-2"><Clock3 className="h-4 w-4" aria-hidden="true" />Último acceso: {formatDateTime(profile.user.lastSignInAt)}</span>
                  <span className="flex items-center gap-2">
                    {profile.user.emailConfirmed ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" aria-hidden="true" /> : <CircleAlert className="h-4 w-4 text-amber-600 dark:text-amber-300" aria-hidden="true" />}
                    {profile.user.emailConfirmed ? 'Correo verificado' : 'Correo pendiente de verificar'}
                  </span>
                </div>
              </div>
            </header>

            {error ? (
              <Alert variant="destructive" className="rounded-2xl">
                <CircleAlert className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>No se pudo actualizar</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Card className="overflow-hidden rounded-2xl border-border/60 bg-card/90 shadow-[0_16px_34px_-30px_rgba(15,23,42,0.45)]">
              <CardContent className="grid p-0 sm:grid-cols-2 lg:grid-cols-5 sm:[&>*:nth-child(even)]:border-l lg:[&>*]:border-l lg:[&>*:first-child]:border-l-0 [&>*]:border-border/60">
                <Metric label="Leads creados" value={profile.metrics.leadsCreated} icon={UserPlus} />
                <Metric label="Contactos enviados" value={profile.metrics.contactsSent} icon={Send} />
                <Metric label="Respuestas recibidas" value={profile.metrics.repliesReceived} icon={Mail} />
                <Metric label="Investigaciones" value={profile.metrics.researchJobs} icon={Search} />
                <Metric label="Días con actividad" value={profile.metrics.activeDays} icon={CalendarDays} />
              </CardContent>
            </Card>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.65fr)]">
              <Card className="overflow-hidden rounded-2xl border-border/60 bg-card/90">
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b border-border/60 px-5 py-5 sm:px-6">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">Actividad de los últimos 90 días</h2>
                    <CardDescription className="mt-1">Más reciente primero · desde {formatDate(profile.period.from)}</CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadProfile(true)} disabled={loading || refreshing} aria-label="Actualizar historial">
                    <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
                    <span className="hidden sm:inline">Actualizar</span>
                  </Button>
                </CardHeader>
                {profile.coverage.unavailableSources.length > 0 || profile.coverage.timelineLimited ? (
                  <div role="status" className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 sm:mx-6">
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <p>
                      {profile.coverage.unavailableSources.length > 0
                        ? `Hay fuentes temporalmente no disponibles: ${profile.coverage.unavailableSources.map((source) => SOURCE_LABELS[source]).join(', ')}.`
                        : 'Se muestran los eventos más recientes del período.'}
                    </p>
                  </div>
                ) : null}
                <Timeline items={profile.timeline} />
              </Card>

              <Card className="rounded-2xl border-border/60 bg-card/90 lg:sticky lg:top-5">
                <CardHeader className="px-5 pb-3 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <CreditCard className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <Badge variant={profile.credit.allowed ? 'secondary' : 'destructive'}>
                      {profile.credit.allowed ? 'Disponible' : 'Límite alcanzado'}
                    </Badge>
                  </div>
                  <h2 className="pt-3 text-base font-semibold tracking-tight">Créditos de hoy</h2>
                  <CardDescription>{MODE_LABELS[profile.credit.mode]} · controla {profile.credit.binding === 'team' ? 'el equipo' : 'el usuario'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 px-5 pb-5">
                  <div>
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-3xl font-semibold tracking-tight tabular-nums">{formatNumber(profile.credit.remaining)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">créditos disponibles</p>
                      </div>
                      <p className="pb-0.5 text-xs text-muted-foreground tabular-nums">{formatNumber(profile.credit.used)} de {formatNumber(profile.credit.limit)}</p>
                    </div>
                    <Progress value={creditPercent} className="mt-4 h-2" aria-label={`${profile.credit.used} de ${profile.credit.limit} créditos usados`} />
                  </div>

                  <div className="space-y-2 rounded-xl bg-muted/30 p-3.5 text-sm">
                    {profile.credit.user ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Uso individual</span>
                        <span className="font-medium tabular-nums">{formatNumber(profile.credit.user.used)} / {formatNumber(profile.credit.user.limit)}</span>
                      </div>
                    ) : null}
                    {profile.credit.team ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-muted-foreground">{profile.credit.groupName || 'Uso del equipo'}</span>
                        <span className="shrink-0 font-medium tabular-nums">{formatNumber(profile.credit.team.used)} / {formatNumber(profile.credit.team.limit)}</span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                      <span className="text-muted-foreground">Reinicio</span>
                      <span className="font-medium">{formatDateTime(profile.credit.resetAt)}</span>
                    </div>
                  </div>

                  {profile.credit.legacy ? <p className="text-xs leading-5 text-muted-foreground">Esta cuenta conserva la política de créditos anterior.</p> : null}
                </CardContent>
              </Card>
            </div>

            <footer className="flex flex-col gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>Actualizado {formatDateTime(profile.generatedAt)}</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Datos limitados a {profile.organization.name}</span>
            </footer>
          </div>
        ) : null}
      </div>
    </div>
  );
}
