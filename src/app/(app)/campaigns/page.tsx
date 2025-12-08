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
import { Trash2, Plus, Pause, Play, Eye, X, Sparkles, MessageSquare } from 'lucide-react';
import { computeEligibilityForCampaign, type EligiblePreviewRow } from '@/lib/campaign-eligibility';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { googleAuthService } from '@/lib/google-auth-service';
import type { ContactedLead } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { CommentsSection } from '@/components/comments-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignAnalytics } from '@/components/campaigns/CampaignAnalytics';
import { CampaignFlow } from '@/components/campaigns/CampaignFlow';
import { cn } from '@/lib/utils';

type Mode = { kind: 'list' } | { kind: 'edit'; id?: string };

type DraftStep = CampaignStep & { _files?: File[] };

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
  const selectedCount = selectedIds.size;
  const allSelected = previewRows.length > 0 && selectedCount === previewRows.length;
  const someSelected = selectedCount > 0 && !allSelected;

  // Editor state
  const [draft, setDraft] = useState<{
    id?: string;
    name: string;
    steps: DraftStep[];
    excludedLeadIds: string[];
    settings: NonNullable<Campaign['settings']>;
  }>({
    name: 'Nueva campaña',
    steps: [{ id: crypto.randomUUID(), name: 'Follow-up 1', offsetDays: 3, subject: '', bodyHtml: '', attachments: [] }],
    excludedLeadIds: [],
    settings: { smartScheduling: { enabled: false, timezone: 'UTC', startHour: 9, endHour: 17 } }
  });

  const [contacted, setContacted] = useState<ContactedLead[]>([]);

  useEffect(() => {
    async function load() {
      if (authLoading) return;
      if (!user) return; // or handle unauthenticated state

      setItems(await campaignsStorage.get());
      setContacted(await contactedLeadsStorage.get());
    }
    load();
  }, [authLoading, user]);

  function startCreate() {
    setDraft({
      name: 'Nueva campaña',
      steps: [{ id: crypto.randomUUID(), name: 'Follow-up 1', offsetDays: 3, subject: '', bodyHtml: '', attachments: [] }],
      excludedLeadIds: [],
      settings: { smartScheduling: { enabled: false, timezone: 'UTC', startHour: 9, endHour: 17 } }
    });
    setMode({ kind: 'edit' });
  }

  function startEdit(c: Campaign) {
    setDraft({
      id: c.id,
      name: c.name,
      steps: c.steps.map((s) => ({ ...s })),
      excludedLeadIds: [...c.excludedLeadIds],
      settings: c.settings || { smartScheduling: { enabled: false, timezone: 'UTC', startHour: 9, endHour: 17 } }
    });
    setMode({ kind: 'edit', id: c.id });
  }

  function addStep() {
    setDraft((d) => ({
      ...d,
      steps: [...d.steps, { id: crypto.randomUUID(), name: `Follow-up ${d.steps.length + 1}`, offsetDays: 3, subject: '', bodyHtml: '', attachments: [] }],
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
      if (draft.id) {
        await campaignsStorage.update(draft.id, {
          name: draft.name,
          steps,
          excludedLeadIds: draft.excludedLeadIds,
          settings: draft.settings
        });
        toast({ title: 'Campaña actualizada', description: 'Se guardaron los cambios.' });
      } else {
        await campaignsStorage.add({
          name: draft.name,
          steps,
          excludedLeadIds: draft.excludedLeadIds,
          settings: draft.settings
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
      const allIds = contacted.map((c: any) => String(c.leadId)).filter(Boolean);
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

      // Render template
      // Note: We don't have sender name easily available without auth service call.
      // We can default to 'Mi Empresa' or fetch profile if needed.
      // For now, let's use a generic placeholder or try to get it from profile if stored.
      const senderName = 'Mi Empresa'; // TODO: Fetch from profile service

      const subject = renderTemplate(step.subject || '', contacted, { name: senderName });
      const rawBody = renderTemplate(step.bodyHtml || '', contacted, { name: senderName });
      const bodyHtml = normalizeBodyHtml(rawBody);

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
      setSelectedIds(new Set(previewRows.map(r => r.leadId)));
    } else {
      setSelectedIds(new Set());
    }
  };


  async function generateCampaign() {
    if (!aiGoal.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/generate-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: aiGoal,
          targetAudience: aiAudience,
          companyName: 'Mi Empresa', // TODO: Get from profile
          language: 'es',
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

      setDraft(d => ({ ...d, steps: newSteps }));
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
      <PageHeader title="Campañas" description="Crea campañas con pasos, excluye leads y previsualiza elegibles." />

      {mode.kind === 'list' && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Mis campañas</CardTitle>
                <CardDescription>Administra, pausa/reanuda, previsualiza y elimina.</CardDescription>
              </div>
              <Button onClick={startCreate}><Plus className="mr-2 h-4 w-4" />Nueva campaña</Button>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Pasos</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No hay campañas.</TableCell></TableRow>
                    ) : items.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.steps.length}</TableCell>
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
                      </TableRow>
                    ))}
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
              <h2 className="text-2xl font-bold tracking-tight">{draft.id ? 'Gestionar Campaña' : 'Nueva Campaña'}</h2>
              <p className="text-muted-foreground">Configura los pasos, revisa métricas y ajusta exclusiones.</p>
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
                      <Button variant="outline" size="sm" onClick={() => setAiOpen(true)}>
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
                <CardTitle>Exclusiones y Configuración Avanzada</CardTitle>
                <CardDescription>Gestiona quiénes no deben recibir correos de esta campaña.</CardDescription>
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
                        ) : contacted.map((cl: any) => {
                          const id = String(cl.leadId || '');
                          const checked = draft.excludedLeadIds.includes(id);
                          return (
                            <TableRow key={id}>
                              <TableCell>
                                <Checkbox checked={checked} onCheckedChange={(v) => onExcludeToggle(id, Boolean(v))} />
                              </TableCell>
                              <TableCell>{cl.name}</TableCell>
                              <TableCell>{cl.company || '—'}</TableCell>
                              <TableCell>{cl.email}</TableCell>
                              <TableCell>{cl.status}</TableCell>
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
                    {previewRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          No hay leads elegibles todavía.
                        </TableCell>
                      </TableRow>
                    ) : (
                      previewRows.map((row) => (
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
                            </div>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="text-sm">
                              {row.nextStep?.name ?? `Paso ${row.nextStepIdx + 1}`}
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
            <DialogTitle>Generar campaña con IA</DialogTitle>
            <DialogDescription>
              Describe el objetivo de tu campaña y la IA generará los pasos, asuntos y correos por ti.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="ai-goal">Objetivo de la campaña</Label>
              <Textarea
                id="ai-goal"
                placeholder="Ej: Recuperar clientes que pidieron presupuesto pero no compraron..."
                value={aiGoal}
                onChange={(e) => setAiGoal(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ai-audience">Público objetivo (Opcional)</Label>
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
