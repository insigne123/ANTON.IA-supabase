'use client';

import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Sparkles, Loader2, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { companySizes } from '@/lib/data';
import { cn } from '@/lib/utils';

type MissionLike = {
  id: string;
  title: string;
  goalSummary?: string;
  params?: any;
};

type IntelligenceResponse = {
  mission: any;
  metrics: Record<string, number>;
  reasoning: string;
  suggestedPatch: any;
  goalProgress?: {
    label: string;
    target: number;
    achieved: number;
    gap: number;
    progressPct: number;
    status: 'achieved' | 'on_track' | 'at_risk';
  };
  allocatorPlan?: {
    current: Record<string, number>;
    recommended: Record<string, number>;
    changed: boolean;
    rationale: string;
  };
  recommendations: Array<{
    id: string;
    title: string;
    why: string;
    confidence: number;
    patch: any;
  }>;
};

type FormState = {
  title: string;
  goalSummary: string;
  jobTitle: string;
  location: string;
  industry: string;
  keywords: string;
  companySize: string;
  senioritiesText: string;
  targetOutcome: 'meetings' | 'positive_replies' | 'pipeline';
  targetMeetings: number;
  targetPositiveReplies: number;
  targetPipelineValue: number;
  targetTimelineDays: number;
  idealCustomerProfile: string;
  valueProposition: string;
  applyIcpFilter: boolean;
  enrichmentLevel: 'basic' | 'deep';
  campaignName: string;
  campaignContext: string;
  dailySearchLimit: number;
  dailyEnrichLimit: number;
  dailyInvestigateLimit: number;
  dailyContactLimit: number;
};

const TARGET_OUTCOME_OPTIONS = [
  { value: 'meetings', label: 'Reuniones', hint: 'Prioriza reuniones calificadas' },
  { value: 'positive_replies', label: 'Respuestas', hint: 'Optimiza respuestas positivas' },
  { value: 'pipeline', label: 'Pipeline', hint: 'Empuja oportunidades con valor' },
] as const;

const ENRICHMENT_OPTIONS = [
  { value: 'basic', label: 'Basico', hint: 'Email verificado y datos clave' },
  { value: 'deep', label: 'Profundo', hint: 'Mas contexto comercial y señales' },
] as const;

const EYEBROW_CLASSNAME = 'text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80';
const PANEL_CLASSNAME = 'rounded-[30px] border border-border/60 bg-background/78 p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.28)] backdrop-blur-sm dark:bg-card/60 dark:shadow-[0_24px_60px_-36px_rgba(2,6,23,0.78)]';
const SUBPANEL_CLASSNAME = 'rounded-[24px] border border-border/60 bg-muted/35 p-4 backdrop-blur-sm';
const METRIC_CARD_CLASSNAME = 'rounded-[24px] border border-border/60 bg-gradient-to-b from-background/95 to-muted/35 p-4 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.32)] dark:from-card/80 dark:to-muted/20 dark:shadow-[0_16px_40px_-32px_rgba(2,6,23,0.82)]';
const FIELD_CLASSNAME = 'h-11 rounded-2xl border-border/70 bg-background/85 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.28)] focus-visible:border-primary/35 focus-visible:ring-[3px] focus-visible:ring-primary/15 dark:bg-background/60 dark:shadow-none';
const TEXTAREA_CLASSNAME = 'min-h-[108px] rounded-2xl border-border/70 bg-background/85 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.28)] focus-visible:border-primary/35 focus-visible:ring-[3px] focus-visible:ring-primary/15 dark:bg-background/60 dark:shadow-none';

const GOAL_STATUS_META = {
  achieved: { label: 'Objetivo cumplido', className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' },
  on_track: { label: 'En curso', className: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300' },
  at_risk: { label: 'En riesgo', className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' },
} as const;

function fromMission(mission: MissionLike | null): FormState {
  const p = mission?.params || {};
  return {
    title: mission?.title || '',
    goalSummary: mission?.goalSummary || '',
    jobTitle: p.jobTitle || '',
    location: p.location || '',
    industry: p.industry || '',
    keywords: p.keywords || '',
    companySize: p.companySize || '',
    senioritiesText: Array.isArray(p.seniorities) ? p.seniorities.join(', ') : '',
    targetOutcome: p.targetOutcome === 'positive_replies' || p.targetOutcome === 'pipeline' ? p.targetOutcome : 'meetings',
    targetMeetings: Number(p.targetMeetings || 5),
    targetPositiveReplies: Number(p.targetPositiveReplies || 12),
    targetPipelineValue: Number(p.targetPipelineValue || 10000),
    targetTimelineDays: Number(p.targetTimelineDays || 30),
    idealCustomerProfile: p.idealCustomerProfile || '',
    valueProposition: p.valueProposition || '',
    applyIcpFilter: p.applyIcpFilter !== false,
    enrichmentLevel: p.enrichmentLevel === 'deep' ? 'deep' : 'basic',
    campaignName: p.campaignName || '',
    campaignContext: p.campaignContext || '',
    dailySearchLimit: Number(p.dailySearchLimit || 1),
    dailyEnrichLimit: Number(p.dailyEnrichLimit || 10),
    dailyInvestigateLimit: Number(p.dailyInvestigateLimit || 5),
    dailyContactLimit: Number(p.dailyContactLimit || 3),
  };
}

function mergePatchIntoForm(form: FormState, patch: any): FormState {
  if (!patch || typeof patch !== 'object') return form;
  const next = { ...form };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'seniorities') {
      next.senioritiesText = Array.isArray(v) ? v.join(', ') : String(v || '');
      continue;
    }
    if (k in next) {
      (next as any)[k] = v as any;
    }
  }
  return next;
}

export function MissionTunerDialog({
  open,
  onOpenChange,
  mission,
  onMissionUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mission: MissionLike | null;
  onMissionUpdated?: (mission: any) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [intel, setIntel] = useState<IntelligenceResponse | null>(null);
  const [form, setForm] = useState<FormState>(() => fromMission(mission));

  useEffect(() => {
    setForm(fromMission(mission));
  }, [mission]);

  useEffect(() => {
    const missionId = mission?.id;
    if (!open || !missionId) return;
    let mounted = true;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/antonia/missions/${missionId}/intelligence`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'No se pudo cargar inteligencia de misión');
        if (!mounted) return;
        setIntel(data);
        setForm((prev) => mergePatchIntoForm(mergePatchIntoForm(prev, {
          dailySearchLimit: data?.mission?.limits?.dailySearchLimit,
          dailyEnrichLimit: data?.mission?.limits?.dailyEnrichLimit,
          dailyInvestigateLimit: data?.mission?.limits?.dailyInvestigateLimit,
          dailyContactLimit: data?.mission?.limits?.dailyContactLimit,
        }), data?.mission?.params || {}));
      } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudo analizar la misión' });
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [open, mission?.id, toast]);

  const metrics = intel?.metrics || {};
  const currentOutcome = TARGET_OUTCOME_OPTIONS.find((option) => option.value === form.targetOutcome) || TARGET_OUTCOME_OPTIONS[0];

  const seniorities = useMemo(
    () => form.senioritiesText.split(',').map((s) => s.trim()).filter(Boolean),
    [form.senioritiesText]
  );

  const applySuggestedPatch = () => {
    if (!intel?.suggestedPatch) return;
    setForm((prev) => mergePatchIntoForm(prev, intel.suggestedPatch));
    toast({ title: 'Sugerencia cargada', description: 'Puedes revisar y guardar los cambios.' });
  };

  const save = async () => {
    const missionId = mission?.id;
    if (!missionId) return;
    setSaving(true);
    try {
      const updates = {
        title: form.title,
        goalSummary: form.goalSummary,
        jobTitle: form.jobTitle,
        location: form.location,
        industry: form.industry,
        keywords: form.keywords,
        companySize: form.companySize,
        seniorities,
        targetOutcome: form.targetOutcome,
        targetMeetings: Number(form.targetMeetings),
        targetPositiveReplies: Number(form.targetPositiveReplies),
        targetPipelineValue: Number(form.targetPipelineValue),
        targetTimelineDays: Number(form.targetTimelineDays),
        idealCustomerProfile: form.idealCustomerProfile,
        valueProposition: form.valueProposition,
        applyIcpFilter: form.applyIcpFilter,
        enrichmentLevel: form.enrichmentLevel,
        campaignName: form.campaignName,
        campaignContext: form.campaignContext,
        dailySearchLimit: Number(form.dailySearchLimit),
        dailyEnrichLimit: Number(form.dailyEnrichLimit),
        dailyInvestigateLimit: Number(form.dailyInvestigateLimit),
        dailyContactLimit: Number(form.dailyContactLimit),
      };

      const res = await fetch(`/api/antonia/missions/${missionId}/intelligence`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'No se pudo guardar ajustes');

      setIntel(data);
      onMissionUpdated?.(data.mission);
      toast({
        title: 'Misión ajustada',
        description: `Cambios aplicados. Tareas pendientes actualizadas: ${data.patchedPendingTasks || 0}`,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudieron guardar los cambios' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl border-0 bg-transparent p-0 shadow-none [&>button]:right-6 [&>button]:top-6 [&>button]:rounded-full [&>button]:border [&>button]:border-border/60 [&>button]:bg-background/85 [&>button]:p-2 [&>button]:text-muted-foreground [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:backdrop-blur-md data-[state=open]:[&>button]:bg-background/90">
        <div className="relative overflow-hidden rounded-[32px] border border-border/60 bg-background/95 shadow-[0_30px_80px_-32px_rgba(15,23,42,0.35)] dark:shadow-[0_30px_80px_-32px_rgba(2,6,23,0.9)]">
          <div className="pointer-events-none absolute -left-10 top-0 h-36 w-36 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-500/10" />
          <div className="pointer-events-none absolute right-8 top-8 h-40 w-40 rounded-full bg-indigo-200/30 blur-3xl dark:bg-indigo-500/10" />

          <DialogHeader className="relative border-b border-border/60 bg-background/60 px-6 py-6 text-left backdrop-blur-xl md:px-8 md:py-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
                  Edicion IA
                </div>
                <DialogTitle className="flex items-center gap-3 text-xl font-semibold tracking-tight text-foreground">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground text-background shadow-lg shadow-black/10 dark:shadow-black/30">
                <SlidersHorizontal className="h-4 w-4" />
              </span>
                  Ajuste inteligente de mision
                </DialogTitle>
                <DialogDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Ajusta audiencia, ICP, limites y outreach desde un panel mas preciso. Los cambios impactan la mision y sus tareas pendientes.
                </DialogDescription>
              </div>

              {mission && (
                <div className="w-full max-w-sm rounded-[26px] border border-border/60 bg-background/72 p-4 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.35)] backdrop-blur-sm dark:shadow-[0_20px_50px_-36px_rgba(2,6,23,0.8)]">
                  <div className={EYEBROW_CLASSNAME}>Mision en edicion</div>
                  <div className="mt-2 line-clamp-2 text-sm font-semibold tracking-tight text-foreground">{mission.title}</div>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                    {mission.goalSummary || 'Refina el enfoque sin perder el contexto actual de la mision.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full border border-border/60 bg-muted/45 px-3 py-1 text-muted-foreground">{currentOutcome.label}</span>
                    <span className="rounded-full border border-border/60 bg-muted/45 px-3 py-1 text-muted-foreground">
                      {form.applyIcpFilter ? 'ICP activo' : 'ICP libre'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </DialogHeader>

          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analizando misión...
            </div>
          ) : (
            <div className="max-h-[78vh] overflow-y-auto bg-muted/[0.18] px-6 py-6 md:px-8 md:py-7">
              <div className="space-y-6">
                <div className={PANEL_CLASSNAME}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                        <Sparkles className="h-3.5 w-3.5" /> Razonamiento ANTONIA
                      </div>
                      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                        {intel?.reasoning || 'Sin sugerencias por ahora.'}
                      </p>
                    </div>
                    {intel?.suggestedPatch && Object.keys(intel.suggestedPatch).length > 0 && (
                      <Button size="sm" variant="secondary" className="rounded-full border border-border/60 bg-background/80 px-4 text-foreground shadow-sm backdrop-blur-sm" onClick={applySuggestedPatch}>
                        <WandSparkles className="mr-2 h-4 w-4" /> Aplicar patch recomendado
                      </Button>
                    )}
                  </div>

                  {intel?.recommendations?.length ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {intel.recommendations.map((rec) => (
                        <div key={rec.id} className={cn(SUBPANEL_CLASSNAME, 'text-xs shadow-sm')}>
                          <div className="flex items-center justify-between gap-2 text-foreground">
                            <span className="font-medium">{rec.title}</span>
                            <Badge variant="outline" className="rounded-full border-border/60 bg-background/80">{Math.round(rec.confidence * 100)}%</Badge>
                          </div>
                          <div className="mt-2 leading-5 text-muted-foreground">{rec.why}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                  <div className="space-y-6">
                    <section className={PANEL_CLASSNAME}>
                      <div className="mb-4 space-y-1">
                        <div className={EYEBROW_CLASSNAME}>Targeting</div>
                        <h3 className="text-base font-semibold text-foreground">Audiencia y targeting</h3>
                        <p className="text-sm text-muted-foreground">Define a quien debe buscar la mision y que filtros duros deben respetarse.</p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Nombre misión</Label>
                          <Input className={FIELD_CLASSNAME} value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Cargo objetivo</Label>
                          <Input className={FIELD_CLASSNAME} value={form.jobTitle} onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Ubicación</Label>
                          <Input className={FIELD_CLASSNAME} value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Industria</Label>
                          <Input className={FIELD_CLASSNAME} value={form.industry} onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Tamaño empresa</Label>
                          <Select value={form.companySize} onValueChange={(value) => setForm((p) => ({ ...p, companySize: value }))}>
                            <SelectTrigger className={FIELD_CLASSNAME}>
                              <SelectValue placeholder="Seleccionar tamaño" />
                            </SelectTrigger>
                            <SelectContent>
                              {companySizes.map((size) => (
                                <SelectItem key={size} value={size}>{size.replace('+', ' o más')}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Seniorities (coma)</Label>
                          <Input className={FIELD_CLASSNAME} value={form.senioritiesText} onChange={(e) => setForm((p) => ({ ...p, senioritiesText: e.target.value }))} />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Keywords</Label>
                          <Input className={FIELD_CLASSNAME} value={form.keywords} onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))} />
                        </div>
                      </div>
                    </section>

                    <section className={PANEL_CLASSNAME}>
                      <div className="mb-4 space-y-1">
                        <div className={EYEBROW_CLASSNAME}>Narrativa</div>
                        <h3 className="text-base font-semibold text-foreground">ICP y narrativa comercial</h3>
                        <p className="text-sm text-muted-foreground">Haz que Mission IA use mejor el ICP real y la propuesta de valor correcta.</p>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Outcome principal</Label>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {TARGET_OUTCOME_OPTIONS.map((option) => {
                              const active = form.targetOutcome === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setForm((p) => ({ ...p, targetOutcome: option.value }))}
                                   className={cn(
                                     'rounded-[24px] border px-4 py-3 text-left transition backdrop-blur-sm',
                                     active
                                       ? 'border-foreground/80 bg-foreground text-background shadow-lg shadow-black/10 dark:shadow-black/30'
                                       : 'border-border/60 bg-muted/35 text-foreground hover:border-border hover:bg-background/70'
                                   )}
                                 >
                                   <div className="text-sm font-medium">{option.label}</div>
                                   <div className={cn('mt-1 text-xs', active ? 'text-background/75' : 'text-muted-foreground')}>{option.hint}</div>
                                 </button>
                               );
                             })}
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <div className="space-y-2">
                            <Label>Timeline objetivo</Label>
                            <Input className={FIELD_CLASSNAME} type="number" min={1} max={365} value={form.targetTimelineDays} onChange={(e) => setForm((p) => ({ ...p, targetTimelineDays: Number(e.target.value || 30) }))} />
                          </div>
                          <div className="space-y-2">
                            <Label>Meetings target</Label>
                            <Input className={FIELD_CLASSNAME} type="number" min={1} max={500} value={form.targetMeetings} onChange={(e) => setForm((p) => ({ ...p, targetMeetings: Number(e.target.value || 5) }))} />
                          </div>
                          <div className="space-y-2">
                            <Label>Replies target</Label>
                            <Input className={FIELD_CLASSNAME} type="number" min={1} max={1000} value={form.targetPositiveReplies} onChange={(e) => setForm((p) => ({ ...p, targetPositiveReplies: Number(e.target.value || 12) }))} />
                          </div>
                          <div className="space-y-2">
                            <Label>Meta pipeline</Label>
                            <Input className={FIELD_CLASSNAME} type="number" min={1} value={form.targetPipelineValue} onChange={(e) => setForm((p) => ({ ...p, targetPipelineValue: Number(e.target.value || 10000) }))} />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>ICP ideal</Label>
                          <Textarea className={TEXTAREA_CLASSNAME} rows={4} value={form.idealCustomerProfile} onChange={(e) => setForm((p) => ({ ...p, idealCustomerProfile: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Propuesta de valor</Label>
                          <Textarea className={TEXTAREA_CLASSNAME} rows={4} value={form.valueProposition} onChange={(e) => setForm((p) => ({ ...p, valueProposition: e.target.value }))} />
                        </div>
                        <div className={SUBPANEL_CLASSNAME}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                              <Label>Aplicar filtro ICP después del search</Label>
                              <p className="text-xs leading-5 text-muted-foreground">Si lo apagas, la mision guardara los leads del search sin descartarlos por el segundo filtro de calificacion.</p>
                            </div>
                            <Switch checked={form.applyIcpFilter} onCheckedChange={(checked) => setForm((p) => ({ ...p, applyIcpFilter: checked }))} />
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>

                  <div className="space-y-6">
                    <section className={PANEL_CLASSNAME}>
                      <div className="mb-4 space-y-1">
                        <div className={EYEBROW_CLASSNAME}>Outreach</div>
                        <h3 className="text-base font-semibold text-foreground">Outreach y campana</h3>
                        <p className="text-sm text-muted-foreground">Controla como se construye el contexto comercial y cuanta data adicional pides.</p>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Nivel enriquecimiento</Label>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {ENRICHMENT_OPTIONS.map((option) => {
                              const active = form.enrichmentLevel === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setForm((p) => ({ ...p, enrichmentLevel: option.value }))}
                                   className={cn(
                                     'rounded-[24px] border px-4 py-3 text-left transition backdrop-blur-sm',
                                     active
                                       ? 'border-foreground/80 bg-foreground text-background shadow-lg shadow-black/10 dark:shadow-black/30'
                                       : 'border-border/60 bg-muted/35 text-foreground hover:border-border hover:bg-background/70'
                                   )}
                                 >
                                   <div className="text-sm font-medium">{option.label}</div>
                                   <div className={cn('mt-1 text-xs', active ? 'text-background/75' : 'text-muted-foreground')}>{option.hint}</div>
                                 </button>
                               );
                             })}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>Campaña</Label>
                          <Input className={FIELD_CLASSNAME} value={form.campaignName} onChange={(e) => setForm((p) => ({ ...p, campaignName: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Contexto campaña</Label>
                          <Textarea className={TEXTAREA_CLASSNAME} rows={4} value={form.campaignContext} onChange={(e) => setForm((p) => ({ ...p, campaignContext: e.target.value }))} />
                        </div>
                      </div>
                    </section>

                    <section className={PANEL_CLASSNAME}>
                      <div className="mb-4 space-y-1">
                        <div className={EYEBROW_CLASSNAME}>Capacidad</div>
                        <h3 className="text-base font-semibold text-foreground">Presupuesto operativo diario</h3>
                        <p className="text-sm text-muted-foreground">Ajusta capacidad con limites claros antes de relanzar la mision.</p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Límite búsqueda/día (1-5)</Label>
                          <Input className={FIELD_CLASSNAME} type="number" min={1} max={5} value={form.dailySearchLimit} onChange={(e) => setForm((p) => ({ ...p, dailySearchLimit: Number(e.target.value || 1) }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Límite enriq./día (1-50)</Label>
                          <Input className={FIELD_CLASSNAME} type="number" min={1} max={50} value={form.dailyEnrichLimit} onChange={(e) => setForm((p) => ({ ...p, dailyEnrichLimit: Number(e.target.value || 1) }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Límite investig./día (1-50)</Label>
                          <Input className={FIELD_CLASSNAME} type="number" min={1} max={50} value={form.dailyInvestigateLimit} onChange={(e) => setForm((p) => ({ ...p, dailyInvestigateLimit: Number(e.target.value || 1) }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Límite contacto/día (1-50)</Label>
                          <Input className={FIELD_CLASSNAME} type="number" min={1} max={50} value={form.dailyContactLimit} onChange={(e) => setForm((p) => ({ ...p, dailyContactLimit: Number(e.target.value || 1) }))} />
                        </div>
                      </div>
                    </section>
                  </div>
                </div>

                <Separator className="bg-border/70" />

                <div className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                  <div className={METRIC_CARD_CLASSNAME}>
                    <div className="text-muted-foreground">Search 24h</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">{metrics.searchRuns24h ?? 0}</div>
                  </div>
                  <div className={METRIC_CARD_CLASSNAME}>
                    <div className="text-muted-foreground">Found 24h</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">{metrics.found24h ?? 0}</div>
                  </div>
                  <div className={METRIC_CARD_CLASSNAME}>
                    <div className="text-muted-foreground">Investigados 24h</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">{metrics.investigated24h ?? 0}</div>
                  </div>
                  <div className={METRIC_CARD_CLASSNAME}>
                    <div className="text-muted-foreground">Contactados hoy</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">{metrics.orgContactsToday ?? 0}</div>
                  </div>
                </div>

                {(intel?.goalProgress || intel?.allocatorPlan) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {intel?.goalProgress && (
                      <div className={cn(METRIC_CARD_CLASSNAME, 'text-sm')}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">Progreso de meta</span>
                          <Badge variant="outline" className={cn('rounded-full border', GOAL_STATUS_META[intel.goalProgress.status].className)}>
                            {GOAL_STATUS_META[intel.goalProgress.status].label}
                          </Badge>
                        </div>
                        <div className="mt-3 text-foreground">
                          {intel.goalProgress.achieved}/{intel.goalProgress.target} {intel.goalProgress.label.toLowerCase()}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">Gap: {intel.goalProgress.gap} · Avance: {intel.goalProgress.progressPct}%</div>
                      </div>
                    )}
                    {intel?.allocatorPlan && (
                      <div className={cn(METRIC_CARD_CLASSNAME, 'text-sm')}>
                        <div className="font-medium text-foreground">Allocator recomendado</div>
                        <div className="mt-2 text-xs leading-5 text-muted-foreground">{intel.allocatorPlan.rationale}</div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-foreground/80">
                          <div>Search: {intel.allocatorPlan.current.dailySearchLimit} → {intel.allocatorPlan.recommended.dailySearchLimit}</div>
                          <div>Enrich: {intel.allocatorPlan.current.dailyEnrichLimit} → {intel.allocatorPlan.recommended.dailyEnrichLimit}</div>
                          <div>Investigate: {intel.allocatorPlan.current.dailyInvestigateLimit} → {intel.allocatorPlan.recommended.dailyInvestigateLimit}</div>
                          <div>Contact: {intel.allocatorPlan.current.dailyContactLimit} → {intel.allocatorPlan.recommended.dailyContactLimit}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-2 flex justify-end gap-3 border-t border-border/60 pt-5">
                  <Button variant="outline" className="rounded-full border-border/60 bg-background/85 px-5 backdrop-blur-sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
                  <Button className="rounded-full bg-foreground px-5 text-background shadow-lg shadow-black/10 hover:opacity-95 dark:shadow-black/30" onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar ajustes inteligentes
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
