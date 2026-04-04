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
import { campaignsStorage, type CampaignStep, type CampaignStepAttachment } from '@/lib/services/campaigns-service';
// UI-compatible Campaign type from service
import type { Campaign } from '@/lib/services/campaigns-service';

import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { Trash2, Plus, Pause, Play, Eye, X, Sparkles, MessageSquare, Search as SearchIcon, SlidersHorizontal } from 'lucide-react';
import { computeEligibilityForCampaign, type EligiblePreviewRow } from '@/lib/campaign-eligibility';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { googleAuthService } from '@/lib/google-auth-service';
import type { ContactedLead } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CommentsSection } from '@/components/comments-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignAnalytics } from '@/components/campaigns/CampaignAnalytics';
import { CampaignFlow } from '@/components/campaigns/CampaignFlow';
import { cn } from '@/lib/utils';
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

type DraftStep = CampaignStep & { _files?: File[] };

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

function getCampaignTypeDescription(campaignType: CampaignType) {
  return campaignType === 'reconnection'
    ? 'Promociona un nuevo servicio o vuelve a activar leads antiguos con personalización inteligente.'
    : 'Automatiza follow-ups clásicos por offset para no perseguir manualmente cada lead contactado.';
}

function getCampaignEditorTitle(campaignType: CampaignType, hasId: boolean) {
  if (hasId) {
    return campaignType === 'reconnection' ? 'Gestionar campaña de reconexión' : 'Gestionar campaña de seguimiento';
  }
  return campaignType === 'reconnection' ? 'Nueva campaña de reconexión' : 'Nueva campaña de seguimiento';
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

function getRunStatusVariant(status?: CampaignRunStatus | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'success': return 'default';
    case 'partial': return 'secondary';
    case 'failed': return 'destructive';
    default: return 'outline';
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

function fileToBase64(file: File): Promise<CampaignStepAttachment> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const base64 = String(fr.result || '').split(',')[1] || '';
      resolve({ name: file.name, contentBytes: base64, contentType: file.type || undefined });
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

import { useAuth } from '@/context/AuthContext';

export default function CampaignsPage() {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [items, setItems] = useState<Campaign[]>([]);
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
      reconnection: items.filter((campaign) => campaign.campaignType === 'reconnection').length,
      followUp: items.filter((campaign) => campaign.campaignType === 'follow_up').length,
      missingAutomation: active.filter((campaign) => !campaign.lastRunAt).length,
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

  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!user) return; // or handle unauthenticated state

      setItems(await campaignsStorage.get());
      setContacted(await contactedLeadsStorage.get());
    }
    load();
  }, [authLoading, user]);

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

  function onStepFile(e: React.ChangeEvent<HTMLInputElement>, stepId: string) {
    const files = Array.from(e.target.files || []);
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => (s.id === stepId ? { ...s, _files: files } : s)),
    }));
  }

  async function buildAttachments(step: DraftStep): Promise<CampaignStepAttachment[]> {
    if (!step._files?.length) return step.attachments || [];
    const att = await Promise.all(step._files.map(fileToBase64));
    return [...(step.attachments || []), ...att];
  }

  async function saveCampaign() {
    if (!draft.name.trim()) {
      toast({ variant: 'destructive', title: 'Nombre requerido', description: 'La campaña debe tener un nombre.' });
      return;
    }
    if (!draft.steps.length) {
      toast({ variant: 'destructive', title: 'Agrega al menos un paso', description: 'Necesitas un paso de seguimiento.' });
      return;
    }
    if (draft.campaignType === 'reconnection' && draft.settings.reconnection.enabled && !draft.settings.reconnection.brief.offerSummary.trim() && !draft.settings.reconnection.brief.offerName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Describe qué vas a promocionar',
        description: 'Agrega al menos un resumen o nombre del servicio para que la IA personalice la campaña de reconexion.',
      });
      return;
    }
    if (draft.campaignType === 'reconnection' && draft.settings.audience?.kind === 'reactivation') {
      const audience = draft.settings.audience.reactivation;
      const hasActiveSegment =
        audience.includeOpenedNoReply ||
        audience.includeClickedNoReply ||
        audience.includeDeliveredNoOpen ||
        audience.includeNeutralReplies ||
        audience.includeNoSignal;

      if (!hasActiveSegment) {
        toast({
          variant: 'destructive',
          title: 'Activa al menos un segmento',
          description: 'Selecciona qué tipo de leads reactivados quieres incluir en esta campaña.',
        });
        return;
      }
    }
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
          attachments: await buildAttachments(s),
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
          name: draft.name,
          steps,
          excludedLeadIds: draft.excludedLeadIds,
          settings: normalizedSettings
        });
        toast({ title: 'Campaña actualizada', description: 'Se guardaron los cambios.' });
      } else {
        await campaignsStorage.add({
          campaignType: draft.campaignType,
          name: draft.name,
          steps,
          excludedLeadIds: draft.excludedLeadIds,
          settings: normalizedSettings
        });
        toast({ title: 'Campaña creada', description: 'Ya puedes previsualizar elegibles.' });
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
    const next = await campaignsStorage.togglePause(c.id, !c.isPaused);
    setItems(await campaignsStorage.get());
    toast({ title: next?.isPaused ? 'Campaña pausada' : 'Campaña reanudada' });
  }

  function askDelete(id: string) {
    setDeletingId(id);
  }

  function cancelDelete() {
    setDeletingId(null);
  }

  async function confirmDelete() {
    if (!deletingId) return;
    const removed = await campaignsStorage.remove(deletingId);
    setDeletingId(null);
    setItems(await campaignsStorage.get());
    if (removed > 0) toast({ title: 'Campaña eliminada' });
    else toast({ variant: 'destructive', title: 'No se pudo eliminar' });
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
      let bodyHtml = normalizeBodyHtml(String(personalizationPayload.bodyHtml || ''));

      const tracking = campaign.settings?.tracking;
      const trackingEnabled = Boolean(tracking?.enabled);
      const trackLinks = trackingEnabled && (tracking?.linkTracking ?? true);
      const trackPixel = trackingEnabled && (tracking?.pixel ?? true);

      if (trackingEnabled) {
        const trackingId = String(contacted.id || contacted.leadId || row.leadId || '').trim();
        const origin = window.location.origin;

        if (trackLinks && trackingId && !bodyHtml.includes('/api/tracking/click')) {
          bodyHtml = bodyHtml.replace(/href=("|')(?!(?:\/api\/tracking\/click\?id=))([^"']+)("|')/gi, (match, q, url) => {
            if (String(url).startsWith('mailto:')) return match;
            const trackingUrl = `${origin}/api/tracking/click?id=${trackingId}&url=${encodeURIComponent(url)}`;
            return `href=${q}${trackingUrl}${q}`;
          });
        }

        if (trackPixel && trackingId && !bodyHtml.includes('/api/tracking/open?id=')) {
          const pixelUrl = `${origin}/api/tracking/open?id=${trackingId}`;
          bodyHtml += `\n<br><img src="${pixelUrl}" alt="" width="1" height="1" style="width:1px;height:1px;border:0;" />`;
        }
      }

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
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al enviar correo');
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
    <div className="container mx-auto space-y-6">
      <PageHeader title="Campañas" description="Separa reconexión inteligente y seguimiento clásico. Las campañas activas se revisan automáticamente desde el cron principal de ANTONIA." />

      {mode.kind === 'list' && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-border/60 bg-card/80 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.14)]">
              <CardHeader className="pb-2"><CardDescription>Total</CardDescription><CardTitle className="text-2xl">{campaignOverview.total}</CardTitle></CardHeader>
            </Card>
            <Card className="border-border/60 bg-card/80 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.14)]">
              <CardHeader className="pb-2"><CardDescription>Activas</CardDescription><CardTitle className="text-2xl">{campaignOverview.active}</CardTitle></CardHeader>
            </Card>
            <Card className="border-border/60 bg-card/80 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.14)]">
              <CardHeader className="pb-2"><CardDescription>Reconexión</CardDescription><CardTitle className="text-2xl">{campaignOverview.reconnection}</CardTitle></CardHeader>
            </Card>
            <Card className="border-border/60 bg-card/80 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.14)]">
              <CardHeader className="pb-2"><CardDescription>Sin ejecución automática</CardDescription><CardTitle className="text-2xl">{campaignOverview.missingAutomation}</CardTitle></CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Mis campañas</CardTitle>
                <CardDescription>Reconexión para difundir algo nuevo. Seguimiento para perseguir automáticamente mensajes ya enviados.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Filtrar y crear</div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant={campaignTypeFilter === 'all' ? 'secondary' : 'outline'} size="sm" onClick={() => setCampaignTypeFilter('all')}>Todas</Button>
                      <Button variant={campaignTypeFilter === 'reconnection' ? 'secondary' : 'outline'} size="sm" onClick={() => setCampaignTypeFilter('reconnection')}>Reconexión</Button>
                      <Button variant={campaignTypeFilter === 'follow_up' ? 'secondary' : 'outline'} size="sm" onClick={() => setCampaignTypeFilter('follow_up')}>Seguimiento</Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => startCreate('follow_up')}><Plus className="mr-2 h-4 w-4" />Nueva de seguimiento</Button>
                    <Button onClick={() => startCreate('reconnection')}><Sparkles className="mr-2 h-4 w-4" />Nueva de reconexión</Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border bg-background px-3 py-1">Activas: {campaignOverview.active}</span>
                  <span className="rounded-full border bg-background px-3 py-1">Pendientes de revisar: {campaignOverview.missingAutomation}</span>
                  <span className="rounded-full border bg-background px-3 py-1">Separadas por tipo para evitar mezclar reconexión con seguimiento</span>
                </div>
              </div>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Pasos</TableHead>
                        <TableHead>Métricas</TableHead>
                        <TableHead>Automatización</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No hay campañas para este filtro.</TableCell></TableRow>
                    ) : filteredItems.map((c) => {
                        const campaignSettings = c.settings || createDefaultCampaignSettings({ campaignType: c.campaignType });
                        return <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-medium">{c.name}</div>
                          {c.campaignType === 'reconnection' ? (
                            <div className="text-xs text-muted-foreground">
                              Reactivacion · {campaignSettings.audience?.reactivation.minDaysSinceLastContact ?? defaultCampaignReactivationSettings.minDaysSinceLastContact}d · {campaignSettings.reconnection?.brief?.offerName || getReactivationSummary(campaignSettings.audience?.reactivation || defaultCampaignReactivationSettings)}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">Seguimiento clasico por offset</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={c.campaignType === 'reconnection' ? 'default' : 'outline'}>{getCampaignTypeLabel(c.campaignType)}</Badge>
                        </TableCell>
                        <TableCell>{c.steps.length}</TableCell>
                        <TableCell>
                          {(() => {
                            const m = metricsByCampaignId[c.id] || { totalSent: 0, opened: 0, replied: 0, clicked: 0 };
                            return (
                              <div className="text-xs text-muted-foreground">
                                Env: <span className="text-foreground font-medium">{m.totalSent}</span> · Abr: <span className="text-foreground font-medium">{m.opened}</span> · Clic: <span className="text-foreground font-medium">{m.clicked}</span> · Resp: <span className="text-foreground font-medium">{m.replied}</span>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant={getRunStatusVariant(c.lastRunStatus)}>{formatRunStatusLabel(c.lastRunStatus)}</Badge>
                            <div className="text-xs text-muted-foreground">Ultima revisión: {formatRunAt(c.lastRunAt)}</div>
                            {c.lastRunSummary?.eligibleCount !== undefined ? (
                              <div className="text-xs text-muted-foreground">
                                Elegibles: <span className="text-foreground font-medium">{c.lastRunSummary.eligibleCount ?? 0}</span> · Enviados: <span className="text-foreground font-medium">{c.lastRunSummary.sentCount ?? 0}</span>
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{c.isPaused ? 'Pausada' : 'Activa'}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button size="sm" variant="outline" onClick={() => doPreview(c)} disabled={previewLoading}><Eye className="mr-1 h-4 w-4" />{previewLoading ? 'Cargando...' : 'Previsualizar'}</Button>
                          <Button size="sm" variant="secondary" onClick={() => startEdit(c)}>Editar</Button>
                          <Button size="sm" variant="outline" onClick={() => togglePause(c)}>
                            {c.isPaused ? <Play className="mr-1 h-4 w-4" /> : <Pause className="mr-1 h-4 w-4" />}
                            {c.isPaused ? 'Reanudar' : 'Pausar'}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => askDelete(c.id)}>
                            <Trash2 className="mr-1 h-4 w-4" />Eliminar
                          </Button>
                        </TableCell>
                      </TableRow>;
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {mode.kind === 'edit' && (
        <Tabs defaultValue="editor" className="space-y-6">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div>
              <div className="mb-2"><Badge variant={draft.campaignType === 'reconnection' ? 'default' : 'outline'}>{getCampaignTypeLabel(draft.campaignType)}</Badge></div>
              <h2 className="text-2xl font-bold tracking-tight">{getCampaignEditorTitle(draft.campaignType, Boolean(draft.id))}</h2>
              <p className="text-muted-foreground">{getCampaignTypeDescription(draft.campaignType)}</p>
            </div>
            <div className="flex items-center gap-2">
              <TabsList>
                <TabsTrigger value="editor">Editor</TabsTrigger>
                <TabsTrigger value="analytics" disabled={!draft.id}>Analíticas</TabsTrigger>
                <TabsTrigger value="settings">Configuración</TabsTrigger>
              </TabsList>
              <div className="h-6 w-px bg-border mx-2" />
              <Button variant="outline" onClick={() => setMode({ kind: 'list' })}>Volver</Button>
              <Button onClick={saveCampaign} disabled={saving}>{saving ? 'Guardando...' : 'Guardar Cambios'}</Button>
            </div>
          </div>

          <TabsContent value="editor" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Pasos de la secuencia</CardTitle>
                    <div className="flex items-center gap-2">
                      <div className="flex bg-muted p-1 rounded-md">
                        <Button size="sm" variant={viewMode === 'list' ? 'secondary' : 'ghost'} className="h-7 px-2" onClick={() => setViewMode('list')}>Lista</Button>
                        <Button size="sm" variant={viewMode === 'flow' ? 'secondary' : 'ghost'} className="h-7 px-2" onClick={() => setViewMode('flow')}>Flujo</Button>
                      </div>
                      <Button variant="outline" size="sm" onClick={openAiGenerator}>
                        <Sparkles className="mr-2 h-4 w-4" />
                        IA
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Nombre de la campaña</label>
                      <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                    </div>

                    {draft.campaignType === 'reconnection' ? (
                      <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-medium">Brief de reconexion</div>
                            <p className="text-xs text-muted-foreground">
                              Describe el nuevo servicio o producto. Si un lead no tiene investigacion previa, la campaña la dispara automaticamente con n8n antes de personalizar el mensaje.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                              <Switch
                                id="reconnection-enabled"
                                checked={reconnectionSettings.enabled}
                                onCheckedChange={(checked) => updateReconnectionSettings({ enabled: checked })}
                              />
                              <Label htmlFor="reconnection-enabled">Personalizacion inteligente</Label>
                            </div>
                            <Button type="button" variant="secondary" size="sm" onClick={openAiGenerator}>
                              <Sparkles className="mr-2 h-4 w-4" />
                              Generar secuencia
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="grid gap-1.5">
                            <Label>Nombre del servicio</Label>
                            <Input
                              value={reconnectionSettings.brief.offerName}
                              onChange={(e) => updateReconnectionBrief({ offerName: e.target.value })}
                              placeholder="Ej: Auditoria SEO continua"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label>Audiencia ideal</Label>
                            <Input
                              value={reconnectionSettings.brief.audienceHint}
                              onChange={(e) => updateReconnectionBrief({ audienceHint: e.target.value })}
                              placeholder="Ej: Leads de marketing y growth en SaaS B2B"
                            />
                          </div>
                        </div>

                        <div className="grid gap-1.5">
                          <Label>Que quieres promocionar</Label>
                          <Textarea
                            rows={4}
                            value={reconnectionSettings.brief.offerSummary}
                            onChange={(e) => updateReconnectionBrief({ offerSummary: e.target.value })}
                            placeholder="Describe el servicio, problema que resuelve, para quien aplica y por que ahora vale la pena reconectar al lead."
                          />
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="grid gap-1.5">
                            <Label>Puntos de valor</Label>
                            <Textarea
                              rows={4}
                              value={toValuePointsText(reconnectionSettings.brief.valuePoints)}
                              onChange={(e) => updateReconnectionBrief({ valuePoints: parseValuePoints(e.target.value) })}
                              placeholder="Un punto por linea. Ej: Reduce tiempo operativo en 40%"
                            />
                          </div>
                          <div className="space-y-4">
                            <div className="grid gap-1.5">
                              <Label>CTA sugerido</Label>
                              <Input
                                value={reconnectionSettings.brief.cta}
                                onChange={(e) => updateReconnectionBrief({ cta: e.target.value })}
                                placeholder="Ej: Te parece si lo vemos en 15 minutos?"
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label>Tono</Label>
                              <Input
                                value={reconnectionSettings.brief.tone}
                                onChange={(e) => updateReconnectionBrief({ tone: e.target.value })}
                                placeholder="Ej: consultivo y cercano"
                              />
                            </div>
                            <div className="grid gap-3 pt-1">
                              <div className="flex items-center gap-2">
                                <Switch
                                  id="reconnection-auto-research"
                                  checked={reconnectionSettings.autoResearchOnSend}
                                  onCheckedChange={(checked) => updateReconnectionSettings({ autoResearchOnSend: checked })}
                                  disabled={!reconnectionSettings.enabled}
                                />
                                <Label htmlFor="reconnection-auto-research">Investigar automaticamente con n8n si falta contexto</Label>
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
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed bg-muted/20 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-medium">Seguimiento clásico</div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Esta campaña se dedica a enviar follow-ups automáticamente según los offsets definidos en cada paso. Ideal para no perseguir manualmente respuestas después del primer contacto.
                            </p>
                          </div>
                          <Button type="button" variant="secondary" size="sm" onClick={openAiGenerator}>
                            <Sparkles className="mr-2 h-4 w-4" />
                            Generar secuencia
                          </Button>
                        </div>
                      </div>
                    )}

                    {viewMode === 'list' ? (
                      <div className="space-y-4">
                        {draft.steps.map((s, idx) => (
                          <div key={s.id} id={`step-${s.id}`} className={cn("relative border rounded-lg p-4 bg-card hover:border-primary/50 transition-colors", activeStepId === s.id && "border-primary ring-1 ring-primary bg-primary/5")}>
                            <div className="absolute right-4 top-4">
                              <Button size="sm" variant="ghost" onClick={() => removeStep(s.id)} className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500">
                                <X className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="mb-4 flex items-center gap-2">
                              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                                {idx + 1}
                              </div>
                              <span className="text-sm font-medium">Paso {idx + 1}</span>
                              {idx > 0 && (
                                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                  Espera {s.offsetDays} días
                                </span>
                              )}
                            </div>

                            <div className="grid gap-4">
                              <div className="flex items-center justify-between">
                                <div className="grid md:grid-cols-2 gap-4 flex-1">
                                  <div className="grid gap-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Nombre del paso</label>
                                    <Input className="h-8" value={s.name} onChange={(e) =>
                                      setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x) }))
                                    } />
                                  </div>
                                  <div className="grid gap-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Días de espera (Offset)</label>
                                    <Input className="h-8" type="number" min={0} value={s.offsetDays}
                                      onChange={(e) => setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, offsetDays: Number(e.target.value || 0) } : x) }))} />
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 border-l pl-4 ml-4">
                                  <Label htmlFor={`ab-toggle-${s.id}`} className="text-xs">Prueba A/B</Label>
                                  <Switch id={`ab-toggle-${s.id}`} checked={!!s.variantB} onCheckedChange={(checked) => {
                                    setDraft(d => ({
                                      ...d,
                                      steps: d.steps.map(x => x.id === s.id ? {
                                        ...x,
                                        variantB: checked ? { subject: '', bodyHtml: '' } : undefined
                                      } : x)
                                    }));
                                  }} />
                                </div>
                              </div>

                              {s.variantB ? (
                                <Tabs defaultValue="A" className="w-full">
                                  <TabsList className="grid w-full grid-cols-2 h-8">
                                    <TabsTrigger value="A" className="text-xs">Variante A (Original)</TabsTrigger>
                                    <TabsTrigger value="B" className="text-xs">Variante B (Alternativa)</TabsTrigger>
                                  </TabsList>
                                  <TabsContent value="A" className="space-y-4 pt-4 border rounded-md p-4 mt-2">
                                    <div className="grid gap-1.5">
                                      <label className="text-xs font-medium text-muted-foreground">Asunto A</label>
                                      <Input className="h-9" value={s.subject} placeholder="Hola {{lead.name}}..."
                                        onChange={(e) => setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, subject: e.target.value } : x) }))} />
                                    </div>
                                    <div className="grid gap-1.5">
                                      <label className="text-xs font-medium text-muted-foreground">Cuerpo A</label>
                                      <Textarea rows={6} className="font-mono text-sm resize-none" value={s.bodyHtml} placeholder="Permite HTML básico y variables..."
                                        onChange={(e) => setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, bodyHtml: e.target.value } : x) }))} />
                                      <div className="text-[10px] text-muted-foreground flex gap-2">
                                        <span>Variables:</span>
                                        <code className="bg-muted px-1 rounded">{`{{lead.name}}`}</code>
                                        <code className="bg-muted px-1 rounded">{`{{company}}`}</code>
                                        <code className="bg-muted px-1 rounded">{`{{sender.name}}`}</code>
                                      </div>
                                    </div>
                                  </TabsContent>
                                  <TabsContent value="B" className="space-y-4 pt-4 border rounded-md p-4 mt-2 border-orange-200 bg-orange-50/30">
                                    <div className="grid gap-1.5">
                                      <label className="text-xs font-medium text-muted-foreground text-orange-800">Asunto B</label>
                                      <Input className="h-9 border-orange-200" value={s.variantB?.subject || ''} placeholder="Variante B..."
                                        onChange={(e) => setDraft((d) => ({
                                          ...d,
                                          steps: d.steps.map((x) => x.id === s.id ? { ...x, variantB: { ...x.variantB!, subject: e.target.value, bodyHtml: x.variantB!.bodyHtml } } : x)
                                        }))} />
                                    </div>
                                    <div className="grid gap-1.5">
                                      <label className="text-xs font-medium text-muted-foreground text-orange-800">Cuerpo B</label>
                                      <Textarea rows={6} className="font-mono text-sm resize-none border-orange-200" value={s.variantB?.bodyHtml || ''} placeholder="Versión alternativa..."
                                        onChange={(e) => setDraft((d) => ({
                                          ...d,
                                          steps: d.steps.map((x) => x.id === s.id ? { ...x, variantB: { ...x.variantB!, subject: x.variantB!.subject, bodyHtml: e.target.value } } : x)
                                        }))} />
                                    </div>
                                  </TabsContent>
                                </Tabs>
                              ) : (
                                <>
                                  <div className="grid gap-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Asunto</label>
                                    <Input className="h-9" value={s.subject} placeholder="Hola {{lead.name}}..."
                                      onChange={(e) => setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, subject: e.target.value } : x) }))} />
                                  </div>
                                  <div className="grid gap-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Cuerpo del correo</label>
                                    <Textarea rows={6} className="font-mono text-sm resize-none" value={s.bodyHtml} placeholder="Permite HTML básico y variables..."
                                      onChange={(e) => setDraft((d) => ({ ...d, steps: d.steps.map((x) => x.id === s.id ? { ...x, bodyHtml: e.target.value } : x) }))} />
                                    <div className="text-[10px] text-muted-foreground flex gap-2">
                                      <span>Variables:</span>
                                      <code className="bg-muted px-1 rounded">{`{{lead.name}}`}</code>
                                      <code className="bg-muted px-1 rounded">{`{{company}}`}</code>
                                      <code className="bg-muted px-1 rounded">{`{{sender.name}}`}</code>
                                    </div>
                                  </div>
                                </>
                              )}

                              <div className="grid gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Adjuntar archivos</label>
                                <Input className="text-xs" type="file" multiple onChange={(e) => onStepFile(e, s.id)} />
                                {s.attachments?.length ? <div className="text-xs text-green-600 flex items-center gap-1"><Sparkles className="w-3 h-3" /> {s.attachments.length} archivos adjuntos listos</div> : null}
                              </div>
                            </div>
                          </div>
                        ))}

                        <Button variant="outline" className="w-full border-dashed py-6" onClick={addStep}>
                          <Plus className="mr-2 h-4 w-4" />
                          Añadir siguiente paso
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
                        <div className="text-center text-xs text-muted-foreground">
                          Haz clic en un paso para editar su contenido.
                        </div>
                        <Button variant="outline" className="w-full border-dashed py-6" onClick={addStep}>
                          <Plus className="mr-2 h-4 w-4" />
                          Añadir siguiente paso
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="lg:col-span-1">
                {draft.id ? (
                  <div className="sticky top-6 h-[calc(100vh-100px)]">
                    <CommentsSection entityType="campaign" entityId={draft.id} />
                  </div>
                ) : (
                  <Card className="h-full flex items-center justify-center p-6 text-center text-muted-foreground bg-muted/30 border-dashed">
                    <div>
                      <p>Guarda la campaña para habilitar los comentarios.</p>
                    </div>
                  </Card>
                )}
              </div>
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
            <Card>
              <CardHeader>
                <CardTitle>Audiencia, exclusiones y configuración</CardTitle>
                <CardDescription>
                  {draft.campaignType === 'reconnection'
                    ? 'Configura la audiencia de reconexión, filtros de elegibilidad y exclusiones.'
                    : 'Configura tracking, horarios de envío y exclusiones para el seguimiento automático.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">

                <div>
                  <h3 className="text-sm font-medium mb-3">Envío Inteligente</h3>
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
                        <Label>Zona Horaria</Label>
                        <Input value={draft.settings.smartScheduling.timezone} onChange={(e) =>
                          setDraft(d => ({ ...d, settings: { ...d.settings, smartScheduling: { ...d.settings.smartScheduling!, timezone: e.target.value } } }))
                        } />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>Hora Inicio (0-23)</Label>
                        <Input type="number" min={0} max={23} value={draft.settings.smartScheduling.startHour} onChange={(e) =>
                          setDraft(d => ({ ...d, settings: { ...d.settings, smartScheduling: { ...d.settings.smartScheduling!, startHour: Number(e.target.value) } } }))
                        } />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>Hora Fin (0-23)</Label>
                        <Input type="number" min={0} max={23} value={draft.settings.smartScheduling.endHour} onChange={(e) =>
                          setDraft(d => ({ ...d, settings: { ...d.settings, smartScheduling: { ...d.settings.smartScheduling!, endHour: Number(e.target.value) } } }))
                        } />
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-px bg-border my-6" />

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

                <div className="h-px bg-border my-6" />

                {draft.campaignType === 'reconnection' ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium">Reactivacion de leads</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Usa esta opcion para volver a contactar leads ya trabajados, priorizando senales reales de entrega o interes.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id="reactivation-enabled"
                        checked={draft.settings.audience?.kind === 'reactivation'}
                        onCheckedChange={toggleReactivationAudience}
                      />
                      <Label htmlFor="reactivation-enabled">Activar filtros de reactivacion</Label>
                    </div>

                    {reactivationAudience ? (
                    <div className="space-y-4 border rounded-md p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <div className="grid gap-1.5">
                          <Label>Dias minimos desde el ultimo contacto</Label>
                          <Input
                            type="number"
                            min={0}
                            value={reactivationAudience.minDaysSinceLastContact}
                            onChange={(e) => updateReactivationSettings({ minDaysSinceLastContact: Number(e.target.value || 0) })}
                          />
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3 text-sm">
                          <div className="font-medium">Resumen del segmento</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {getReactivationSummary(reactivationAudience)}
                          </div>
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3 text-sm">
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
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Clicks sin reply</div>
                            <div className="text-lg font-semibold">{reactivationStats.clicked}</div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Aperturas sin reply</div>
                            <div className="text-lg font-semibold">{reactivationStats.opened}</div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Entregados sin apertura</div>
                            <div className="text-lg font-semibold">{reactivationStats.delivered}</div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Replies neutrales</div>
                            <div className="text-lg font-semibold">{reactivationStats.neutral}</div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Sin senal</div>
                            <div className="text-lg font-semibold">{reactivationStats.noSignal}</div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Fallidos / invalidos</div>
                            <div className="text-lg font-semibold">{reactivationStats.failedDelivery}</div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Do not contact</div>
                            <div className="text-lg font-semibold">{reactivationStats.doNotContact}</div>
                          </div>
                          <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">Demasiado recientes</div>
                            <div className="text-lg font-semibold">{reactivationStats.tooRecent}</div>
                          </div>
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
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    En seguimiento clásico no necesitas segmentar por reactivación: el sistema revisa automáticamente offsets, replies, unsubscribe y exclusiones para decidir a quién tocar en cada corrida.
                  </div>
                )}

                <div className="h-px bg-border my-6" />

                <div className="space-y-3">
                  <div className="text-sm font-medium">Leads contactados que NO participarán</div>
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
                                <Checkbox checked={checked} onCheckedChange={(v) => onExcludeToggle(id, Boolean(v))} />
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
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* === Modal de Previsualización === */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[min(96vw,1100px)] p-0">
          <div className="flex max-h-[80vh] flex-col">
            <div className="sticky top-0 z-10 border-b bg-background/90 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <DialogHeader className="mb-2">
                <DialogTitle>Leads elegibles</DialogTitle>
              </DialogHeader>
              {previewLoading ? null : (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px_180px]">
                    <div className="relative">
                      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={eligibleNameFilter}
                        onChange={(e) => setEligibleNameFilter(e.target.value)}
                        placeholder="Buscar por nombre, email o empresa"
                        className="pl-9"
                      />
                    </div>
                    <select
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
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={eligibleStepFilter}
                      onChange={(e) => setEligibleStepFilter(e.target.value)}
                    >
                      <option value="all">Todos los pasos</option>
                      {previewStepOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <select
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={eligibleIndustryFilter}
                      onChange={(e) => setEligibleIndustryFilter(e.target.value)}
                    >
                      <option value="all">Todas las industrias</option>
                      {previewIndustryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>

                  <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
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
                  <div className="ml-auto flex gap-2">
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

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {previewLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Calculando elegibles…</div>
              ) : (
                <Table className="w-full">
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

      {/* Diálogo de confirmación de borrado */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="bg-background border rounded-lg p-5 w-full max-w-md">
            <div className="text-lg font-semibold mb-2">Eliminar campaña</div>
            <p className="text-sm text-muted-foreground mb-4">Esta acción no se puede deshacer. ¿Eliminar definitivamente?</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={cancelDelete}>Cancelar</Button>
              <Button onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Eliminar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
