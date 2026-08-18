'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { campaignsStorage, type CampaignStep } from '@/lib/services/campaigns-service';
// UI-compatible Campaign type from service
import type { Campaign } from '@/lib/services/campaigns-service';

import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, Eye, FileText, Loader2, MessageSquare, MoreHorizontal, Pause, Play, Plus, Search as SearchIcon, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import { computeEligibilityForCampaign, type EligiblePreviewRow } from '@/lib/campaign-eligibility';
import type { ContactedLead } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CommentsSection } from '@/components/comments-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { CampaignAnalytics } from '@/components/campaigns/CampaignAnalytics';
import { CampaignFlow } from '@/components/campaigns/CampaignFlow';
import { cn } from '@/lib/utils';
import { assessCampaignDraftReadiness } from '@/lib/campaign-qa';
import { profileService } from '@/lib/services/profile-service';
import {
  type CampaignRunStatus,
  type CampaignType,
  createDefaultCampaignSettings,
  defaultCampaignReactivationSettings,
  evaluateLeadForReactivation,
  inferCampaignType,
  type CampaignReconnectionBrief,
  type CampaignReconnectionSettings,
  type CampaignReactivationSettings,
} from '@/lib/campaign-settings';

type Mode = { kind: 'list' } | { kind: 'edit'; id?: string };

type DraftStep = CampaignStep;

function buildDraftStep(index = 0, campaignType: CampaignType = 'reconnection'): DraftStep {
  const isReconnection = campaignType === 'reconnection';
  return {
    id: crypto.randomUUID(),
    name: index === 0 ? (isReconnection ? 'Reactivacion inicial' : 'Follow-up inicial') : (isReconnection ? `Reactivacion ${index + 1}` : `Follow-up ${index + 1}`),
    offsetDays: index === 0 ? (isReconnection ? 0 : 3) : 3,
    subject: '',
    bodyHtml: '',
    attachments: [],
  };
}

function buildDraftState(campaignType: CampaignType = 'reconnection') {
  const isReconnection = campaignType === 'reconnection';
  return {
    campaignType,
    name: isReconnection ? 'Campaña de reconexion' : 'Campaña de seguimiento',
    steps: [buildDraftStep(0, campaignType)],
    excludedLeadIds: [] as string[],
    settings: createDefaultCampaignSettings({ withReactivationAudience: isReconnection, campaignType }),
  };
}

function getCampaignTypeLabel(campaignType: CampaignType) {
  return campaignType === 'reconnection' ? 'Reconexión' : 'Seguimiento';
}

function formatRunStatusLabel(status?: CampaignRunStatus | null) {
  switch (status) {
    case 'success': return 'OK';
    case 'partial': return 'Parcial';
    case 'failed': return 'Con fallos';
    case 'skipped': return 'Sin ejecutar';
    case 'idle': return 'Sin elegibles';
    default: return 'Sin ejecuciones';
  }
}

function formatRunAt(value?: string | null) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return date.toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function getContactLeadKey(lead: Partial<ContactedLead>) {
  return String(lead.leadId || lead.id || '').trim();
}

function getReactivationSummary(settings: CampaignReactivationSettings) {
  const segments: string[] = [];
  if (settings.includeClickedNoReply) segments.push('click');
  if (settings.includeOpenedNoReply) segments.push('apertura');
  if (settings.includeDeliveredNoOpen) segments.push('entregado');
  if (settings.includeNeutralReplies) segments.push('reply neutral');
  if (settings.includeNoSignal) segments.push('sin señal');
  return segments.length > 0 ? segments.join(' · ') : 'sin segmentos activos';
}

function toValuePointsText(points: string[]) {
  return (points || []).join('\n');
}

function parseValuePoints(value: string) {
  return String(value || '')
    .split(/\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatPreviewDate(value: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

import { useAuth } from '@/context/AuthContext';

export default function CampaignsPage() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [items, setItems] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);
  const [previewRows, setPreviewRows] = useState<EligiblePreviewRow[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  // AI Generation State
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiGoal, setAiGoal] = useState('');
  const [aiAudience, setAiAudience] = useState('');

  // View Mode
  const [viewMode, setViewMode] = useState<'list' | 'flow'>('list');
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [advancedBriefOpen, setAdvancedBriefOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [deliverySettingsOpen, setDeliverySettingsOpen] = useState(false);
  const [exclusionsOpen, setExclusionsOpen] = useState(false);

  // Selección en la tabla de previsualización
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [eligibleNameFilter, setEligibleNameFilter] = useState('');
  const [eligibleDaysFilter, setEligibleDaysFilter] = useState<'all' | '7' | '14' | '30'>('all');
  const [eligibleStepFilter, setEligibleStepFilter] = useState('all');
  const [eligibleIndustryFilter, setEligibleIndustryFilter] = useState('all');
  const selectedCount = selectedIds.size;
  const previewStepOptions = useMemo(() => Array.from(new Set(previewRows.map((row) => row.nextStep?.name ?? `Paso ${row.nextStepIdx + 1}`))), [previewRows]);
  const previewIndustryOptions = useMemo(() => Array.from(new Set(previewRows.map((row) => String(row.leadIndustry || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [previewRows]);
  const filteredPreviewRows = useMemo(() => {
    const query = eligibleNameFilter.trim().toLowerCase();
    return previewRows.filter((row) => {
      const stepLabel = row.nextStep?.name ?? `Paso ${row.nextStepIdx + 1}`;
      const matchesName = !query || [row.leadName, row.leadEmail, row.leadCompany].some((value) => String(value || '').toLowerCase().includes(query));
      const matchesDays = eligibleDaysFilter === 'all' || row.daysSinceLastContact >= Number(eligibleDaysFilter);
      const matchesStep = eligibleStepFilter === 'all' || stepLabel === eligibleStepFilter;
      const matchesIndustry = eligibleIndustryFilter === 'all' || row.leadIndustry === eligibleIndustryFilter;
      return matchesName && matchesDays && matchesStep && matchesIndustry;
    });
  }, [previewRows, eligibleNameFilter, eligibleDaysFilter, eligibleStepFilter, eligibleIndustryFilter]);
  const allSelected = filteredPreviewRows.length > 0 && filteredPreviewRows.every((row) => selectedIds.has(row.leadId));
  const someSelected = filteredPreviewRows.some((row) => selectedIds.has(row.leadId)) && !allSelected;

  // Editor state
  const [draft, setDraft] = useState<{
    id?: string;
    campaignType: CampaignType;
    name: string;
    steps: DraftStep[];
    excludedLeadIds: string[];
    settings: NonNullable<Campaign['settings']>;
  }>(buildDraftState);
  const [campaignTypeFilter, setCampaignTypeFilter] = useState<'all' | CampaignType>('all');

  const [contacted, setContacted] = useState<ContactedLead[]>([]);
  const reactivationAudience = draft.settings.audience?.kind === 'reactivation'
    ? draft.settings.audience.reactivation
    : null;
  const reconnectionSettings = draft.settings.reconnection;
  const draftAudienceHasActiveSegment = reactivationAudience
    ? reactivationAudience.includeOpenedNoReply ||
      reactivationAudience.includeClickedNoReply ||
      reactivationAudience.includeDeliveredNoOpen ||
      reactivationAudience.includeNeutralReplies ||
      reactivationAudience.includeNoSignal
    : draft.campaignType !== 'reconnection';
  const draftReadiness = useMemo(() => assessCampaignDraftReadiness({
    name: draft.name,
    campaignType: draft.campaignType,
    steps: draft.steps,
    offerName: reconnectionSettings.brief.offerName,
    offerSummary: reconnectionSettings.brief.offerSummary,
    hasActiveAudienceSegment: draftAudienceHasActiveSegment,
  }), [draft.campaignType, draft.name, draft.steps, draftAudienceHasActiveSegment, reconnectionSettings.brief.offerName, reconnectionSettings.brief.offerSummary]);

  const metricsByCampaignId = useMemo(() => {
    const leadMap = new Map((contacted || []).map((l: any) => [String(l.leadId || l.id || ''), l]));
    const out: Record<string, { totalSent: number; opened: number; replied: number; clicked: number }> = {};

    for (const campaign of items) {
      const sentLeadIds = Object.keys(campaign.sentRecords || {});
      let opened = 0;
      let replied = 0;
      let clicked = 0;

      for (const id of sentLeadIds) {
        const lead = leadMap.get(String(id));
        if (!lead) continue;
        if (lead.openedAt) opened++;
        if (lead.repliedAt || lead.status === 'replied') replied++;
        if (lead.clickedAt) clicked++;
      }

      out[campaign.id] = {
        totalSent: sentLeadIds.length,
        opened,
        replied,
        clicked,
      };
    }

    return out;
  }, [contacted, items]);

  const filteredItems = useMemo(() => {
    return items.filter((campaign) => campaignTypeFilter === 'all' || campaign.campaignType === campaignTypeFilter);
  }, [campaignTypeFilter, items]);

  const campaignOverview = useMemo(() => {
    const active = items.filter((campaign) => !campaign.isPaused);
    return {
      total: items.length,
      active: active.length,
      paused: items.length - active.length,
    };
  }, [items]);

  const reactivationStats = useMemo(() => {
    if (!reactivationAudience) return null;

    const excluded = new Set(draft.excludedLeadIds);
    const stats = {
      totalCandidates: 0,
      matched: 0,
      clicked: 0,
      opened: 0,
      delivered: 0,
      neutral: 0,
      noSignal: 0,
      failedDelivery: 0,
      doNotContact: 0,
      noEvidence: 0,
      tooRecent: 0,
    };

    for (const lead of contacted) {
      const leadId = getContactLeadKey(lead);
      if (!leadId || excluded.has(leadId) || !lead.email) continue;

      stats.totalCandidates += 1;
      const evaluation = evaluateLeadForReactivation(lead, reactivationAudience);

      if (evaluation.hasFailedDelivery) stats.failedDelivery += 1;
      if (evaluation.isDoNotContact) stats.doNotContact += 1;
      if (!evaluation.hasDeliveryEvidence) stats.noEvidence += 1;
      if (evaluation.daysSinceLastContact < reactivationAudience.minDaysSinceLastContact) stats.tooRecent += 1;

      if (!evaluation.matched) continue;

      stats.matched += 1;
      if (evaluation.segment === 'clicked_no_reply') stats.clicked += 1;
      if (evaluation.segment === 'opened_no_reply') stats.opened += 1;
      if (evaluation.segment === 'delivered_no_open') stats.delivered += 1;
      if (evaluation.segment === 'neutral_reply') stats.neutral += 1;
      if (evaluation.segment === 'no_signal') stats.noSignal += 1;
    }

    return stats;
  }, [contacted, draft.excludedLeadIds, reactivationAudience]);

  const loadCampaignData = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      setLoadingCampaigns(false);
      return;
    }

    setLoadingCampaigns(true);
    setLoadError(null);
    try {
      const [campaigns, contactedLeads] = await Promise.all([
        campaignsStorage.get(),
        contactedLeadsStorage.get(),
      ]);
      setItems(campaigns);
      setContacted(contactedLeads);
    } catch (error: any) {
      setLoadError(error?.message || 'No se pudieron cargar las campañas.');
    } finally {
      setLoadingCampaigns(false);
    }
  }, [authLoading, user]);

  useEffect(() => {
    void loadCampaignData();
  }, [loadCampaignData]);

  function updateReactivationSettings(patch: Partial<CampaignReactivationSettings>) {
    setDraft((current) => ({
      ...current,
      settings: {
        ...current.settings,
        audience: {
          kind: 'reactivation',
          reactivation: {
            ...(current.settings.audience?.kind === 'reactivation'
              ? current.settings.audience.reactivation
              : defaultCampaignReactivationSettings),
            ...patch,
          },
        },
      },
    }));
  }

  function updateReconnectionSettings(patch: Partial<CampaignReconnectionSettings>) {
    setDraft((current) => ({
      ...current,
      settings: {
        ...current.settings,
        reconnection: {
          ...current.settings.reconnection,
          ...patch,
          brief: {
            ...current.settings.reconnection.brief,
            ...(patch.brief || {}),
          },
        },
      },
    }));
  }

  function updateReconnectionBrief(patch: Partial<CampaignReconnectionBrief>) {
    updateReconnectionSettings({
      brief: {
        ...reconnectionSettings.brief,
        ...patch,
      },
    });
  }

  function openAiGenerator() {
    if (draft.campaignType === 'follow_up') {
      setAiGoal('Crear una secuencia de seguimiento amable y persistente para leads ya contactados, con foco en retomar la conversación y obtener respuesta.');
      setAiAudience('Leads contactados anteriormente que aún no responden');
      setAiOpen(true);
      return;
    }

    const goalParts = [
      reconnectionSettings.brief.offerName ? `Servicio o producto: ${reconnectionSettings.brief.offerName}` : '',
      reconnectionSettings.brief.offerSummary ? `Contexto: ${reconnectionSettings.brief.offerSummary}` : '',
      reconnectionSettings.brief.valuePoints.length ? `Puntos de valor: ${reconnectionSettings.brief.valuePoints.join('; ')}` : '',
      reconnectionSettings.brief.cta ? `CTA: ${reconnectionSettings.brief.cta}` : '',
      reconnectionSettings.brief.tone ? `Tono: ${reconnectionSettings.brief.tone}` : '',
    ].filter(Boolean);

    setAiGoal(goalParts.join('\n'));
    setAiAudience(reconnectionSettings.brief.audienceHint || 'Leads ya contactados elegibles para reconexion');
    setAiOpen(true);
  }

  function toggleReactivationAudience(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      settings: {
        ...current.settings,
        audience: enabled
          ? {
            kind: 'reactivation',
            reactivation: current.settings.audience?.kind === 'reactivation'
              ? current.settings.audience.reactivation
              : { ...defaultCampaignReactivationSettings },
          }
          : undefined,
      },
    }));
  }

  function startCreate(campaignType: CampaignType) {
    setDraft(buildDraftState(campaignType));
    setCommentsOpen(false);
    setAdvancedBriefOpen(false);
    setDeliverySettingsOpen(false);
    setExclusionsOpen(false);
    setMode({ kind: 'edit' });
  }

  function startEdit(c: Campaign) {
    setDraft({
      id: c.id,
      campaignType: c.campaignType || inferCampaignType({ settings: c.settings }),
      name: c.name,
      steps: c.steps.map((s) => ({ ...s })),
      excludedLeadIds: [...c.excludedLeadIds],
      settings: c.settings || createDefaultCampaignSettings({ campaignType: c.campaignType || 'follow_up' }),
    });
    setCommentsOpen(false);
    setAdvancedBriefOpen(false);
    setDeliverySettingsOpen(false);
    setExclusionsOpen(false);
    setMode({ kind: 'edit', id: c.id });
  }

  function addStep() {
    setDraft((d) => ({
      ...d,
      steps: [...d.steps, buildDraftStep(d.steps.length, d.campaignType)],
    }));
  }

  function removeStep(stepId: string) {
    setDraft((d) => ({ ...d, steps: d.steps.filter((s) => s.id !== stepId) }));
  }

  async function saveCampaign() {
    const safeName = draft.name.trim() || (draft.campaignType === 'reconnection' ? 'Campaña de reconexión sin título' : 'Campaña de seguimiento sin título');
    setSaving(true);
    try {
      const steps: CampaignStep[] = [];
      for (const s of draft.steps) {
        steps.push({
          id: s.id,
          name: s.name.trim() || 'Paso',
          offsetDays: Math.max(0, Number.isFinite(+s.offsetDays) ? Number(s.offsetDays) : 0),
          subject: s.subject || '',
          bodyHtml: s.bodyHtml || '',
          attachments: s.attachments || [],
          variantB: s.variantB,
        });
      }
      const normalizedSettings = {
        ...draft.settings,
        reconnection: {
          ...draft.settings.reconnection,
          enabled: draft.campaignType === 'reconnection' && draft.settings.reconnection.enabled,
        },
        audience: draft.campaignType === 'reconnection' ? draft.settings.audience : undefined,
      };
      if (draft.id) {
        await campaignsStorage.update(draft.id, {
          campaignType: draft.campaignType,
          name: safeName,
          steps,
          excludedLeadIds: draft.excludedLeadIds,
          settings: normalizedSettings,
          isPaused: true,
        });
        toast({ title: 'Borrador guardado', description: 'La campaña quedó pausada para que puedas revisarla antes de activarla.' });
      } else {
        const created = await campaignsStorage.add({
          campaignType: draft.campaignType,
          name: safeName,
          steps,
          excludedLeadIds: draft.excludedLeadIds,
          settings: normalizedSettings,
          isPaused: true,
        });
        if (!created) throw new Error('No se pudo confirmar la campaña guardada.');
        toast({ title: 'Borrador guardado', description: 'La campaña quedó pausada. Revísala antes de activarla.' });
      }
      setItems(await campaignsStorage.get());
      setMode({ kind: 'list' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: e?.message || 'Revisa los campos.' });
    } finally {
      setSaving(false);
    }
  }

  async function togglePause(c: Campaign) {
    try {
      if (c.isPaused) {
        const audience = c.settings?.audience?.kind === 'reactivation' ? c.settings.audience.reactivation : null;
        const readiness = assessCampaignDraftReadiness({
          name: c.name,
          campaignType: c.campaignType,
          steps: c.steps,
          offerName: c.settings?.reconnection?.brief?.offerName,
          offerSummary: c.settings?.reconnection?.brief?.offerSummary,
          hasActiveAudienceSegment: audience
            ? audience.includeOpenedNoReply || audience.includeClickedNoReply || audience.includeDeliveredNoOpen || audience.includeNeutralReplies || audience.includeNoSignal
            : c.campaignType !== 'reconnection',
        });
        if (!readiness.ready) {
          toast({
            variant: 'destructive',
            title: 'Completa la revisión antes de activar',
            description: readiness.issues[0],
          });
          startEdit(c);
          return;
        }
      }

      const next = await campaignsStorage.togglePause(c.id, !c.isPaused);
      if (!next) throw new Error('No se pudo confirmar el nuevo estado.');
      setItems(await campaignsStorage.get());
      toast({
        title: next.isPaused ? 'Campaña pausada' : 'Campaña activada',
        description: next.isPaused ? 'No se realizarán nuevos envíos.' : 'La campaña quedó lista para su próxima ejecución.',
      });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'No se pudo cambiar el estado', description: error?.message || 'Inténtalo de nuevo.' });
    }
  }

  function askDelete(id: string) {
    setDeletingId(id);
  }

  function cancelDelete() {
    setDeletingId(null);
  }

  async function confirmDelete() {
    if (!deletingId) return;
    try {
      const removed = await campaignsStorage.remove(deletingId);
      if (removed <= 0) throw new Error('La campaña no se pudo eliminar.');
      setItems(await campaignsStorage.get());
      setDeletingId(null);
      toast({ title: 'Campaña eliminada' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'No se pudo eliminar', description: error?.message || 'Inténtalo de nuevo.' });
    }
  }

  function onExcludeToggle(leadId: string, checked: boolean) {
    setDraft((d) => {
      const set = new Set(d.excludedLeadIds);
      if (checked) set.add(leadId); else set.delete(leadId);
      return { ...d, excludedLeadIds: [...set] };
    });
  }

  function excludeAll(checked: boolean) {
    if (checked) {
      const allIds = contacted.map((lead) => getContactLeadKey(lead)).filter(Boolean);
      setDraft((d) => ({ ...d, excludedLeadIds: [...new Set(allIds)] }));
    } else {
      setDraft((d) => ({ ...d, excludedLeadIds: [] }));
    }
  }

  const doPreview = useCallback(async (campaign: Campaign) => {
    setPreviewLoading(true);
    try {
      // PREVIEW 100% LOCAL: NO OAuth/Graph/Gmail aquí.
      const rows = await computeEligibilityForCampaign(campaign, {
        verifyReplies: false,
        now: new Date(),
      });
      setPreviewRows(rows);
      setPreviewCampaign(campaign);
      setSelectedIds(new Set()); // reset selección
      setPreviewOpen(true);
    } catch (err: any) {
      console.error('[campaigns/preview] Error:', err);
      toast({ title: 'Error al previsualizar', description: err?.message || 'Revisa la consola', variant: 'destructive' });
    } finally {
      setPreviewLoading(false);
    }
  }, [toast]);


  // --- Helpers de render de plantilla (con fallback) ---
  function renderTemplate(tpl: string, lead: ContactedLead, sender: { name?: string | null } = {}) {
    const base = String(tpl ?? '');
    const out = base
      .replace(/{{\s*lead\.name\s*}}/gi, lead?.name ?? '')
      .replace(/{{\s*company\s*}}/gi, lead?.company ?? '')
      .replace(/{{\s*sender\.name\s*}}/gi, String(sender?.name ?? ''));
    // Evita mandar vacío: si quedó en blanco tras reemplazos, devuelve algo mínimo
    const trimmed = out.replace(/\s+/g, ' ').trim();
    return trimmed.length ? out : '<div></div>';
  }

  // Genera texto plano rápido desde HTML (para Gmail)
  function htmlToPlainText(html: string) {
    return (html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // --- Normalización de cuerpo: texto plano -> HTML con párrafos ---
  function isLikelyHtml(s: string) {
    // Si ya tiene etiquetas comunes, asumimos HTML y no tocamos.
    return /<\s*(p|div|br|table|ul|ol|li|img|a|span|strong|em)\b/i.test(s);
  }
  function escapeHtml(s: string) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  /**
   * Si el usuario escribió texto con saltos de línea en el textarea,
   * lo convertimos a HTML preservando párrafos y <br/>.
   * - Doble salto: nuevo párrafo
   * - Salto simple: <br/>
   */
  function normalizeBodyHtml(input: string) {
    const raw = String(input ?? '');
    if (!raw.trim()) return '<div></div>';
    if (isLikelyHtml(raw)) return raw; // ya es HTML
    const blocks = raw.split(/\n{2,}/).map(b => b.replace(/\r/g, ''));
    const html = blocks
      .map(b => `<p>${escapeHtml(b).replace(/\n/g, '<br/>')}</p>`)
      .join('');
    return html;
  }

  // Busca en storage por múltiples claves (leadId | id | email). Devuelve null si no existe.
  function findContactedByLead(leadId: string, email?: string | null): ContactedLead | null {
    const all = contacted || [];
    const wantId = String(leadId || '').trim().toLowerCase();
    const wantEmail = String(email || '').trim().toLowerCase();
    // 1) por leadId
    let hit =
      all.find((x: any) => String(x.leadId || '').trim().toLowerCase() === wantId) ||
      // 2) por id (algunos storages usan id en vez de leadId)
      all.find((x: any) => String(x.id || '').trim().toLowerCase() === wantId) ||
      // 3) por email
      (wantEmail
        ? all.find((x: any) => String(x.email || '').trim().toLowerCase() === wantEmail)
        : null);
    return hit || null;
  }

  // --- Envío manual (por fila de previsualización) ---
  const sendFollowUpNow = async (row: EligiblePreviewRow, provider: 'outlook' | 'gmail'): Promise<boolean> => {
    const key = `${row.leadId}:${provider}`;
    if (sendingId === key) return false;
    setSendingId(key);
    try {
      const campaign = previewCampaign;
      if (!campaign) throw new Error('Campaña no encontrada en el estado de previsualización.');

      // Buscar contacto; permitir fallback por email desde la fila
      const contactedFromStore = findContactedByLead(row.leadId, row.leadEmail);
      const contacted: any =
        contactedFromStore ??
        (row.leadEmail
          ? {
            // Fallback mínimo para poder enviar aunque no exista en storage
            leadId: row.leadId,
            name: row.leadName ?? '',
            email: row.leadEmail,
            company: '',
            status: 'pending',
          }
          : null);
      if (!contacted) throw new Error('No se pudo resolver el contacto: falta email.');

      const step = campaign.steps[row.nextStepIdx];
      if (!step) throw new Error('Paso no encontrado.');

      const personalizationRes = await fetch('/api/campaigns/personalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          leadId: row.leadId,
          leadEmail: row.leadEmail,
          stepIndex: row.nextStepIdx,
          matchReason: row.matchReason,
          daysSinceLastContact: row.daysSinceLastContact,
        }),
      });

      const personalizationPayload = await personalizationRes.json().catch(() => ({}));
      if (!personalizationRes.ok) {
        throw new Error(personalizationPayload?.error || 'No se pudo personalizar el mensaje');
      }

      const subject = String(personalizationPayload.subject || '').trim();
      const bodyHtml = normalizeBodyHtml(String(personalizationPayload.bodyHtml || ''));

      const tracking = campaign.settings?.tracking;
      const trackingEnabled = Boolean(tracking?.enabled);
      const trackLinks = trackingEnabled && (tracking?.linkTracking ?? true);
      const trackPixel = trackingEnabled && (tracking?.pixel ?? true);
      const trackingId = String(contacted.id || '').trim();

      const subjectTrim = subject.replace(/\s+/g, ' ').trim();
      const bodyTrim = bodyHtml.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (!subjectTrim) throw new Error('El paso no tiene asunto luego de renderizar variables.');
      if (!bodyTrim) throw new Error('El paso no tiene cuerpo luego de renderizar variables.');

      // Use Server-Side Proxy
      const res = await fetch('/api/providers/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          to: contacted.email,
          subject,
          htmlBody: bodyHtml,
          leadId: row.leadId,
          idempotencyKey: `campaign-manual:${campaign.id}:${row.leadId}:${row.nextStepIdx}:${provider}`,
          trackingId: trackingId || undefined,
          tracking: {
            pixel: Boolean(trackPixel && trackingId),
            linkTracking: Boolean(trackLinks && trackingId),
          },
        }),
      });

      const sendResult = await res.json().catch(() => ({}));
      if (!res.ok || sendResult?.status !== 'sent') {
        throw new Error(sendResult?.error || 'El envio no fue confirmado.');
      }

      // Update local records
      const rec = campaign.sentRecords || {};
      rec[String(row.leadId)] = { lastStepIdx: row.nextStepIdx, lastSentAt: new Date().toISOString() };
      await campaignsStorage.update(campaign.id, { sentRecords: rec });

      // Update contacted lead status
      // Note: We don't get messageId/threadId back from the simple proxy yet, 
      // but we can at least bump the step index.
      if (provider === 'outlook' && (contactedLeadsStorage as any).bumpFollowupByConversationId && contacted.conversationId) {
        await (contactedLeadsStorage as any).bumpFollowupByConversationId(contacted.conversationId, row.nextStepIdx);
      } else if (provider === 'gmail' && (contactedLeadsStorage as any).bumpFollowupByThreadId && contacted.threadId) {
        await (contactedLeadsStorage as any).bumpFollowupByThreadId(contacted.threadId, row.nextStepIdx);
      }

      toast({ title: 'Seguimiento enviado', description: `Se envió el paso #${row.nextStepIdx + 1} a ${contacted.name}.` });
      return true;
    } catch (e: any) {
      console.error('[campaigns/send] Error:', e);
      toast({ variant: 'destructive', title: 'No se pudo enviar', description: e?.message || 'Error desconocido' });
      // Propaga para que el envío masivo cuente el fallo
      throw e;
    } finally {
      setSendingId(null);
    }
  };

  // Envío masivo (secuencial) de los seleccionados
  const sendBulk = async (provider: 'outlook' | 'gmail') => {
    if (!previewCampaign || selectedIds.size === 0) return;
    const toSend = previewRows.filter(r => selectedIds.has(r.leadId));
    let ok = 0, fail = 0;
    toast({ title: `Enviando ${toSend.length} seleccionados`, description: `Proveedor: ${provider}` });
    for (const row of toSend) {
      try {
        const res = await sendFollowUpNow(row, provider);
        ok += res ? 1 : 0;
      } catch (err) {
        console.warn('[campaigns/sendBulk] fallo en lead', row.leadId, err);
        fail += 1;
      }
    }
    toast({
      title: 'Envío masivo finalizado',
      description: `Éxitos: ${ok} • Fallos: ${fail}`,
    });
    // Opcional: limpiar selección tras envío
    setSelectedIds(new Set());
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filteredPreviewRows.map(r => r.leadId)));
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredPreviewRows.forEach((row) => next.delete(row.leadId));
        return next;
      });
    }
  };


  async function generateCampaign() {
    if (!aiGoal.trim()) return;
    setAiLoading(true);
    try {
      const profile = await profileService.getCurrentProfile().catch(() => null);
      const generatedBrief = {
        ...reconnectionSettings.brief,
        offerSummary: aiGoal.trim(),
        audienceHint: aiAudience.trim() || reconnectionSettings.brief.audienceHint,
      };

      const res = await fetch('/api/ai/generate-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: aiGoal,
          targetAudience: aiAudience,
          companyName: profile?.company_name || 'Mi Empresa',
          language: 'es',
          campaignType: draft.campaignType === 'reconnection' ? 'reconnection' : 'standard',
          offerName: generatedBrief.offerName,
          offerSummary: generatedBrief.offerSummary,
          offerBenefits: generatedBrief.valuePoints,
          cta: generatedBrief.cta,
          tone: generatedBrief.tone,
        }),
      });
      if (!res.ok) throw new Error('Error generando campaña');
      const data = await res.json();

      // Map response to draft steps
      const newSteps: DraftStep[] = data.steps.map((s: any) => ({
        id: crypto.randomUUID(),
        name: s.name,
        offsetDays: s.offsetDays,
        subject: s.subject,
        bodyHtml: s.bodyHtml,
        attachments: [],
      }));

      setDraft(d => ({
        ...d,
        steps: newSteps,
        settings: {
          ...d.settings,
          reconnection: {
            ...d.settings.reconnection,
            enabled: d.campaignType === 'reconnection',
            brief: generatedBrief,
          },
        },
      }));
      setAiOpen(false);
      toast({ title: 'Campaña generada', description: 'Revisa y edita los pasos antes de guardar.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="mx-auto space-y-6">
      {mode.kind === 'list' && (
        <PageHeader title="Campañas" description="Crea secuencias, revisa sus destinatarios y decide cuándo activarlas.">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="w-full rounded-full sm:w-auto">
                <Plus aria-hidden="true" />
                Nueva campaña
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-2xl p-1.5">
              <DropdownMenuLabel>Elige el objetivo</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="items-start py-2.5" onClick={() => startCreate('reconnection')}>
                <Sparkles className="mt-0.5" aria-hidden="true" />
                <span><span className="block font-medium">Volver a conectar</span><span className="block text-xs text-muted-foreground">Presenta una nueva propuesta a contactos anteriores.</span></span>
              </DropdownMenuItem>
              <DropdownMenuItem className="items-start py-2.5" onClick={() => startCreate('follow_up')}>
                <MessageSquare className="mt-0.5" aria-hidden="true" />
                <span><span className="block font-medium">Hacer seguimiento</span><span className="block text-xs text-muted-foreground">Continúa conversaciones sin respuesta.</span></span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PageHeader>
      )}

      {mode.kind === 'list' && (
        <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/80 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.24)]">
          <CardHeader className="gap-4 border-b border-border/60 bg-muted/10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-xl tracking-tight">Tus campañas</CardTitle>
                <CardDescription className="mt-1">Abre una campaña para editarla o revisa a quién se enviaría.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label="Resumen de campañas">
                <span><strong className="font-semibold text-foreground">{campaignOverview.total}</strong> total</span>
                <span className="text-border" aria-hidden="true">•</span>
                <span><strong className="font-semibold text-emerald-700 dark:text-emerald-400">{campaignOverview.active}</strong> activas</span>
                <span className="text-border" aria-hidden="true">•</span>
                <span><strong className="font-semibold text-foreground">{campaignOverview.paused}</strong> pausadas</span>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-muted/50 p-1 sm:w-auto" aria-label="Filtrar campañas por tipo">
                {([
                  ['all', 'Todas'],
                  ['reconnection', 'Reconexión'],
                  ['follow_up', 'Seguimiento'],
                ] as const).map(([value, label]) => (
                  <Button key={value} variant={campaignTypeFilter === value ? 'secondary' : 'ghost'} size="sm" className="shrink-0 rounded-lg" onClick={() => setCampaignTypeFilter(value)}>
                    {label}
                  </Button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{filteredItems.length} {filteredItems.length === 1 ? 'campaña' : 'campañas'}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loadError ? (
              <div className="p-6">
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertTitle>No pudimos cargar tus campañas</AlertTitle>
                  <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>{loadError}</span>
                    <Button variant="outline" size="sm" onClick={() => void loadCampaignData()}>Reintentar</Button>
                  </AlertDescription>
                </Alert>
              </div>
            ) : loadingCampaigns ? (
              <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Cargando campañas…
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageSquare className="size-5" aria-hidden="true" /></div>
                <h3 className="text-base font-semibold">{items.length === 0 ? 'Crea tu primera campaña' : 'No hay campañas en este filtro'}</h3>
                <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                  {items.length === 0 ? 'Prepara una secuencia como borrador, revisa sus destinatarios y actívala cuando esté lista.' : 'Cambia el filtro para volver a ver tus campañas.'}
                </p>
                {items.length > 0 ? <Button variant="outline" className="mt-5 rounded-full" onClick={() => setCampaignTypeFilter('all')}>Ver todas</Button> : null}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[860px]">
                  <TableHeader>
                    <TableRow className="bg-muted/15 hover:bg-muted/15">
                      <TableHead>Campaña</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Actividad</TableHead>
                      <TableHead>Resultado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((c) => {
                        const campaignSettings = c.settings || createDefaultCampaignSettings({ campaignType: c.campaignType });
                        const metrics = metricsByCampaignId[c.id] || { totalSent: 0, opened: 0, replied: 0, clicked: 0 };
                        return <TableRow key={c.id} className="border-border/60 hover:bg-muted/15">
                        <TableCell>
                          <button type="button" onClick={() => startEdit(c)} className="max-w-[360px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                            <span className="block font-medium text-foreground hover:underline">{c.name}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{getCampaignTypeLabel(c.campaignType)} · {c.steps.length} {c.steps.length === 1 ? 'paso' : 'pasos'}{c.campaignType === 'reconnection' && campaignSettings.reconnection?.brief?.offerName ? ` · ${campaignSettings.reconnection.brief.offerName}` : ''}</span>
                          </button>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('rounded-full', c.isPaused ? 'text-muted-foreground' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400')}>
                            {c.isPaused ? 'Pausada' : 'Activa'}
                          </Badge>
                        </TableCell>
                        <TableCell><span className="text-sm">{formatRunStatusLabel(c.lastRunStatus)}</span><span className="mt-1 block text-xs text-muted-foreground">{formatRunAt(c.lastRunAt)}</span></TableCell>
                        <TableCell><span className="text-sm font-medium">{metrics.totalSent} enviados</span><span className="mt-1 block text-xs text-muted-foreground">{metrics.opened} aperturas · {metrics.replied} respuestas</span></TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="rounded-full" onClick={() => doPreview(c)} disabled={previewLoading}>
                              {previewLoading ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Eye aria-hidden="true" />}
                              Revisar
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="rounded-full" aria-label={`Más acciones para ${c.name}`}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52 rounded-2xl p-1.5">
                                <DropdownMenuItem onClick={() => startEdit(c)}>Editar campaña</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void togglePause(c)}>{c.isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{c.isPaused ? 'Revisar y activar' : 'Pausar campaña'}</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => askDelete(c.id)}><Trash2 aria-hidden="true" />Eliminar</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>;
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {mode.kind === 'edit' && (
        <Tabs defaultValue="editor" className="space-y-6">
          <div className="sticky top-14 z-20 -mx-2 rounded-2xl border border-border/60 bg-background/90 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:mx-0 sm:p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <Button size="icon" variant="ghost" className="shrink-0 rounded-full" onClick={() => setMode({ kind: 'list' })} aria-label="Volver a campañas">
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{draft.name.trim() || 'Campaña sin título'}</h1>
                    <Badge variant="outline" className="hidden shrink-0 rounded-full sm:inline-flex">{getCampaignTypeLabel(draft.campaignType)}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{draft.id ? 'Guardar los cambios pausará la campaña para una nueva revisión.' : 'La campaña se creará pausada.'}</p>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:justify-end">
                <TabsList className="grid h-10 w-full grid-cols-3 rounded-xl sm:w-auto">
                  <TabsTrigger value="editor" className="rounded-lg">Contenido</TabsTrigger>
                  <TabsTrigger value="settings" className="rounded-lg">Audiencia</TabsTrigger>
                  <TabsTrigger value="analytics" className="rounded-lg" disabled={!draft.id}>Resultados</TabsTrigger>
                </TabsList>
                <Button onClick={saveCampaign} disabled={saving} className="shrink-0 rounded-full">
                  {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                  {saving ? 'Guardando…' : 'Guardar borrador'}
                </Button>
              </div>
            </div>
          </div>

          <TabsContent value="editor" className="space-y-6">
            <div className="mx-auto max-w-5xl space-y-6">
                <Card className="rounded-2xl border-border/60 shadow-sm">
                  <CardHeader className="gap-4 border-b border-border/60 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-lg">1. Define la campaña</CardTitle>
                      <CardDescription className="mt-1">Nómbrala y deja claro qué conversación quieres iniciar.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex rounded-lg bg-muted p-1">
                        <Button size="sm" variant={viewMode === 'list' ? 'secondary' : 'ghost'} className="h-8 rounded-md px-2.5" onClick={() => setViewMode('list')}>Editar</Button>
                        <Button size="sm" variant={viewMode === 'flow' ? 'secondary' : 'ghost'} className="h-8 rounded-md px-2.5" onClick={() => setViewMode('flow')}>Ver flujo</Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-2">
                      <Label htmlFor="campaign-name">Nombre de la campaña</Label>
                      <Input id="campaign-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Ej. Reconexión clientes de agosto" />
                    </div>

                    {draft.campaignType === 'reconnection' ? (
                      <div className="space-y-4 rounded-xl border border-border/60 bg-muted/15 p-4 sm:p-5">
                        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-medium">Propuesta de reconexión</div>
                            <p className="text-xs text-muted-foreground">
                              Describe qué ofreces y para quién. Podrás generar una secuencia base y editarla antes de guardar.
                            </p>
                          </div>
                          <Button type="button" variant="outline" size="sm" className="mt-2 rounded-full md:mt-0" onClick={openAiGenerator}>
                              <Sparkles aria-hidden="true" />
                              Generar secuencia
                          </Button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="grid gap-1.5">
                            <Label htmlFor="reconnection-offer-name">Nombre del servicio</Label>
                            <Input
                              id="reconnection-offer-name"
                              value={reconnectionSettings.brief.offerName}
                              onChange={(e) => updateReconnectionBrief({ offerName: e.target.value })}
                              placeholder="Ej: Auditoria SEO continua"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="reconnection-audience-hint">Audiencia ideal</Label>
                            <Input
                              id="reconnection-audience-hint"
                              value={reconnectionSettings.brief.audienceHint}
                              onChange={(e) => updateReconnectionBrief({ audienceHint: e.target.value })}
                              placeholder="Ej: Leads de marketing y growth en SaaS B2B"
                            />
                          </div>
                        </div>

                        <div className="grid gap-1.5">
                          <Label htmlFor="reconnection-offer-summary">Qué quieres promocionar</Label>
                          <Textarea
                            id="reconnection-offer-summary"
                            rows={4}
                            value={reconnectionSettings.brief.offerSummary}
                            onChange={(e) => updateReconnectionBrief({ offerSummary: e.target.value })}
                            placeholder="Describe el servicio, problema que resuelve, para quien aplica y por que ahora vale la pena reconectar al lead."
                          />
                        </div>

                        <Collapsible open={advancedBriefOpen} onOpenChange={setAdvancedBriefOpen}>
                          <CollapsibleTrigger asChild>
                            <Button type="button" variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
                              <ChevronDown className={cn('transition-transform', advancedBriefOpen && 'rotate-180')} aria-hidden="true" />
                              {advancedBriefOpen ? 'Ocultar detalles opcionales' : 'Añadir detalles opcionales'}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="pt-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="grid gap-1.5">
                            <Label htmlFor="reconnection-value-points">Puntos de valor</Label>
                            <Textarea
                              id="reconnection-value-points"
                              rows={4}
                              value={toValuePointsText(reconnectionSettings.brief.valuePoints)}
                              onChange={(e) => updateReconnectionBrief({ valuePoints: parseValuePoints(e.target.value) })}
                              placeholder="Un punto por linea. Ej: Reduce tiempo operativo en 40%"
                            />
                          </div>
                          <div className="space-y-4">
                            <div className="grid gap-1.5">
                              <Label htmlFor="reconnection-cta">Llamado a la acción sugerido</Label>
                              <Input
                                id="reconnection-cta"
                                value={reconnectionSettings.brief.cta}
                                onChange={(e) => updateReconnectionBrief({ cta: e.target.value })}
                                placeholder="Ej: Te parece si lo vemos en 15 minutos?"
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label htmlFor="reconnection-tone">Tono</Label>
                              <Input
                                id="reconnection-tone"
                                value={reconnectionSettings.brief.tone}
                                onChange={(e) => updateReconnectionBrief({ tone: e.target.value })}
                                placeholder="Ej: consultivo y cercano"
                              />
                            </div>
                            <div className="grid gap-3 pt-1">
                              <div className="flex items-center gap-2">
                                <Switch
                                  id="reconnection-enabled"
                                  checked={reconnectionSettings.enabled}
                                  onCheckedChange={(checked) => updateReconnectionSettings({ enabled: checked })}
                                />
                                <Label htmlFor="reconnection-enabled">Personalización inteligente</Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  id="reconnection-auto-research"
                                  checked={reconnectionSettings.autoResearchOnSend}
                                  onCheckedChange={(checked) => updateReconnectionSettings({ autoResearchOnSend: checked })}
                                  disabled={!reconnectionSettings.enabled}
                                />
                                <Label htmlFor="reconnection-auto-research">Completar contexto cuando falte información</Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  id="reconnection-ai-personalization"
                                  checked={reconnectionSettings.personalizeWithAi}
                                  onCheckedChange={(checked) => updateReconnectionSettings({ personalizeWithAi: checked })}
                                  disabled={!reconnectionSettings.enabled}
                                />
                                <Label htmlFor="reconnection-ai-personalization">Personalizar cada correo con IA</Label>
                              </div>
                            </div>
                          </div>
                        </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-medium">Secuencia de seguimiento</div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Define cuánto esperar entre mensajes y revisa el contenido antes de activar la campaña.
                            </p>
                          </div>
                          <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" onClick={openAiGenerator}>
                            <Sparkles aria-hidden="true" />
                            Generar secuencia
                          </Button>
                        </div>
                      </div>
                    )}

                    {viewMode === 'list' ? (
                      <div className="space-y-4">
                        {draft.steps.map((s, idx) => (
                          <div key={s.id} id={`step-${s.id}`} className={cn('relative rounded-xl border border-border/60 bg-card p-4 transition-colors sm:p-5', activeStepId === s.id && 'border-primary/60 ring-1 ring-primary/30')}>
                            <div className="mb-5 flex items-center gap-2 pr-10">
                              <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                {idx + 1}
                              </div>
                              <span className="text-sm font-semibold">{idx === 0 ? 'Primer mensaje' : `Mensaje ${idx + 1}`}</span>
                              {idx > 0 && (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                  {s.offsetDays} {s.offsetDays === 1 ? 'día después' : 'días después'}
                                </span>
                              )}
                              <Button type="button" size="icon" variant="ghost" onClick={() => removeStep(s.id)} disabled={draft.steps.length === 1} className="absolute right-5 size-8 text-muted-foreground hover:text-destructive" aria-label={`Eliminar paso ${idx + 1}`}>
                                <X aria-hidden="true" />
                              </Button>
                            </div>

                            <div className="grid gap-4">
                              <div className="grid gap-4 md:grid-cols-2">
                                  <div className="grid gap-1.5">
                                    <Label htmlFor={`step-name-${s.id}`}>Nombre del paso</Label>
                                    <Input id={`step-name-${s.id}`} value={s.name} onChange={(e) =>
                                      setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x) }))
                                    } />
                                  </div>
                                  <div className="grid gap-1.5">
                                    <Label htmlFor={`step-offset-${s.id}`}>{idx === 0 ? 'Espera antes del primer mensaje' : 'Espera desde el mensaje anterior'}</Label>
                                    <Input id={`step-offset-${s.id}`} type="number" min={0} value={s.offsetDays}
                                      onChange={(e) => setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, offsetDays: Number(e.target.value || 0) } : x) }))} />
                                  </div>
                              </div>

                              <div className="grid gap-1.5">
                                <Label htmlFor={`step-subject-${s.id}`}>Asunto</Label>
                                <Input id={`step-subject-${s.id}`} value={s.subject} placeholder="Ej. Una idea para {{company}}"
                                  onChange={(e) => setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, subject: e.target.value } : x) }))} />
                              </div>
                              <div className="grid gap-1.5">
                                <Label htmlFor={`step-body-${s.id}`}>Mensaje</Label>
                                <Textarea id={`step-body-${s.id}`} rows={7} className="resize-y text-sm leading-6" value={s.bodyHtml} placeholder="Escribe un mensaje breve y claro…"
                                  onChange={(e) => setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, bodyHtml: e.target.value } : x) }))} />
                                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                  <span>Variables:</span>
                                  <code className="rounded bg-muted px-1.5 py-0.5">{`{{lead.name}}`}</code>
                                  <code className="rounded bg-muted px-1.5 py-0.5">{`{{company}}`}</code>
                                  <code className="rounded bg-muted px-1.5 py-0.5">{`{{sender.name}}`}</code>
                                </div>
                              </div>

                              {(s.variantB || s.attachments?.length) ? (
                                <Alert className="border-amber-500/30 bg-amber-500/5 text-foreground">
                                  <AlertCircle className="size-4 text-amber-600 dark:text-amber-400" />
                                  <AlertTitle>Funciones no disponibles en este flujo</AlertTitle>
                                  <AlertDescription>
                                    {s.variantB ? 'La variante A/B anterior se conservará, pero no se usará desde este editor. ' : ''}
                                    {s.attachments?.length ? `${s.attachments.length} adjunto(s) anterior(es) se conservarán, pero el envío desde esta pantalla no los incluye.` : 'Las pruebas A/B y los adjuntos todavía no están habilitados.'}
                                  </AlertDescription>
                                </Alert>
                              ) : (
                                <p className="text-xs text-muted-foreground">Pruebas A/B y adjuntos no disponibles en este flujo.</p>
                              )}
                            </div>
                          </div>
                        ))}

                        <Button type="button" variant="outline" className="w-full rounded-xl border-dashed py-6" onClick={addStep}>
                          <Plus aria-hidden="true" />
                          Añadir otro mensaje
                        </Button>
                      </div>
                    ) : (
                      // FLOW VIEW
                      <div className="flex flex-col gap-6">
                        <CampaignFlow
                          steps={draft.steps}
                          activeStepId={activeStepId}
                          onSelectStep={(id) => {
                            setActiveStepId(id);
                            setViewMode('list');
                            setTimeout(() => {
                              document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 100);
                          }}
                        />
                        <Button type="button" variant="outline" className="w-full rounded-xl border-dashed py-6" onClick={addStep}>
                          <Plus aria-hidden="true" />
                          Añadir otro mensaje
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {draft.id ? (
                  <Collapsible open={commentsOpen} onOpenChange={setCommentsOpen}>
                    <Card className="rounded-2xl border-border/60">
                      <CollapsibleTrigger asChild>
                        <Button type="button" variant="ghost" className="h-auto w-full justify-between rounded-2xl px-5 py-4">
                          <span className="flex items-center gap-2"><MessageSquare aria-hidden="true" />Comentarios</span>
                          <ChevronDown className={cn('transition-transform', commentsOpen && 'rotate-180')} aria-hidden="true" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="max-h-[520px] overflow-y-auto border-t border-border/60 p-4">
                        <CommentsSection entityType="campaign" entityId={draft.id} />
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                ) : null}
            </div>
          </TabsContent>

          <TabsContent value="analytics">
            {draft.id ? (
              (() => {
                const original = items.find(i => i.id === draft.id);
                if (!original) return <div className="p-8 text-center">Campaña no encontrada.</div>;
                return <CampaignAnalytics campaign={original} contactedLeads={contacted} />;
              })()
            ) : (
              <div className="p-12 text-center text-muted-foreground">Guarda la campaña para ver analíticas.</div>
            )}
          </TabsContent>

          <TabsContent value="settings">
            <Card className="mx-auto max-w-5xl rounded-2xl border-border/60 shadow-sm">
              <CardHeader className="border-b border-border/60">
                <CardTitle className="text-lg">2. Define la audiencia</CardTitle>
                <CardDescription>
                  {draft.campaignType === 'reconnection'
                    ? 'Elige a quién volver a contactar y deja fuera a quien no deba participar.'
                    : 'Revisa exclusiones y, si lo necesitas, ajusta las opciones de entrega.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">

                <Collapsible open={deliverySettingsOpen} onOpenChange={setDeliverySettingsOpen} className="rounded-xl border border-border/60 bg-muted/10">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="h-auto w-full justify-between rounded-xl px-4 py-3.5 text-left">
                      <span><span className="block text-sm font-medium">Opciones de entrega y medición</span><span className="mt-0.5 block text-xs font-normal text-muted-foreground">Horario y tracking opcionales</span></span>
                      <ChevronDown className={cn('transition-transform', deliverySettingsOpen && 'rotate-180')} aria-hidden="true" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-6 border-t border-border/60 p-4">
                <div>
                  <h3 className="text-sm font-medium mb-3">Horario de envío</h3>
                  <div className="flex items-center gap-2 mb-4">
                    <Switch id="smart-sched"
                      checked={!!draft.settings?.smartScheduling?.enabled}
                      onCheckedChange={(v) =>
                        setDraft(d => ({ ...d, settings: { ...d.settings, smartScheduling: { ...d.settings.smartScheduling!, enabled: v } } }))
                      } />
                    <Label htmlFor="smart-sched">Optimizar horario de envío (envía solo en horario laboral)</Label>
                  </div>

                  {draft.settings?.smartScheduling?.enabled && (
                    <div className="grid gap-4 md:grid-cols-3 border p-4 rounded-md">
                      <div className="grid gap-1.5">
                        <Label htmlFor="schedule-timezone">Zona horaria</Label>
                        <Input id="schedule-timezone" value={draft.settings.smartScheduling.timezone} onChange={(e) =>
                          setDraft(d => ({ ...d, settings: { ...d.settings, smartScheduling: { ...d.settings.smartScheduling!, timezone: e.target.value } } }))
                        } />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="schedule-start-hour">Hora de inicio (0-23)</Label>
                        <Input id="schedule-start-hour" type="number" min={0} max={23} value={draft.settings.smartScheduling.startHour} onChange={(e) =>
                          setDraft(d => ({ ...d, settings: { ...d.settings, smartScheduling: { ...d.settings.smartScheduling!, startHour: Number(e.target.value) } } }))
                        } />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="schedule-end-hour">Hora de fin (0-23)</Label>
                        <Input id="schedule-end-hour" type="number" min={0} max={23} value={draft.settings.smartScheduling.endHour} onChange={(e) =>
                          setDraft(d => ({ ...d, settings: { ...d.settings, smartScheduling: { ...d.settings.smartScheduling!, endHour: Number(e.target.value) } } }))
                        } />
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-px bg-border" />

                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Tracking opcional</h3>
                  <p className="text-xs text-muted-foreground">Activa solo si deseas medir aperturas y clics en esta campaña.</p>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="track-enabled"
                      checked={!!draft.settings?.tracking?.enabled}
                      onCheckedChange={(v) =>
                        setDraft(d => ({
                          ...d,
                          settings: {
                            ...d.settings,
                            tracking: {
                              enabled: v,
                              pixel: d.settings?.tracking?.pixel ?? true,
                              linkTracking: d.settings?.tracking?.linkTracking ?? true,
                            }
                          }
                        }))
                      }
                    />
                    <Label htmlFor="track-enabled">Habilitar tracking en esta campaña</Label>
                  </div>

                  {!!draft.settings?.tracking?.enabled && (
                    <div className="grid gap-3 md:grid-cols-2 border p-4 rounded-md">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="track-pixel"
                          checked={draft.settings?.tracking?.pixel ?? true}
                          onCheckedChange={(v) =>
                            setDraft(d => ({
                              ...d,
                              settings: {
                                ...d.settings,
                                tracking: {
                                  enabled: true,
                                  pixel: v,
                                  linkTracking: d.settings?.tracking?.linkTracking ?? true,
                                }
                              }
                            }))
                          }
                        />
                        <Label htmlFor="track-pixel">Pixel de apertura</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          id="track-links"
                          checked={draft.settings?.tracking?.linkTracking ?? true}
                          onCheckedChange={(v) =>
                            setDraft(d => ({
                              ...d,
                              settings: {
                                ...d.settings,
                                tracking: {
                                  enabled: true,
                                  pixel: d.settings?.tracking?.pixel ?? true,
                                  linkTracking: v,
                                }
                              }
                            }))
                          }
                        />
                        <Label htmlFor="track-links">Tracking de links</Label>
                      </div>
                    </div>
                  )}
                </div>
                  </CollapsibleContent>
                </Collapsible>

                {draft.campaignType === 'reconnection' ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium">Segmentos de reconexión</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Prioriza contactos anteriores según sus señales de interés y entrega.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id="reactivation-enabled"
                        checked={draft.settings.audience?.kind === 'reactivation'}
                        onCheckedChange={toggleReactivationAudience}
                      />
                      <Label htmlFor="reactivation-enabled">Usar segmentos de reconexión</Label>
                    </div>

                    {reactivationAudience ? (
                    <div className="space-y-4 border rounded-md p-4">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="grid gap-1.5">
                          <Label htmlFor="reactivation-min-days">Días mínimos desde el último contacto</Label>
                          <Input
                            id="reactivation-min-days"
                            type="number"
                            min={0}
                            value={reactivationAudience.minDaysSinceLastContact}
                            onChange={(e) => updateReactivationSettings({ minDaysSinceLastContact: Number(e.target.value || 0) })}
                          />
                        </div>
                        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
                          <div className="font-medium">Resumen del segmento</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {getReactivationSummary(reactivationAudience)}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
                          <div className="font-medium">Candidatos estimados</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {reactivationStats?.matched ?? 0} de {reactivationStats?.totalCandidates ?? 0} leads con email cumplen estos filtros.
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reactivation-delivery-evidence"
                            checked={reactivationAudience.requireDeliveryEvidence}
                            onCheckedChange={(value) => updateReactivationSettings({ requireDeliveryEvidence: value })}
                          />
                          <Label htmlFor="reactivation-delivery-evidence">Requerir evidencia de entrega o engagement</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reactivation-opened"
                            checked={reactivationAudience.includeOpenedNoReply}
                            onCheckedChange={(value) => updateReactivationSettings({ includeOpenedNoReply: value })}
                          />
                          <Label htmlFor="reactivation-opened">Incluir abiertos sin respuesta</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reactivation-clicked"
                            checked={reactivationAudience.includeClickedNoReply}
                            onCheckedChange={(value) => updateReactivationSettings({ includeClickedNoReply: value })}
                          />
                          <Label htmlFor="reactivation-clicked">Incluir clicks sin respuesta</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reactivation-delivered"
                            checked={reactivationAudience.includeDeliveredNoOpen}
                            onCheckedChange={(value) => updateReactivationSettings({ includeDeliveredNoOpen: value })}
                          />
                          <Label htmlFor="reactivation-delivered">Incluir correos entregados sin apertura</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reactivation-neutral"
                            checked={reactivationAudience.includeNeutralReplies}
                            onCheckedChange={(value) => updateReactivationSettings({ includeNeutralReplies: value })}
                          />
                          <Label htmlFor="reactivation-neutral">Incluir replies neutrales o auto-reply</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reactivation-no-signal"
                            checked={reactivationAudience.includeNoSignal}
                            onCheckedChange={(value) => updateReactivationSettings({ includeNoSignal: value })}
                          />
                          <Label htmlFor="reactivation-no-signal">Incluir leads sin senales previas</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reactivation-failed"
                            checked={reactivationAudience.excludeFailedDeliveries}
                            onCheckedChange={(value) => updateReactivationSettings({ excludeFailedDeliveries: value })}
                          />
                          <Label htmlFor="reactivation-failed">Excluir entregas fallidas o invalidas</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id="reactivation-dnc"
                            checked={reactivationAudience.excludeDoNotContact}
                            onCheckedChange={(value) => updateReactivationSettings({ excludeDoNotContact: value })}
                          />
                          <Label htmlFor="reactivation-dnc">Excluir negativos, unsubscribe y do-not-contact</Label>
                        </div>
                      </div>

                      {reactivationStats ? (
                        <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                          <span><strong className="text-foreground">{reactivationStats.clicked}</strong> clics sin respuesta</span>
                          <span><strong className="text-foreground">{reactivationStats.opened}</strong> aperturas sin respuesta</span>
                          <span><strong className="text-foreground">{reactivationStats.delivered}</strong> entregados sin apertura</span>
                          <span><strong className="text-foreground">{reactivationStats.failedDelivery + reactivationStats.doNotContact}</strong> excluidos por seguridad</span>
                        </div>
                      ) : null}
                    </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        Activa la reactivacion para limitar la campaña a leads ya contactados que muestran senales validas para un nuevo acercamiento.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground">
                    Los seguimientos usan el historial de contacto y detienen la secuencia cuando hay una respuesta, una baja o una exclusión.
                  </div>
                )}

                <Collapsible open={exclusionsOpen} onOpenChange={setExclusionsOpen} className="rounded-xl border border-border/60">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="h-auto w-full justify-between rounded-xl px-4 py-3.5 text-left">
                      <span><span className="block text-sm font-medium">Exclusiones manuales</span><span className="mt-0.5 block text-xs font-normal text-muted-foreground">{draft.excludedLeadIds.length} {draft.excludedLeadIds.length === 1 ? 'contacto excluido' : 'contactos excluidos'}</span></span>
                      <ChevronDown className={cn('transition-transform', exclusionsOpen && 'rotate-180')} aria-hidden="true" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 border-t border-border/60 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox id="exclude-all" checked={draft.excludedLeadIds.length > 0 && draft.excludedLeadIds.length >= contacted.length}
                      onCheckedChange={(v) => excludeAll(Boolean(v))} />
                    <label htmlFor="exclude-all" className="text-sm cursor-pointer">Excluir todos los contactados previamente</label>
                  </div>
                  <div className="border rounded-md max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Lead</TableHead>
                          <TableHead>Empresa</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contacted.length === 0 ? (
                          <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No hay leads contactados aún.</TableCell></TableRow>
                        ) : contacted.map((cl: ContactedLead) => {
                          const id = getContactLeadKey(cl);
                          if (!id) return null;
                          const checked = draft.excludedLeadIds.includes(id);
                          return (
                            <TableRow key={id}>
                              <TableCell>
                                <Checkbox checked={checked} onCheckedChange={(v) => onExcludeToggle(id, Boolean(v))} aria-label={`Excluir a ${cl.name || cl.email}`} />
                              </TableCell>
                              <TableCell>{cl.name}</TableCell>
                              <TableCell>{cl.company || '—'}</TableCell>
                              <TableCell>{cl.email}</TableCell>
                              <TableCell>{cl.deliveryStatus === 'bounced' ? 'Bounce' : cl.deliveryStatus === 'soft_bounced' ? 'Entrega fallida' : cl.status}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="rounded-xl border border-border/60 bg-muted/10 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-3">
                      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', draftReadiness.ready ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400')}>
                        {draftReadiness.ready ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold">3. Revisa antes de activar</h3>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {draftReadiness.ready ? 'El contenido básico está completo. Guarda el borrador y revisa los destinatarios antes de activarlo.' : 'Puedes guardar ahora y completar estos puntos más tarde.'}
                        </p>
                        {!draftReadiness.ready ? (
                          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                            {draftReadiness.issues.slice(0, 3).map((issue) => <li key={issue}>• {issue}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0 rounded-full"
                      disabled={!draft.id || !draftReadiness.ready || previewLoading}
                      onClick={() => {
                        const campaign = items.find((item) => item.id === draft.id);
                        if (campaign) void doPreview(campaign);
                      }}
                    >
                      <Eye aria-hidden="true" />
                      Revisar destinatarios
                    </Button>
                  </div>
                  {!draft.id ? <p className="mt-3 text-xs text-muted-foreground sm:text-right">Guarda el borrador para habilitar la revisión.</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* === Modal de Previsualización === */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[92vh] max-w-[min(96vw,1100px)] overflow-hidden p-0">
          <div className="flex max-h-[92vh] flex-col">
            <div className="sticky top-0 z-10 border-b bg-background/90 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6">
              <DialogHeader className="mb-2">
                <DialogTitle>Revisar destinatarios</DialogTitle>
                <DialogDescription>Verifica quién recibiría el siguiente mensaje antes de realizar un envío.</DialogDescription>
              </DialogHeader>
              {previewLoading ? null : (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px_180px]">
                    <div className="relative">
                      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        aria-label="Buscar destinatarios por nombre, email o empresa"
                        value={eligibleNameFilter}
                        onChange={(e) => setEligibleNameFilter(e.target.value)}
                        placeholder="Buscar por nombre, email o empresa"
                        className="pl-9"
                      />
                    </div>
                    <select
                      aria-label="Filtrar destinatarios por días desde el último contacto"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={eligibleDaysFilter}
                      onChange={(e) => setEligibleDaysFilter(e.target.value as 'all' | '7' | '14' | '30')}
                    >
                      <option value="all">Todos los días</option>
                      <option value="7">7+ días</option>
                      <option value="14">14+ días</option>
                      <option value="30">30+ días</option>
                    </select>
                    <select
                      aria-label="Filtrar destinatarios por próximo paso"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={eligibleStepFilter}
                      onChange={(e) => setEligibleStepFilter(e.target.value)}
                    >
                      <option value="all">Todos los pasos</option>
                      {previewStepOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <select
                      aria-label="Filtrar destinatarios por industria"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={eligibleIndustryFilter}
                      onChange={(e) => setEligibleIndustryFilter(e.target.value)}
                    >
                      <option value="all">Todas las industrias</option>
                      {previewIndustryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      aria-label="Seleccionar todos los destinatarios visibles"
                      checked={allSelected}
                      onCheckedChange={(v) => toggleAll(Boolean(v))}
                      aria-checked={allSelected ? 'true' : someSelected ? 'mixed' : 'false'}
                    />
                    <span className="text-sm">
                      {allSelected ? 'Todos seleccionados' : someSelected ? `${selectedCount} seleccionados` : 'Seleccionar todo'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {filteredPreviewRows.length} de {previewRows.length} visibles
                  </div>
                  <div className="flex flex-wrap gap-2 sm:ml-auto">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={selectedCount === 0}
                      onClick={() => sendBulk('outlook')}
                    >
                      Enviar seleccionados (Outlook)
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={selectedCount === 0}
                      onClick={() => sendBulk('gmail')}
                    >
                      Enviar seleccionados (Gmail)
                    </Button>
                  </div>
                </div>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
              {previewLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Calculando elegibles…</div>
              ) : (
                <Table className="min-w-[760px]">
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Próximo paso</TableHead>
                      <TableHead>Días transcurridos</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPreviewRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          No hay leads elegibles para estos filtros.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPreviewRows.map((row) => (
                        <TableRow key={row.leadId} className="align-middle">
                          <TableCell className="py-3">
                            <Checkbox
                              checked={selectedIds.has(row.leadId)}
                              onCheckedChange={(v) => toggleRow(row.leadId, Boolean(v))}
                              aria-label={`Seleccionar ${row.leadName ?? row.leadId}`}
                            />
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex flex-col">
                              <span className="font-medium">{row.leadName ?? 'Sin nombre'}</span>
                              <span className="text-xs text-muted-foreground">{row.leadEmail ?? 'Sin email'}</span>
                              <span className="text-xs text-muted-foreground">{row.leadCompany ?? 'Sin empresa'}{row.leadIndustry ? ` · ${row.leadIndustry}` : ''}</span>
                              <span className="text-xs text-muted-foreground">{row.matchReason}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="text-sm">
                              {row.nextStep?.name ?? `Paso ${row.nextStepIdx + 1}`}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Ultimo contacto: {formatPreviewDate(row.lastContactAt)}
                            </div>
                          </TableCell>
                          <TableCell className="py-3">{row.daysSinceLastContact}</TableCell>
                          <TableCell className="py-3 text-right space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={sendingId === `${row.leadId}:outlook`}
                              onClick={() => sendFollowUpNow(row, 'outlook')}
                            >
                              Enviar Outlook
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={sendingId === `${row.leadId}:gmail`}
                              onClick={() => sendFollowUpNow(row, 'gmail')}
                            >
                              Enviar Gmail
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* === Modal de IA === */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar campaña de reconexion con IA</DialogTitle>
            <DialogDescription>
              Describe lo que quieres promocionar y la IA preparara la secuencia base para luego personalizar cada envio lead por lead.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="ai-goal">Servicio o anuncio a difundir</Label>
              <Textarea
                id="ai-goal"
                placeholder="Ej: Nuevo servicio de automatizacion de soporte con IA para empresas que ya mostraron interes en eficiencia operativa..."
                value={aiGoal}
                onChange={(e) => setAiGoal(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ai-audience">Quién debería recibirlo</Label>
              <Input
                id="ai-audience"
                placeholder="Ej: Gerentes de marketing en empresas de software"
                value={aiAudience}
                onChange={(e) => setAiAudience(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)}>Cancelar</Button>
            <Button onClick={generateCampaign} disabled={aiLoading || !aiGoal.trim()}>
              {aiLoading ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-spin" />
                  Generando...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deletingId)} onOpenChange={(open) => { if (!open) cancelDelete(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar campaña</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer. La campaña y su secuencia se eliminarán definitivamente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
