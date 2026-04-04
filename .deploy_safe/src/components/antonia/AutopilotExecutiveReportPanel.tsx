'use client';

import { useCallback, useEffect, useState } from 'react';
import { Briefcase, CalendarRange, Loader2, RefreshCw, Target, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type ExecutiveReport = {
  summary: {
    activeMissions: number;
    pausedMissions: number;
    contacts: number;
    replies: number;
    positiveReplies: number;
    meetings: number;
    approvalsPending: number;
    atRiskMissions: number;
    achievedGoals: number;
  };
  rates: {
    replyRate: number;
    positiveRate: number;
    meetingRate: number;
  };
  insights: string[];
  missions: Array<{
    id: string;
    title: string;
    playbookName?: string | null;
    goalLabel: string;
    progress: {
      label: string;
      target: number;
      achieved: number;
      gap: number;
      progressPct: number;
      status: 'achieved' | 'on_track' | 'at_risk';
    };
    approvalsPending: number;
    criticalOpen: number;
    meetingRate: number;
  }>;
};

const metricConfig = [
  { key: 'activeMissions', label: 'Misiones activas', icon: Target },
  { key: 'meetings', label: 'Meetings', icon: CalendarRange },
  { key: 'positiveReplies', label: 'Replies positivas', icon: TrendingUp },
  { key: 'atRiskMissions', label: 'En riesgo', icon: Briefcase },
] as const;

export function AutopilotExecutiveReportPanel() {
  const [report, setReport] = useState<ExecutiveReport | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/antonia/executive-report', { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudo cargar el reporte ejecutivo');
      const data = await res.json();
      setReport(data);
    } catch (error) {
      console.error('[AutopilotExecutiveReportPanel] fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Executive Autopilot Report</CardTitle>
            <CardDescription>Vista rapida de progreso comercial, riesgo operativo y cumplimiento de metas.</CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={fetchReport}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !report ? (
          <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">No se pudo generar el reporte ejecutivo.</div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metricConfig.map(({ key, label, icon: Icon }) => (
                <div key={key} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-muted-foreground">{label}</p>
                      <p className="text-2xl font-semibold">{report.summary[key]}</p>
                    </div>
                    <div className="rounded-full bg-primary/10 p-3">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border p-4 text-sm">
                <p className="text-muted-foreground">Reply rate</p>
                <p className="text-xl font-semibold">{report.rates.replyRate}%</p>
              </div>
              <div className="rounded-xl border p-4 text-sm">
                <p className="text-muted-foreground">Positive rate</p>
                <p className="text-xl font-semibold">{report.rates.positiveRate}%</p>
              </div>
              <div className="rounded-xl border p-4 text-sm">
                <p className="text-muted-foreground">Meeting rate</p>
                <p className="text-xl font-semibold">{report.rates.meetingRate}%</p>
              </div>
            </div>

            {report.insights.length > 0 && (
              <div className="space-y-2">
                {report.insights.map((insight) => (
                  <div key={insight} className="rounded-lg border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                    {insight}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              {report.missions.slice(0, 6).map((mission) => (
                <div key={mission.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{mission.title}</p>
                      <p className="text-xs text-muted-foreground">{mission.goalLabel}{mission.playbookName ? ` · ${mission.playbookName}` : ''}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={mission.progress.status === 'achieved' ? 'default' : mission.progress.status === 'on_track' ? 'secondary' : 'outline'}>
                        {mission.progress.status}
                      </Badge>
                      {mission.approvalsPending > 0 && <Badge variant="outline">{mission.approvalsPending} approvals</Badge>}
                      {mission.criticalOpen > 0 && <Badge variant="destructive">{mission.criticalOpen} riesgos</Badge>}
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-muted-foreground">
                    {mission.progress.achieved}/{mission.progress.target} {mission.progress.label.toLowerCase()} · gap {mission.progress.gap} · meeting rate {mission.meetingRate}%
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
