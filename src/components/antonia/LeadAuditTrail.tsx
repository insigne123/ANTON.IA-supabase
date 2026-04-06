'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Search, Sparkles, Brain, Mail, AlertTriangle, Clock, Filter } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

const EXACT_DATETIME_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatExactDateTime(input?: string | null) {
  if (!input) return '-';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '-';
  return EXACT_DATETIME_FORMATTER.format(d);
}

type LeadRow = {
  id: string;
  name: string;
  email: string | null;
  company: string;
  title: string;
  linkedin_url?: string | null;
};

type LeadEventRow = {
  id: string;
  organization_id: string | null;
  mission_id: string | null;
  task_id: string | null;
  lead_id: string | null;
  event_type: string;
  stage: string | null;
  outcome: string | null;
  message: string | null;
  meta: any;
  created_at: string;
  leads?: LeadRow | null;
};

function iconForStage(stage?: string | null) {
  const s = String(stage || '').toLowerCase();
  if (s === 'search') return <Search className="h-4 w-4" />;
  if (s === 'enrich') return <Sparkles className="h-4 w-4" />;
  if (s === 'investigate') return <Brain className="h-4 w-4" />;
  if (s === 'contact') return <Mail className="h-4 w-4" />;
  return <Clock className="h-4 w-4" />;
}

function badgeVariantForOutcome(outcome?: string | null): any {
  const o = String(outcome || '').toLowerCase();
  if (!o) return 'secondary';
  if (o.includes('completed') || o.includes('inserted') || o.includes('email_found') || o.includes('sent')) return 'default';
  if (o.includes('no_email') || o.includes('skipped') || o.includes('pending')) return 'secondary';
  if (o.includes('failed') || o.includes('error') || o.includes('http_') || o.includes('exception')) return 'destructive';
  return 'secondary';
}

export function LeadAuditTrail({ missionId }: { missionId: string }) {
  const supabase = createClientComponentClient();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<LeadEventRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'search' | 'enrich' | 'investigate' | 'contact' | 'errors'>('all');

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from('antonia_lead_events')
        .select('id, organization_id, mission_id, task_id, lead_id, event_type, stage, outcome, message, meta, created_at, leads (id, name, email, company, title, linkedin_url)')
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false })
        .limit(400);

      if (!isMounted) return;
      if (error) {
        console.error('[LeadAuditTrail] load error:', error);
        setEvents([]);
      } else {
        setEvents((data as any[]) as LeadEventRow[]);
      }
      setLoading(false);
    }

    load();

    const channel = supabase
      .channel(`antonia_lead_events_${missionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'antonia_lead_events',
          filter: `mission_id=eq.${missionId}`
        },
        async (payload) => {
          if (!isMounted) return;
          if (payload.eventType === 'INSERT') {
            // We only get the raw row in realtime; do a lightweight refresh of the top N
            const { data } = await supabase
              .from('antonia_lead_events')
              .select('id, organization_id, mission_id, task_id, lead_id, event_type, stage, outcome, message, meta, created_at, leads (id, name, email, company, title, linkedin_url)')
              .eq('mission_id', missionId)
              .order('created_at', { ascending: false })
              .limit(200);
            if (data) setEvents((data as any[]) as LeadEventRow[]);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [missionId, supabase]);

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    if (filter === 'errors') {
      return events.filter(e => {
        const o = String(e.outcome || '').toLowerCase();
        const t = String(e.event_type || '').toLowerCase();
        return o.includes('failed') || o.includes('error') || o.includes('http_') || o.includes('exception') || t.includes('failed');
      });
    }
    return events.filter(e => String(e.stage || '').toLowerCase() === filter);
  }, [events, filter]);

  const summary = useMemo(() => {
    const out = {
      found: 0,
      enrichEmail: 0,
      enrichNoEmail: 0,
      enrichFailed: 0,
      investigated: 0,
      investigateFailed: 0,
      contactedSent: 0,
      contactedBlocked: 0,
      contactedFailed: 0,
    };

    for (const e of events) {
      const type = String(e.event_type || '');
      const outcome = String(e.outcome || '');

      if (type === 'lead_found') out.found++;

      if (type === 'lead_enrich_completed') {
        if (outcome === 'email_found') out.enrichEmail++;
        else if (outcome === 'no_email') out.enrichNoEmail++;
      }
      if (type === 'lead_enrich_failed') out.enrichFailed++;

      if (type === 'lead_investigate_completed') out.investigated++;
      if (type === 'lead_investigate_failed') out.investigateFailed++;

      if (type === 'lead_contact_sent') out.contactedSent++;
      if (type === 'lead_contact_blocked') out.contactedBlocked++;
      if (type === 'lead_contact_failed') out.contactedFailed++;
    }

    return out;
  }, [events]);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center border-2 border-primary">
                <Filter className="h-3 w-3 text-primary" />
              </Badge>
              Auditoria por Lead
            </h3>
            <p className="text-sm text-muted-foreground ml-8">
              {events.length} eventos • {summary.found} encontrados • {summary.enrichEmail} emails • {summary.contactedSent} enviados
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Badge variant="secondary">Sin email: {summary.enrichNoEmail}</Badge>
            {(summary.enrichFailed + summary.investigateFailed + summary.contactedFailed + summary.contactedBlocked) > 0 && (
              <Badge variant="destructive">Problemas: {summary.enrichFailed + summary.investigateFailed + summary.contactedFailed + summary.contactedBlocked}</Badge>
            )}
          </div>
        </div>

        <div className="mt-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as any)} className="w-full">
            <TabsList className="w-full h-auto justify-start gap-1 overflow-x-auto rounded-xl p-1">
              <TabsTrigger value="all" className="shrink-0 px-3 py-1.5 text-xs">Todo</TabsTrigger>
              <TabsTrigger value="search" className="shrink-0 px-3 py-1.5 text-xs">Busqueda</TabsTrigger>
              <TabsTrigger value="enrich" className="shrink-0 px-3 py-1.5 text-xs">Enriq.</TabsTrigger>
              <TabsTrigger value="investigate" className="shrink-0 px-3 py-1.5 text-xs">Invest.</TabsTrigger>
              <TabsTrigger value="contact" className="shrink-0 px-3 py-1.5 text-xs">Contacto</TabsTrigger>
              <TabsTrigger value="errors" className="shrink-0 px-3 py-1.5 text-xs flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Errores
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">No hay eventos para este filtro.</div>
        ) : (
          <ScrollArea className="h-full px-4 py-4">
            <div className="space-y-3 pb-10">
              {filtered.map((e) => {
                const lead = e.leads;
                const name = lead?.name || (e.meta?.name as string) || 'Lead';
                const company = lead?.company || (e.meta?.company as string) || '';
                const title = lead?.title || (e.meta?.title as string) || '';
                const email = lead?.email || (e.meta?.email as string) || null;

                return (
                  <Card key={e.id} className="border-border/60">
                    <CardHeader className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <CardTitle className="text-sm font-semibold truncate">{name}</CardTitle>
                          <div className="text-xs text-muted-foreground truncate">
                            {title}{title && company ? ' - ' : ''}{company}
                            {email ? ` - ${email}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                            <span className="inline-flex items-center gap-1">
                              {iconForStage(e.stage)}
                              {e.stage || 'event'}
                            </span>
                          </Badge>
                          {(e.outcome || e.event_type) && (
                            <Badge variant={badgeVariantForOutcome(e.outcome)} className="text-[10px]">
                              {e.outcome || e.event_type}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 pb-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm">
                          {e.message || e.event_type}
                        </div>
                        <div className="text-right text-xs text-muted-foreground shrink-0 leading-tight">
                          <div>{formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: es })}</div>
                          <div className="text-[10px] text-muted-foreground/80">{formatExactDateTime(e.created_at)}</div>
                        </div>
                      </div>
                      {e.meta && (typeof e.meta === 'object') && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {e.meta?.error ? (
                            <span className="text-red-600 dark:text-red-400">{String(e.meta.error).slice(0, 180)}</span>
                          ) : e.meta?.emailStatus ? (
                            <span>Email status: {String(e.meta.emailStatus)}</span>
                          ) : null}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
