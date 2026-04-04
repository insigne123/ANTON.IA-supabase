'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Flame, Gauge, Loader2, RefreshCw, ShieldCheck, Siren, Sparkles, Waves } from 'lucide-react';

import type { AntoniaConfig } from '@/lib/types';
import { approvalModeLabel, autopilotModeLabel } from '@/lib/antonia-autopilot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type OverviewData = {
  config: AntoniaConfig;
  summary: {
    activeMissions: number;
    tasksProcessing: number;
    tasksPending: number;
    openExceptions: number;
    approvalsPending: number;
    hotLeads: number;
    contactsToday: number;
    repliesToday: number;
  };
  exceptionSummary: Record<string, number>;
  scoreDistribution: Record<string, number>;
  missions: Array<{
    id: string;
    title: string;
    status: string;
    readyToContact: number;
    approvalsPending: number;
    openExceptions: number;
    updatedAt?: string;
  }>;
};

const metricCards = [
  { key: 'activeMissions', label: 'Misiones activas', icon: Bot },
  { key: 'tasksProcessing', label: 'Procesando', icon: Waves },
  { key: 'approvalsPending', label: 'Aprobaciones', icon: ShieldCheck },
  { key: 'hotLeads', label: 'Leads calientes', icon: Flame },
  { key: 'openExceptions', label: 'Excepciones', icon: Siren },
  { key: 'contactsToday', label: 'Contactos hoy', icon: Sparkles },
] as const;

export function AutopilotControlCenter({
  config,
  onUpdateConfig,
}: {
  config: AntoniaConfig | null;
  onUpdateConfig: (key: keyof AntoniaConfig, value: any) => Promise<void> | void;
}) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOverview = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch('/api/antonia/autopilot/overview', { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudo cargar el overview de autopilot');
      const data = await res.json();
      setOverview(data);
    } catch (error) {
      console.error('[AutopilotControlCenter] fetch error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(() => fetchOverview(true), 30000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  const effectiveConfig = useMemo(() => config || overview?.config || null, [config, overview?.config]);

  const modeBadgeVariant = effectiveConfig?.autopilotMode === 'full_auto'
    ? 'default'
    : effectiveConfig?.autopilotMode === 'semi_auto'
      ? 'secondary'
      : 'outline';

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Gauge className="h-5 w-5 text-primary" />
                Autopilot Control Center
              </CardTitle>
              <CardDescription>
                Configura cuanto puede operar ANTONIA sin supervision y monitorea riesgo, aprobaciones y leads calientes.
              </CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={() => fetchOverview(true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={effectiveConfig?.autopilotEnabled ? 'default' : 'secondary'}>
              {effectiveConfig?.autopilotEnabled ? 'Autopilot activo' : 'Autopilot inactivo'}
            </Badge>
            {effectiveConfig?.autopilotMode && (
              <Badge variant={modeBadgeVariant}>{autopilotModeLabel(effectiveConfig.autopilotMode)}</Badge>
            )}
            {effectiveConfig?.approvalMode && (
              <Badge variant="outline">{approvalModeLabel(effectiveConfig.approvalMode)}</Badge>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="autopilot-enabled">Activar autopilot</Label>
                  <p className="text-xs text-muted-foreground">Habilita decisiones automaticas con guardrails.</p>
                </div>
                <Switch
                  id="autopilot-enabled"
                  checked={!!effectiveConfig?.autopilotEnabled}
                  onCheckedChange={(value) => onUpdateConfig('autopilotEnabled', value)}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-xl border bg-card p-4">
              <Label>Modo operativo</Label>
              <Select
                value={effectiveConfig?.autopilotMode || 'manual_assist'}
                onValueChange={(value) => onUpdateConfig('autopilotMode', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona modo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual_assist">Manual Assist</SelectItem>
                  <SelectItem value="semi_auto">Semi Auto</SelectItem>
                  <SelectItem value="full_auto">Full Auto</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-xl border bg-card p-4">
              <Label>Politica de aprobacion</Label>
              <Select
                value={effectiveConfig?.approvalMode || 'low_score_only'}
                onValueChange={(value) => onUpdateConfig('approvalMode', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona politica" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_contacts">Aprobar todos</SelectItem>
                  <SelectItem value="low_score_only">Solo score bajo</SelectItem>
                  <SelectItem value="high_risk_only">Solo alto riesgo</SelectItem>
                  <SelectItem value="disabled">Sin aprobacion</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-xl border bg-card p-4">
                <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="min-auto-send">Auto-send</Label>
                  <Input
                    key={`min-auto-send-${effectiveConfig?.minAutoSendScore ?? 70}`}
                    id="min-auto-send"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue={effectiveConfig?.minAutoSendScore ?? 70}
                    onBlur={(event) => onUpdateConfig('minAutoSendScore', Number(event.target.value || 0))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="min-review">Review</Label>
                  <Input
                    key={`min-review-${effectiveConfig?.minReviewScore ?? 45}`}
                    id="min-review"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue={effectiveConfig?.minReviewScore ?? 45}
                    onBlur={(event) => onUpdateConfig('minReviewScore', Number(event.target.value || 0))}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center justify-between rounded-xl border bg-card p-4">
              <div>
                <Label htmlFor="pause-negative">Pausar por reply negativo</Label>
                <p className="text-xs text-muted-foreground">Eleva control reputacional.</p>
              </div>
              <Switch
                id="pause-negative"
                checked={!!effectiveConfig?.pauseOnNegativeReply}
                onCheckedChange={(value) => onUpdateConfig('pauseOnNegativeReply', value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border bg-card p-4 md:col-span-1 xl:col-span-1">
              <div>
                <Label htmlFor="pause-failure">Pausar por fallos</Label>
                <p className="text-xs text-muted-foreground">Corta envios si la entrega se degrada.</p>
              </div>
              <Switch
                id="pause-failure"
                checked={!!effectiveConfig?.pauseOnFailureSpike}
                onCheckedChange={(value) => onUpdateConfig('pauseOnFailureSpike', value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-xl border bg-card p-4">
              <Label htmlFor="booking-link">Booking link</Label>
              <Input
                key={`booking-link-${effectiveConfig?.bookingLink || ''}`}
                id="booking-link"
                defaultValue={effectiveConfig?.bookingLink || ''}
                placeholder="https://calendly.com/tu-equipo/demo"
                onBlur={(event) => onUpdateConfig('bookingLink', event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Se usa para responder rapido cuando un lead pide reunion.</p>
            </div>
            <div className="space-y-2 rounded-xl border bg-card p-4">
              <Label htmlFor="meeting-instructions">Meeting handoff notes</Label>
              <Textarea
                key={`meeting-instructions-${effectiveConfig?.meetingInstructions || ''}`}
                id="meeting-instructions"
                defaultValue={effectiveConfig?.meetingInstructions || ''}
                placeholder="Ej: menciona que cubrimos staffing, payroll y outsourcing operativo en una llamada de 20 min."
                onBlur={(event) => onUpdateConfig('meetingInstructions', event.target.value)}
                className="min-h-[96px]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && !overview ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : overview ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {metricCards.map(({ key, label, icon: Icon }) => (
              <Card key={key}>
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="text-2xl font-semibold">{overview.summary[key]}</p>
                  </div>
                  <div className="rounded-full bg-primary/10 p-3">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Distribucion de score</CardTitle>
                <CardDescription>Prioridad comercial de los leads detectados.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(overview.scoreDistribution).map(([tier, value]) => {
                  const total = Object.values(overview.scoreDistribution).reduce((sum, item) => sum + Number(item || 0), 0) || 1;
                  const width = Math.min(100, Math.round((Number(value || 0) / total) * 100));
                  return (
                    <div key={tier} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize">{tier}</span>
                        <span className="text-muted-foreground">{value}</span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">Matriz de misiones</CardTitle>
                <CardDescription>Que tan listas estan tus misiones para operar sin tocar la app.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {overview.missions.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    No hay misiones activas para monitorear.
                  </div>
                ) : overview.missions.map((mission) => (
                  <div key={mission.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{mission.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Listos: {mission.readyToContact} · Aprobaciones: {mission.approvalsPending} · Excepciones: {mission.openExceptions}
                        </p>
                      </div>
                      <Badge variant={mission.openExceptions > 0 ? 'secondary' : 'outline'}>
                        {mission.openExceptions > 0 ? 'Requiere atencion' : 'Operando estable'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
