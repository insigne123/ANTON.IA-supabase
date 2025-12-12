
'use client';
import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { enrichedOpportunitiesStorage } from '@/lib/services/enriched-opportunities-service';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import * as Quota from '@/lib/quota-client';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { ensureSubjectPrefix } from '@/lib/outreach-templates';
import { generateCompanyOutreachV2 } from '@/lib/outreach-templates';
import { findReportForLead } from '@/lib/lead-research-storage';
import { getFirstNameSafe } from '@/lib/template';
import { sendGmailEmail } from '@/lib/gmail-email-service';
import { styleProfilesStorage } from '@/lib/style-profiles-storage';
import { generateMailFromStyle } from '@/lib/ai/style-mail';

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
    if (list.length && !selectedStyleName) setSelectedStyleName(list[0].name);
  }, []);

  function buildDraftForLead(leadObj: AnyLead, opts?: { forceRegenerate?: boolean }) {
    const company = getCompanyProfile() || {};
    const sender = buildSenderInfo();
    const leadData = {
      firstName: (leadObj?.fullName || '').split(' ')[0] || '',
      name: leadObj?.fullName || '',
      email: leadObj?.email || '',
      company: leadObj?.companyName || '',
    };

    // Si hay parámetros en URL y NO estamos forzando regeneración, respétalos.
    const generatedSubject = !opts?.forceRegenerate ? (sp.get('subject') || '') : '';
    const generatedBody = !opts?.forceRegenerate ? (sp.get('body') || '') : '';

    let initialSubject: string;
    let initialBody: string;

    if (generatedSubject && generatedBody) {
      initialSubject = generatedSubject;
      initialBody = generatedBody;
    } else {
      const rep = findReportForLead({
        leadId: (leadObj as any).id || (leadObj as any).email || null,
        companyDomain: (leadObj as any).companyDomain || null,
        companyName: (leadObj as any).companyName || null,
      });
      if (draftSource === 'style' && styleProfiles.length) {
        const prof = styleProfiles.find(p => p.name === selectedStyleName) || styleProfiles[0];
        const gen = generateMailFromStyle(
          prof,
          rep?.cross || null,
          {
            id: (leadObj as any).id,
            fullName: leadData.name,
            email: leadData.email,
            title: (leadObj as any).title,
            companyName: leadData.company,
            companyDomain: (leadObj as any).companyDomain,
          }
        );
        initialSubject = gen.subject;
        initialBody = gen.body;
      } else {
        // Investigación por defecto (como hoy)
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
    }

    // 1) Plantillas {{lead.*}} / {{company.*}} / {{sender.*}}
    let subj = renderTemplate(initialSubject || '', { lead: leadData, company, sender });
    let bod = renderTemplate(initialBody || '', { lead: leadData, company, sender });
    // 2) Firma y placeholders humanos
    bod = applySignaturePlaceholders(bod, sender);
    bod = htmlToPlainParas(bod);
    // 3) Solo aseguramos el prefijo con el nombre en el ASUNTO (no tocamos el cuerpo estilo empresa).
    subj = ensureSubjectPrefix(subj, leadData.firstName);
    return { subject: subj, body: bod };
  }

  const [usePixel, setUsePixel] = useState(true);
  const [useReadReceipt, setUseReadReceipt] = useState(false);
  const [useLinkTracking, setUseLinkTracking] = useState(false);

  useEffect(() => {
    if (!lead) return;
    const tuned = buildDraftForLead(lead);
    setSubject(tuned.subject);
    setBody(tuned.body);

  }, [lead, sp, draftSource, selectedStyleName, styleProfiles.length]);

  // Helper to inject link tracking
  function rewriteLinksForTracking(html: string, trackingId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    // Unify regex with the robust one from EmailTestPage
    return html.replace(/href=(["'])(http[^"']+)\1/gi, (match, quote, url) => {
      if (url.includes('/api/tracking/click')) return match;
      const trackingUrl = `${origin}/api/tracking/click?id=${trackingId}&url=${encodeURIComponent(url)}`;
      return `href=${quote}${trackingUrl}${quote}`;
    });
  }

  const regenerate = async () => {
    if (!lead) return;
    setIsRegenerating(true);
    try {
      const tuned = buildDraftForLead(lead, { forceRegenerate: true });
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
    setIsLoading(true);
    try {
      // 1. Generate ID upfront to create pixel URL
      const trackingId = uuid();
      let finalHtmlBody = body.replace(/\n/g, '<br>');

      // 2. Rewrite Links if enabled
      if (useLinkTracking) {
        finalHtmlBody = rewriteLinksForTracking(finalHtmlBody, trackingId);
      }

      // 3. Inject Pixel if enabled
      if (usePixel) {
        // Use window.location.origin to get the current domain
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const pixelUrl = `${origin}/api/tracking/open?id=${trackingId}`;
        // FIX: Removed display:none to prevent blocking by email clients
        const trackingPixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="width:1px;height:1px;border:0;" />`;
        finalHtmlBody += `\n<br>${trackingPixel}`;
      }

      const res = await sendEmail({
        to: email,
        subject,
        htmlBody: finalHtmlBody,
        requestReceipts: useReadReceipt, // Pass new option
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
      router.back();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al enviar con Outlook', description: e.message || 'Outlook falló' });
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
    setIsLoading(true);
    try {
      // 1. Generate ID upfront to create pixel URL
      const trackingId = uuid();
      let finalHtmlBody = body.replace(/\n/g, '<br>');

      // 2. Rewrite Links if enabled
      if (useLinkTracking) {
        finalHtmlBody = rewriteLinksForTracking(finalHtmlBody, trackingId);
      }

      // 3. Inject Pixel if enabled
      if (usePixel) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const pixelUrl = `${origin}/api/tracking/open?id=${trackingId}`;
        // FIX: Removed display:none
        const trackingPixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="width:1px;height:1px;border:0;" />`;
        finalHtmlBody += `\n<br>${trackingPixel}`;
      }

      const result = await sendGmailEmail({
        to: email,
        subject: subject,
        html: finalHtmlBody,
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
        lastUpdateAt: new Date().toISOString(),
      });

      // ✅ quitar de Oportunidades Enriquecidas (storage correcto)
      if ((lead as any)._sourceTable === 'opportunities') {
        await enrichedOpportunitiesStorage.removeById((lead as any).id);
      } else {
        await enrichedLeadsStorage.removeById((lead as any).id);
      }
      toast({ title: 'Enviado con Gmail', description: `Correo enviado a ${(lead as any).fullName}.` });
      router.back();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al enviar con Gmail', description: e.message || 'Gmail falló' });
    } finally {
      setIsLoading(false);
    }
  };

  if (!lead) return <div className="p-6">Lead no encontrado. Vuelve a la lista de guardados.</div>;

  const { email: displayEmail } = extractPrimaryEmail(lead);

  return (
    <div className="p-6 container mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Contactar a {(lead as any).fullName}</CardTitle>
          <CardDescription>
            {(lead as any).title} en {(lead as any).companyName}
            {displayEmail ? <span className="text-sm text-muted-foreground"> · {displayEmail}</span> : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Fuente del borrador y selector de estilo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Fuente del borrador</div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="draft-source" value="investigation" checked={draftSource === 'investigation'} onChange={() => setDraftSource('investigation')} />
                  Investigación (n8n)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="draft-source" value="style" checked={draftSource === 'style'} onChange={() => {
                    setDraftSource('style');
                    if (!selectedStyleName && styleProfiles.length) setSelectedStyleName(styleProfiles[0].name);
                  }} />
                  Estilo (Email Studio)
                </label>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Perfil de estilo</div>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                disabled={draftSource !== 'style' || styleProfiles.length === 0}
                value={selectedStyleName}
                onChange={(e) => setSelectedStyleName(e.target.value)}
              >
                {styleProfiles.length === 0 ? <option value="">(No hay estilos guardados)</option> :
                  styleProfiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)
                }
              </select>
            </div>
            <div className="flex items-end">
              <Button type="button" variant="secondary" onClick={regenerate} disabled={isRegenerating || isLoading} title="Regenerar usando la fuente y/o estilo seleccionados">
                {isRegenerating ? 'Regenerando…' : 'Regenerar borrador'}
              </Button>
            </div>
          </div>

          {/* Tracking Options - NEW SECTION */}
          <div className="border border-border/50 rounded-md p-3 bg-muted/20">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" title="Inyecta una imagen invisible para detectar apertura en tiempo real">
                  <input
                    type="checkbox"
                    checked={usePixel}
                    onChange={(e) => setUsePixel(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  Activar Tracking Pixel
                  <span className="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded ml-1">Recomendado</span>
                </label>
                <p className="text-xs text-muted-foreground ml-6">
                  Inserta un píxel invisible. Sabrás exactamente cuándo abren tu correo sin que el destinatario lo note.
                </p>
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" title="Reescribe enlaces para saber si el usuario hizo clic">
                  <input
                    type="checkbox"
                    checked={useLinkTracking}
                    onChange={(e) => setUseLinkTracking(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  Track Link Clicks
                </label>
                <p className="text-xs text-muted-foreground ml-6">
                  Convierte automáticamente cualquier link en el cuerpo (ej. tu web) en un enlace rastreable.
                </p>
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" title="Solicita confirmación de lectura estándar (puede ser bloqueado por el usuario)">
                  <input
                    type="checkbox"
                    checked={useReadReceipt}
                    onChange={(e) => setUseReadReceipt(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  Solicitar Confirmación
                </label>
                <p className="text-xs text-muted-foreground ml-6">
                  Pide una confirmación formal. El destinatario verá una ventana emergente y podría rechazarla.
                </p>
              </div>
            </div>
          </div>

          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-sm" />
          <div className="flex gap-2">
            <Button onClick={doSendOutlook} disabled={isLoading}>
              {isLoading ? 'Enviando...' : 'Enviar con Outlook'}
            </Button>
            <Button onClick={doSendGmail} disabled={isLoading}>
              {isLoading ? 'Enviando...' : 'Enviar con Gmail'}
            </Button>
            <Button variant="outline" onClick={() => router.back()}>
              Volver
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
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
