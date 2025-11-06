
// src/components/dashboard/NextStepsWidget.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lightbulb, ArrowRight, CheckCircle2 } from 'lucide-react';
import { getEnrichedLeads } from '@/lib/saved-enriched-leads-storage';
import { findReportForLead } from '@/lib/lead-research-storage';
import { campaignsStorage } from '@/lib/campaigns-storage';
import { computeEligibilityForCampaign } from '@/lib/campaign-eligibility';
import type { EnrichedLead } from '@/lib/types';

type ReadyToContactLead = {
  id: string;
  name: string;
  company: string;
};

export default function NextStepsWidget() {
  const [readyLeads, setReadyLeads] = useState<ReadyToContactLead[]>([]);
  const [eligibleCampaignLeads, setEligibleCampaignLeads] = useState<number>(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Calcular al montar y potencialmente en un intervalo si los datos cambian a menudo.
    const enriched = getEnrichedLeads();
    const ready = enriched
      .filter(lead => !!findReportForLead({ leadId: lead.id, companyDomain: lead.companyDomain, companyName: lead.companyName }))
      .slice(0, 5) // Limitar a 5 para el widget
      .map(lead => ({ id: lead.id, name: lead.fullName, company: lead.companyName || 'N/A' }));
    
    setReadyLeads(ready);

    const campaigns = campaignsStorage.get();
    let totalEligible = 0;
    campaigns.forEach(c => {
      if (!c.isPaused) {
        totalEligible += computeEligibilityForCampaign(c).length;
      }
    });
    setEligibleCampaignLeads(totalEligible);

  }, []);

  if (!mounted) return null; // Evita renderizado SSR que no puede acceder a localStorage

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <span>Próximos Pasos Sugeridos</span>
        </CardTitle>
        <CardDescription>Acciones recomendadas para mantener el ritmo de tu prospección.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {eligibleCampaignLeads > 0 && (
          <div className="flex items-center justify-between rounded-lg border bg-accent/50 p-3">
            <div>
              <p className="font-semibold text-sm">Seguimientos de Campaña</p>
              <p className="text-xs text-muted-foreground">{eligibleCampaignLeads} lead(s) son elegibles para un seguimiento hoy.</p>
            </div>
            <Button size="sm" asChild>
              <Link href="/campaigns">
                Ver y Enviar <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}

        {readyLeads.length > 0 && (
          <div className="space-y-2">
             <p className="font-semibold text-sm">Leads Listos para Primer Contacto</p>
            {readyLeads.map(lead => (
              <div key={lead.id} className="flex items-center justify-between text-sm">
                <p>
                  <span className="font-medium">{lead.name}</span>
                  <span className="text-muted-foreground"> en {lead.company}</span>
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/contact/compose?id=${lead.id}`}>Contactar</Link>
                </Button>
              </div>
            ))}
             <Link href="/saved/leads/enriched" className="text-xs text-primary hover:underline flex items-center mt-2">
              Ver todos los leads enriquecidos <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </div>
        )}

        {readyLeads.length === 0 && eligibleCampaignLeads === 0 && (
           <div className="flex flex-col items-center justify-center text-center p-6 bg-muted/30 rounded-lg">
             <CheckCircle2 className="h-8 w-8 text-green-500 mb-2"/>
            <p className="font-medium">¡Todo al día!</p>
            <p className="text-sm text-muted-foreground">No hay acciones sugeridas por ahora.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
