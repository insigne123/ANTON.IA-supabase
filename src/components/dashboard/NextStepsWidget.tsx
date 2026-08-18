'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, ArrowRight, LayoutGrid, MailPlus, Search } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { computeEligibilityForCampaign } from '@/lib/campaign-eligibility';
import { campaignsStorage } from '@/lib/services/campaigns-service';
import { buildUnifiedRows } from '@/lib/unified-sheet-data';

type DashboardInsights = {
  activePipeline: number;
  activeCampaigns: number;
  dueActions: number;
  eligibleFollowUps: number;
  readyLeads: number;
};

type NextAction = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const INITIAL_INSIGHTS: DashboardInsights = {
  activePipeline: 0,
  activeCampaigns: 0,
  dueActions: 0,
  eligibleFollowUps: 0,
  readyLeads: 0,
};

const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);
const ACTIVE_STAGES = new Set(['contacted', 'engaged', 'meeting', 'negotiation']);

export default function NextStepsWidget() {
  const [insights, setInsights] = useState<DashboardInsights>(INITIAL_INSIGHTS);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setHasError(false);

      try {
        const [rows, campaigns] = await Promise.all([
          buildUnifiedRows(),
          campaignsStorage.get(),
        ]);

        const now = Date.now();
        const activeCampaigns = campaigns.filter((campaign) => !campaign.isPaused);
        const eligibilityCounts = await Promise.all(
          activeCampaigns.map((campaign) =>
            computeEligibilityForCampaign(campaign)
              .then((eligibleRows) => eligibleRows.length)
              .catch(() => 0)
          )
        );

        const dueActions = rows.filter((row) => {
          if (!row.nextActionDueAt || CLOSED_STAGES.has(String(row.stage || ''))) return false;
          const dueAt = new Date(row.nextActionDueAt).getTime();
          return Number.isFinite(dueAt) && dueAt <= now;
        }).length;

        const readyLeadIds = new Set(
          rows
            .filter((row) => row.kind === 'lead_enriched' && Boolean(row.email || row.hasEmail))
            .map((row) => row.sourceId)
        );

        if (!cancelled) {
          setInsights({
            activePipeline: rows.filter((row) => ACTIVE_STAGES.has(String(row.stage || ''))).length,
            activeCampaigns: activeCampaigns.length,
            dueActions,
            eligibleFollowUps: eligibilityCounts.reduce((total, count) => total + count, 0),
            readyLeads: readyLeadIds.size,
          });
        }
      } catch (error) {
        console.error('Error loading dashboard next steps:', error);
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const actions = useMemo<NextAction[]>(() => {
    const crmAction: NextAction = insights.dueActions > 0
      ? {
          title: `Revisa ${insights.dueActions.toLocaleString('es')} ${insights.dueActions === 1 ? 'tarea vencida' : 'tareas vencidas'}`,
          description: 'Hay próximos pasos del CRM que ya requieren atención.',
          href: '/crm',
          icon: AlertCircle,
        }
      : insights.activePipeline > 0
        ? {
            title: `Continúa ${insights.activePipeline.toLocaleString('es')} ${insights.activePipeline === 1 ? 'conversación activa' : 'conversaciones activas'}`,
            description: 'Revisa los leads que ya avanzan por tu pipeline.',
            href: '/crm',
            icon: LayoutGrid,
          }
        : {
            title: 'Organiza tu pipeline',
            description: 'Prioriza los leads que necesitan seguimiento.',
            href: '/crm',
            icon: LayoutGrid,
          };

    const campaignAction: NextAction = insights.eligibleFollowUps > 0
      ? {
          title: `Envía ${insights.eligibleFollowUps.toLocaleString('es')} ${insights.eligibleFollowUps === 1 ? 'seguimiento pendiente' : 'seguimientos pendientes'}`,
          description: 'Estos contactos ya cumplen las condiciones de campaña.',
          href: '/campaigns',
          icon: MailPlus,
        }
      : insights.activeCampaigns > 0
        ? {
            title: 'Revisa tus campañas activas',
            description: 'Confirma los próximos envíos y su secuencia.',
            href: '/campaigns',
            icon: MailPlus,
          }
        : {
            title: 'Prepara una campaña',
            description: 'Convierte tus leads seleccionados en una secuencia.',
            href: '/campaigns',
            icon: MailPlus,
          };

    const leadAction: NextAction = insights.readyLeads > 0
      ? {
          title: `${insights.readyLeads.toLocaleString('es')} ${insights.readyLeads === 1 ? 'lead listo' : 'leads listos'} para contactar`,
          description: 'Ya tienen email y datos enriquecidos disponibles.',
          href: '/saved/leads/enriched',
          icon: Search,
        }
      : {
          title: 'Encuentra nuevos leads',
          description: 'Inicia una búsqueda para ampliar tu pipeline.',
          href: '/search',
          icon: Search,
        };

    return [crmAction, campaignAction, leadAction];
  }, [insights]);

  return (
    <Card className="h-full overflow-hidden rounded-2xl border-border/60 bg-card shadow-[0_12px_32px_-28px_rgba(15,23,42,0.3)]">
      <CardHeader className="space-y-1 px-5 pb-2 pt-4">
        <CardTitle className="text-base">Próximos pasos</CardTitle>
        <CardDescription>Las tres acciones más útiles para avanzar hoy.</CardDescription>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1" aria-busy={loading}>
        {loading ? (
          <div className="space-y-1" aria-label="Cargando próximos pasos">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex min-h-16 items-center gap-3 px-2">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : hasError ? (
          <div role="alert" className="m-1 flex min-h-[176px] flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50/70 px-5 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">No pudimos actualizar tus próximos pasos</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Puedes continuar desde Buscar leads, CRM o Campañas.</p>
          </div>
        ) : (
          <ol className="divide-y divide-border/60">
            {actions.map((action) => (
              <li key={action.href}>
                <Link
                  href={action.href}
                  className="group flex min-h-16 items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
                    <action.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{action.title}</span>
                    <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">{action.description}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
