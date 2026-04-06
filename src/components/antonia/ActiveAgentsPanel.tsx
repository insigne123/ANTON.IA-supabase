'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, Loader2, Clock, Activity } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

type TaskRow = {
  id: string;
  mission_id: string | null;
  type: string;
  status: string;
  progress_current?: number | null;
  progress_total?: number | null;
  progress_label?: string | null;
  heartbeat_at?: string | null;
  processing_started_at?: string | null;
  created_at: string;
};

type MissionRow = {
  id: string;
  title: string;
  status: string;
};

function typeLabel(type: string) {
  switch (type) {
    case 'GENERATE_CAMPAIGN': return 'Estrategia';
    case 'SEARCH': return 'Busqueda';
    case 'ENRICH': return 'Enriquecimiento';
    case 'INVESTIGATE': return 'Investigacion';
    case 'CONTACT':
    case 'CONTACT_INITIAL': return 'Contacto';
    case 'CONTACT_CAMPAIGN': return 'Seguimiento';
    case 'EVALUATE': return 'Evaluacion';
    case 'GENERATE_REPORT': return 'Reporte';
    default: return type;
  }
}

export function ActiveAgentsPanel({ organizationId }: { organizationId: string }) {
  const supabase = createClientComponentClient();
  const [loading, setLoading] = useState(true);
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setLoading(true);
      const { data: m } = await supabase
        .from('antonia_missions')
        .select('id, title, status')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!isMounted) return;
      setMissions(((m as any[]) || []) as MissionRow[]);

      const ids = (((m as any[]) || []) as any[]).map(x => x.id).filter(Boolean);
      if (ids.length === 0) {
        setTasks([]);
        setLoading(false);
        return;
      }

      const { data: t } = await supabase
        .from('antonia_tasks')
        .select('id, mission_id, type, status, progress_current, progress_total, progress_label, heartbeat_at, processing_started_at, created_at')
        .in('mission_id', ids)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: true })
        .limit(200);

      if (!isMounted) return;
      setTasks(((t as any[]) || []) as TaskRow[]);
      setLoading(false);
    }

    load();

    const channel = supabase
      .channel(`antonia_active_${organizationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'antonia_tasks', filter: `organization_id=eq.${organizationId}` },
        () => load()
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [organizationId, supabase]);

  const byMission = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      if (!t.mission_id) continue;
      if (!map.has(t.mission_id)) map.set(t.mission_id, []);
      map.get(t.mission_id)!.push(t);
    }
    return map;
  }, [tasks]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          Agentes Activos
          <Badge variant="secondary" className="ml-2">{missions.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : missions.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            No hay misiones activas.
          </div>
        ) : (
          <ScrollArea className="h-[220px]">
            <div className="space-y-3 pr-2">
              {missions.map(m => {
                const ts = byMission.get(m.id) || [];
                const processing = ts.find(x => x.status === 'processing');
                const pendingCount = ts.filter(x => x.status === 'pending').length;
                const label = processing?.progress_label || (processing ? typeLabel(processing.type) : 'En cola');
                const cur = typeof processing?.progress_current === 'number' ? processing!.progress_current : null;
                const tot = typeof processing?.progress_total === 'number' ? processing!.progress_total : null;

                return (
                  <div key={m.id} className="p-3 rounded-lg border bg-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{m.title}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <Activity className="h-3 w-3" />
                            {processing ? 'Procesando' : 'Sin ejecucion'}
                          </span>
                          {pendingCount > 0 && <span>• {pendingCount} en cola</span>}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <Badge variant={processing ? 'default' : 'secondary'} className="text-[10px]">
                          {label}{(cur != null && tot != null) ? ` (${cur}/${tot})` : ''}
                        </Badge>
                        {processing?.heartbeat_at ? (
                          <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(processing.heartbeat_at), { addSuffix: true, locale: es })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
