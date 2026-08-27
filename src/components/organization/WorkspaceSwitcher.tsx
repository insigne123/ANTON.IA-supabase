'use client';

import { useEffect, useState } from 'react';
import { Building2, ChevronsUpDown, Loader2, RefreshCw } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import { organizationService } from '@/lib/services/organization-service';

type OrganizationRole = 'owner' | 'admin' | 'member';

type OrganizationSummary = {
  id: string;
  name: string;
  role: OrganizationRole;
  memberCount: number;
};

type OrganizationsResult = {
  activeOrganizationId: string | null;
  organizations: OrganizationSummary[];
};

const roleLabels: Record<OrganizationRole, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Miembro',
};
const WORKSPACE_FOCUS_KEY = 'antonia-workspace-focus';

function memberCountLabel(count: number) {
  return `${count} ${count === 1 ? 'miembro' : 'miembros'}`;
}

export function WorkspaceSwitcher() {
  const { organizationId, refreshOrganization } = useAuth();
  const [data, setData] = useState<OrganizationsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    void organizationService.listOrganizations()
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch(() => {
        if (cancelled) return;
        setError('No pudimos cargar tus workspaces.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId, reloadKey]);

  async function handleWorkspaceChange(nextOrganizationId: string) {
    if (!data || switchingId || nextOrganizationId === data.activeOrganizationId) return;

    setSwitchingId(nextOrganizationId);
    setError(null);

    try {
      const changed = await organizationService.setCurrentOrganization(nextOrganizationId);
      if (!changed) {
        setError('No pudimos cambiar de workspace. Inténtalo de nuevo.');
        return;
      }

      setData((current) => current ? { ...current, activeOrganizationId: nextOrganizationId } : current);
      const nextOrganization = data.organizations.find((organization) => organization.id === nextOrganizationId);
      window.sessionStorage.setItem(WORKSPACE_FOCUS_KEY, nextOrganization?.name || 'workspace seleccionado');
      await refreshOrganization();
    } catch {
      setError('El workspace cambió, pero no pudimos actualizar la sesión.');
    } finally {
      setSwitchingId(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="rounded-[18px] border border-sidebar-border/70 bg-sidebar-accent/25 px-3 py-2.5" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Cargando workspace.</span>
        <Skeleton className="h-3 w-16 bg-sidebar-accent" />
        <Skeleton className="mt-2 h-4 w-32 bg-sidebar-accent" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-[18px] border border-sidebar-border/70 bg-sidebar-accent/25 px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-sidebar-foreground/60" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/70">Workspace</div>
            <p className="mt-1 text-xs leading-5 text-sidebar-foreground/75" role="alert">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label="Reintentar carga de workspaces"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  const organizations = data?.organizations || [];
  const activeId = data?.activeOrganizationId || organizationId;
  const activeOrganization = organizations.find((organization) => organization.id === activeId) || organizations[0];

  if (!activeOrganization) {
    return (
      <div className="rounded-[18px] border border-sidebar-border/70 bg-sidebar-accent/25 px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/70">Workspace</div>
        <p className="mt-1 text-sm font-medium text-sidebar-foreground/80">Sin workspace activo</p>
      </div>
    );
  }

  const workspaceSummary = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sidebar-accent text-sidebar-foreground/75">
        <Building2 className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-sidebar-foreground">{activeOrganization.name}</span>
        <span className="mt-0.5 block truncate text-xs text-sidebar-foreground/60">
          {switchingId ? 'Cambiando workspace…' : roleLabels[activeOrganization.role]}
        </span>
      </span>
    </>
  );

  if (organizations.length === 1) {
    return (
      <div
        className="rounded-[18px] border border-sidebar-border/70 bg-sidebar-accent/25 px-3 py-2.5"
        aria-label={`Workspace activo: ${activeOrganization.name}. Rol: ${roleLabels[activeOrganization.role]}.`}
      >
        <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/70">Workspace</div>
        <div className="flex items-center gap-2.5">{workspaceSummary}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 px-1 text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/70">Workspace</div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={Boolean(switchingId)}
            className="flex w-full items-center gap-2.5 rounded-[18px] border border-sidebar-border/70 bg-sidebar-accent/25 px-3 py-2.5 transition-colors hover:bg-sidebar-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:cursor-wait disabled:opacity-70"
            aria-label={`Cambiar workspace. Actual: ${activeOrganization.name}, ${roleLabels[activeOrganization.role]}`}
            aria-describedby={error ? 'workspace-switcher-error' : undefined}
            aria-busy={Boolean(switchingId)}
          >
            {workspaceSummary}
            {switchingId ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sidebar-foreground/55 motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/45" aria-hidden="true" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 rounded-xl border-border/70 p-1.5">
          <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Cambiar workspace</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={activeOrganization.id} onValueChange={(value) => void handleWorkspaceChange(value)}>
            {organizations.map((organization) => (
              <DropdownMenuRadioItem key={organization.id} value={organization.id} disabled={Boolean(switchingId)} className="items-start rounded-lg py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{organization.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {roleLabels[organization.role]} · {memberCountLabel(organization.memberCount)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? <p id="workspace-switcher-error" className="mt-1.5 px-1 text-xs leading-5 text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
