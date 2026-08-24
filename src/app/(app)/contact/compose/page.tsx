
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
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { sendEmail } from '@/lib/outlook-email-service';
import { getCompanyProfile } from '@/lib/data';
import type { EnrichedLead, EnrichedOppLead, StyleProfile } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { v4 as uuid } from 'uuid';
import { extractPrimaryEmail } from '@/lib/email-utils';
import { renderTemplate } from '@/lib/template';
import { buildSenderInfo, applySignaturePlaceholders } from '@/lib/signature-placeholders';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { ensureSubjectPrefix } from '@/lib/outreach-templates';
import { generateCompanyOutreachV2 } from '@/lib/outreach-templates';
import { findReportForLead } from '@/lib/lead-research-storage';
import { getFirstNameSafe } from '@/lib/template';
import { sendGmailEmail } from '@/lib/gmail-email-service';
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
import { ArrowLeft, CheckCircle2, ChevronDown, FileText, Loader2, RefreshCw, SendHorizontal, Settings2, Sparkles } from 'lucide-react';

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
  const nativeDraftId = sp.get('draftId') || '';
  const isCanonicalDraft = Boolean(nativeDraftId);
  const [lead, setLead] = useState<AnyLead | null>(null);
  const [leadLoading, setLeadLoading] = useState(Boolean(id) && !isCanonicalDraft);
  const [leadLoadError, setLeadLoadError] = useState<string | null>(null);
  const [leadReloadKey, setLeadReloadKey] = useState(0);
  const [nativeDraft, setNativeDraft] = useState<any | null>(null);
  const [nativeDraftLoading, setNativeDraftLoading] = useState(isCanonicalDraft);
  const [nativeDraftLoadError, setNativeDraftLoadError] = useState<string | null>(null);
  const [nativeDraftReloadKey, setNativeDraftReloadKey] = useState(0);
  const [nativeDraftSaving, setNativeDraftSaving] = useState(false);
  const [nativeDraftApproving, setNativeDraftApproving] = useState(false);
  const [nativeDraftRewriting, setNativeDraftRewriting] = useState(false);
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [rewriteError, setRewriteError] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [draftSource, setDraftSource] = useState<'investigation' | 'style'>('investigation');
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [selectedStyleName, setSelectedStyleName] = useState<string>('');
  const [styleProfilesError, setStyleProfilesError] = useState(false);
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
    if (isCanonicalDraft) {
      setLeadLoading(false);
      setLeadLoadError(null);
      return;
    }

    if (!id) {
      setLead(null);
      setLeadLoading(false);
      setLeadLoadError(null);
      return;
    }

    let active = true;
    setLead(null);
    setLeadLoading(true);
    setLeadLoadError(null);

    async function loadLead() {
      try {
        // 0) buffer temporal desde la página de enriquecidos
        const buffered = readComposeBuffer(id);
        if (buffered) {
          if (active) setLead(buffered);
          return;
        }

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
          if (active) setLead(found);
          return;
        }

        // 3) contactados (por si se registró antes de abrir compose)
        const contacted = await contactedLeadsStorage.findByLeadId(id);
        if (contacted) {
          if (active) {
            setLead({
              id,
              fullName: contacted.name,
              email: contacted.email,
              companyName: contacted.company,
              title: (contacted as any).title || '',
              companyDomain: (contacted as any).companyDomain || '',
            } as any);
          }
          return;
        }

        // 4) fallback a reporte (si existe)
        // Note: findReportForLead is still sync/local for now.
        const rep = findReportForLead({ leadId: id, companyDomain: null, companyName: null });
        if (rep?.cross && active) {
          setLead({
            id,
            fullName: (rep as any)?.lead?.fullName || '',
            email: (rep as any)?.lead?.email || '',
            companyName: rep.cross.company?.name || '',
            companyDomain: rep.cross.company?.domain || '',
            title: (rep as any)?.lead?.title || '',
          } as any);
        }
      } catch (error) {
        console.error('No se pudo cargar el contacto para compose', error);
        if (active) setLeadLoadError('No pudimos cargar el contacto. Inténtalo nuevamente o vuelve a la lista.');
      } finally {
        if (active) setLeadLoading(false);
      }
    }

    void loadLead();
    return () => { active = false; };
  }, [id, isCanonicalDraft, leadReloadKey]);

  useEffect(() => {
    if (!nativeDraftId) {
      setNativeDraft(null);
      setNativeDraftLoading(false);
      setNativeDraftLoadError(null);
      return;
    }

    let active = true;
    setNativeDraft(null);
    setNativeDraftLoading(true);
    setNativeDraftLoadError(null);

    async function loadNativeDraft() {
      try {
        const response = await fetch(`/api/native-drafts/${encodeURIComponent(nativeDraftId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.draft) throw new Error('No se pudo cargar el correo.');
        if (!active) return;
        const draft = payload.draft;
        setNativeDraft(draft);
        setSubject(draft?.content?.subject || '');
        setBody(draft?.content?.text || '');
        setLead({
          id: draft?.recipient?.leadRef || nativeDraftId,
          fullName: draft?.recipient?.displayName || 'Contacto',
          email: draft?.recipient?.email || '',
          companyName: '',
          title: '',
        });
      } catch (error) {
        console.error('No se pudo cargar el correo para revisión', error);
        if (active) setNativeDraftLoadError('No pudimos cargar este correo. Inténtalo nuevamente.');
      } finally {
        if (active) setNativeDraftLoading(false);
      }
    }

    void loadNativeDraft();
    return () => { active = false; };
  }, [nativeDraftId, nativeDraftReloadKey]);

  useEffect(() => {
    let active = true;

    async function loadStyleProfiles() {
      try {
        const response = await fetch('/api/email-styles', { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.styles)) throw new Error('No se pudieron cargar los estilos.');
        if (!active) return;
        const list = payload.styles.map((style: any) => ({
          ...(style?.profile || {}),
          id: String(style?.id || ''),
          name: String(style?.name || style?.profile?.name || 'Estilo sin nombre'),
          isDefault: Boolean(style?.isDefault),
        })) as StyleProfile[];
        setStyleProfiles(list);
        setSelectedStyleName((current) => current || list.find((profile) => profile.isDefault)?.name || list[0]?.name || '');
        setStyleProfilesError(false);
      } catch (error) {
        console.error('No se pudieron cargar los estilos de email', error);
        if (active) setStyleProfilesError(true);
      }
    }

    void loadStyleProfiles();
    return () => { active = false; };
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
    if (!lead || nativeDraftId) return;
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
  }, [lead, buildDraftForLead, nativeDraftId, toast]);

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
  const hasNativeEdits = Boolean(
    isCanonicalDraft
    && nativeDraft
    && (
      subject !== String(nativeDraft?.content?.subject || '')
      || body !== String(nativeDraft?.content?.text || '')
    ),
  );
  const nativeReviewComplete = Boolean(
    isCanonicalDraft
    && nativeDraft?.lifecycle === 'ready'
    && nativeDraft?.approval?.status === 'approved'
    && nativeDraft?.preflight?.status === 'passed',
  );
  const nativeDraftArchived = Boolean(isCanonicalDraft && nativeDraft?.lifecycle === 'archived');
  const nativeReviewRequired = Boolean(
    isCanonicalDraft
    && !nativeDraftArchived
    && (!nativeReviewComplete || hasNativeEdits),
  );
  const shouldShowCampaignQa = !nativeDraftArchived
    && (!isCanonicalDraft || !nativeReviewRequired || campaignQaBlocksSend);

  const canContinueWithContact = () => {
    if (isCanonicalDraft && (nativeDraftLoading || nativeDraftLoadError || nativeDraftArchived || nativeReviewRequired)) {
      toast({
        title: 'Revisa el correo antes de enviarlo',
        description: hasNativeEdits
          ? 'Guarda los cambios y confirma la revisión antes de enviarlo.'
          : 'Este correo requiere una revisión explícita antes de enviarlo.',
      });
      return false;
    }
    if (contactabilityChecking) {
      toast({ title: 'Verificando contacto', description: 'Espera unos segundos mientras revisamos si este email puede recibir mensajes.' });
      return false;
    }
    if (campaignQaBlocksSend) {
      const firstBlockingCheck = campaignQa.checks.find((check) => check.severity === 'blocked');
      toast({
        variant: 'destructive',
        title: 'Corrige el correo antes de enviarlo',
        description: firstBlockingCheck?.message || 'Hay un bloqueo activo en este correo.',
      });
      return false;
    }
    return true;
  };

  // Helper to inject link tracking
  function rewriteLinksForTracking(html: string, trackingId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    // Unify regex with the robust one from EmailTestPage
    return html.replace(/href=(["'])(http[^"']+)\1/gi, (match: string, quote: string, url: string) => {
      if (url.includes('/api/tracking/click')) return match;
      const trackingUrl = `${origin}/api/tracking/click?id=${trackingId}&url=${encodeURIComponent(url)}`;
      return `href=${quote}${trackingUrl}${quote}`;
    });
  }

  const regenerate = async () => {
    if (!lead || nativeDraftId) return;
    setIsRegenerating(true);
    try {
      const tuned = await buildDraftForLead(lead, { forceRegenerate: true });
      setSubject(tuned.subject);
      setBody(tuned.body);
      toast({ title: 'Correo actualizado', description: 'Actualizamos el asunto y el mensaje.' });
    } finally {
      setIsRegenerating(false);
    }
  };

  const saveNativeDraft = async () => {
    if (!nativeDraftId || !hasNativeEdits) return;
    setNativeDraftSaving(true);
    try {
      const response = await fetch(`/api/native-drafts/${encodeURIComponent(nativeDraftId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, text: body }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft) throw new Error('No se pudo guardar el correo.');
      setNativeDraft(payload.draft);
      setSubject(payload?.draft?.content?.subject || subject);
      setBody(payload?.draft?.content?.text || body);
      toast({ title: 'Cambios guardados', description: 'Revisa el correo y confirma la revisión antes de enviarlo.' });
    } catch (error) {
      console.error('No se pudo guardar el correo', error);
      toast({ variant: 'destructive', title: 'No se pudo guardar', description: 'Vuelve a intentarlo.' });
    } finally {
      setNativeDraftSaving(false);
    }
  };

  const approveNativeDraft = async () => {
    if (!nativeDraftId || !nativeDraft?.versionId || hasNativeEdits || nativeDraftArchived || campaignQaBlocksSend || contactabilityChecking) return;
    setNativeDraftApproving(true);
    try {
      const response = await fetch(`/api/native-drafts/${encodeURIComponent(nativeDraftId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: nativeDraft.versionId, warnings: campaignQa.reviewCount ? ['Hay observaciones para revisar antes de enviar.'] : [] }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft) throw new Error('No se pudo confirmar la revisión.');
      setNativeDraft(payload.draft);
      toast({ title: 'Correo revisado', description: 'Ya está listo para enviarse.' });
    } catch (error) {
      console.error('No se pudo confirmar la revisión del correo', error);
      toast({ variant: 'destructive', title: 'No se pudo confirmar la revisión', description: 'Revisa el correo e inténtalo nuevamente.' });
    } finally {
      setNativeDraftApproving(false);
    }
  };

  const rewriteNativeDraftWithAi = async () => {
    const instruction = rewriteInstruction.trim();
    if (!nativeDraftId || !instruction || hasNativeEdits || nativeDraftArchived) return;
    setNativeDraftRewriting(true);
    setRewriteError(null);
    try {
      const selectedStyle = styleProfiles.find((profile) => profile.name === selectedStyleName);
      const response = await fetch(`/api/native-drafts/${encodeURIComponent(nativeDraftId)}/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          styleProfileId: selectedStyle?.id || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft) {
        throw new Error(payload?.message || 'No se pudo aplicar el ajuste.');
      }
      setNativeDraft(payload.draft);
      setSubject(payload.draft?.content?.subject || '');
      setBody(payload.draft?.content?.text || '');
      setRewriteInstruction('');
      toast({
        title: 'Correo ajustado',
        description: 'Creamos una nueva revisión. Confírmala antes de enviar.',
      });
    } catch (error: any) {
      console.error('No se pudo ajustar el correo con IA', error);
      setRewriteError(error?.message || 'No pudimos aplicar el ajuste. Inténtalo nuevamente.');
    } finally {
      setNativeDraftRewriting(false);
    }
  };

  const doSendOutlook = async () => {
    const { email } = extractPrimaryEmail(lead);
    if (!email) {
      toast({ variant: 'destructive', title: 'Sin email', description: 'Este contacto no tiene un email disponible.' });
      return;
    }
    if (!canContinueWithContact()) return;
    if (!nativeDraft?.draftId || !nativeDraft?.versionId) {
      toast({
        variant: 'destructive',
        title: 'Borrador aprobado requerido',
        description: 'Genera, revisa y aprueba este correo antes de enviarlo.',
      });
      return;
    }
    setIsLoading(true);
    try {
      const researchSnapshotId = String(findReportForLead({
        leadId: String((lead as any).id || ''),
        email,
      })?.raw?.research_snapshot_id || '').trim() || nativeDraft?.researchSnapshotId || null;
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

      // 2. Rewrite Links if enabled
      if (useLinkTracking) {
        finalHtmlBody = rewriteLinksForTracking(finalHtmlBody, trackingId);
      }

      // 3. Inject Pixel if enabled
      if (usePixel) {
        // Use window.location.origin to get the current domain
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        let pixelUrl = `${origin}/api/tracking/open?id=${trackingId}`;

        // OPTIMIZATION: Redirect to logo if available
        const profile = getCompanyProfile();
        if (profile?.logo && profile.logo.startsWith('http')) {
          pixelUrl += `&redirect=${encodeURIComponent(profile.logo)}`;
        }

        // FIX: Removed display:none to prevent blocking by email clients
        const trackingPixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="width:1px;height:1px;border:0;" />`;
        finalHtmlBody += `\n<br>${trackingPixel}`;
      }

      await sendEmail({
        to: email,
        subject,
        htmlBody: finalHtmlBody,
        requestReceipts: useReadReceipt, // Pass new option
        leadId: String((lead as any).id || ''),
        researchSnapshotId,
        draftId: nativeDraft?.draftId || null,
        versionId: nativeDraft?.versionId || null,
        idempotencyKey: operation.idempotencyKey,
      });

      // The dispatch finalizer owns authoritative history and quota writes.
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
      toast({ variant: 'destructive', title: 'Sin email', description: 'Este contacto no tiene un email disponible.' });
      return;
    }
    if (!canContinueWithContact()) return;
    if (!nativeDraft?.draftId || !nativeDraft?.versionId) {
      toast({
        variant: 'destructive',
        title: 'Borrador aprobado requerido',
        description: 'Genera, revisa y aprueba este correo antes de enviarlo.',
      });
      return;
    }
    setIsLoading(true);
    try {
      const researchSnapshotId = String(findReportForLead({
        leadId: String((lead as any).id || ''),
        email,
      })?.raw?.research_snapshot_id || '').trim() || nativeDraft?.researchSnapshotId || null;
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

      // 2. Rewrite Links if enabled
      if (useLinkTracking) {
        finalHtmlBody = rewriteLinksForTracking(finalHtmlBody, trackingId);
      }

      // 3. Inject Pixel if enabled
      if (usePixel) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        let pixelUrl = `${origin}/api/tracking/open?id=${trackingId}`;

        // OPTIMIZATION: Redirect to logo
        const profile = getCompanyProfile();
        if (profile?.logo && profile.logo.startsWith('http')) {
          pixelUrl += `&redirect=${encodeURIComponent(profile.logo)}`;
        }

        // FIX: Removed display:none
        const trackingPixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="width:1px;height:1px;border:0;" />`;
        finalHtmlBody += `\n<br>${trackingPixel}`;
      }

      await sendGmailEmail({
        to: email,
        subject: subject,
        html: finalHtmlBody,
        leadId: String((lead as any).id || ''),
        researchSnapshotId,
        draftId: nativeDraft?.draftId || null,
        versionId: nativeDraft?.versionId || null,
        idempotencyKey: operation.idempotencyKey,
      });

      // The dispatch finalizer owns authoritative history and quota writes.

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

  const loadError = nativeDraftLoadError || leadLoadError;
  if (nativeDraftLoading || leadLoading) {
    return (
      <main aria-busy="true" className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Revisar correo</p>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Cargando correo…</h1>
        </div>
        <Card className="border-border/60">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-72 w-full" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Revisar correo</p>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">No pudimos cargar el correo</h1>
        </div>
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
          <AlertTitle>Inténtalo nuevamente</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => router.back()}>
            Volver
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => isCanonicalDraft ? setNativeDraftReloadKey((value) => value + 1) : setLeadReloadKey((value) => value + 1)}
          >
            Reintentar
          </Button>
        </div>
      </main>
    );
  }

  if (!lead) {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Revisar correo</p>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">No encontramos el contacto</h1>
        </div>
        <Card className="border-border/60">
          <CardContent className="flex flex-col items-start gap-4 p-5 sm:p-6">
            <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">El correo no está disponible</p>
              <p className="text-sm leading-6 text-muted-foreground">Vuelve a la lista, elige un contacto y abre su correo desde allí.</p>
            </div>
            <Button type="button" onClick={() => router.back()}>Volver</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const displayEmail = composeEmail;
  const send = sendProvider === 'outlook' ? doSendOutlook : doSendGmail;
  const isSendBlocked = isLoading
    || nativeDraftSaving
    || nativeDraftApproving
    || nativeDraftRewriting
    || contactabilityChecking
    || campaignQaBlocksSend
    || nativeDraftArchived
    || nativeReviewRequired;
  const isReviewActionBlocked = nativeDraftApproving
    || nativeDraftSaving
    || nativeDraftRewriting
    || isLoading
    || contactabilityChecking
    || campaignQaBlocksSend;
  const reviewStatus = nativeDraftArchived
    ? {
      title: 'Correo no disponible',
      description: 'Este correo ya no puede enviarse desde esta pantalla.',
      className: 'border-border bg-muted/40 text-foreground',
      icon: FileText,
    }
    : hasNativeEdits
      ? {
        title: 'Cambios pendientes de revisión',
        description: 'Guárdalos y confirma la revisión antes de enviar.',
        className: 'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
        icon: RefreshCw,
      }
      : nativeReviewComplete
        ? {
          title: 'Correo revisado',
          description: 'Está listo para enviarse cuando tú decidas.',
          className: 'border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100',
          icon: CheckCircle2,
        }
        : {
          title: 'Revisión pendiente',
          description: 'Este correo no se enviará hasta que confirmes la revisión.',
          className: 'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
          icon: FileText,
        };
  const ReviewStatusIcon = reviewStatus.icon;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 pb-24 sm:px-6 sm:py-6 sm:pb-24">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="mt-0.5 shrink-0 rounded-full"
            onClick={() => router.back()}
            aria-label="Volver"
            disabled={isLoading || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Contacto individual</p>
            <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Revisar correo</h1>
            <p className="truncate text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{(lead as any).fullName || 'Contacto'}</span>
              {[(lead as any).title, (lead as any).companyName, displayEmail].filter(Boolean).length > 0 ? ` · ${[(lead as any).title, (lead as any).companyName, displayEmail].filter(Boolean).join(' · ')}` : ''}
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
              className="h-8 rounded-full px-3"
              aria-label={`Usar ${provider === 'outlook' ? 'Outlook' : 'Gmail'} para enviar`}
              aria-pressed={sendProvider === provider}
              disabled={isLoading || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting}
              onClick={() => setSendProvider(provider)}
            >
              {provider === 'outlook' ? 'Outlook' : 'Gmail'}
            </Button>
          ))}
        </div>
      </header>

      <section aria-label="Estado del correo" className="grid gap-2">
        {isCanonicalDraft ? (
          <div
            id="review-status"
            role={nativeDraftArchived ? 'alert' : 'status'}
            aria-live="polite"
            className={`rounded-xl border px-3 py-2.5 ${reviewStatus.className}`}
          >
            <div className="flex items-start gap-2.5">
              <ReviewStatusIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{reviewStatus.title}</p>
                <p className="text-xs leading-5 opacity-80">{reviewStatus.description}</p>
              </div>
            </div>
          </div>
        ) : null}
        <ContactabilityStatusCard
          compact
          email={displayEmail}
          result={contactability.result}
          loading={contactability.loading}
          error={contactability.error}
          onRetry={contactability.refresh}
        />
        {shouldShowCampaignQa ? <CampaignQaPanel result={campaignQa} compact /> : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
        <section aria-labelledby="email-editor-heading" className="min-w-0">
          <Card className="overflow-hidden border-border/60 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.32)]">
            <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 py-4">
              <div>
                <CardTitle id="email-editor-heading" className="text-base">Correo</CardTitle>
                <CardDescription className="mt-1">
                  {isCanonicalDraft ? 'Revísalo y confirma la revisión antes de enviarlo.' : 'Revisa el mensaje antes de enviarlo.'}
                </CardDescription>
              </div>
              {!isCanonicalDraft ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={regenerate}
                  disabled={isRegenerating || isLoading}
                >
                  {isRegenerating ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
                  Regenerar
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="space-y-2">
                <Label htmlFor="compose-subject" className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Asunto</Label>
                <Input
                  id="compose-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Escribe un asunto"
                  className="h-11"
                  aria-describedby={isCanonicalDraft ? 'review-status' : undefined}
                  disabled={nativeDraftArchived || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="compose-body" className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Mensaje</Label>
                <Textarea
                  id="compose-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Escribe tu mensaje"
                  rows={16}
                  className="min-h-[390px] resize-y text-[15px] leading-7"
                  aria-describedby={isCanonicalDraft ? 'review-status' : undefined}
                  disabled={nativeDraftArchived || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting}
                />
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {isCanonicalDraft ? (
            <section aria-labelledby="ai-adjustment-heading">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle id="ai-adjustment-heading" className="flex items-center gap-2 text-base">
                    <Sparkles className="size-4 text-primary" aria-hidden="true" />
                    Ajustar con IA
                  </CardTitle>
                  <CardDescription>Cambia el tono o la estructura sin perder el contexto investigado.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="native-compose-style" className="text-xs font-medium text-muted-foreground">Estilo</Label>
                    <select
                      id="native-compose-style"
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={nativeDraftRewriting || styleProfiles.length === 0}
                      value={selectedStyleName}
                      onChange={(event) => {
                        setSelectedStyleName(event.target.value);
                        setRewriteError(null);
                      }}
                    >
                      {styleProfiles.length === 0
                        ? <option value="">Estilo actual del correo</option>
                        : styleProfiles.map((profile) => (
                          <option key={profile.id || profile.name} value={profile.name}>
                            {profile.name}{profile.isDefault ? ' · Predeterminado' : ''}
                          </option>
                        ))}
                    </select>
                    {styleProfilesError ? (
                      <p className="text-xs leading-5 text-muted-foreground">No pudimos cargar tus estilos. Aún puedes indicar el ajuste manualmente.</p>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="native-rewrite-instruction" className="text-xs font-medium text-muted-foreground">Qué quieres cambiar</Label>
                    <Textarea
                      id="native-rewrite-instruction"
                      value={rewriteInstruction}
                      onChange={(event) => {
                        setRewriteInstruction(event.target.value);
                        setRewriteError(null);
                      }}
                      rows={4}
                      maxLength={1_000}
                      placeholder="Ej. hazlo más directo, con párrafos más breves y un tono consultivo"
                      className="min-h-24 resize-y leading-6"
                      disabled={nativeDraftArchived || nativeDraftRewriting}
                    />
                  </div>
                  {hasNativeEdits ? (
                    <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">Guarda primero tus cambios manuales para aplicar un ajuste con IA.</p>
                  ) : null}
                  <div aria-live="polite">
                    {rewriteError ? <p className="text-sm leading-5 text-destructive">{rewriteError}</p> : null}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => void rewriteNativeDraftWithAi()}
                    disabled={!rewriteInstruction.trim() || hasNativeEdits || nativeDraftArchived || nativeDraftRewriting || nativeDraftSaving || nativeDraftApproving}
                  >
                    {nativeDraftRewriting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Sparkles data-icon="inline-start" />}
                    {nativeDraftRewriting ? 'Ajustando…' : 'Aplicar ajuste'}
                  </Button>
                </CardContent>
              </Card>
            </section>
          ) : null}

          {!isCanonicalDraft ? (
            <section aria-labelledby="message-preparation-heading">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle id="message-preparation-heading" className="text-base">Preparación</CardTitle>
                  <CardDescription>Elige cómo preparar el correo.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-muted/30 p-1" role="group" aria-label="Forma de preparar el correo">
                    <Button
                      type="button"
                      size="sm"
                      variant={draftSource === 'investigation' ? 'secondary' : 'ghost'}
                      className="rounded-lg"
                      aria-pressed={draftSource === 'investigation'}
                      onClick={() => setDraftSource('investigation')}
                    >
                      Sugerencia
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={draftSource === 'style' ? 'secondary' : 'ghost'}
                      className="rounded-lg"
                      aria-pressed={draftSource === 'style'}
                      onClick={() => {
                        setDraftSource('style');
                        if (!selectedStyleName && styleProfiles.length) setSelectedStyleName(styleProfiles[0].name);
                      }}
                    >
                      Estilo
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="compose-style" className="text-xs font-medium text-muted-foreground">Perfil de estilo</Label>
                    <select
                      id="compose-style"
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={draftSource !== 'style' || styleProfiles.length === 0}
                      value={selectedStyleName}
                      onChange={(event) => setSelectedStyleName(event.target.value)}
                    >
                      {styleProfiles.length === 0 ? <option value="">No hay estilos guardados</option> : styleProfiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
                    </select>
                  </div>
                </CardContent>
              </Card>
            </section>
          ) : null}

          <Collapsible open={showDeliveryOptions} onOpenChange={setShowDeliveryOptions}>
            <Card className="border-border/60">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" className="flex h-auto w-full items-center justify-between rounded-xl px-4 py-3 text-left hover:bg-muted/50">
                  <span className="flex items-center gap-2 text-sm font-medium"><Settings2 className="size-4 text-muted-foreground" aria-hidden="true" />Opciones de seguimiento</span>
                  <ChevronDown className={`size-4 text-muted-foreground transition-transform ${showDeliveryOptions ? 'rotate-180' : ''}`} aria-hidden="true" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4 border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label htmlFor="tracking-opens" className="text-sm font-medium">Detectar aperturas</Label>
                      <p id="tracking-opens-description" className="mt-1 text-xs text-muted-foreground">Usa un píxel de seguimiento.</p>
                    </div>
                    <Switch id="tracking-opens" checked={usePixel} onCheckedChange={setUsePixel} aria-describedby="tracking-opens-description" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label htmlFor="tracking-clicks" className="text-sm font-medium">Medir clics</Label>
                      <p id="tracking-clicks-description" className="mt-1 text-xs text-muted-foreground">Hace rastreables los enlaces.</p>
                    </div>
                    <Switch id="tracking-clicks" checked={useLinkTracking} onCheckedChange={setUseLinkTracking} aria-describedby="tracking-clicks-description" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label htmlFor="tracking-receipt" className="text-sm font-medium">Solicitar confirmación</Label>
                      <p id="tracking-receipt-description" className="mt-1 text-xs text-muted-foreground">El destinatario puede rechazarla.</p>
                    </div>
                    <Switch id="tracking-receipt" checked={useReadReceipt} onCheckedChange={setUseReadReceipt} aria-describedby="tracking-receipt-description" />
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </aside>
      </div>

      <footer aria-label="Acciones del correo" className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p id="send-summary" className="text-xs leading-5 text-muted-foreground">
          {nativeDraftArchived
            ? 'Este correo ya no está disponible.'
            : hasNativeEdits
              ? 'Guarda los cambios y vuelve a revisar el correo antes de enviarlo.'
              : nativeReviewRequired
                ? 'Este correo no se enviará hasta que confirmes la revisión.'
                : `Se enviará por ${sendProvider === 'outlook' ? 'Outlook' : 'Gmail'}.`}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => router.back()}
            disabled={isLoading || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting}
          >
            Cancelar
          </Button>
          {nativeDraftArchived ? (
            <Button type="button" className="w-full sm:w-auto" disabled>
              Correo no disponible
            </Button>
          ) : hasNativeEdits ? (
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => void saveNativeDraft()}
              disabled={nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting || isLoading}
              aria-describedby="review-status"
            >
              {nativeDraftSaving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FileText data-icon="inline-start" />}
              {nativeDraftSaving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          ) : isCanonicalDraft && !nativeReviewComplete ? (
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => void approveNativeDraft()}
              disabled={isReviewActionBlocked}
              aria-describedby="review-status"
            >
              {nativeDraftApproving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <CheckCircle2 data-icon="inline-start" />}
              {nativeDraftApproving ? 'Confirmando…' : contactabilityChecking ? 'Verificando contacto…' : 'Revisar y aprobar'}
            </Button>
          ) : (
            <Button type="button" className="w-full sm:w-auto" onClick={send} disabled={isSendBlocked} aria-describedby="send-summary">
              {isLoading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <SendHorizontal data-icon="inline-start" />}
              {isLoading ? 'Enviando…' : contactabilityChecking ? 'Verificando…' : 'Enviar correo'}
            </Button>
          )}
        </div>
      </footer>
    </main>
  );
}

export const dynamic = 'force-dynamic';

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Cargando correo…</div>}>
      <ComposeInner />
    </Suspense>
  );
}
