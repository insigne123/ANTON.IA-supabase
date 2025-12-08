
// src/components/dashboard/SummaryCards.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Send, MailCheck, Briefcase } from 'lucide-react';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { campaignsStorage } from '@/lib/campaigns-storage';
import { getEnrichedLeads } from '@/lib/services/enriched-leads-service';
import { savedOpportunitiesStorage } from '@/lib/services/opportunities-service';

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
      const contacted = await contactedLeadsStorage.get();
      const campaigns = await campaignsStorage.get();
      const enriched = await getEnrichedLeads();
      const opps = await savedOpportunitiesStorage.get();

      setSummary({
        contacted: contacted.length,
        replied: contacted.filter(c => c.status === 'replied').length,
        activeCampaigns: campaigns.filter(c => c.status === 'active').length,
        enrichedLeads: enriched.length,
        savedOpps: opps.length,
      });
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
