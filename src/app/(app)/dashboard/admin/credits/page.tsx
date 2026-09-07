'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Coins,
  LoaderCircle,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { AdminCreditMode, AdminCreditOverview } from '@/lib/admin-dashboard-types';
import { cn } from '@/lib/utils';

type CreditTeam = AdminCreditOverview['teams'][number];
type CreditUser = AdminCreditOverview['users'][number];

type OrganizationDraft = {
  mode: AdminCreditMode;
  userLimit: string;
  teamLimit: string;
};

const MAX_LIMIT = 1_000_000;
const LIMIT_INPUT_CLASS = 'rounded-xl [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const EDITOR_DIALOG_CLASS = 'flex max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md flex-col gap-0 overflow-hidden rounded-[24px] border-border/70 p-0 shadow-2xl [overflow-wrap:anywhere] sm:max-w-md [&>button]:right-3 [&>button]:top-3 [&>button]:flex [&>button]:h-10 [&>button]:w-10 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full';

const MODE_DETAILS: Record<AdminCreditMode, { label: string; description: string }> = {
  user: {
    label: 'Por usuario',
    description: 'Cada persona consume únicamente su cupo individual.',
  },
  team: {
    label: 'Por equipo',
    description: 'Cada persona consume el cupo compartido de su equipo principal.',
  },
  hybrid: {
    label: 'Híbrido',
    description: 'Se validan ambos cupos y se detiene el uso al alcanzar el primero.',
  },
};

const ROLE_LABELS: Record<CreditUser['role'], string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Miembro',
};

function formatNumber(value: number) {
  return value.toLocaleString('es-CL');
}

function formatUtcReset(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'próximo reinicio, 00:00 UTC';
  return `${date.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).replace('.', '')} UTC`;
}

function formatUtcDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).replace('.', '');
}

function validateLimit(value: string) {
  if (!value.trim()) return 'Ingresa un límite diario.';
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue)) return 'Usa un número entero.';
  if (numberValue < 0 || numberValue > MAX_LIMIT) {
    return `El límite debe estar entre 0 y ${formatNumber(MAX_LIMIT)}.`;
  }
  return null;
}

function organizationPolicySummary(
  policy: AdminCreditOverview['defaultPolicy']['current'],
) {
  const mode = policy.mode || 'user';
  const userLimit = formatNumber(policy.userDailyLimit ?? 0);
  const teamLimit = formatNumber(policy.teamDailyLimit ?? 0);
  if (mode === 'user') return `${MODE_DETAILS[mode].label} · ${userLimit} por persona`;
  if (mode === 'team') return `${MODE_DETAILS[mode].label} · ${teamLimit} por equipo`;
  return `${MODE_DETAILS[mode].label} · ${userLimit} por persona y ${teamLimit} por equipo`;
}

function userPolicySummary(policy: CreditUser['pendingPolicy']) {
  if (!policy) return null;
  const mode = policy.mode || 'user';
  if (mode === 'team') return MODE_DETAILS[mode].label;
  return `${MODE_DETAILS[mode].label} · ${formatNumber(policy.userDailyLimit ?? 0)} por persona`;
}

function policyToOrganizationDraft(
  policy: AdminCreditOverview['defaultPolicy']['current'],
): OrganizationDraft {
  return {
    mode: policy.mode || 'user',
    userLimit: String(policy.userDailyLimit ?? 0),
    teamLimit: String(policy.teamDailyLimit ?? 0),
  };
}

function UsageMeter({
  label,
  usage,
  limit,
  className,
}: {
  label: string;
  usage: number;
  limit: number;
  className?: string;
}) {
  const percentage = limit > 0
    ? Math.min(100, Math.max(0, (usage / limit) * 100))
    : usage > 0
      ? 100
      : 0;

  return (
    <div className={cn('min-w-0', className)} aria-label={`${label}: ${usage} de ${limit} créditos usados`}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="shrink-0 font-medium tabular-nums">
          {formatNumber(usage)} de {formatNumber(limit)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn(
            'h-full rounded-full bg-primary/70 transition-[width] duration-300 motion-reduce:transition-none',
            usage >= limit && limit > 0 && 'bg-amber-500 dark:bg-amber-400',
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mt-5 space-y-5" aria-busy="true" aria-label="Cargando configuración de créditos">
      <Skeleton className="h-16 rounded-2xl" />
      <Skeleton className="h-[340px] rounded-2xl" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

export default function AdminCreditsPage() {
  const [overview, setOverview] = useState<AdminCreditOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);

  const [organizationDraft, setOrganizationDraft] = useState<OrganizationDraft>({
    mode: 'user',
    userLimit: '0',
    teamLimit: '0',
  });
  const [organizationErrors, setOrganizationErrors] = useState<{
    userLimit?: string;
    teamLimit?: string;
  }>({});

  const [editingTeam, setEditingTeam] = useState<CreditTeam | null>(null);
  const [teamLimitDraft, setTeamLimitDraft] = useState('');
  const [teamFieldError, setTeamFieldError] = useState<string | null>(null);
  const [teamMutationError, setTeamMutationError] = useState<string | null>(null);

  const [editingUser, setEditingUser] = useState<CreditUser | null>(null);
  const [userModeDraft, setUserModeDraft] = useState<AdminCreditMode>('user');
  const [userLimitDraft, setUserLimitDraft] = useState('');
  const [userFieldError, setUserFieldError] = useState<string | null>(null);
  const [userMutationError, setUserMutationError] = useState<string | null>(null);

  const loadCredits = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch('/api/dashboard/admin/credits', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => null) as (AdminCreditOverview & { error?: string }) | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'No pudimos cargar la configuración de créditos.');
      }
      if (!payload?.organization || !payload.defaultPolicy || !Array.isArray(payload.teams) || !Array.isArray(payload.users)) {
        throw new Error('La configuración recibida está incompleta. Intenta actualizarla.');
      }

      setOverview(payload);
      const editablePolicy = payload.defaultPolicy.pending || payload.defaultPolicy.current;
      setOrganizationDraft(policyToOrganizationDraft(editablePolicy));
      setOrganizationErrors({});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No pudimos cargar la configuración de créditos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadCredits();
  }, [loadCredits]);

  async function requestCredits(
    method: 'PUT' | 'DELETE',
    body: Record<string, unknown>,
    fallbackError: string,
  ) {
    const response = await fetch('/api/dashboard/admin/credits', {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || fallbackError);
  }

  const organizationBaseline = useMemo(() => {
    if (!overview) return null;
    return policyToOrganizationDraft(overview.defaultPolicy.pending || overview.defaultPolicy.current);
  }, [overview]);

  const organizationDirty = Boolean(organizationBaseline && (
    organizationDraft.mode !== organizationBaseline.mode
    || organizationDraft.userLimit !== organizationBaseline.userLimit
    || organizationDraft.teamLimit !== organizationBaseline.teamLimit
  ));
  const isMutating = mutationKey !== null;

  async function saveOrganizationPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userLimitError = validateLimit(organizationDraft.userLimit);
    const teamLimitError = validateLimit(organizationDraft.teamLimit);
    setOrganizationErrors({
      userLimit: userLimitError || undefined,
      teamLimit: teamLimitError || undefined,
    });
    if (userLimitError || teamLimitError || !overview) return;

    setMutationKey('organization');
    setActionSuccess(null);
    setActionError(null);
    try {
      await requestCredits('PUT', {
        subjectType: 'organization',
        mode: organizationDraft.mode,
        userDailyLimit: Number(organizationDraft.userLimit),
        teamDailyLimit: Number(organizationDraft.teamLimit),
        reason: 'Actualización desde la configuración administrativa',
      }, 'No pudimos guardar la política de la organización.');
      await loadCredits({ silent: true });
      setActionSuccess('La política de la organización quedó programada para el próximo reinicio UTC.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No pudimos guardar la política de la organización.');
    } finally {
      setMutationKey(null);
    }
  }

  function openTeamEditor(team: CreditTeam) {
    setEditingTeam(team);
    setTeamLimitDraft(String(team.pendingPolicy?.teamDailyLimit ?? team.currentLimit));
    setTeamFieldError(null);
    setTeamMutationError(null);
    setActionSuccess(null);
    setActionError(null);
  }

  async function saveTeamLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const team = editingTeam;
    if (!team) return;
    const validationError = validateLimit(teamLimitDraft);
    setTeamFieldError(validationError);
    if (validationError) return;

    setMutationKey(`team:${team.id}`);
    setTeamMutationError(null);
    setActionSuccess(null);
    try {
      await requestCredits('PUT', {
        subjectType: 'team',
        subjectId: team.id,
        teamDailyLimit: Number(teamLimitDraft),
        reason: 'Límite de equipo actualizado desde la configuración administrativa',
      }, `No pudimos guardar el límite de ${team.name}.`);
      await loadCredits({ silent: true });
      setEditingTeam(null);
      setActionSuccess(`El nuevo límite de ${team.name} quedó programado para el próximo reinicio UTC.`);
    } catch (error) {
      setTeamMutationError(error instanceof Error ? error.message : `No pudimos guardar el límite de ${team.name}.`);
    } finally {
      setMutationKey(null);
    }
  }

  async function restoreTeamPolicy() {
    const team = editingTeam;
    if (!team) return;
    setMutationKey(`team-restore:${team.id}`);
    setTeamMutationError(null);
    setActionSuccess(null);
    try {
      await requestCredits('DELETE', {
        subjectType: 'team',
        subjectId: team.id,
      }, `No pudimos restaurar la política de ${team.name}.`);
      await loadCredits({ silent: true });
      setEditingTeam(null);
      setActionSuccess(`${team.name} usará el límite de la organización en el próximo reinicio UTC.`);
    } catch (error) {
      setTeamMutationError(error instanceof Error ? error.message : `No pudimos restaurar la política de ${team.name}.`);
    } finally {
      setMutationKey(null);
    }
  }

  function openUserEditor(user: CreditUser) {
    setEditingUser(user);
    setUserModeDraft(user.pendingPolicy?.mode || user.mode);
    setUserLimitDraft(String(user.pendingPolicy?.userDailyLimit ?? user.userLimit));
    setUserFieldError(null);
    setUserMutationError(null);
    setActionSuccess(null);
    setActionError(null);
  }

  async function saveUserPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const user = editingUser;
    if (!user) return;
    const validationError = validateLimit(userLimitDraft);
    setUserFieldError(validationError);
    if (validationError) return;

    setMutationKey(`user:${user.id}`);
    setUserMutationError(null);
    setActionSuccess(null);
    try {
      await requestCredits('PUT', {
        subjectType: 'user',
        subjectId: user.id,
        mode: userModeDraft,
        userDailyLimit: Number(userLimitDraft),
        reason: 'Política de usuario actualizada desde la configuración administrativa',
      }, `No pudimos guardar la política de ${user.name}.`);
      await loadCredits({ silent: true });
      setEditingUser(null);
      setActionSuccess(`La política de ${user.name} quedó programada para el próximo reinicio UTC.`);
    } catch (error) {
      setUserMutationError(error instanceof Error ? error.message : `No pudimos guardar la política de ${user.name}.`);
    } finally {
      setMutationKey(null);
    }
  }

  async function restoreUserPolicy() {
    const user = editingUser;
    if (!user) return;
    setMutationKey(`user-restore:${user.id}`);
    setUserMutationError(null);
    setActionSuccess(null);
    try {
      await requestCredits('DELETE', {
        subjectType: 'user',
        subjectId: user.id,
      }, `No pudimos restaurar la política de ${user.name}.`);
      await loadCredits({ silent: true });
      setEditingUser(null);
      setActionSuccess(`${user.name} heredará la política de la organización desde el próximo reinicio UTC.`);
    } catch (error) {
      setUserMutationError(error instanceof Error ? error.message : `No pudimos restaurar la política de ${user.name}.`);
    } finally {
      setMutationKey(null);
    }
  }

  const editingTeamBaseline = editingTeam
    ? String(editingTeam.pendingPolicy?.teamDailyLimit ?? editingTeam.currentLimit)
    : '';
  const teamDraftDirty = Boolean(editingTeam && teamLimitDraft !== editingTeamBaseline);
  const editingUserMode = editingUser?.pendingPolicy?.mode || editingUser?.mode;
  const editingUserLimit = editingUser
    ? String(editingUser.pendingPolicy?.userDailyLimit ?? editingUser.userLimit)
    : '';
  const userDraftDirty = Boolean(editingUser && (
    userModeDraft !== editingUserMode || userLimitDraft !== editingUserLimit
  ));

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-[1320px] pb-10">
        <header className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 rounded-lg text-muted-foreground">
              <Link href="/dashboard/admin">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Panel administrativo
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Créditos diarios</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
              Define cómo se distribuye el uso diario entre la organización, los equipos y cada persona.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void loadCredits({ silent: true })}
            disabled={loading || refreshing || isMutating}
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            {refreshing ? 'Actualizando' : 'Actualizar'}
          </Button>
        </header>

        {loading && !overview ? <LoadingState /> : null}

        {!loading && !overview && loadError ? (
          <Card className="mt-5 rounded-2xl border-destructive/25 bg-card/90">
            <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3" role="alert">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                <div>
                  <p className="font-medium">No se pudo cargar la configuración</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{loadError}</p>
                </div>
              </div>
              <Button type="button" onClick={() => void loadCredits()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Reintentar
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {overview ? (
          <div className="mt-4 space-y-4" aria-busy={refreshing || isMutating}>
            <section
              aria-label="Próxima aplicación de cambios"
              className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3.5 sm:px-5"
            >
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-sm leading-6">
                <span className="font-medium">Los cambios no alteran el consumo de hoy.</span>{' '}
                Se aplican en el próximo reinicio diario, el {formatUtcReset(overview.nextResetAt)}.
              </p>
            </section>

            {loadError ? (
              <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <div>
                  <p className="font-medium">No se pudo actualizar la información</p>
                  <p className="mt-1 text-muted-foreground">{loadError}</p>
                </div>
              </div>
            ) : null}

            {actionSuccess ? (
              <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-2xl border border-emerald-300/60 bg-emerald-50/70 p-4 text-sm text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                <p>{actionSuccess}</p>
              </div>
            ) : null}

            {actionError ? (
              <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <p>{actionError}</p>
              </div>
            ) : null}

            <section aria-labelledby="organization-policy-title">
              <Card className="rounded-2xl border-border/60 bg-card/90 shadow-[0_16px_34px_-30px_rgba(15,23,42,0.45)]">
                <CardHeader className="flex flex-col gap-3 space-y-0 px-5 pb-4 pt-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle id="organization-policy-title" className="text-base">Política de la organización</CardTitle>
                    <CardDescription className="mt-1 leading-5">
                      Esta configuración se hereda cuando un equipo o usuario no tiene una política propia.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit rounded-full font-normal">
                    {overview.organization.name}
                  </Badge>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Modo actual</p>
                      <p className="mt-1 text-sm font-medium">{MODE_DETAILS[overview.defaultPolicy.current.mode || 'user'].label}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Límite por usuario</p>
                      <p className="mt-1 text-sm font-medium tabular-nums">
                        {formatNumber(overview.defaultPolicy.current.userDailyLimit ?? 0)} créditos
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Límite por equipo</p>
                      <p className="mt-1 text-sm font-medium tabular-nums">
                        {formatNumber(overview.defaultPolicy.current.teamDailyLimit ?? 0)} créditos
                      </p>
                    </div>
                  </div>

                  {overview.defaultPolicy.pending ? (
                    <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-300/50 bg-amber-50/70 p-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                      <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
                      <p>
                        <span className="font-medium">Cambio programado:</span>{' '}
                        {organizationPolicySummary(overview.defaultPolicy.pending)}.
                      </p>
                    </div>
                  ) : null}

                  <form onSubmit={saveOrganizationPolicy} className="mt-5 border-t border-border/60 pt-5" noValidate>
                    <div className="grid gap-4 xl:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="organization-credit-mode">Modo de consumo</Label>
                        <Select
                          value={organizationDraft.mode}
                          onValueChange={(value) => {
                            setOrganizationDraft((current) => ({ ...current, mode: value as AdminCreditMode }));
                            setActionSuccess(null);
                            setActionError(null);
                          }}
                          disabled={isMutating}
                        >
                          <SelectTrigger id="organization-credit-mode" aria-describedby="organization-mode-help" className="rounded-xl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(MODE_DETAILS) as AdminCreditMode[]).map((mode) => (
                              <SelectItem key={mode} value={mode}>{MODE_DETAILS[mode].label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p id="organization-mode-help" className="text-xs leading-5 text-muted-foreground">
                          {MODE_DETAILS[organizationDraft.mode].description}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="organization-user-limit">Límite diario por usuario</Label>
                        <Input
                          id="organization-user-limit"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_LIMIT}
                          step={1}
                          value={organizationDraft.userLimit}
                          onChange={(event) => {
                            setOrganizationDraft((current) => ({ ...current, userLimit: event.target.value }));
                            setOrganizationErrors((current) => ({ ...current, userLimit: undefined }));
                            setActionSuccess(null);
                          }}
                          disabled={isMutating}
                          aria-invalid={Boolean(organizationErrors.userLimit)}
                          aria-describedby={organizationErrors.userLimit ? 'organization-user-limit-error' : 'organization-user-limit-help'}
                          className={LIMIT_INPUT_CLASS}
                        />
                        {organizationErrors.userLimit ? (
                          <p id="organization-user-limit-error" role="alert" className="text-xs text-destructive">{organizationErrors.userLimit}</p>
                        ) : (
                          <p id="organization-user-limit-help" className="text-xs leading-5 text-muted-foreground">
                            Se usa en los modos por usuario e híbrido.
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="organization-team-limit">Límite diario por equipo</Label>
                        <Input
                          id="organization-team-limit"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_LIMIT}
                          step={1}
                          value={organizationDraft.teamLimit}
                          onChange={(event) => {
                            setOrganizationDraft((current) => ({ ...current, teamLimit: event.target.value }));
                            setOrganizationErrors((current) => ({ ...current, teamLimit: undefined }));
                            setActionSuccess(null);
                          }}
                          disabled={isMutating}
                          aria-invalid={Boolean(organizationErrors.teamLimit)}
                          aria-describedby={organizationErrors.teamLimit ? 'organization-team-limit-error' : 'organization-team-limit-help'}
                          className={LIMIT_INPUT_CLASS}
                        />
                        {organizationErrors.teamLimit ? (
                          <p id="organization-team-limit-error" role="alert" className="text-xs text-destructive">{organizationErrors.teamLimit}</p>
                        ) : (
                          <p id="organization-team-limit-help" className="text-xs leading-5 text-muted-foreground">
                            Se usa en los modos por equipo e híbrido.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 flex justify-end">
                      <Button
                        type="submit"
                        className="w-full sm:w-auto"
                        disabled={!organizationDirty || isMutating}
                      >
                        {mutationKey === 'organization' ? (
                          <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        ) : (
                          <Save className="h-4 w-4" aria-hidden="true" />
                        )}
                        {mutationKey === 'organization' ? 'Guardando' : 'Guardar para el próximo reinicio'}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="team-limits-title">
              <Card className="rounded-2xl border-border/60 bg-card/90">
                <CardHeader className="px-5 pb-3 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle id="team-limits-title" className="text-base">Límites por equipo</CardTitle>
                      <CardDescription className="mt-1 leading-5">
                        Ajusta excepciones al límite compartido de la organización.
                      </CardDescription>
                    </div>
                    <UsersRound className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                </CardHeader>
                <CardContent className="px-0 pb-1">
                  {overview.teams.length === 0 ? (
                    <div className="mx-5 mb-4 flex flex-col items-center rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
                      <UsersRound className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                      <p className="mt-3 text-sm font-medium">Aún no hay equipos activos</p>
                      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                        Cuando se cree un equipo, aparecerá aquí con la política heredada de la organización.
                      </p>
                    </div>
                  ) : (
                    <div role="list" aria-label="Límites diarios por equipo">
                      {overview.teams.map((team) => (
                        <div
                          key={team.id}
                          role="listitem"
                          className="grid gap-4 border-t border-border/60 px-5 py-4 first:border-t-0 lg:grid-cols-[minmax(180px,0.8fr)_minmax(240px,1fr)_auto] lg:items-center"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{team.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatNumber(team.memberCount)} {team.memberCount === 1 ? 'miembro' : 'miembros'}
                            </p>
                          </div>
                          <div className="min-w-0 space-y-2.5">
                            <UsageMeter label="Uso de hoy" usage={team.usage} limit={team.currentLimit} />
                            {team.pendingPolicy ? (
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="secondary" className="rounded-full font-normal">Programado</Badge>
                                <span>{formatNumber(team.pendingPolicy.teamDailyLimit ?? 0)} créditos por día</span>
                              </div>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full rounded-xl lg:w-auto"
                            onClick={() => openTeamEditor(team)}
                            disabled={isMutating}
                            aria-label={`Editar límite de ${team.name}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                            Editar
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="user-policies-title">
              <Card className="rounded-2xl border-border/60 bg-card/90">
                <CardHeader className="px-5 pb-3 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle id="user-policies-title" className="text-base">Políticas por usuario</CardTitle>
                      <CardDescription className="mt-1 leading-5">
                        Revisa el consumo activo y programa excepciones individuales.
                      </CardDescription>
                    </div>
                    <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                </CardHeader>
                <CardContent className="px-0 pb-1">
                  {overview.users.length === 0 ? (
                    <div className="mx-5 mb-4 flex flex-col items-center rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
                      <UserRound className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                      <p className="mt-3 text-sm font-medium">No hay usuarios para configurar</p>
                      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                        Los miembros de la organización aparecerán aquí cuando estén disponibles.
                      </p>
                    </div>
                  ) : (
                    <div role="list" aria-label="Políticas de crédito por usuario">
                      {overview.users.map((user) => (
                        <div
                          key={user.id}
                          role="listitem"
                          className="grid gap-4 border-t border-border/60 px-5 py-5 first:border-t-0 xl:grid-cols-[minmax(220px,1fr)_minmax(190px,0.75fr)_minmax(260px,1.1fr)_auto] xl:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
                                {user.name.slice(0, 1).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <Link href={`/dashboard/admin/users/${user.id}`} className="block truncate text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{user.name}</Link>
                                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline" className="rounded-full font-normal">{ROLE_LABELS[user.role]}</Badge>
                              <span className="inline-flex min-w-0 items-center gap-1.5">
                                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span className="truncate">{user.primaryTeam?.name || 'Sin equipo principal'}</span>
                              </span>
                              {user.pendingTeam ? (
                                <Badge variant="secondary" className="rounded-full font-normal">
                                  Próximo equipo: {user.pendingTeam.name}
                                </Badge>
                              ) : null}
                            </div>
                          </div>

                          <div className="min-w-0">
                            <Badge variant="secondary" className="rounded-full font-normal">
                              {MODE_DETAILS[user.mode].label}
                            </Badge>
                            <p className="mt-2 text-xs text-muted-foreground">
                              Cupo vinculante: <span className="font-medium text-foreground">{user.binding === 'user' ? 'Usuario' : 'Equipo'}</span>
                            </p>
                            {user.pendingPolicy ? (
                              <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                                Programado: {userPolicySummary(user.pendingPolicy)}
                              </p>
                            ) : null}
                          </div>

                          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                            {user.userUsage !== null ? (
                              <UsageMeter label="Usuario" usage={user.userUsage} limit={user.userLimit} />
                            ) : (
                              <p className="text-xs text-muted-foreground">Cupo personal no activo</p>
                            )}
                            {user.teamUsage !== null && user.teamLimit !== null ? (
                              <UsageMeter label="Equipo" usage={user.teamUsage} limit={user.teamLimit} />
                            ) : (
                              <p className="text-xs text-muted-foreground">Cupo de equipo no activo</p>
                            )}
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full rounded-xl xl:w-auto"
                            onClick={() => openUserEditor(user)}
                            disabled={isMutating}
                            aria-label={`Editar política de ${user.name}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                            Editar
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <footer className="flex flex-col gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span className="inline-flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                Consumo del {formatUtcDay(overview.quotaDay)} UTC
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Configuración restringida a administradores
              </span>
            </footer>
          </div>
        ) : null}
      </div>

      <Dialog
        open={Boolean(editingTeam)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingTeam(null);
            setTeamFieldError(null);
            setTeamMutationError(null);
          }
        }}
      >
        <DialogContent className={EDITOR_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 px-5 pb-4 pt-5 pr-14 text-left sm:px-6 sm:pt-6 sm:pr-14">
            <DialogTitle className="text-left leading-7">Límite de {editingTeam?.name}</DialogTitle>
            <DialogDescription className="text-left leading-6">
              Programa el cupo compartido que tendrá este equipo desde el próximo reinicio UTC.
            </DialogDescription>
          </DialogHeader>
          {editingTeam ? (
            <form onSubmit={saveTeamLimit} className="flex min-h-0 flex-1 flex-col overflow-hidden" noValidate>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 sm:px-6">
                <div className="rounded-2xl border border-border/50 bg-muted/25 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Uso actual</span>
                    <span className="font-medium tabular-nums">
                      {formatNumber(editingTeam.usage)} de {formatNumber(editingTeam.currentLimit)}
                    </span>
                  </div>
                  {editingTeam.pendingPolicy ? (
                    <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/50 pt-2">
                      <span className="text-muted-foreground">Límite programado</span>
                      <span className="font-medium tabular-nums">
                        {formatNumber(editingTeam.pendingPolicy.teamDailyLimit ?? 0)}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 space-y-1.5">
                  <Label htmlFor="team-daily-limit">Límite diario del equipo</Label>
                  <Input
                    id="team-daily-limit"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_LIMIT}
                    step={1}
                    value={teamLimitDraft}
                    onChange={(event) => {
                      setTeamLimitDraft(event.target.value);
                      setTeamFieldError(null);
                      setTeamMutationError(null);
                    }}
                    disabled={isMutating}
                    aria-invalid={Boolean(teamFieldError)}
                    aria-describedby={teamFieldError ? 'team-limit-error' : 'team-limit-help'}
                    className={LIMIT_INPUT_CLASS}
                  />
                  {teamFieldError ? (
                    <p id="team-limit-error" role="alert" className="text-xs leading-5 text-destructive">{teamFieldError}</p>
                  ) : (
                    <p id="team-limit-help" className="text-xs leading-5 text-muted-foreground">
                      Entre 0 y {formatNumber(MAX_LIMIT)} créditos diarios.
                    </p>
                  )}
                </div>

                {teamMutationError ? (
                  <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                    <p>{teamMutationError}</p>
                  </div>
                ) : null}

                <div className="mt-5 border-t border-border/60 pt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-10 w-full justify-start whitespace-normal rounded-xl px-2 py-2 text-left leading-5 text-muted-foreground hover:text-foreground"
                    onClick={() => void restoreTeamPolicy()}
                    disabled={isMutating}
                  >
                    {mutationKey === `team-restore:${editingTeam.id}` ? (
                      <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    )}
                    Usar política de la organización
                  </Button>
                  <p className="px-2 pt-1 text-xs leading-5 text-muted-foreground">
                    Quita la excepción del equipo desde el próximo reinicio.
                  </p>
                </div>
              </div>

              <DialogFooter className="shrink-0 gap-2 border-t border-border/60 bg-background/95 px-5 py-4 sm:flex-row sm:justify-end sm:space-x-0 sm:px-6">
                <DialogClose asChild>
                  <Button type="button" variant="ghost" className="w-full rounded-xl sm:w-auto" disabled={isMutating}>Cancelar</Button>
                </DialogClose>
                <Button type="submit" className="w-full rounded-xl sm:w-auto" disabled={!teamDraftDirty || isMutating}>
                  {mutationKey === `team:${editingTeam.id}` ? (
                    <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  {mutationKey === `team:${editingTeam.id}` ? 'Guardando' : 'Guardar límite'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingUser)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingUser(null);
            setUserFieldError(null);
            setUserMutationError(null);
          }
        }}
      >
        <DialogContent className={EDITOR_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 px-5 pb-4 pt-5 pr-14 text-left sm:px-6 sm:pt-6 sm:pr-14">
            <DialogTitle className="text-left leading-7">Política de {editingUser?.name}</DialogTitle>
            <DialogDescription className="text-left leading-6">
              Configura una excepción individual. El cambio se aplicará en el próximo reinicio UTC.
            </DialogDescription>
          </DialogHeader>
          {editingUser ? (
            <form onSubmit={saveUserPolicy} className="flex min-h-0 flex-1 flex-col overflow-hidden" noValidate>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 sm:px-6">
                <div className="rounded-2xl border border-border/50 bg-muted/25 p-4 text-sm">
                  <div className="flex items-start gap-2">
                    <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-medium">{editingUser.primaryTeam?.name || 'Sin equipo principal'}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {editingUser.pendingTeam
                          ? `Cambiará a ${editingUser.pendingTeam.name} en el próximo reinicio.`
                          : 'Equipo principal usado para los modos por equipo e híbrido.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-1.5">
                  <Label htmlFor="user-credit-mode">Modo de consumo</Label>
                  <Select
                    value={userModeDraft}
                    onValueChange={(value) => {
                      setUserModeDraft(value as AdminCreditMode);
                      setUserFieldError(null);
                      setUserMutationError(null);
                    }}
                    disabled={isMutating}
                  >
                    <SelectTrigger id="user-credit-mode" aria-describedby="user-mode-help" className="rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MODE_DETAILS) as AdminCreditMode[]).map((mode) => (
                        <SelectItem key={mode} value={mode}>{MODE_DETAILS[mode].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p id="user-mode-help" className="text-xs leading-5 text-muted-foreground">
                    {MODE_DETAILS[userModeDraft].description}
                  </p>
                </div>

                <div className="mt-4 space-y-1.5">
                  <Label htmlFor="user-daily-limit">Límite diario del usuario</Label>
                  <Input
                    id="user-daily-limit"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_LIMIT}
                    step={1}
                    value={userLimitDraft}
                    onChange={(event) => {
                      setUserLimitDraft(event.target.value);
                      setUserFieldError(null);
                      setUserMutationError(null);
                    }}
                    disabled={isMutating}
                    aria-invalid={Boolean(userFieldError)}
                    aria-describedby={userFieldError ? 'user-limit-error' : 'user-limit-help'}
                    className={LIMIT_INPUT_CLASS}
                  />
                  {userFieldError ? (
                    <p id="user-limit-error" role="alert" className="text-xs leading-5 text-destructive">{userFieldError}</p>
                  ) : (
                    <p id="user-limit-help" className="text-xs leading-5 text-muted-foreground">
                      {userModeDraft === 'team'
                        ? 'Se conserva para cuando esta persona vuelva a usar un cupo personal.'
                        : `Entre 0 y ${formatNumber(MAX_LIMIT)} créditos diarios.`}
                    </p>
                  )}
                </div>

                {userMutationError ? (
                  <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                    <p>{userMutationError}</p>
                  </div>
                ) : null}

                <div className="mt-5 border-t border-border/60 pt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-10 w-full justify-start whitespace-normal rounded-xl px-2 py-2 text-left leading-5 text-muted-foreground hover:text-foreground"
                    onClick={() => void restoreUserPolicy()}
                    disabled={isMutating}
                  >
                    {mutationKey === `user-restore:${editingUser.id}` ? (
                      <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    )}
                    Restaurar política heredada
                  </Button>
                  <p className="px-2 pt-1 text-xs leading-5 text-muted-foreground">
                    Vuelve a la política del equipo o de la organización.
                  </p>
                </div>
              </div>

              <DialogFooter className="shrink-0 gap-2 border-t border-border/60 bg-background/95 px-5 py-4 sm:flex-row sm:justify-end sm:space-x-0 sm:px-6">
                <DialogClose asChild>
                  <Button type="button" variant="ghost" className="w-full rounded-xl sm:w-auto" disabled={isMutating}>Cancelar</Button>
                </DialogClose>
                <Button type="submit" className="w-full rounded-xl sm:w-auto" disabled={!userDraftDirty || isMutating}>
                  {mutationKey === `user:${editingUser.id}` ? (
                    <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  {mutationKey === `user:${editingUser.id}` ? 'Guardando' : 'Guardar política'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
