
// src/components/dashboard/SummaryCards.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Send, MailCheck, Briefcase } from 'lucide-react';
// Imports removed: Storage services are no longer used for counts to improve performance.


type Summary = {
  contacted: number;
  replied: number;
  activeCampaigns: number;
  enrichedLeads: number;
  savedOpps: number;
};

export default function SummaryCards() {
  const [summary, setSummary] = useState<Summary>({
    contacted: 0,
    replied: 0,
    activeCampaigns: 0,
    enrichedLeads: 0,
    savedOpps: 0,
  });

  useEffect(() => {
    async function load() {
      try {
        // [P2-PERF-001] Optimized Count Queries (HEAD request)
        // Instead of downloading all rows (approx 2MB+ json), we just get the count (kB).

        // We need organization context. Assuming RLS handles visibility, 
        // but explicit filter is safer if service uses specific logic.
        // Services usually use `organization_id`.

        const { data: { user } } = await import('@/lib/supabase').then(m => m.supabase.auth.getUser());
        if (!user) return;

        const supabase = (await import('@/lib/supabase')).supabase;
        const orgService = (await import('@/lib/services/organization-service')).organizationService;
        const orgId = await orgService.getCurrentOrganizationId();

        // Parallelize queries
        const [
          contactedRes,
          repliedRes,
          campaignsRes,
          enrichedRes,
          oppsRes
        ] = await Promise.all([
          // 1. Contacted Leads (Total)
          supabase.from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId),

          // 2. Replies (Status='replied')
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

          // 5. Saved Opportunities
          // Note: service does not use orgId yet (legacy?), uses user_id implicitly via RLS?
          // Checking service: it inserts with user_id. RLS likely filters by user_id for now.
          supabase.from('opportunities')
            .select('*', { count: 'exact', head: true })
          // .eq('user_id', user.id) // Redundant if RLS enabled, but safe.
        ]);

        setSummary({
          contacted: contactedRes.count || 0,
          replied: repliedRes.count || 0,
          activeCampaigns: campaignsRes.count || 0,
          enrichedLeads: enrichedRes.count || 0,
          savedOpps: oppsRes.count || 0,
        });

      } catch (error) {
        console.error("Error loading summary cards:", error);
      }
    }
    load();
  }, []);

  const cardItems = [
    { title: 'Leads Contactados', value: summary.contacted, icon: Send },
    { title: 'Respuestas Obtenidas', value: summary.replied, icon: MailCheck },
    { title: 'Campañas Activas', value: summary.activeCampaigns, icon: Users },
    { title: 'Oportunidades Guardadas', value: summary.savedOpps, icon: Briefcase },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cardItems.map((item, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{item.title}</CardTitle>
            <item.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{item.value}</div>
            <p className="text-xs text-muted-foreground">Total histórico</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
