
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { EnrichedOppLead, LeadResearchReport, StyleProfile } from '@/lib/types';
import { enrichedOpportunitiesStorage } from '@/lib/services/enriched-opportunities-service';
import { upsertLeadReports, getLeadReports, findReportForLead, findReportByRef } from '@/lib/lead-research-storage';
import { BackBar } from '@/components/back-bar';
import { extractPrimaryEmail } from '@/lib/email-utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { buildSenderInfo, applySignaturePlaceholders } from '@/lib/signature-placeholders';
import { renderTemplate, buildPersonEmailContext } from '@/lib/template';
import { ensureSubjectPrefix, generateCompanyOutreachV2 } from '@/lib/outreach-templates';
import { getCompanyProfile } from '@/lib/data';
import { emailDraftsStorage } from '@/lib/email-drafts-storage';
import { sendEmail } from '@/lib/outlook-email-service';
import { sendGmailEmail } from '@/lib/gmail-email-service';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { v4 as uuid } from 'uuid';
import { styleProfilesStorage } from '@/lib/style-profiles-storage';
import { generateMailFromStyle } from '@/lib/ai/style-mail';
import * as Quota from '@/lib/quota-client';
import { isResearched, markResearched } from '@/lib/researched-leads-storage';
import { v4 as uuidv4 } from 'uuid';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import { extractJsonFromMaybeFenced } from '@/lib/extract-json';

function getClientUserId(): string {
  // ID estable por navegador para trazabilidad en n8n; no PII
  try {
    const KEY = 'lf.clientUserId';
    let v = localStorage.getItem(KEY);
    if (!v) { v = uuidv4(); localStorage.setItem(KEY, v); }
    return v;
  } catch { return 'anon'; }
}

export default function EnrichedOpportunitiesPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [enriched, setEnriched] = useState<EnrichedOppLead[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [reports, setReports] = useState<LeadResearchReport[]>([]);
  const [researching, setResearching] = useState(false);
  const [researchProgress, setResearchProgress] = useState({ done: 0, total: 0 });

  // === Estado para CONTACTO MASIVO ===
  const [selectedToContact, setSelectedToContact] = useState<Set<string>>(new Set());
  const [openCompose, setOpenCompose] = useState(false);
  const [composeList, setComposeList] = useState<Array<{ lead: EnrichedOppLead; subject: string; body: string }>>([]);
  const [bulkProvider, setBulkProvider] = useState<'outlook' | 'gmail'>('outlook');
  const [sendingBulk, setSendingBulk] = useState(false);
  const [sendProgress, setSendProgress] = useState({ done: 0, total: 0 });
  const [draftSource, setDraftSource] = useState<'investigation' | 'style'>('investigation');
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [selectedStyleName, setSelectedStyleName] = useState<string>('');

  // Tracking options
  const [usePixel, setUsePixel] = useState(true);
  const [useLinkTracking, setUseLinkTracking] = useState(false);
  const [useReadReceipt, setUseReadReceipt] = useState(false);

  // Helper to inject link tracking
  function rewriteLinksForTracking(html: string, trackingId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    // Replace href="http..." with href="origin/api/tracking/click?id=...&url=encoded"
    return html.replace(/href=["'](http[^"']+)["']/gi, (match, url, quote) => {
      const trackingUrl = `${origin}/api/tracking/click?id=${trackingId}&url=${encodeURIComponent(url)}`;
      return `href=${quote}${trackingUrl}${quote}`;
    });
  }

  // === Reporte modal ===
  const [openReport, setOpenReport] = useState(false);
  const [reportLead, setReportLead] = useState<EnrichedOppLead | null>(null);
  const [reportToView, setReportToView] = useState<LeadResearchReport | null>(null);

  useEffect(() => {
    async function loadFilteredEnriched() {
      const all = await enrichedOpportunitiesStorage.get();
      const contacted = await contactedLeadsStorage.get();
      const contactedIds = new Set<string>(
        contacted.map(c => (c.leadId || '').toString()).filter(Boolean)
      );
      const filtered = all.filter(e => !contactedIds.has(e.id));
      setEnriched(filtered as EnrichedOppLead[]);
    }
    loadFilteredEnriched();
    setReports(getLeadReports());
    setStyleProfiles(styleProfilesStorage.list());
  }, []);

  // === Helpers de referencia y elegibilidad (mismos criterios que en Leads) ===
  const leadRefOf = (e: EnrichedOppLead) => {
    const email = extractPrimaryEmail(e).email;
    const id = (e.id || '').trim(); // IDs suelen ser ya normalizados
    if (id) return id; // mantenemos prioridad por id exacto
    const li = (e.linkedinUrl || '').trim().toLowerCase();
    const nm = (e.fullName || '').trim().toLowerCase();
    const co = (e.companyName || '').trim().toLowerCase();
    const em = (email || '').trim().toLowerCase();
    return em || li || `${nm}|${co}`;
  };


  /** ¿Existe reporte estricto para ESTE leadRef (no por dominio/nombre)? */
  const hasReportStrict = (e: EnrichedOppLead) =>
    !!findReportByRef(leadRefOf(e))?.cross;

  /** Elegible para INVESTIGAR: tiene email y NO está investigado y NO tiene reporte estricto */
  const canResearch = (e: EnrichedOppLead) => {
    const email = extractPrimaryEmail(e).email;
    return !!email && !isResearched(leadRefOf(e)) && !hasReportStrict(e);
  };

  const contactEligible = useMemo(
    () => enriched.filter(e => !!extractPrimaryEmail(e).email).length,
    [enriched]
  );

  const allResearchChecked = useMemo(
    () => enriched.length > 0 && enriched.filter(canResearch).every(e => sel[e.id]),
    [enriched, sel]
  );

  const allContactChecked = useMemo(
    () =>
      contactEligible > 0 &&
      enriched
        .filter(e => !!extractPrimaryEmail(e).email)
        .every(e => selectedToContact.has(e.id)),
    [enriched, selectedToContact, contactEligible]
  );

  const toggleAllResearch = (checked: boolean) => {
    if (!checked) return setSel({});
    const next: Record<string, boolean> = {};
    enriched.forEach(e => { if (canResearch(e)) next[e.id] = true; });
    setSel(next);
  };

  const toggleAllContact = (checked: boolean) => {
    if (!checked) {
      setSelectedToContact(new Set());
      return;
    }
    const s = new Set<string>();
    enriched.forEach(e => { if (extractPrimaryEmail(e).email) s.add(e.id); });
    setSelectedToContact(s);
  };

  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

  // ===== Investigación (ya existente) =====
  async function runOneInvestigationForOpp(lead: EnrichedOppLead) {
    const ref = leadRefOf(lead);
    const { email } = extractPrimaryEmail(lead);

    // Construimos el mismo shape que en Leads
    const item = {
      leadRef: ref,
      targetCompany: {
        name: lead.companyName || null,
        domain: lead.companyDomain || null,
        linkedin: (lead as any).companyLinkedinUrl || null,
        country: (lead as any).country || null,
        industry: (lead as any).industry || null,
        website: lead.companyDomain ? `https://${lead.companyDomain}` : null,
      },
      lead: {
        id: lead.id,
        fullName: lead.fullName,
        title: lead.title,
        email,
        linkedinUrl: lead.linkedinUrl,
      },
      meta: { leadRef: ref },
    };

    const payload = {
      companies: [item],
      userCompanyProfile: getCompanyProfile() || {},
    };

    const res = await fetch('/api/research/n8n', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': getClientUserId(),
        'X-App-Env': 'LeadFlowAI',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Error fetching from n8n');
      throw new Error(`n8n failed: ${errorText}`);
    }

    const j = await res.json();

    let reports: any[] = Array.isArray(j?.reports) ? j.reports : [];

    // Fallback: parsear message.content sin usar la secuencia literal de backticks
    if ((!reports.length) && j?.message?.content) {
      try {
        const cross = extractJsonFromMaybeFenced(j.message.content);
        if (cross && typeof cross === 'object') {
          reports = [{
            cross,
            company: {
              name: cross?.company?.name || (lead.companyName ?? ''),
              domain: cross?.company?.domain || (lead.companyDomain ?? ''),
            },
            meta: { leadRef: ref },
            createdAt: new Date().toISOString(),
          }];
        }
      } catch (e) {
        console.warn('[research:n8n] message.content parse failed', (e as any)?.message);
      }
    }

    if (reports.length) {
      const normalized = reports.map((r: any) => {
        const out = { ...r };
        if (!out.cross) out.cross = out.report || out.data || null;
        if (!out.meta) out.meta = {};
        if (!out.meta.leadRef) out.meta.leadRef = ref;
        return out;
      });
      upsertLeadReports(normalized);
      setReports(getLeadReports());
      const refs = normalized.map((r: any) => r?.meta?.leadRef).filter(Boolean);
      if (refs.length) markResearched(refs); else markResearched([ref]);
    }

    // si el backend retornó 'skipped', también marcamos investigado
    if (Array.isArray(j?.skipped) && j.skipped.length) {
      markResearched(j.skipped);
    }
  }

  const runN8nResearch = async () => {
    // SOLO los seleccionados elegibles
    const chosen = enriched.filter(e => sel[e.id] && canResearch(e));
    if (chosen.length === 0) {
      toast({ title: 'Nada que investigar', description: 'Selecciona contactos elegibles.' });
      return;
    }
    // Límite diario (mismo comportamiento que Leads enriquecidos)
    if (!Quota.canUseClientQuota('research')) {
      toast({
        variant: 'destructive',
        title: 'Límite diario alcanzado',
        description: 'Has llegado al límite de investigaciones por hoy.',
      });
      return;
    }
    setResearching(true);
    setResearchProgress({ done: 0, total: chosen.length });

    let successCount = 0;
    for (const lead of chosen) {
      try {
        await runOneInvestigationForOpp(lead);
        successCount++;
        // espejo local de cuota (igual que en Leads enriquecidos)
        Quota.incClientQuota('research');
      } catch (e: any) {
        console.error(`Failed to research ${lead.fullName}`, e.message);
      }
      setResearchProgress(prev => ({ ...prev, done: prev.done + 1 }));
      // pausa suave para no saturar
      await new Promise(r => setTimeout(r, 1200));
    }

    setResearching(false);
    setSel({}); // limpiar selección
    // refrescar la lista para que se deshabiliten los ya investigados
    setEnriched(prev => [...prev]); // trigger re-render (isResearched se evalúa en runtime)
    toast({ title: 'Investigación completa', description: `Reportes generados: ${successCount} de ${chosen.length}` });
  };

  // ======== Bulk Compose ========
  function openBulkCompose() {
    const company = getCompanyProfile() || {};
    const sender = buildSenderInfo();
    const overrides = emailDraftsStorage.getMap();

    const drafts = enriched
      .filter(l => selectedToContact.has(l.id) && !!extractPrimaryEmail(l).email)
      .map(l => {
        const email = extractPrimaryEmail(l).email!;
        const rep = findReportForLead({
          leadId: l.id || email || l.linkedinUrl || `${l.fullName}|${l.companyName || ''}`,
          companyDomain: l.companyDomain || null,
          companyName: l.companyName || null,
        });

        let subj = '';
        let body = '';
        if (draftSource === 'style' && styleProfiles.length) {
          const prof = styleProfiles.find(p => p.name === selectedStyleName) || styleProfiles[0];
          const gen = generateMailFromStyle(
            prof,
            rep?.cross || null,
            { id: l.id, fullName: l.fullName, email, title: l.title, companyName: l.companyName, companyDomain: l.companyDomain, linkedinUrl: l.linkedinUrl }
          );
          subj = gen.subject; body = gen.body;
        } else {
          const seed = rep?.cross?.emailDraft
            ? { subject: rep.cross.emailDraft.subject, body: rep.cross.emailDraft.body }
            : (() => {
              const v2 = generateCompanyOutreachV2({
                leadFirstName: (l.fullName || '').split(' ')[0] || '',
                companyName: l.companyName,
                myCompanyProfile: company,
              });
              return { subject: v2.subjectBase, body: v2.body };
            })();

          const ctx = buildPersonEmailContext({
            lead: { name: l.fullName, email, title: l.title, company: l.companyName },
            company: { name: l.companyName, domain: l.companyDomain },
            sender,
          });
          subj = ensureSubjectPrefix(renderTemplate(seed.subject || '', ctx), ctx.lead.firstName);
          body = applySignaturePlaceholders(renderTemplate(seed.body || '', ctx), sender);
        }

        const ov = overrides[l.id];
        if (ov?.subject || ov?.body) {
          subj = ov.subject || subj;
          body = ov.body || body;
        }

        return { lead: l, subject: subj, body };
      });

    setComposeList(drafts);
    if (!selectedStyleName && styleProfiles.length) setSelectedStyleName(styleProfiles[0].name);
    setBulkProvider('outlook');
    setOpenCompose(true);
  }

  async function sendBulk() {
    const items = composeList;
    if (!items?.length) return;

    setSendingBulk(true);
    setSendProgress({ done: 0, total: items.length });
    const removedIds = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const { lead, subject, body } = items[i];
      const email = extractPrimaryEmail(lead).email!;
      try {
        let res: any = null;
        const trackingId = uuid(); // ID unificado para el envío y el registro local
        let finalHtmlBody = body.replace(/\n/g, '<br/>');

        // 1. Rewrite Links if enabled
        if (useLinkTracking) {
          finalHtmlBody = rewriteLinksForTracking(finalHtmlBody, trackingId);
        }

        // 2. Inject Pixel if enabled
        if (usePixel) {
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const pixelUrl = `${origin}/api/tracking/open?id=${trackingId}`;
          const trackingPixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="display:none;width:1px;height:1px;" />`;
          finalHtmlBody += `\n<br>${trackingPixel}`;
        }

        if (bulkProvider === 'outlook') {
          res = await sendEmail({
            to: email,
            subject,
            htmlBody: finalHtmlBody,
            requestReceipts: useReadReceipt
          });
        } else {
          res = await sendGmailEmail({
            to: email,
            subject,
            html: finalHtmlBody
          });
        }
        Quota.incClientQuota('contact');
        await contactedLeadsStorage.add({
          id: trackingId, // Usamos el ID generado para tracking
          leadId: lead.id,
          name: lead.fullName,
          email,
          company: lead.companyName,
          subject,
          sentAt: new Date().toISOString(),
          status: 'sent',
          provider: bulkProvider,
          messageId: bulkProvider === 'outlook' ? res?.messageId : res?.id,
          conversationId: bulkProvider === 'outlook' ? res?.conversationId : undefined,
          internetMessageId: bulkProvider === 'outlook' ? res?.internetMessageId : undefined,
          threadId: bulkProvider === 'gmail' ? res?.threadId : undefined,
          lastUpdateAt: new Date().toISOString(),
        });

        await enrichedOpportunitiesStorage.removeById(lead.id); // Updated storage
        removedIds.add(lead.id);
      } catch (e: any) {
        console.error(`send mail error (${bulkProvider})`, email, e?.message);
      }
      setSendProgress(p => ({ ...p, done: p.done + 1 }));
      await new Promise(res => setTimeout(res, 500));
    }

    setSendingBulk(false);
    setOpenCompose(false);
    if (removedIds.size) {
      setEnriched(prev => prev.filter(x => !removedIds.has(x.id)));
      setSelectedToContact(new Set(Array.from(selectedToContact).filter(id => !removedIds.has(id))));
    }
    toast({
      title: 'Listo',
      description: `Enviados por ${bulkProvider}: ${items.length}. Quitados de Enriquecidos: ${removedIds.size}`,
    });
  }

  const goContact = (id: string, subject?: string, body?: string) => {
    const url = new URL(window.location.origin + `/contact/compose`);
    url.searchParams.set('id', id);
    if (subject) url.searchParams.set('subject', subject);
    if (body) url.searchParams.set('body', body);
    router.push(url.toString());
  };

  function putComposeBuffer(lead: EnrichedOppLead, subject?: string, body?: string) {
    try {
      const key = `compose-lead:${lead.id}`;
      sessionStorage.setItem(key, JSON.stringify({
        id: lead.id,
        fullName: lead.fullName,
        title: lead.title,
        email: extractPrimaryEmail(lead).email,
        companyName: lead.companyName,
        companyDomain: lead.companyDomain,
        subject, body,
      }));
    } catch (e: any) { console.warn('[compose-buffer] set failed', e?.message); }
  }

  async function generateEmailFromReport(lead: EnrichedOppLead) {
    const report = findReportForLead({
      leadId: leadRefOf(lead), // ← misma ref normalizada
      companyDomain: lead.companyDomain,
      companyName: lead.companyName,
    });

    if (!report?.cross?.emailDraft) {
      toast({
        title: 'Sin borrador',
        description: 'Investiga con n8n y revisa el reporte para ver el borrador.',
      });
      openReportFor(lead);
      return;
    }

    const company = getCompanyProfile() || {};
    const sender = buildSenderInfo();
    const { email } = extractPrimaryEmail(lead);
    const ctx = buildPersonEmailContext({
      lead: { name: lead.fullName, email: email!, title: lead.title, company: lead.companyName },
      company: { name: lead.companyName, domain: lead.companyDomain },
      sender,
    });

    let subj = renderTemplate(report.cross.emailDraft.subject || '', ctx);
    let body = renderTemplate(report.cross.emailDraft.body || '', ctx);
    body = applySignaturePlaceholders(body, sender);
    subj = ensureSubjectPrefix(subj, ctx.lead.firstName);

    putComposeBuffer(lead, subj, body);
    goContact(lead.id, subj, body);
  }

  function openReportFor(lead: EnrichedOppLead) {
    const ref = leadRefOf(lead); // ← usar la MISMA ref que se usó al guardar (normalizada)
    const rep = findReportForLead({
      leadId: ref,
      companyDomain: lead.companyDomain || null,
      companyName: lead.companyName || null,
    });
    // Log discreto para diagnosticar matching
    try { console.log('[report:open] ref', { ref, found: !!rep }); } catch { }
    if (!rep?.cross) {
      toast({ title: 'Sin reporte', description: 'Investiga con n8n antes de ver el reporte cruzado.' });
      return;
    }
    setReportLead(lead);
    setReportToView(rep);
    setOpenReport(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Oportunidades enriquecidas"
        description="Contactos encontrados desde vacantes; investiga (n8n) y contacta."
      />
      <BackBar fallbackHref="/saved/opportunities" className="mb-2" />

      {/* Contador diario (igual a Leads enriquecidos) */}
      <div className="mb-4">
        <DailyQuotaProgress kinds={['research']} compact />
      </div>

      {researching && (
        <div className="mb-3 text-sm text-muted-foreground border rounded p-3">
          Progreso de investigación: {researchProgress.done}/{researchProgress.total}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Lista de contactos ({enriched.length})</CardTitle>
            <CardDescription>Derivados de oportunidades (LinkedIn → Apollo).</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={openBulkCompose} disabled={selectedToContact.size === 0}>
              Contactar seleccionados ({selectedToContact.size})
            </Button>
            <Button
              variant="secondary"
              onClick={runN8nResearch}
              disabled={researching || Object.values(sel).every(v => !v)}
            >
              {researching
                ? `Investigando... (${researchProgress.done}/${researchProgress.total})`
                : `Investigar (n8n)`}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Inv.</span>
                      <Checkbox
                        checked={allResearchChecked}
                        onCheckedChange={(v) => toggleAllResearch(Boolean(v))}
                        aria-label="Seleccionar todos para investigar"
                      />
                    </div>
                  </TableHead>
                  <TableHead className="w-10" title="Seleccionar todos para contactar">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">Cont.</span>
                      <Checkbox
                        checked={allContactChecked}
                        onCheckedChange={(v) => toggleAllContact(Boolean(v))}
                        disabled={contactEligible === 0}
                        aria-label="Seleccionar todos para contactar"
                      />
                    </div>
                  </TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>LinkedIn</TableHead>
                  <TableHead>Dominio</TableHead>
                  <TableHead className="w-64 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enriched.map(e => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Checkbox
                        checked={!!sel[e.id]}
                        onCheckedChange={(v) => setSel(prev => ({ ...prev, [e.id]: Boolean(v) }))}
                        disabled={!canResearch(e)}
                        title={
                          !extractPrimaryEmail(e).email
                            ? 'Este contacto no tiene email revelado'
                            : isResearched(leadRefOf(e)) || hasReportStrict(e)
                              ? 'Este contacto ya fue investigado'
                              : ''
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={selectedToContact.has(e.id)}
                        onCheckedChange={(v) => {
                          const next = new Set(selectedToContact);
                          if (v) next.add(e.id); else next.delete(e.id);
                          setSelectedToContact(next);
                        }}
                        disabled={!extractPrimaryEmail(e).email}
                        title={!extractPrimaryEmail(e).email ? 'Este contacto no tiene email revelado' : ''}
                      />
                    </TableCell>
                    <TableCell>{e.fullName}</TableCell>
                    <TableCell>{e.title || '—'}</TableCell>
                    <TableCell>{e.companyName || '—'}</TableCell>
                    <TableCell>{extractPrimaryEmail(e).email || (e.emailStatus === 'locked' ? '(locked)' : '—')}</TableCell>
                    <TableCell>{e.linkedinUrl ? <a className="underline" target="_blank" href={e.linkedinUrl}>Perfil</a> : '—'}</TableCell>
                    <TableCell>{e.companyDomain || '—'}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openReportFor(e)}
                      >
                        Ver reporte
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => generateEmailFromReport(e)}
                        disabled={!extractPrimaryEmail(e).email}
                      >
                        Contactar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Diálogo de REPORTE (solo lectura) */}
      <Dialog open={openReport} onOpenChange={setOpenReport}>
        <DialogContent className="max-w-4xl" onEscapeKeyDown={() => setOpenReport(false)}>
          <DialogHeader>
            <DialogTitle>Reporte · {reportToView?.cross?.company?.name}</DialogTitle>
          </DialogHeader>
          {reportToView?.cross && (
            <div className="space-y-4 text-sm leading-relaxed max-h-[70vh] overflow-y-auto pr-4">
              <div className="text-lg font-semibold">{reportToView.cross.company.name}</div>

              {reportToView.cross.overview && <p>{reportToView.cross.overview}</p>}

              {reportToView.cross.pains?.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Pains</h4>
                  <ul className="list-disc pl-5">
                    {reportToView.cross.pains.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </section>
              )}

              {reportToView.cross.valueProps?.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Cómo ayudamos</h4>
                  <ul className="list-disc pl-5">
                    {reportToView.cross.valueProps.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </section>
              )}

              {reportToView.cross.useCases?.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Casos de uso</h4>
                  <ul className="list-disc pl-5">
                    {reportToView.cross.useCases.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </section>
              )}

              {reportToView.cross.talkTracks?.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Talk tracks</h4>
                  <ul className="list-disc pl-5">
                    {reportToView.cross.talkTracks.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </section>
              )}

              {reportToView.cross.subjectLines?.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Asuntos sugeridos</h4>
                  <ul className="list-disc pl-5">
                    {reportToView.cross.subjectLines.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </section>
              )}

              {reportToView.cross.emailDraft && (
                <section className="border rounded p-3 bg-muted/50">
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Borrador de correo</div>
                  <div><strong>Asunto:</strong> {reportToView.cross.emailDraft.subject}</div>
                  <pre className="whitespace-pre-wrap mt-2 font-mono text-xs">{reportToView.cross.emailDraft.body}</pre>
                </section>
              )}

              {reportToView.cross.sources?.length ? (
                <section>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Fuentes</h4>
                  <ul className="space-y-1">
                    {reportToView.cross.sources.map((s, i) => (
                      <li key={i}>• <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a></li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Diálogo de COMPOSE MASIVO */}
      <Dialog open={openCompose} onOpenChange={setOpenCompose}>
        <DialogContent className="max-w-4xl" onEscapeKeyDown={() => setOpenCompose(false)}>
          <DialogHeader><DialogTitle>Contactar {composeList.length} leads</DialogTitle></DialogHeader>

          <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="col-span-1">
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
            <div className="col-span-1">
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
            <div className="col-span-1">
              <div className="text-xs text-muted-foreground mb-1">Proveedor de envío</div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="bulk-provider" value="outlook" checked={bulkProvider === 'outlook'} onChange={() => setBulkProvider('outlook')} />
                  Outlook
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="bulk-provider" value="gmail" checked={bulkProvider === 'gmail'} onChange={() => setBulkProvider('gmail')} />
                  Gmail
                </label>
              </div>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center bg-muted/30 p-2 rounded">
            <div className="col-span-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
                <Checkbox checked={usePixel} onCheckedChange={(v) => setUsePixel(Boolean(v))} />
                Tracking Pixel (Lectura)
              </label>
            </div>
            <div className="col-span-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
                <Checkbox checked={useLinkTracking} onCheckedChange={(v) => setUseLinkTracking(Boolean(v))} />
                Link Tracking (Clics)
              </label>
            </div>
            <div className="col-span-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
                <Checkbox checked={useReadReceipt} onCheckedChange={(v) => setUseReadReceipt(Boolean(v))} disabled={bulkProvider === 'gmail'} />
                Read Requests (Outlook)
              </label>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto space-y-4 p-1">
            {composeList.map(({ lead, subject, body }, i) => (
              <div key={lead.id} className="border rounded-lg p-3">
                <div className="font-semibold text-sm">{lead.fullName} &lt;{extractPrimaryEmail(lead).email}&gt;</div>
                <div className="text-xs text-muted-foreground">{lead.title} @ {lead.companyName}</div>

                <div className="mt-3 text-xs font-semibold">Asunto</div>
                <Input
                  value={subject}
                  onChange={(e) => {
                    const v = e.target.value;
                    setComposeList(prev => { const next = [...prev]; next[i] = { ...next[i], subject: v }; return next; });
                    emailDraftsStorage.set(lead.id, v, body);
                  }}
                />

                <div className="mt-3 text-xs font-semibold">Cuerpo</div>
                <Textarea
                  value={body}
                  onChange={(e) => {
                    const v = e.target.value;
                    setComposeList(prev => { const next = [...prev]; next[i] = { ...next[i], body: v }; return next; });
                    emailDraftsStorage.set(lead.id, subject, v);
                  }}
                  rows={10}
                  className="font-mono"
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            {sendingBulk
              ? <div className="text-xs">Enviando… {sendProgress.done}/{sendProgress.total}</div>
              : <div className="text-xs text-muted-foreground">Revisa y ajusta antes de enviar. Proveedor: <strong>{bulkProvider}</strong></div>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpenCompose(false)} disabled={sendingBulk}>Cerrar</Button>
              <Button onClick={sendBulk} disabled={sendingBulk || !composeList?.length}>
                {sendingBulk ? 'Enviando…' : `Enviar todos (${bulkProvider})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
