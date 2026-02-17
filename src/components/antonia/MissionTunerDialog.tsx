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
  enrichmentLevel: 'basic' | 'deep';
  campaignName: string;
  campaignContext: string;
  dailySearchLimit: number;
  dailyEnrichLimit: number;
  dailyInvestigateLimit: number;
  dailyContactLimit: number;
};

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
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" />
            Ajuste inteligente de misión
          </DialogTitle>
          <DialogDescription>
            Modifica parámetros en caliente. Los cambios impactan misión y tareas pendientes.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Analizando misión...
          </div>
        ) : (
          <div className="space-y-5">
            <div className="p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  {intel?.reasoning || 'Sin sugerencias por ahora.'}
                </div>
                {intel?.suggestedPatch && Object.keys(intel.suggestedPatch).length > 0 && (
                  <Button size="sm" variant="secondary" onClick={applySuggestedPatch}>
                    <WandSparkles className="w-4 h-4 mr-2" /> Aplicar patch recomendado
                  </Button>
                )}
              </div>

              {intel?.recommendations?.length ? (
                <div className="mt-3 space-y-2">
                  {intel.recommendations.map((rec) => (
                    <div key={rec.id} className="text-xs rounded border bg-background p-2">
                      <div className="font-medium flex items-center justify-between gap-2">
                        <span>{rec.title}</span>
                        <Badge variant="outline">{Math.round(rec.confidence * 100)}%</Badge>
                      </div>
                      <div className="text-muted-foreground mt-1">{rec.why}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre misión</Label>
                <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Cargo objetivo</Label>
                <Input value={form.jobTitle} onChange={(e) => setForm((p) => ({ ...p, jobTitle: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Ubicación</Label>
                <Input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Industria</Label>
                <Input value={form.industry} onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Keywords</Label>
                <Input value={form.keywords} onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Tamaño empresa</Label>
                <Input value={form.companySize} onChange={(e) => setForm((p) => ({ ...p, companySize: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Seniorities (coma)</Label>
                <Input value={form.senioritiesText} onChange={(e) => setForm((p) => ({ ...p, senioritiesText: e.target.value }))} />
              </div>

              <div className="space-y-2">
                <Label>Nivel enriquecimiento</Label>
                <Select value={form.enrichmentLevel} onValueChange={(v) => setForm((p) => ({ ...p, enrichmentLevel: v as 'basic' | 'deep' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="deep">Deep</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Campaña</Label>
                <Input value={form.campaignName} onChange={(e) => setForm((p) => ({ ...p, campaignName: e.target.value }))} />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Contexto campaña</Label>
                <Textarea rows={3} value={form.campaignContext} onChange={(e) => setForm((p) => ({ ...p, campaignContext: e.target.value }))} />
              </div>

              <div className="space-y-2">
                <Label>Límite búsqueda/día (1-5)</Label>
                <Input type="number" min={1} max={5} value={form.dailySearchLimit} onChange={(e) => setForm((p) => ({ ...p, dailySearchLimit: Number(e.target.value || 1) }))} />
              </div>
              <div className="space-y-2">
                <Label>Límite enriq./día (1-50)</Label>
                <Input type="number" min={1} max={50} value={form.dailyEnrichLimit} onChange={(e) => setForm((p) => ({ ...p, dailyEnrichLimit: Number(e.target.value || 1) }))} />
              </div>
              <div className="space-y-2">
                <Label>Límite investig./día (1-50)</Label>
                <Input type="number" min={1} max={50} value={form.dailyInvestigateLimit} onChange={(e) => setForm((p) => ({ ...p, dailyInvestigateLimit: Number(e.target.value || 1) }))} />
              </div>
              <div className="space-y-2">
                <Label>Límite contacto/día (1-50)</Label>
                <Input type="number" min={1} max={50} value={form.dailyContactLimit} onChange={(e) => setForm((p) => ({ ...p, dailyContactLimit: Number(e.target.value || 1) }))} />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-2 rounded border bg-muted/20">
                <div className="text-muted-foreground">Search 24h</div>
                <div className="font-semibold">{metrics.searchRuns24h ?? 0}</div>
              </div>
              <div className="p-2 rounded border bg-muted/20">
                <div className="text-muted-foreground">Found 24h</div>
                <div className="font-semibold">{metrics.found24h ?? 0}</div>
              </div>
              <div className="p-2 rounded border bg-muted/20">
                <div className="text-muted-foreground">Investigados 24h</div>
                <div className="font-semibold">{metrics.investigated24h ?? 0}</div>
              </div>
              <div className="p-2 rounded border bg-muted/20">
                <div className="text-muted-foreground">Contactados hoy</div>
                <div className="font-semibold">{metrics.orgContactsToday ?? 0}</div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Guardar ajustes inteligentes
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
