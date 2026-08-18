
// src/components/dashboard/SummaryCards.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, Users, Send, MailCheck, UserCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { countUniqueReplyContacts } from '@/lib/antonia-reply-metrics';
// Imports removed: Storage services are no longer used for counts to improve performance.


type Summary = {
  contacted: number;
  replied: number;
  activeCampaigns: number;
  enrichedLeads: number;
};

export default function SummaryCards() {
  const [summary, setSummary] = useState<Summary>({
    contacted: 0,
    replied: 0,
    activeCampaigns: 0,
    enrichedLeads: 0,
  });
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setHasError(false);
      try {
        // [P2-PERF-001] Optimized Count Queries (HEAD request)
        // Instead of downloading all rows (approx 2MB+ json), we just get the count (kB).

        // We need organization context. Assuming RLS handles visibility, 
        // but explicit filter is safer if service uses specific logic.
        // Services usually use `organization_id`.

        const { data: { user } } = await import('@/lib/supabase').then(m => m.supabase.auth.getUser());
        if (!user) throw new Error('No active session');

        const supabase = (await import('@/lib/supabase')).supabase;
        const orgService = (await import('@/lib/services/organization-service')).organizationService;
        const orgId = await orgService.getCurrentOrganizationId();

        // Parallelize queries
        const [
          contactedRes,
          repliedRes,
          campaignsRes,
          enrichedRes,
          repliedSignalRes,
          replyRowsRes,
        ] = await Promise.all([
          // 1. Contacted Leads (Total)
          supabase.from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId),

          // 2. Legacy replies by status
          supabase.from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('status', 'replied'),

          // 3. Active Campaigns
          supabase.from('campaigns')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('status', 'active'),

          // 4. Enriched Leads
          // Note: service uses 'enriched_leads' table
          supabase.from('enriched_leads')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId),

          supabase.from('contacted_leads')
            .select('id, lead_id, email, replied_at, reply_intent, last_reply_text')
            .eq('organization_id', orgId),
          supabase.from('lead_responses')
            .select('contacted_id, lead_id, type')
            .eq('organization_id', orgId)
        ]);

        const results = [contactedRes, repliedRes, campaignsRes, enrichedRes, repliedSignalRes, replyRowsRes];
        if (results.some((result) => result.error)) {
          throw new Error('One or more dashboard metrics could not be loaded');
        }

        const repliedCount = countUniqueReplyContacts(repliedSignalRes.data || [], replyRowsRes.data || []);

        if (!cancelled) {
          setSummary({
            contacted: contactedRes.count || 0,
            replied: repliedCount || repliedRes.count || 0,
            activeCampaigns: campaignsRes.count || 0,
            enrichedLeads: enrichedRes.count || 0,
          });
        }

      } catch (error) {
        console.error("Error loading summary cards:", error);
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const metrics = [
    { title: 'Contactados', value: summary.contacted, icon: Send },
    { title: 'Respuestas', value: summary.replied, icon: MailCheck },
    { title: 'Campañas activas', value: summary.activeCampaigns, icon: Users },
    { title: 'Leads enriquecidos', value: summary.enrichedLeads, icon: UserCheck },
  ];

  if (hasError) {
    return (
      <Alert className="rounded-2xl border-amber-200 bg-amber-50/70 py-3 text-amber-950 shadow-none dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
        <AlertDescription className="text-sm text-amber-800 dark:text-amber-100/80">
          No pudimos actualizar el resumen. Tus acciones y el uso diario siguen disponibles.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card
      aria-busy={loading}
      aria-label="Resumen general"
      className="overflow-hidden rounded-2xl border-border/60 bg-border/60 shadow-[0_12px_28px_-26px_rgba(15,23,42,0.28)]"
    >
      <CardContent className="grid grid-cols-2 gap-px p-0 md:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.title} className="min-w-0 bg-card px-4 py-3.5 dark:bg-card/90 sm:px-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <metric.icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="truncate">{metric.title}</span>
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-14" />
            ) : (
              <div className="mt-1 text-2xl font-semibold leading-7 tracking-tight tabular-nums">{metric.value.toLocaleString('es')}</div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
