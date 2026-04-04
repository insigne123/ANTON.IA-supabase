'use client';

import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Sparkles, Loader2, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { companySizes } from '@/lib/data';

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
  enrichmentLevel: 'basic' | 'deep';
  campaignName: string;
  campaignContext: string;
  dailySearchLimit: number;
  dailyEnrichLimit: number;
  dailyInvestigateLimit: number;
  dailyContactLimit: number;
};

const TARGET_OUTCOME_OPTIONS = [
  { value: 'meetings', label: 'Meetings', hint: 'Prioriza reuniones calificadas' },
  { value: 'positive_replies', label: 'Replies', hint: 'Optimiza respuestas positivas' },
  { value: 'pipeline', label: 'Pipeline', hint: 'Empuja oportunidades con valor' },
] as const;

const ENRICHMENT_OPTIONS = [
  { value: 'basic', label: 'Basico', hint: 'Email verificado y datos clave' },
  { value: 'deep', label: 'Profundo', hint: 'Mas contexto comercial y señales' },
] as const;

const FIELD_CLASSNAME = 'h-11 rounded-2xl border-slate-200 bg-white/90 shadow-sm shadow-slate-100 focus-visible:ring-slate-300';
const TEXTAREA_CLASSNAME = 'min-h-[108px] rounded-2xl border-slate-200 bg-white/90 shadow-sm shadow-slate-100 focus-visible:ring-slate-300';

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
      <DialogContent className="max-w-5xl border-0 bg-transparent p-0 shadow-none">
        <div className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_22%,#f8fafc_100%)] shadow-[0_30px_80px_-32px_rgba(15,23,42,0.35)]">
          <DialogHeader className="border-b border-slate-200/80 bg-[radial-gradient(circle_at_top_left,#dbeafe_0,#f8fbff_32%,#ffffff_72%)] px-6 py-6 md:px-8 md:py-7 text-left">
            <DialogTitle className="flex items-center gap-3 text-xl font-semibold tracking-tight text-slate-900">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-300/60">
                <SlidersHorizontal className="h-4 w-4" />
              </span>
              Ajuste inteligente de misión
            </DialogTitle>
            <DialogDescription className="max-w-2xl text-sm leading-6 text-slate-600">
              Ajusta audiencia, ICP, límites y outreach desde un panel más preciso. Los cambios impactan misión y tareas pendientes.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analizando misión...
            </div>
          ) : (
            <div className="max-h-[78vh] overflow-y-auto px-6 py-6 md:px-8 md:py-7">
              <div className="space-y-6">
                <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.5)] backdrop-blur">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                        <Sparkles className="h-3.5 w-3.5" /> Razonamiento ANTONIA
                      </div>
                      <p className="max-w-2xl text-sm leading-6 text-slate-600">
                        {intel?.reasoning || 'Sin sugerencias por ahora.'}
                      </p>
                    </div>
                    {intel?.suggestedPatch && Object.keys(intel.suggestedPatch).length > 0 && (
                      <Button size="sm" variant="secondary" className="rounded-full border border-slate-200 bg-white px-4 text-slate-700 shadow-sm" onClick={applySuggestedPatch}>
                        <WandSparkles className="mr-2 h-4 w-4" /> Aplicar patch recomendado
                      </Button>
                    )}
                  </div>

                  {intel?.recommendations?.length ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {intel.recommendations.map((rec) => (
                        <div key={rec.id} className="rounded-3xl border border-slate-200/80 bg-slate-50/80 p-4 text-xs shadow-sm">
                          <div className="flex items-center justify-between gap-2 text-slate-900">
                            <span className="font-medium">{rec.title}</span>
                            <Badge variant="outline" className="rounded-full border-slate-300 bg-white">{Math.round(rec.confidence * 100)}%</Badge>
                          </div>
                          <div className="mt-2 leading-5 text-slate-500">{rec.why}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                  <div className="space-y-6">
                    <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.42)]">
                      <div className="mb-4 space-y-1">
                        <h3 className="text-base font-semibold text-slate-900">Audiencia y targeting</h3>
                        <p className="text-sm text-slate-500">Define a quién debe buscar la misión y qué filtros duros deben respetarse.</p>
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

                    <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.42)]">
                      <div className="mb-4 space-y-1">
                        <h3 className="text-base font-semibold text-slate-900">ICP y narrativa comercial</h3>
                        <p className="text-sm text-slate-500">Haz que Mission IA use mejor el ICP real y la propuesta de valor correcta.</p>
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
                                  className={`rounded-3xl border px-4 py-3 text-left transition ${active
                                    ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-300/60'
                                    : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-white'}`}
                                >
                                  <div className="text-sm font-medium">{option.label}</div>
                                  <div className={`mt-1 text-xs ${active ? 'text-slate-200' : 'text-slate-500'}`}>{option.hint}</div>
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
                      </div>
                    </section>
                  </div>

                  <div className="space-y-6">
                    <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.42)]">
                      <div className="mb-4 space-y-1">
                        <h3 className="text-base font-semibold text-slate-900">Outreach y campaña</h3>
                        <p className="text-sm text-slate-500">Controla cómo se construye el contexto comercial y cuánta data adicional pides.</p>
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
                                  className={`rounded-3xl border px-4 py-3 text-left transition ${active
                                    ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-300/60'
                                    : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-white'}`}
                                >
                                  <div className="text-sm font-medium">{option.label}</div>
                                  <div className={`mt-1 text-xs ${active ? 'text-slate-200' : 'text-slate-500'}`}>{option.hint}</div>
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

                    <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.42)]">
                      <div className="mb-4 space-y-1">
                        <h3 className="text-base font-semibold text-slate-900">Presupuesto operativo diario</h3>
                        <p className="text-sm text-slate-500">Ajusta capacidad con límites claros antes de relanzar la misión.</p>
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

                <Separator className="bg-slate-200/80" />

                <div className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
                    <div className="text-slate-500">Search 24h</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{metrics.searchRuns24h ?? 0}</div>
                  </div>
                  <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
                    <div className="text-slate-500">Found 24h</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{metrics.found24h ?? 0}</div>
                  </div>
                  <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
                    <div className="text-slate-500">Investigados 24h</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{metrics.investigated24h ?? 0}</div>
                  </div>
                  <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
                    <div className="text-slate-500">Contactados hoy</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{metrics.orgContactsToday ?? 0}</div>
                  </div>
                </div>

                {(intel?.goalProgress || intel?.allocatorPlan) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {intel?.goalProgress && (
                      <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-4 text-sm shadow-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-900">Progreso de meta</span>
                          <Badge variant={intel.goalProgress.status === 'achieved' ? 'default' : intel.goalProgress.status === 'on_track' ? 'secondary' : 'outline'} className="rounded-full">
                            {intel.goalProgress.status}
                          </Badge>
                        </div>
                        <div className="mt-3 text-slate-600">
                          {intel.goalProgress.achieved}/{intel.goalProgress.target} {intel.goalProgress.label.toLowerCase()}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">Gap: {intel.goalProgress.gap} · Avance: {intel.goalProgress.progressPct}%</div>
                      </div>
                    )}
                    {intel?.allocatorPlan && (
                      <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-4 text-sm shadow-sm">
                        <div className="font-medium text-slate-900">Allocator recomendado</div>
                        <div className="mt-2 text-xs leading-5 text-slate-500">{intel.allocatorPlan.rationale}</div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                          <div>Search: {intel.allocatorPlan.current.dailySearchLimit} → {intel.allocatorPlan.recommended.dailySearchLimit}</div>
                          <div>Enrich: {intel.allocatorPlan.current.dailyEnrichLimit} → {intel.allocatorPlan.recommended.dailyEnrichLimit}</div>
                          <div>Investigate: {intel.allocatorPlan.current.dailyInvestigateLimit} → {intel.allocatorPlan.recommended.dailyInvestigateLimit}</div>
                          <div>Contact: {intel.allocatorPlan.current.dailyContactLimit} → {intel.allocatorPlan.recommended.dailyContactLimit}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" className="rounded-full border-slate-300 bg-white px-5" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
                  <Button className="rounded-full bg-slate-900 px-5 text-white shadow-lg shadow-slate-300/60 hover:bg-slate-800" onClick={save} disabled={saving}>
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
