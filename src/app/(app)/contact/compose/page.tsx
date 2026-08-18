
'use client';
import { Suspense } from 'react';
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { enrichedOpportunitiesStorage } from '@/lib/services/enriched-opportunities-service';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { sendEmail } from '@/lib/outlook-email-service';
import type { EnrichedLead, EnrichedOppLead, StyleProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { v4 as uuid } from 'uuid';
import { extractPrimaryEmail } from '@/lib/email-utils';
import { renderTemplate } from '@/lib/template';
import { buildSenderInfo, applySignaturePlaceholders } from '@/lib/signature-placeholders';
import * as Quota from '@/lib/quota-client';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { ensureSubjectPrefix } from '@/lib/outreach-templates';
import { generateCompanyOutreachV2 } from '@/lib/outreach-templates';
import { findReportForLead } from '@/lib/lead-research-storage';
import { getFirstNameSafe } from '@/lib/template';
import { sendGmailEmail } from '@/lib/gmail-email-service';
import { styleProfilesStorage } from '@/lib/style-profiles-storage';
import { restyleDraftWithProfile } from '@/lib/email-style-restyle';
import { profileService, type Profile } from '@/lib/services/profile-service';
import { buildEffectiveCompanyProfile } from '@/lib/signature-placeholders';
import { ContactabilityStatusCard } from '@/components/commercial/ContactabilityStatusCard';
import { CampaignQaPanel } from '@/components/commercial/CampaignQaPanel';
import { useContactability } from '@/hooks/use-contactability';
import { assessCampaignQa } from '@/lib/campaign-qa';
import { resolveManualEmailOperation, type ManualEmailOperation } from '@/lib/manual-send-idempotency';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, ChevronDown, FileText, Loader2, RefreshCw, SendHorizontal, Settings2 } from 'lucide-react';

type AnyLead = EnrichedLead | EnrichedOppLead | any;

function htmlToPlainParas(htmlOrText: string): string {
  if (!htmlOrText) return '';
  let s = String(htmlOrText);
  s = s.replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

function ComposeInner() {
  const { toast } = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const id = sp.get('id') || '';
  const [lead, setLead] = useState<AnyLead | null>(null);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [draftSource, setDraftSource] = useState<'investigation' | 'style'>('investigation');
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [selectedStyleName, setSelectedStyleName] = useState<string>('');
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [sendOperation, setSendOperation] = useState<ManualEmailOperation | null>(null);

  function readComposeBuffer(leadId: string): AnyLead | null {
    try {
      const key = `compose-lead:${leadId}`;
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // limpiar buffer para no dejar basura
      sessionStorage.removeItem(key);
      return parsed;
    } catch { return null; }
  }

  useEffect(() => {
    if (!id) return;

    async function loadLead() {
      // 0) buffer temporal desde la página de enriquecidos
      const buffered = readComposeBuffer(id);
      if (buffered) { setLead(buffered); return; }

      // 1) & 2) Enriched Leads (merged)
      let found: AnyLead | undefined = await enrichedLeadsStorage.findEnrichedLeadById(id);
      let source = 'leads';

      if (!found) {
        // Try searching in opportunities
        const opp = await enrichedOpportunitiesStorage.findEnrichedLeadById(id);
        if (opp) {
          found = opp;
          source = 'opportunities';
        }
      }

      if (found) {
        (found as any)._sourceTable = source;
        setLead(found);
        return;
      }

      // 3) contactados (por si se registró antes de abrir compose)
      const contacted = await contactedLeadsStorage.findByLeadId(id);
      if (contacted) {
        setLead({
          id,
          fullName: contacted.name,
          email: contacted.email,
          companyName: contacted.company,
          title: (contacted as any).title || '',
          companyDomain: (contacted as any).companyDomain || '',
        } as any);
        return;
      }

      // 4) fallback a reporte (si existe)
      // Note: findReportForLead is still sync/local for now.
      const rep = findReportForLead({ leadId: id, companyDomain: null, companyName: null });
      if (rep?.cross) {
        setLead({
          id,
          fullName: (rep as any)?.lead?.fullName || '',
          email: (rep as any)?.lead?.email || '',
          companyName: rep.cross.company?.name || '',
          companyDomain: rep.cross.company?.domain || '',
          title: (rep as any)?.lead?.title || '',
        } as any);
      }
    }
    loadLead();
  }, [id]);
  useEffect(() => {
    const list = styleProfilesStorage.list();
    setStyleProfiles(list);
    setSelectedStyleName(prev => prev || (list[0]?.name || ''));
  }, []);

  useEffect(() => {
    let active = true;

    async function loadCurrentProfile() {
      try {
        const profile = await profileService.getCurrentProfile();
        if (!active) return;
        setCurrentProfile(profile);
      } catch (error) {
        if (!active) return;
        console.error('No se pudo cargar el perfil actual para compose', error);
        setCurrentProfile(null);
      }
    }

    loadCurrentProfile();
    return () => {
      active = false;
    };
  }, []);

  const buildBaseDraftForLead = useCallback((leadObj: AnyLead, opts?: { forceRegenerate?: boolean }) => {
    const company = buildEffectiveCompanyProfile(currentProfile);
    const sender = buildSenderInfo(currentProfile);
    const leadData = {
      firstName: (leadObj?.fullName || '').split(' ')[0] || '',
      name: leadObj?.fullName || '',
      email: leadObj?.email || '',
      company: leadObj?.companyName || '',
    };

    // Si hay parámetros en URL y NO estamos forzando regeneración, respétalos.
    const generatedSubject = !opts?.forceRegenerate ? (sp.get('subject') || '') : '';
    const generatedBody = !opts?.forceRegenerate ? (sp.get('body') || '') : '';
    const rep = findReportForLead({
      leadId: (leadObj as any).id || (leadObj as any).email || null,
      companyDomain: (leadObj as any).companyDomain || null,
      companyName: (leadObj as any).companyName || null,
    });

    let initialSubject: string;
    let initialBody: string;

    if (generatedSubject && generatedBody) {
      initialSubject = generatedSubject;
      initialBody = generatedBody;
    } else {
      if (rep?.cross?.emailDraft?.body) {
        initialSubject = rep.cross.emailDraft.subject || 'Propuesta';
        initialBody = htmlToPlainParas(rep.cross.emailDraft.body || '');
      } else {
        const v2 = generateCompanyOutreachV2({
          leadFirstName: leadData.firstName,
          companyName: leadData.company,
          myCompanyProfile: company,
        });
        initialSubject = v2.subjectBase;
        initialBody = v2.body;
      }
    }

    // 1) Plantillas {{lead.*}} / {{company.*}} / {{sender.*}}
    let subj = renderTemplate(initialSubject || '', { lead: leadData, company, sender });
    let bod = renderTemplate(initialBody || '', { lead: leadData, company, sender });
    // 2) Firma y placeholders humanos
    bod = applySignaturePlaceholders(bod, sender);
    bod = htmlToPlainParas(bod);
    // 3) Solo aseguramos el prefijo con el nombre en el ASUNTO (no tocamos el cuerpo estilo empresa).
    subj = ensureSubjectPrefix(subj, leadData.firstName);
    return {
      subject: subj,
      body: bod,
      report: rep?.cross || null,
      leadData,
      company,
    };
  }, [currentProfile, sp]);

  const buildDraftForLead = useCallback(async (leadObj: AnyLead, opts?: { forceRegenerate?: boolean }) => {
    const base = buildBaseDraftForLead(leadObj, opts);

    if (draftSource !== 'style' || styleProfiles.length === 0) {
      return { subject: base.subject, body: base.body };
    }

    const profile = styleProfiles.find(p => p.name === selectedStyleName) || styleProfiles[0];
    if (!profile) {
      return { subject: base.subject, body: base.body };
    }

    const styled = await restyleDraftWithProfile({
      mode: (leadObj as any)?._sourceTable === 'opportunities' ? 'opportunities' : 'leads',
      baseSubject: base.subject,
      baseBody: base.body,
      styleProfile: profile,
      lead: {
        id: (leadObj as any).id,
        fullName: base.leadData.name,
        email: base.leadData.email,
        title: (leadObj as any).title,
        companyName: base.leadData.company,
        companyDomain: (leadObj as any).companyDomain,
      },
      report: base.report,
      companyProfile: base.company,
    });

    return {
      subject: ensureSubjectPrefix(styled.subject, base.leadData.firstName),
      body: htmlToPlainParas(styled.body),
    };
  }, [buildBaseDraftForLead, draftSource, selectedStyleName, styleProfiles]);

  const [usePixel, setUsePixel] = useState(true);
  const [useReadReceipt, setUseReadReceipt] = useState(false);
  const [useLinkTracking, setUseLinkTracking] = useState(false);
  const [sendProvider, setSendProvider] = useState<'outlook' | 'gmail'>('outlook');
  const [showDeliveryOptions, setShowDeliveryOptions] = useState(false);

  useEffect(() => {
    if (!lead) return;
    let cancelled = false;
    void buildDraftForLead(lead).then((tuned) => {
      if (cancelled) return;
      setSubject(tuned.subject);
      setBody(tuned.body);
    }).catch((e: any) => {
      if (cancelled) return;
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudo aplicar la personalizacion.' });
    });
    return () => { cancelled = true; };
  }, [lead, buildDraftForLead, toast]);

  const { email: composeEmail } = lead ? extractPrimaryEmail(lead) : { email: '' };
  const contactability = useContactability(composeEmail);
  const campaignQa = assessCampaignQa({
    email: composeEmail,
    subject,
    body,
    usePixel,
    useLinkTracking,
    useReadReceipt,
    contactability: contactability.result,
    contactabilityLoading: Boolean(composeEmail) && contactability.loading,
    contactabilityError: contactability.error,
  });
  const campaignQaBlocksSend = campaignQa.status === 'blocked';
  const contactabilityChecking = Boolean(composeEmail) && contactability.loading;

  const canContinueWithContact = () => {
    if (contactabilityChecking) {
      toast({ title: 'Verificando contacto', description: 'Espera unos segundos mientras revisamos si este email puede recibir mensajes.' });
      return false;
    }
    if (campaignQaBlocksSend) {
      const firstBlockingCheck = campaignQa.checks.find((check) => check.severity === 'blocked');
      toast({
        variant: 'destructive',
        title: 'Revisa el QA antes de enviar',
        description: firstBlockingCheck?.message || 'Hay un bloqueo activo en este correo.',
      });
      return false;
    }
    return true;
  };

  const regenerate = async () => {
    if (!lead) return;
    setIsRegenerating(true);
    try {
      const tuned = await buildDraftForLead(lead, { forceRegenerate: true });
      setSubject(tuned.subject);
      setBody(tuned.body);
      toast({ title: 'Borrador actualizado', description: 'Se regeneró el asunto y el cuerpo con el nuevo formato.' });
    } finally {
      setIsRegenerating(false);
    }
  };

  const doSendOutlook = async () => {
    const { email } = extractPrimaryEmail(lead);
    if (!email) {
      toast({ variant: 'destructive', title: 'Sin email', description: 'Este lead no tiene email revelado.' });
      return;
    }
    if (!canContinueWithContact()) return;
    setIsLoading(true);
    try {
      const researchSnapshotId = String(findReportForLead({
        leadId: String((lead as any).id || ''),
        email,
      })?.raw?.research_snapshot_id || '').trim() || null;
      const operation = resolveManualEmailOperation(sendOperation, {
        scope: 'manual-compose',
        recipientId: String((lead as any).id || ''),
        email,
        subject,
        body,
        provider: 'outlook',
        deliveryOptions: { pixel: usePixel, links: useLinkTracking, readReceipt: useReadReceipt },
      }, uuid);
      setSendOperation(operation);
      const trackingId = operation.trackingId;
      let finalHtmlBody = body.replace(/\n/g, '<br>');

      const res = await sendEmail({
        to: email,
        subject,
        htmlBody: finalHtmlBody,
        requestReceipts: useReadReceipt, // Pass new option
        leadId: String((lead as any).id || ''),
        researchSnapshotId,
        idempotencyKey: operation.idempotencyKey,
        trackingId,
        tracking: { pixel: usePixel, linkTracking: useLinkTracking },
      });

      // Incrementa espejo local de cuota
      Quota.incClientQuota('contact');

      await contactedLeadsStorage.add({
        id: trackingId, // Use the pre-generated ID
        leadId: (lead as any).id,
        name: (lead as any).fullName,
        email,
        company: (lead as any).companyName,
        subject,
        sentAt: new Date().toISOString(),
        status: 'sent',
        provider: 'outlook',
        messageId: res.messageId,
        conversationId: res.conversationId,
        internetMessageId: res.internetMessageId,
        lastUpdateAt: new Date().toISOString(),
      });
      // ✅ quitar de Oportunidades Enriquecidas (storage correcto)
      // Remove from source
      if ((lead as any)._sourceTable === 'opportunities') {
        await enrichedOpportunitiesStorage.removeById((lead as any).id);
      } else {
        await enrichedLeadsStorage.removeById((lead as any).id);
      }

      toast({ title: 'Enviado con Outlook', description: `Correo enviado a ${(lead as any).fullName}.` });
      setSendOperation(null);
      router.back();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo enviar con Outlook', description: e?.message || 'Revisa la conexion y vuelve a intentarlo.' });
    } finally {
      setIsLoading(false);
    }
  };

  const doSendGmail = async () => {
    const { email } = extractPrimaryEmail(lead);
    if (!email) {
      toast({ variant: 'destructive', title: 'Sin email', description: 'Este lead no tiene email revelado.' });
      return;
    }
    if (!canContinueWithContact()) return;
    setIsLoading(true);
    try {
      const researchSnapshotId = String(findReportForLead({
        leadId: String((lead as any).id || ''),
        email,
      })?.raw?.research_snapshot_id || '').trim() || null;
      const operation = resolveManualEmailOperation(sendOperation, {
        scope: 'manual-compose',
        recipientId: String((lead as any).id || ''),
        email,
        subject,
        body,
        provider: 'gmail',
        deliveryOptions: { pixel: usePixel, links: useLinkTracking, readReceipt: false },
      }, uuid);
      setSendOperation(operation);
      const trackingId = operation.trackingId;
      let finalHtmlBody = body.replace(/\n/g, '<br>');

      const result = await sendGmailEmail({
        to: email,
        subject: subject,
        html: finalHtmlBody,
        leadId: String((lead as any).id || ''),
        researchSnapshotId,
        idempotencyKey: operation.idempotencyKey,
        trackingId,
        tracking: { pixel: usePixel, linkTracking: useLinkTracking },
      });

      Quota.incClientQuota('contact');

      await contactedLeadsStorage.add({
        id: trackingId, // Use pre-generated ID
        leadId: (lead as any).id,
        name: (lead as any).fullName,
        email,
        company: (lead as any).companyName,
        subject,
        sentAt: new Date().toISOString(),
        status: 'sent',
        provider: 'gmail',
        messageId: result.id,
        threadId: result.threadId,
        lastUpdateAt: new Date().toISOString(),
      });

      // ✅ quitar de Oportunidades Enriquecidas (storage correcto)
      if ((lead as any)._sourceTable === 'opportunities') {
        await enrichedOpportunitiesStorage.removeById((lead as any).id);
      } else {
        await enrichedLeadsStorage.removeById((lead as any).id);
      }
      toast({ title: 'Enviado con Gmail', description: `Correo enviado a ${(lead as any).fullName}.` });
      setSendOperation(null);
      router.back();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo enviar con Gmail', description: e?.message || 'Revisa la conexion y vuelve a intentarlo.' });
    } finally {
      setIsLoading(false);
    }
  };

  if (!lead) return <div className="p-6">Lead no encontrado. Vuelve a la lista de guardados.</div>;

  const displayEmail = composeEmail;

  const send = sendProvider === 'outlook' ? doSendOutlook : doSendGmail;
  const isBlocked = isLoading || contactabilityChecking || campaignQaBlocksSend;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <Button type="button" variant="outline" size="icon" className="mt-0.5 shrink-0 rounded-full" onClick={() => router.back()} aria-label="Volver a leads enriquecidos">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Nuevo contacto</p>
            <h1 className="truncate text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{(lead as any).fullName}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {(lead as any).title || 'Sin cargo'}{(lead as any).companyName ? ` · ${(lead as any).companyName}` : ''}{displayEmail ? ` · ${displayEmail}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 rounded-full border border-border/70 bg-muted/30 p-1" role="group" aria-label="Proveedor de envío">
          {(['outlook', 'gmail'] as const).map((provider) => (
            <Button
              key={provider}
              type="button"
              size="sm"
              variant={sendProvider === provider ? 'secondary' : 'ghost'}
              className="h-8 rounded-full px-3 capitalize"
              aria-pressed={sendProvider === provider}
              onClick={() => setSendProvider(provider)}
            >
              {provider}
            </Button>
          ))}
        </div>
      </header>

      <div className="grid gap-2">
        <ContactabilityStatusCard
          compact
          email={displayEmail}
          result={contactability.result}
          loading={contactability.loading}
          error={contactability.error}
          onRetry={contactability.refresh}
        />
        <CampaignQaPanel result={campaignQa} compact />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
        <Card className="overflow-hidden border-border/60 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.32)]">
          <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 py-4">
            <div>
              <CardTitle className="text-base">Borrador</CardTitle>
              <CardDescription className="mt-1">Revisa el mensaje antes de enviarlo.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={regenerate} disabled={isRegenerating || isLoading}>
              {isRegenerating ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
              Regenerar
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="space-y-2">
              <label htmlFor="compose-subject" className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Asunto</label>
              <Input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto" className="h-11" />
            </div>
            <div className="space-y-2">
              <label htmlFor="compose-body" className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Mensaje</label>
              <Textarea id="compose-body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} className="min-h-[390px] resize-y text-[15px] leading-7" />
            </div>
          </CardContent>
        </Card>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Origen del borrador</CardTitle>
              <CardDescription>Elige cómo preparar el mensaje.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-muted/30 p-1">
                <Button type="button" size="sm" variant={draftSource === 'investigation' ? 'secondary' : 'ghost'} className="rounded-lg" onClick={() => setDraftSource('investigation')}>Investigación</Button>
                <Button type="button" size="sm" variant={draftSource === 'style' ? 'secondary' : 'ghost'} className="rounded-lg" onClick={() => {
                  setDraftSource('style');
                  if (!selectedStyleName && styleProfiles.length) setSelectedStyleName(styleProfiles[0].name);
                }}>Estilo</Button>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="compose-style" className="text-xs font-medium text-muted-foreground">Perfil de estilo</label>
                <select
                  id="compose-style"
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={draftSource !== 'style' || styleProfiles.length === 0}
                  value={selectedStyleName}
                  onChange={(e) => setSelectedStyleName(e.target.value)}
                >
                  {styleProfiles.length === 0 ? <option value="">No hay estilos guardados</option> : styleProfiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
                </select>
              </div>
            </CardContent>
          </Card>

          <Collapsible open={showDeliveryOptions} onOpenChange={setShowDeliveryOptions}>
            <Card className="border-border/60">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" className="flex h-auto w-full items-center justify-between rounded-xl px-4 py-3 text-left hover:bg-muted/50">
                  <span className="flex items-center gap-2 text-sm font-medium"><Settings2 className="size-4 text-muted-foreground" />Opciones de seguimiento</span>
                  <ChevronDown className={`size-4 text-muted-foreground transition-transform ${showDeliveryOptions ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4 border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Detectar aperturas</p><p className="text-xs text-muted-foreground">Usa un píxel de seguimiento.</p></div><Switch checked={usePixel} onCheckedChange={setUsePixel} aria-label="Detectar aperturas" /></div>
                  <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Medir clics</p><p className="text-xs text-muted-foreground">Hace rastreables los enlaces.</p></div><Switch checked={useLinkTracking} onCheckedChange={setUseLinkTracking} aria-label="Medir clics" /></div>
                  <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Solicitar confirmación</p><p className="text-xs text-muted-foreground">El destinatario puede rechazarla.</p></div><Switch checked={useReadReceipt} onCheckedChange={setUseReadReceipt} aria-label="Solicitar confirmación de lectura" /></div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </aside>
      </div>

      <footer className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">El mensaje se enviará por {sendProvider === 'outlook' ? 'Outlook' : 'Gmail'}.</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancelar</Button>
          <Button type="button" onClick={send} disabled={isBlocked}>
            {isLoading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <SendHorizontal data-icon="inline-start" />}
            {isLoading ? 'Enviando…' : contactabilityChecking ? 'Verificando…' : `Enviar con ${sendProvider === 'outlook' ? 'Outlook' : 'Gmail'}`}
          </Button>
        </div>
      </footer>
    </main>
  );
}

export const dynamic = 'force-dynamic';

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Cargando…</div>}>
      <ComposeInner />
    </Suspense>
  );
}
