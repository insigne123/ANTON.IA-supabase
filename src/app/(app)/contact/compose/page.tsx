
'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
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
import { FirstContactFollowUpPlan } from '@/components/campaigns-v2/FirstContactFollowUpPlan';
import { RewriteProposalReview } from '@/components/campaigns-v2/RewriteProposalReview';
import { quickRewrites, readRewriteProposal, reconcileSavedText, versionConflictMessage, type RewriteProposal } from '@/components/campaigns-v2/draft-editor-behavior';
import { useComposeUnsavedGuard } from '@/components/campaigns-v2/useComposeUnsavedGuard';
import {
  campaignV2DispatchReceipt,
  campaignV2SendAvailability,
  loadCampaignV2RecipientStepSendContext,
  loadFirstContactFollowUpPlan,
  resolveCampaignV2SendKey,
  type FirstContactFollowUpPlan as FirstContactFollowUpPlanData,
} from '@/lib/campaigns-v2-client';
import type { CampaignV2RecipientStepSendContextResponse } from '@/lib/campaigns-v2/contracts';
import type { DurableSendReceipt } from '@/lib/outbound-send-receipt';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowLeft, CheckCircle2, ChevronDown, FileText, Loader2, RefreshCw, SendHorizontal, Sparkles } from 'lucide-react';

type AnyLead = EnrichedLead | EnrichedOppLead | any;

const canonicalDeliveryOptions = { pixel: false, links: false, readReceipt: false } as const;

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

function formatFollowUpDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-CL', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function nextFollowUpStep(plan?: FirstContactFollowUpPlanData | null) {
  if (!plan) return null;
  return plan.steps.find((step) => !['sent', 'completed', 'cancelled', 'stopped'].includes(String(step.state || '').toLowerCase()))
    || plan.steps[0]
    || null;
}

function ComposeInner() {
  const { toast } = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const id = sp.get('id') || '';
  const nativeDraftId = sp.get('draftId') || '';
  const campaignStepId = sp.get('campaignStepId') || '';
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
  const [proposal, setProposal] = useState<RewriteProposal | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const editorTextRef = useRef({ subject, body });
  editorTextRef.current = { subject, body };
  const currentVersionRef = useRef(nativeDraft?.versionId);
  currentVersionRef.current = nativeDraft?.versionId;
  const draftOperationRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [draftSource, setDraftSource] = useState<'investigation' | 'style'>('investigation');
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string>('');
  const [rewriteStyleProfileId, setRewriteStyleProfileId] = useState<string>('');
  const [styleProfilesError, setStyleProfilesError] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [sendOperation, setSendOperation] = useState<ManualEmailOperation | null>(null);
  const [sendReceipt, setSendReceipt] = useState<DurableSendReceipt | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendProvider, setSendProvider] = useState<'outlook' | 'gmail'>('outlook');
  const [campaignSendContext, setCampaignSendContext] = useState<CampaignV2RecipientStepSendContextResponse | null>(null);
  const [campaignSendContextLoading, setCampaignSendContextLoading] = useState(Boolean(campaignStepId));
  const [campaignSendContextError, setCampaignSendContextError] = useState<string | null>(null);
  const [campaignSendContextReloadKey, setCampaignSendContextReloadKey] = useState(0);
  const [followUpPlan, setFollowUpPlan] = useState<FirstContactFollowUpPlanData | null>(null);
  const [followUpDirty, setFollowUpDirty] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const successHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const handleFollowUpPlanChange = useCallback((plan: FirstContactFollowUpPlanData | null) => {
    setFollowUpPlan(plan);
  }, []);

  useEffect(() => {
    setSendOperation(null);
    setSendReceipt(null);
    setSendError(null);
    setFollowUpPlan(null);
    setFollowUpDirty(false);
    setFollowUpBusy(false);
    setRewriteInstruction('');
    setRewriteStyleProfileId('');
    setRewriteError(null);
    setProposal(null);
    setSaveError(null);
  }, [nativeDraftId]);


  useEffect(() => {
    if (!campaignStepId) {
      setCampaignSendContext(null);
      setCampaignSendContextLoading(false);
      setCampaignSendContextError(null);
      return;
    }

    let active = true;
    const controller = new AbortController();
    setCampaignSendContextLoading(true);
    setCampaignSendContextError(null);

    async function loadSendContext() {
      try {
        const context = await loadCampaignV2RecipientStepSendContext(campaignStepId, controller.signal);
        if (!active) return;
        setCampaignSendContext(context);
        if (context.dispatch) {
          setSendOperation(null);
          setSendError(null);
          setSendReceipt(campaignV2DispatchReceipt(context.dispatch));
          if (context.dispatch.provider === 'gmail' || context.dispatch.provider === 'outlook') {
            setSendProvider(context.dispatch.provider);
          }
        } else {
          setSendReceipt(null);
        }
      } catch (error: any) {
        if (!active || error?.name === 'AbortError') return;
        setCampaignSendContext(null);
        setCampaignSendContextError(error?.message || 'No pudimos confirmar el estado de este envío.');
      } finally {
        if (active) setCampaignSendContextLoading(false);
      }
    }

    void loadSendContext();
    return () => {
      active = false;
      controller.abort();
    };
  }, [campaignStepId, campaignSendContextReloadKey]);

  useEffect(() => {
    if (sendReceipt?.status !== 'sent') return;
    window.requestAnimationFrame(() => successHeadingRef.current?.focus());
  }, [sendReceipt?.status]);

  function readComposeBuffer(leadId: string): AnyLead | null {
    try {
      const key = `compose-lead:${leadId}`;
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Keep this tab-scoped fallback available for retries and Strict Mode effect replay.
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
        const response = await fetch('/api/email-styles?includePresets=true', { cache: 'no-store' });
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
        setSelectedStyleId((current) => current || list.find((profile) => profile.isDefault)?.id || list[0]?.id || '');
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

    const profile = styleProfiles.find(p => p.id === selectedStyleId) || styleProfiles[0];
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
  }, [buildBaseDraftForLead, draftSource, selectedStyleId, styleProfiles]);

  const [showAiAdjustment, setShowAiAdjustment] = useState(false);

  const { email: composeEmail } = lead ? extractPrimaryEmail(lead) : { email: '' };
  const contactability = useContactability(composeEmail);
  const campaignQa = assessCampaignQa({
    email: composeEmail,
    subject,
    body,
    usePixel: false,
    useLinkTracking: false,
    useReadReceipt: false,
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
  useComposeUnsavedGuard(hasNativeEdits || followUpDirty || followUpBusy || Boolean(proposal) || nativeDraftSaving || nativeDraftRewriting || nativeDraftApproving || isLoading || creatingDraft || Boolean(rewriteInstruction.trim()));
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
  const campaignSendContextMismatch = Boolean(
    campaignStepId
    && campaignSendContext
    && (
      !campaignSendContext.nativeDraftId
      || !campaignSendContext.nativeVersionId
      || !nativeDraft?.organizationId
      || campaignSendContext.organizationId !== nativeDraft.organizationId
      || campaignSendContext.nativeDraftId !== nativeDraftId
      || (
        !campaignSendContext.dispatch
        && nativeDraft?.versionId
        && campaignSendContext.nativeVersionId !== nativeDraft.versionId
      )
    ),
  );
  const campaignDispatchVersionMismatch = Boolean(
    campaignSendContext?.dispatch
    && nativeDraft?.versionId
    && campaignSendContext.nativeVersionId !== nativeDraft.versionId,
  );
  const campaignSendDecision = campaignSendContext
    ? campaignV2SendAvailability(campaignSendContext)
    : null;
  const sendOrganizationId = String(campaignSendContext?.organizationId || nativeDraft?.organizationId || '').trim();

  const canContinueWithContact = () => {
    if (!isCanonicalDraft || proposal || rewriteInstruction.trim() || draftOperationRef.current || nativeDraftSaving || nativeDraftRewriting || nativeDraftApproving || isLoading) return false;
    if (followUpDirty || followUpBusy) {
      toast({
        title: followUpBusy ? 'Seguimientos en proceso' : 'Guarda los seguimientos',
        description: followUpBusy
          ? 'Espera a que termine la operación antes de enviar el correo inicial.'
          : 'Hay cambios sin guardar en uno o más seguimientos.',
      });
      return false;
    }
    if (campaignStepId) {
      if (campaignSendContextLoading || !campaignSendContext || campaignSendContextError || campaignSendContextMismatch || campaignDispatchVersionMismatch) {
        toast({
          variant: 'destructive',
          title: 'No se puede confirmar el envío',
          description: 'Actualiza el estado del seguimiento antes de intentar enviar.',
        });
        return false;
      }
      if (campaignSendDecision?.kind === 'blocked') {
        toast({
          title: 'Este envío no se puede repetir',
          description: campaignSendContext.dispatch
            ? 'Ya existe una confirmación durable para este intento. Revísala antes de continuar.'
            : 'El seguimiento no está en un estado seguro para enviar.',
        });
        return false;
      }
    }
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

  const saveNativeDraft = async (proposed?: RewriteProposal) => {
    if (!nativeDraftId || !nativeDraft?.versionId || (!hasNativeEdits && !proposed) || draftOperationRef.current || nativeDraftArchived || followUpDirty || followUpBusy || isLoading || sendReceipt || sendOperation) return;
    if (proposed && (proposed !== proposal || proposed.expectedVersionId !== nativeDraft.versionId || hasNativeEdits)) { setSaveError(versionConflictMessage); return; }
    if (editorTextRef.current.subject !== subject || editorTextRef.current.body !== body) { setSaveError(versionConflictMessage); return; }
    if (!subject.trim() || !body.trim()) { setSaveError('Completa el asunto y el mensaje antes de guardar.'); return; }
    const submitted = { subject, body };
    draftOperationRef.current = true;
    setNativeDraftSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/native-drafts/${encodeURIComponent(nativeDraftId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: proposed?.subject ?? subject, text: proposed?.body ?? body, expectedVersionId: proposed?.expectedVersionId ?? nativeDraft.versionId }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 409) throw new Error(versionConflictMessage);
      if (!response.ok || payload?.draft?.draftId !== nativeDraftId || !payload?.draft?.versionId
        || typeof payload?.draft?.content?.subject !== 'string' || typeof payload?.draft?.content?.text !== 'string') throw new Error(payload?.message || 'No pudimos confirmar la versión guardada. Tu texto se conserva.');
      setNativeDraft(payload.draft);
      setProposal(null);
      const nextText = reconcileSavedText(editorTextRef.current, submitted, { subject: payload.draft.content.subject, body: payload.draft.content.text });
      setSubject(nextText.subject);
      setBody(nextText.body);
      if (campaignStepId) {
        setCampaignSendContextLoading(true);
        setCampaignSendContextReloadKey((value) => value + 1);
      }
      toast({ title: 'Cambios guardados', description: 'Revisa el correo y confirma la revisión antes de enviarlo.' });
    } catch (error: any) {
      console.error('No se pudo guardar el correo', error);
      setSaveError(error?.message || 'No se pudo guardar. Tus cambios se conservan.');
    } finally {
      draftOperationRef.current = false;
      setNativeDraftSaving(false);
    }
  };

  const approveNativeDraft = async () => {
    if (!nativeDraftId || !nativeDraft?.versionId || hasNativeEdits || nativeDraftArchived || campaignQaBlocksSend || contactabilityChecking || proposal || rewriteInstruction.trim() || draftOperationRef.current || followUpDirty || followUpBusy || isLoading || sendReceipt || sendOperation) return;
    draftOperationRef.current = true;
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
      if (campaignStepId) {
        setCampaignSendContextLoading(true);
        setCampaignSendContextReloadKey((value) => value + 1);
      }
      toast({ title: 'Correo revisado', description: 'Registramos la revisión. El correo aún no se ha enviado.' });
    } catch (error) {
      console.error('No se pudo confirmar la revisión del correo', error);
      toast({ variant: 'destructive', title: 'No se pudo confirmar la revisión', description: 'Revisa el correo e inténtalo nuevamente.' });
    } finally {
      draftOperationRef.current = false;
      setNativeDraftApproving(false);
    }
  };

  const rewriteNativeDraftWithAi = async (quickInstruction?: string, subjectOnly = false) => {
    const instruction = (quickInstruction || rewriteInstruction).trim();
    if (!nativeDraftId || !nativeDraft?.versionId || !instruction || hasNativeEdits || nativeDraftArchived || proposal || draftOperationRef.current || followUpDirty || followUpBusy || isLoading || sendReceipt || sendOperation) return;
    draftOperationRef.current = true;
    setNativeDraftRewriting(true);
    setRewriteError(null);
    try {
      const response = await fetch(`/api/native-drafts/${encodeURIComponent(nativeDraftId)}/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          previewOnly: true,
          styleProfileId: rewriteStyleProfileId || null,
          expectedVersionId: nativeDraft.versionId,
          ...(campaignStepId ? { campaignStepId } : {}),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 409) throw new Error(versionConflictMessage);
      if (!response.ok) {
        throw new Error(payload?.message || 'No se pudo aplicar el ajuste.');
      }
      if (currentVersionRef.current !== nativeDraft.versionId || editorTextRef.current.subject !== subject || editorTextRef.current.body !== body) throw new Error(versionConflictMessage);
      setProposal(readRewriteProposal(payload, nativeDraft.versionId, subjectOnly ? body : undefined));
      setRewriteInstruction('');
    } catch (error: any) {
      console.error('No se pudo ajustar el correo con IA', error);
      setRewriteError(error?.message || 'No pudimos aplicar el ajuste. Inténtalo nuevamente.');
    } finally {
      draftOperationRef.current = false;
      setNativeDraftRewriting(false);
    }
  };

  async function handleDurableSendResult(result: DurableSendReceipt, providerName: 'Outlook' | 'Gmail') {
    setSendError(null);
    setSendReceipt(result);

    if (result.status !== 'sent') {
      if (result.status === 'pending' || result.status === 'sending' || result.status === 'unknown') {
        toast({
          title: 'Estado por confirmar',
          description: 'Conservamos la confirmación durable. No vuelvas a enviar este correo mientras se resuelve.',
        });
      }
      return;
    }

    try {
      if ((lead as any)?._sourceTable === 'opportunities') {
        await enrichedOpportunitiesStorage.removeById((lead as any).id);
      } else {
        await enrichedLeadsStorage.removeById((lead as any).id);
      }
    } catch (error) {
      console.error('El correo fue enviado, pero no pudimos retirar el lead de su lista de origen', error);
    }

    if (nativeDraftId && !campaignStepId) {
      try {
        const refreshed = await loadFirstContactFollowUpPlan(nativeDraftId);
        if (refreshed.enabled) setFollowUpPlan(refreshed.plan);
      } catch (error) {
        console.error('No se pudo actualizar el resumen de seguimiento después del envío', error);
      }
    }

    setSendOperation(null);
    toast({ title: `Enviado con ${providerName}`, description: `Correo enviado a ${(lead as any)?.fullName || 'este contacto'}.` });
  }

  function resolveSendIdempotencyKey(input: {
    email: string;
    provider: 'outlook' | 'gmail';
  }) {
    const createNewKey = () => {
      const operation = resolveManualEmailOperation(sendOperation, {
        scope: campaignStepId ? `campaign-v2-step:${campaignStepId}` : 'manual-compose',
        recipientId: String((lead as any).id || ''),
        email: input.email,
        subject,
        body,
        provider: input.provider,
        deliveryOptions: canonicalDeliveryOptions,
      }, uuid);
      setSendOperation(operation);
      return operation.idempotencyKey;
    };

    if (!campaignStepId) return createNewKey();
    if (!campaignSendContext || campaignSendContextError || campaignSendContextMismatch || campaignDispatchVersionMismatch) {
      throw new Error('No se pudo confirmar un contexto seguro para este envío.');
    }
    const idempotencyKey = resolveCampaignV2SendKey(campaignSendContext, createNewKey);
    if (!idempotencyKey) throw new Error('Este seguimiento ya no admite un envío seguro.');
    return idempotencyKey;
  }

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
    draftOperationRef.current = true;
    setSendError(null);
    try {
      const researchSnapshotId = String(findReportForLead({
        leadId: String((lead as any).id || ''),
        email,
      })?.raw?.research_snapshot_id || '').trim() || nativeDraft?.researchSnapshotId || null;
      const idempotencyKey = resolveSendIdempotencyKey({ email, provider: 'outlook' });
      const finalHtmlBody = body.replace(/\n/g, '<br>');

      const result = await sendEmail({
        to: email,
        subject,
        htmlBody: finalHtmlBody,
        requestReceipts: false,
        leadId: String((lead as any).id || ''),
        researchSnapshotId,
        draftId: nativeDraft?.draftId || null,
        versionId: nativeDraft?.versionId || null,
        organizationId: sendOrganizationId,
        idempotencyKey,
      });
      await handleDurableSendResult(result, 'Outlook');
    } catch (e: any) {
      const message = e?.message || 'Revisa la conexión y vuelve a intentarlo.';
      setSendError(message);
      if (campaignStepId) {
        setCampaignSendContextLoading(true);
        setCampaignSendContextReloadKey((value) => value + 1);
      }
      toast({ variant: 'destructive', title: 'No se pudo enviar con Outlook', description: message });
    } finally {
      draftOperationRef.current = false;
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
    draftOperationRef.current = true;
    setSendError(null);
    try {
      const researchSnapshotId = String(findReportForLead({
        leadId: String((lead as any).id || ''),
        email,
      })?.raw?.research_snapshot_id || '').trim() || nativeDraft?.researchSnapshotId || null;
      const idempotencyKey = resolveSendIdempotencyKey({ email, provider: 'gmail' });
      const finalHtmlBody = body.replace(/\n/g, '<br>');

      const result = await sendGmailEmail({
        to: email,
        subject: subject,
        html: finalHtmlBody,
        leadId: String((lead as any).id || ''),
        researchSnapshotId,
        draftId: nativeDraft?.draftId || null,
        versionId: nativeDraft?.versionId || null,
        organizationId: sendOrganizationId,
        idempotencyKey,
      });
      await handleDurableSendResult(result, 'Gmail');
    } catch (e: any) {
      const message = e?.message || 'Revisa la conexión y vuelve a intentarlo.';
      setSendError(message);
      if (campaignStepId) {
        setCampaignSendContextLoading(true);
        setCampaignSendContextReloadKey((value) => value + 1);
      }
      toast({ variant: 'destructive', title: 'No se pudo enviar con Gmail', description: message });
    } finally {
      draftOperationRef.current = false;
      setIsLoading(false);
    }
  };

  const safeRetryAvailable = Boolean(
    sendReceipt
    && (
      (sendReceipt.status === 'deferred' && sendReceipt.retry?.retryable === true)
      || (sendReceipt.status === 'pending' && Boolean(campaignStepId))
    )
    && (!campaignStepId || (
      campaignSendContext?.dispatch
        ? campaignSendDecision?.kind === 'safe_retry' && !campaignDispatchVersionMismatch
        : Boolean(sendOperation)
    ))
  );

  function retryDurableSend() {
    if (!safeRetryAvailable || isLoading) return;
    setSendReceipt(null);
    setSendError(null);
    void (sendProvider === 'outlook' ? doSendOutlook() : doSendGmail());
  }

  const loadError = campaignSendContextError
    || (campaignSendContextMismatch ? 'El correo abierto ya no coincide con la versión autorizada para este seguimiento.' : null)
    || nativeDraftLoadError
    || leadLoadError;
  if (nativeDraftLoading || leadLoading || campaignSendContextLoading) {
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
            onClick={() => {
              if ((hasNativeEdits || proposal || followUpDirty || followUpBusy) && !window.confirm('¿Recargar y descartar los cambios o propuestas sin guardar?')) return;
              setProposal(null);
              setSaveError(null);
              if (campaignStepId) setCampaignSendContextReloadKey((value) => value + 1);
              if (isCanonicalDraft) setNativeDraftReloadKey((value) => value + 1);
              else setLeadReloadKey((value) => value + 1);
            }}
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

  if (!isCanonicalDraft) {
    const report = findReportForLead({ leadId: id, email: composeEmail, companyDomain: lead?.companyDomain, companyName: lead?.companyName });
    const snapshotId = String(report?.raw?.research_snapshot_id || report?.raw?.researchSnapshotId || '').trim();
    const researchHref = lead?._sourceTable === 'opportunities' ? '/saved/opportunities/enriched' : '/saved/leads/enriched';
    const createDraft = async () => {
      if (!snapshotId || creatingDraft) return;
      setCreatingDraft(true);
      setCreationError(null);
      try {
        const response = await fetch('/api/native-drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `native-draft:${snapshotId}` },
          body: JSON.stringify({ researchSnapshotId: snapshotId }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.draft?.draftId) throw new Error(payload?.message || 'No pudimos crear el borrador. Revisa o actualiza la investigación del contacto.');
        router.replace(`/contact/compose?draftId=${encodeURIComponent(payload.draft.draftId)}`);
      } catch (error: any) {
        setCreationError(error?.message || 'No pudimos crear el borrador. Inténtalo nuevamente.');
      } finally { setCreatingDraft(false); }
    };
    return (
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Preparar correo</h1>
        <Card><CardHeader><CardTitle className="text-base">{lead.fullName || 'Contacto'}</CardTitle><CardDescription>{composeEmail || 'Sin email disponible'}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">{snapshotId ? 'Crea un borrador desde la investigación guardada. Después podrás editarlo, revisarlo y decidir si enviarlo.' : 'Este contacto necesita una investigación actualizada antes de crear el correo. Abre la lista, selecciona este contacto y elige Investigar.'} Nada se enviará desde este paso.</p>
            {creationError ? <Alert variant="destructive"><AlertTitle>No se pudo preparar</AlertTitle><AlertDescription>{creationError}</AlertDescription></Alert> : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              {snapshotId ? <Button disabled={creatingDraft || !composeEmail} onClick={() => void createDraft()}>{creatingDraft ? 'Creando borrador…' : 'Crear borrador para revisar'}</Button> : null}
              {creatingDraft ? <Button variant="outline" disabled>Ir a investigar el contacto</Button> : <Button asChild variant={snapshotId ? 'outline' : 'default'}><Link href={researchHref}>Ir a investigar el contacto</Link></Button>}
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (sendReceipt?.status === 'sent') {
    const activeFollowUpPlan = followUpPlan && ['pending_initial_send', 'active'].includes(followUpPlan.enrollmentState)
      ? followUpPlan
      : null;
    const nextStep = nextFollowUpStep(activeFollowUpPlan);
    const nextDate = formatFollowUpDate(activeFollowUpPlan?.nextDueAt || nextStep?.dueAt);
    const hasFollowUpContext = Boolean(followUpPlan || campaignStepId);
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-4 py-8 sm:px-6">
        <Card className="w-full overflow-hidden rounded-2xl border-emerald-200/80 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.35)] dark:border-emerald-500/30">
          <CardContent className="p-6 sm:p-8">
            <div className="flex size-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-6" aria-hidden="true" />
            </div>
            <div className="mt-5 space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Envío confirmado</p>
              <h1
                ref={successHeadingRef}
                tabIndex={-1}
                className="rounded-sm text-2xl font-semibold tracking-[-0.03em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-3xl"
              >
                Correo enviado
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                El mensaje para {(lead as any).fullName || composeEmail || 'este contacto'} quedó registrado correctamente.
              </p>
            </div>

            <div className="mt-6 rounded-xl border border-border/60 bg-muted/20 px-4 py-3.5">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Confirmación de envío</p>
              <p className="mt-1 break-all font-mono text-sm text-foreground">{sendReceipt.dispatchId}</p>
            </div>

            {activeFollowUpPlan ? (
              <div className="mt-4 rounded-xl border border-border/60 px-4 py-3.5">
                <p className="text-sm font-medium">{nextStep ? `Próximo: ${nextStep.name}` : 'Seguimiento configurado'}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {nextDate
                    ? `Fecha prevista: ${nextDate}. Revisa su estado en Campañas; esta fecha no confirma un envío automático.`
                    : `${activeFollowUpPlan.steps.length} ${activeFollowUpPlan.steps.length === 1 ? 'correo quedó preparado' : 'correos quedaron preparados'} para continuar después del envío inicial.`}
                </p>
              </div>
            ) : null}

            <div className="mt-7 flex justify-end">
              <Button asChild className="min-h-11 w-full sm:w-auto">
                <Link href={hasFollowUpContext ? '/campaigns' : '/saved/leads/enriched'}>
                  {hasFollowUpContext ? 'Ver seguimiento' : 'Volver a leads'}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const displayEmail = composeEmail;
  const send = sendProvider === 'outlook' ? doSendOutlook : doSendGmail;
  const dispatchLocksCompose = Boolean(sendReceipt);
  const composeControlsLocked = dispatchLocksCompose || isLoading || Boolean(sendOperation);
  const leaveCompose = () => {
    if (hasNativeEdits || proposal || followUpDirty || followUpBusy || rewriteInstruction.trim() || draftOperationRef.current || isLoading) {
      toast({
        title: followUpBusy ? 'Hay una operación en curso' : 'Hay cambios sin guardar',
        description: followUpBusy
          ? 'Espera a que termine antes de salir.'
          : 'Guarda tus cambios y aplica o descarta las propuestas antes de salir.',
      });
      return;
    }
    if (window.history.state?.composeUnsavedGuard === window.location.href) window.history.go(-2);
    else router.back();
  };
  const isSafeRequestRetry = Boolean(sendError && sendOperation && !sendReceipt);
  const isSendBlocked = isLoading
    || Boolean(rewriteInstruction.trim())
    || Boolean(proposal)
    || !isCanonicalDraft
    || nativeDraftSaving
    || nativeDraftApproving
    || nativeDraftRewriting
    || contactabilityChecking
    || campaignQaBlocksSend
    || nativeDraftArchived
    || nativeReviewRequired
    || followUpDirty
    || followUpBusy
    || Boolean(campaignStepId && campaignSendDecision?.kind === 'blocked')
    || dispatchLocksCompose;
  const isReviewActionBlocked = nativeDraftApproving
    || Boolean(rewriteInstruction.trim())
    || followUpDirty
    || followUpBusy
    || Boolean(proposal)
    || nativeDraftSaving
    || nativeDraftRewriting
    || isLoading
    || contactabilityChecking
    || campaignQaBlocksSend
    || dispatchLocksCompose;
  const reviewStatus = nativeDraftArchived
    ? {
      title: 'Correo no disponible',
      description: 'Este correo ya no puede enviarse desde esta pantalla.',
      className: 'border-border bg-muted/40 text-foreground',
      icon: FileText,
    }
    : hasNativeEdits || proposal
      ? {
        title: proposal ? 'Propuesta pendiente' : 'Cambios pendientes de revisión',
        description: proposal ? 'Compara el antes y después. Aplica o descarta la propuesta para continuar.' : 'Guárdalos y confirma la revisión antes de enviar.',
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
            onClick={leaveCompose}
            aria-label="Volver"
            disabled={isLoading || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting || followUpBusy}
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
              className="min-h-11 rounded-full px-3"
              aria-label={`Usar ${provider === 'outlook' ? 'Outlook' : 'Gmail'} para enviar`}
              aria-pressed={sendProvider === provider}
              disabled={nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting || composeControlsLocked}
              onClick={() => setSendProvider(provider)}
            >
              {provider === 'outlook' ? 'Outlook' : 'Gmail'}
            </Button>
          ))}
        </div>
      </header>

      <section aria-label="Estado del correo" className="grid gap-2">
        <p className="break-words text-xs leading-5 text-muted-foreground">Perfil remitente: {currentProfile?.full_name || 'Sin nombre configurado'}{currentProfile?.email ? ` · ${currentProfile.email}` : ''}<br />Envío por {sendProvider === 'outlook' ? 'Outlook' : 'Gmail'}: se usará la cuenta conectada al proveedor, que puede diferir del perfil.<br />Versión guardada: <span className="break-all">{nativeDraft?.versionId || 'No disponible'}</span></p>
        {saveError ? <Alert variant="destructive"><AlertTitle>No se guardaron los cambios</AlertTitle><AlertDescription>{saveError}</AlertDescription></Alert> : null}
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
        {sendReceipt ? (
          <Alert
            variant={sendReceipt.status === 'failed' ? 'destructive' : 'default'}
            className={sendReceipt.status === 'deferred'
              ? 'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
              : undefined}
          >
            <AlertTitle>
                {sendReceipt.status === 'deferred'
                  ? 'Envío diferido'
                  : sendReceipt.status === 'pending' && safeRetryAvailable
                    ? 'Envío listo para reintentar'
                  : sendReceipt.status === 'failed'
                  ? 'No se pudo enviar'
                  : 'Estado por confirmar'}
            </AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                {sendReceipt.status === 'deferred'
                  ? 'El intento quedó registrado sin confirmar el envío. Reintenta sólo si aparece la opción segura.'
                  : sendReceipt.status === 'pending' && safeRetryAvailable
                    ? 'El proveedor no fue invocado. Puedes retomar de forma segura la misma operación de envío.'
                  : sendReceipt.status === 'failed'
                    ? 'El proveedor confirmó un fallo. El borrador se conserva sin cambios.'
                    : 'No vuelvas a enviar este correo. Revisa su estado desde Campañas antes de realizar otra acción.'}
              </p>
              {sendReceipt.error?.message ? <p className="text-xs opacity-80">{sendReceipt.error.message}</p> : null}
              <p className="break-all font-mono text-xs">Dispatch: {sendReceipt.dispatchId}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {safeRetryAvailable ? (
                  <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={retryDurableSend} disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                    Reintentar de forma segura
                  </Button>
                ) : null}
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link href="/campaigns">Revisar en Campañas</Link>
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        {sendError ? (
          <Alert variant="destructive">
            <AlertTitle>La solicitud no obtuvo confirmación</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{sendError}</p>
              <p>Puedes reintentar con seguridad: conservaremos la misma operación y la misma clave de envío.</p>
            </AlertDescription>
          </Alert>
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
                  maxLength={998}
                  onChange={(event) => { editorTextRef.current = { ...editorTextRef.current, subject: event.target.value }; setSubject(event.target.value); }}
                  placeholder="Escribe un asunto"
                  className="h-11"
                  aria-describedby={isCanonicalDraft ? 'review-status' : undefined}
                  disabled={Boolean(proposal) || followUpDirty || followUpBusy || nativeDraftArchived || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting || composeControlsLocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="compose-body" className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Mensaje</Label>
                <Textarea
                  id="compose-body"
                  value={body}
                  maxLength={100_000}
                  onChange={(event) => { editorTextRef.current = { ...editorTextRef.current, body: event.target.value }; setBody(event.target.value); }}
                  placeholder="Escribe tu mensaje"
                  rows={16}
                  className="min-h-[390px] resize-y text-[15px] leading-7"
                  aria-describedby={isCanonicalDraft ? 'review-status' : undefined}
                  disabled={Boolean(proposal) || followUpDirty || followUpBusy || nativeDraftArchived || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting || composeControlsLocked}
                />
              </div>
            </CardContent>
          </Card>

          {proposal ? <div className="mt-4"><RewriteProposalReview before={{ subject, body }} proposal={proposal} busy={nativeDraftSaving} disabled={composeControlsLocked || nativeDraftArchived || followUpDirty || followUpBusy} onApply={() => void saveNativeDraft(proposal)} onDiscard={() => { setProposal(null); setSaveError(null); }} /></div> : null}

          {isCanonicalDraft && nativeDraft?.channel === 'email' && !campaignStepId && nativeDraft?.versionId ? (
            <section aria-label="Seguimientos del correo inicial">
              <FirstContactFollowUpPlan
                draftId={nativeDraftId}
                versionId={nativeDraft.versionId}
                styleProfiles={styleProfiles}
                disabled={nativeDraftArchived || hasNativeEdits || Boolean(proposal) || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting || composeControlsLocked}
                disabledReason={hasNativeEdits ? 'Guarda primero los cambios del correo inicial para continuar con la secuencia.' : null}
                onPlanChange={handleFollowUpPlanChange}
                onDirtyChange={setFollowUpDirty}
                onBusyChange={setFollowUpBusy}
              />
            </section>
          ) : null}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {isCanonicalDraft ? (
            <section aria-labelledby="ai-adjustment-heading">
              <Collapsible open={showAiAdjustment} onOpenChange={setShowAiAdjustment}>
                <Card className="border-border/60">
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="flex h-auto w-full items-center justify-between rounded-xl px-4 py-3 text-left hover:bg-muted/50"
                      disabled={composeControlsLocked}
                    >
                      <span id="ai-adjustment-heading" className="flex items-center gap-2 text-sm font-medium">
                        <Sparkles className="size-4 text-primary" aria-hidden="true" /> Ajustar con IA
                      </span>
                      <ChevronDown className={`size-4 text-muted-foreground transition-transform ${showAiAdjustment ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-4 border-t border-border/60 pt-4">
                      <p className="text-xs leading-5 text-muted-foreground">Cambia el tono o la estructura sin perder el contexto investigado.</p>
                      <div className="flex flex-wrap gap-2">
                        {quickRewrites.map((quick) => <Button key={quick.label} type="button" variant="outline" size="sm" disabled={Boolean(proposal) || followUpDirty || followUpBusy || hasNativeEdits || nativeDraftArchived || nativeDraftRewriting || nativeDraftSaving || nativeDraftApproving || composeControlsLocked} onClick={() => void rewriteNativeDraftWithAi(quick.instruction, quick.subjectOnly)}>{quick.label}</Button>)}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="native-compose-style" className="text-xs font-medium text-muted-foreground">Estilo</Label>
                        <select
                          id="native-compose-style"
                          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled
                          value={rewriteStyleProfileId || '__current_style__'}
                          onChange={(event) => {
                            setRewriteStyleProfileId(event.target.value === '__current_style__' ? '' : event.target.value);
                            setRewriteError(null);
                          }}
                        >
                          <option value="__current_style__">Conservar el estilo actual</option>
                        </select>
                        <p className="text-xs leading-5 text-muted-foreground">La propuesta conserva la plantilla del borrador. Puedes pedir otro tono o una redacción diferente en la instrucción.</p>
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
                          disabled={nativeDraftArchived || nativeDraftRewriting || composeControlsLocked}
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
                        disabled={Boolean(proposal) || followUpDirty || followUpBusy || !rewriteInstruction.trim() || hasNativeEdits || nativeDraftArchived || nativeDraftRewriting || nativeDraftSaving || nativeDraftApproving || composeControlsLocked}
                      >
                        {nativeDraftRewriting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Sparkles data-icon="inline-start" />}
                        {nativeDraftRewriting ? 'Preparando propuesta…' : 'Ver propuesta'}
                      </Button>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
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
                        if (!selectedStyleId && styleProfiles.length) setSelectedStyleId(styleProfiles[0].id || '');
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
                      value={selectedStyleId}
                      onChange={(event) => setSelectedStyleId(event.target.value)}
                    >
                      {styleProfiles.length === 0 ? <option value="">No hay estilos guardados</option> : styleProfiles.map((profile) => <option key={profile.id || profile.name} value={profile.id}>{profile.name}</option>)}
                    </select>
                  </div>
                </CardContent>
              </Card>
            </section>
          ) : null}

        </aside>
      </div>

      <footer aria-label="Acciones del correo" className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p id="send-summary" className="text-xs leading-5 text-muted-foreground">
          {proposal
            ? 'Aplica o descarta la propuesta de IA antes de revisar o enviar.'
            : rewriteInstruction.trim()
            ? 'Prepara la propuesta o borra la nota para IA antes de revisar o enviar.'
            : sendReceipt
            ? 'Este intento ya tiene una confirmación durable. Revisa su estado antes de continuar.'
            : isSafeRequestRetry
              ? 'El reintento conservará la misma operación y la misma clave de envío.'
              : nativeDraftArchived
                ? 'Este correo ya no está disponible.'
                : campaignStepId && campaignSendDecision?.kind === 'blocked'
                  ? 'Este seguimiento no está en un estado seguro para enviar.'
                  : followUpBusy
                    ? 'Espera a que termine la operación de seguimiento antes de continuar.'
                  : followUpDirty
                    ? 'Guarda los cambios pendientes de los seguimientos antes de enviar.'
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
            onClick={leaveCompose}
            disabled={isLoading || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting || followUpBusy}
          >
            Cancelar
          </Button>
          {sendReceipt ? (
            <Button type="button" className="w-full sm:w-auto" disabled>
              Envío registrado
            </Button>
          ) : nativeDraftArchived ? (
            <Button type="button" className="w-full sm:w-auto" disabled>
              Correo no disponible
            </Button>
          ) : hasNativeEdits ? (
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => void saveNativeDraft()}
              disabled={followUpDirty || followUpBusy || nativeDraftSaving || nativeDraftApproving || nativeDraftRewriting || isLoading || dispatchLocksCompose}
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
            <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={send} disabled={isSendBlocked} aria-describedby="send-summary">
              {isLoading
                ? <Loader2 data-icon="inline-start" className="animate-spin" />
                : isSafeRequestRetry
                  ? <RefreshCw data-icon="inline-start" />
                  : <SendHorizontal data-icon="inline-start" />}
              {isLoading
                ? 'Enviando…'
                : contactabilityChecking
                  ? 'Verificando…'
                  : isSafeRequestRetry
                    ? 'Reintentar envío seguro'
                    : 'Enviar correo'}
            </Button>
          )}
        </div>
      </footer>
    </main>
  );
}

export const dynamic = 'force-dynamic';

function ComposeRoute() {
  const params = useSearchParams();
  // Late responses from a previous contact must never populate the next editor.
  const identity = `${params.get('draftId') || params.get('id') || ''}:${params.get('campaignStepId') || ''}`;
  return <ComposeInner key={identity} />;
}

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Cargando correo…</div>}>
      <ComposeRoute />
    </Suspense>
  );
}
