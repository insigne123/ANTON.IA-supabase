
// src/components/dashboard/NextStepsWidget.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getEnrichedLeads } from '@/lib/saved-enriched-leads-storage';
import { findReportForLead } from '@/lib/lead-research-storage';
import { campaignsStorage } from '@/lib/campaigns-storage';
import { computeEligibilityForCampaign } from '@/lib/campaign-eligibility';
import { crmService } from '@/lib/services/crm-service';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { UnifiedRow } from '@/lib/unified-sheet-types';
import { differenceInDays } from 'date-fns';
import { AlertCircle, Lightbulb, ArrowRight, CheckCircle2 } from 'lucide-react';

type ReadyToContactLead = {
  id: string;
  name: string;
  company: string;
};

export default function NextStepsWidget() {
  const supabase = createClientComponentClient();
  const [readyLeads, setReadyLeads] = useState<ReadyToContactLead[]>([]);
  const [staleLeads, setStaleLeads] = useState<UnifiedRow[]>([]);
  const [eligibleCampaignLeads, setEligibleCampaignLeads] = useState<number>(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    async function load() {
      try {
        const enrichedPromise = getEnrichedLeads();
        const campaignsPromise = campaignsStorage.get();
        // Fetch CRM leads for pending alerts
        const crmPromise = crmService.getAllUnifiedRows();

        const [enriched, campaigns, crmRows] = await Promise.all([
          Promise.resolve(enrichedPromise).catch(() => []),
          campaignsPromise.catch(() => []),
          crmPromise.catch(() => [])
        ]);

        // 1. Leads listos para contactar (Enriquecidos con reporte)
        const ready = (enriched || [])
          .filter(lead => !!findReportForLead({ leadId: lead.id, companyDomain: lead.companyDomain, companyName: lead.companyName }))
          .slice(0, 5)
          .map(lead => ({ id: lead.id, name: lead.fullName, company: lead.companyName || 'N/A' }));

        setReadyLeads(ready);

        // 2. Leads pendientes/estancados (Lógica de SmartAlerts)
        const stale = crmRows.filter(l =>
          l.stage === 'contacted' &&
          l.updatedAt &&
          differenceInDays(new Date(), new Date(l.updatedAt)) > 3
        ).slice(0, 5); // Mostrar max 5

        setStaleLeads(stale);

        // 3. Campañas
        const promises = (campaigns || []).map(c => {
          const isPaused = c.status === 'paused';
          if (!isPaused) {
            const serviceCampaign: any = {
              ...c,
              isPaused: false,
              excludedLeadIds: c.excludeLeadIds || []
            };
            return computeEligibilityForCampaign(serviceCampaign).then(rows => rows.length).catch(() => 0);
          }
          return Promise.resolve(0);
        });

        Promise.all(promises).then(counts => {
          const total = counts.reduce((a, b) => a + b, 0);
          setEligibleCampaignLeads(total);
        });
      } catch (e) {
        console.error("Error loading next steps widget", e);
      }
    }
    load();
  }, []);

  if (!mounted) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <span>Próximos Pasos Sugeridos</span>
        </CardTitle>
        <CardDescription>Acciones recomendadas para mantener el ritmo de tu prospección.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Sección: Alertas CRM (Leads Desatendidos) */}
        {staleLeads.length > 0 && (
          <div className="space-y-3 border-b pb-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <h4 className="text-sm font-semibold text-orange-700">Leads Pendientes de Respuesta (+3 días)</h4>
            </div>

            <div className="space-y-2">
              {staleLeads.map(lead => (
                <div key={lead.gid} className="flex items-center justify-between bg-orange-50 p-2 rounded border border-orange-100">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-800">{lead.name || 'Sin nombre'}</span>
                    <span className="text-xs text-gray-500">{lead.company}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-orange-700 hover:text-orange-800 hover:bg-orange-100" asChild>
                    <Link href="/crm">Ver en CRM</Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sección: Campañas */}
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

        {/* Sección: Leads Listos */}
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

        {readyLeads.length === 0 && eligibleCampaignLeads === 0 && staleLeads.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center p-6 bg-muted/30 rounded-lg">
            <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
            <p className="font-medium">¡Todo al día!</p>
            <p className="text-sm text-muted-foreground">No hay acciones sugeridas por ahora.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
