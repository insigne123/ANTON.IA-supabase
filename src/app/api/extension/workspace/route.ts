import { NextRequest, NextResponse } from 'next/server';
import { ExtensionRequestSchema, assertExtensionScope } from '@/lib/extension-contracts';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { findExtensionLead, saveExtensionLead, extensionResearchSubject } from '@/lib/server/extension-leads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(req: NextRequest) {
  try {
    // The worker uses the existing HttpOnly web session after explicit pairing.
    const requestOrigin = req.headers.get('origin') || '';
    const allowedOrigins = ['https://app.antonia.ai', 'https://studio--leadflowai-3yjcy.us-central1.hosted.app'];
    if (process.env.NODE_ENV !== 'production') allowedOrigins.push('http://localhost:9003', 'http://localhost:3000', 'http://127.0.0.1:9003', 'http://127.0.0.1:3000');
    // Cloud Run's internal request URL differs from the browser-facing origin.
    // Match an explicit allowlist, never arbitrary forwarded headers.
    const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(requestOrigin);
    if ((!allowedOrigins.includes(requestOrigin) && !extensionOrigin) || req.headers.get('x-antonia-extension') !== '1') {
      return json({ error: 'Origen no autorizado.' }, 403);
    }
    const origin = extensionOrigin ? allowedOrigins[1] : requestOrigin;
    if (Number(req.headers.get('content-length') || 0) > 16000) return json({ error: 'Solicitud demasiado grande.' }, 413);
    const raw = await req.text();
    if (raw.length > 16000) return json({ error: 'Solicitud demasiado grande.' }, 413);
    const body = ExtensionRequestSchema.parse(JSON.parse(raw));
    const auth = await requireAuth();
    if (body.action === 'session') {
      const { data, error } = await auth.supabase.from('organizations').select('name').eq('id', auth.organizationId).maybeSingle();
      if (error) throw error;
      const { isCampaignsV2Enabled } = await import('@/lib/server/campaigns-v2/feature-access');
      const { isNativeResearchEnabled } = await import('@/lib/server/native-research');
      return json({ userId: auth.user.id, email: auth.user.email, organizationId: auth.organizationId,
        organizationName: data?.name || 'Mi organización', researchEnabled: isNativeResearchEnabled(),
        sequencesEnabled: await isCampaignsV2Enabled(auth.organizationId) });
    }
    try { assertExtensionScope(body, auth); } catch { return json({ error: 'EXTENSION_SESSION_CHANGED', message: 'La cuenta o la organización cambió. Vuelve a conectar la extensión.' }, 409); }
    const bridge = { organizationId: auth.organizationId, userId: auth.user.id };
    if (body.action === 'linkedin-jobs-pending') {
      const { listPendingLinkedinJobs } = await import('@/lib/server/linkedin-bridge-ops');
      const { canonicalExtensionProfileUrl } = await import('@/lib/extension-profile-url');
      const filter = body.profile?.linkedinUrl ? canonicalExtensionProfileUrl(body.profile.linkedinUrl) : null;
      return json({ jobs: await listPendingLinkedinJobs(bridge, filter || null) });
    }
    if (body.action === 'linkedin-job-claim') {
      const { claimLinkedinJob } = await import('@/lib/server/linkedin-bridge-ops');
      try {
        return json({ job: await claimLinkedinJob(bridge, body.jobId || body.jobResult!.jobId) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'No se pudo reclamar el trabajo.' }, 409);
      }
    }
    if (body.action === 'linkedin-job-result') {
      const { finishLinkedinJob } = await import('@/lib/server/linkedin-bridge-ops');
      try {
        return json(await finishLinkedinJob(bridge, body.jobResult!));
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'No se pudo registrar el resultado.' }, 409);
      }
    }
    if (body.action === 'network-report') {
      const { reportLinkedinNetwork } = await import('@/lib/server/linkedin-bridge-ops');
      return json(await reportLinkedinNetwork(bridge, {
        entries: body.networkEntries || [], cursor: body.networkCursor, hasMore: body.networkHasMore }));
    }
    if (body.action === 'inbox-report') {
      const { reportLinkedinInbox } = await import('@/lib/server/linkedin-bridge-ops');
      return json(await reportLinkedinInbox(bridge, {
        threads: (body.inboxThreads || []) as Array<{ key: string; url: string; name: string; direction: 'in' | 'out'; at: string | null; snippet: string; replyNeeded: boolean }>,
        cursor: body.inboxCursor, hasMore: body.inboxHasMore }));
    }
    const profile = body.profile!;
    if (body.action === 'phone-status') {
      if (!body.enrichmentId) return json({ error: 'Selecciona la consulta de teléfono pendiente.' }, 400);
      const { getSupabaseAdminClient } = await import('@/lib/server/supabase-admin');
      const { data, error } = await getSupabaseAdminClient().from('people_search_leads')
        .select('id,linkedin_url,primary_phone,enrichment_status').eq('id', body.enrichmentId)
        .eq('organization_id', auth.organizationId).eq('user_id', auth.user.id).maybeSingle();
      if (error) throw error;
      const { canonicalExtensionProfileUrl } = await import('@/lib/extension-profile-url');
      if (!data || canonicalExtensionProfileUrl(data.linkedin_url) !== profile.linkedinUrl) return json({ error: 'Consulta no encontrada para este perfil.' }, 404);
      return json({ phone: data.primary_phone || '', status: data.enrichment_status });
    }
    if (body.action === 'send-result') {
      const { finishExtensionSend } = await import('@/lib/server/extension-sends');
      return json(await finishExtensionSend({ organizationId: auth.organizationId, userId: auth.user.id }, body.sendResult!));
    }
    if (body.action === 'lookup') return json({ lead: await findExtensionLead(auth, profile) });
    if (body.action === 'save') return json(await saveExtensionLead(auth, profile, body.replaceFields));
    if (body.action === 'enrich') {
      if (!body.operationId) return json({ error: 'Actualiza la extensión para enriquecer este perfil.' }, 400);
      const { POST: search } = await import('@/app/api/opportunities/enrich-apollo/route');
      return search(new NextRequest(new URL('/api/opportunities/enrich-apollo', req.url), {
        method: 'POST', headers: req.headers,
        body: JSON.stringify({ tableName: 'people_search_leads', operationId: body.operationId,
          leads: [{ linkedinUrl: profile.linkedinUrl }], revealEmail: body.revealEmail, revealPhone: body.revealPhone }),
      }));
    }
    const row = await findExtensionLead(auth, profile);
    if (!row) return json({ error: 'Guarda el lead antes de continuar.' }, 409);
    const access = { organizationId: auth.organizationId, userId: auth.user.id };
    if (body.action === 'send-claim') {
      const { claimExtensionSend } = await import('@/lib/server/extension-sends');
      return json(await claimExtensionSend(access, row, body.sendMessage!));
    }
    if (body.action === 'campaigns' || body.action === 'campaign-add') {
      const { listExtensionCampaigns, addExtensionCampaignLead, extensionCampaignApi } = await import('@/lib/server/extension-campaigns');
      const call = extensionCampaignApi(origin, req.headers.get('cookie') || '');
      if (body.action === 'campaigns') return json({ campaigns: await listExtensionCampaigns(call, row.email || '') });
      if (!row.email) return json({ error: 'Guarda un email válido antes de añadir el lead.' }, 422);
      return json(await addExtensionCampaignLead({ ...access, campaignId: body.campaignId!, revision: body.campaignRevision!, email: row.email }, call));
    }
    const { listNativeResearchLeadStatuses, isNativeResearchEnabled } = await import('@/lib/server/native-research');
    if (body.action === 'research') {
      if (!isNativeResearchEnabled()) return json({ error: 'La investigación no está habilitada en esta cuenta.' }, 409);
      const { enqueueNativeResearchRun } = await import('@/lib/server/native-research-runs');
      const run = await enqueueNativeResearchRun({ access, leads: [extensionResearchSubject(row)], options: { depth: 'standard', language: body.language, refresh: body.refreshResearch } });
      return json(run, 202);
    }
    const statuses = await listNativeResearchLeadStatuses({ leadIds: [row.id], access });
    const research = statuses[0] || null;
    if (body.action === 'research-retry') {
      if (!research?.reportId) return json({ error: 'No hay un informe para retomar. Inicia una investigación.' }, 409);
      const { POST: retry } = await import('@/app/api/native-research/[reportId]/route');
      return retry(req, { params: Promise.resolve({ reportId: research.reportId }) });
    }
    if (body.action === 'research-status') {
      const { extensionResearchReport } = await import('@/lib/server/extension-research-report');
      return json({ research: await extensionResearchReport(research, access) });
    }
    if (body.action === 'message') {
      const { writeLinkedinMessage } = await import('@/lib/server/linkedin-message-writer');
      const { loadSellerProfile } = await import('@/lib/server/seller-profile');
      const seller = await loadSellerProfile(auth.user.id);
      const { extensionResearchReport } = await import('@/lib/server/extension-research-report');
      const finalResearch = await extensionResearchReport(research, access);
      const report = finalResearch?.reportDocumentV2;
      const evidence = report ? report.evidenceGraph.claims.filter((item: any) => item.type === 'fact').slice(0, 8).map((item: any) => ({ statement: item.statement,
        sourceUrl: report.evidenceGraph.sources.find((source: any) => source.id === report.evidenceGraph.facts.find((fact: any) => fact.id === item.evidenceIds[0])?.sourceId)?.url || '' }))
        : [];
      const generated = await writeLinkedinMessage({ instruction: body.instruction, language: body.language, tone: body.tone,
          seller, lead: extensionResearchSubject(row), evidence,
          commercialAnalysis: report?.sections.filter((section: any) => ['verdict', 'fit', 'angle'].includes(section.key)).map((section: any) => ({ title: section.title, paragraphs: section.paragraphs })),
           previousMessage: body.previousMessage,
      });
      return json({ ...generated, personalized: evidence.length > 0,
         sources: evidence.map((item: any) => ({ statement: item.statement, url: item.sourceUrl })) });
    }
    if (!row.email) return json({ error: 'Completa un email antes de crear la secuencia.' }, 422);
    if (!research?.researchSnapshotId) return json({ error: 'Completa la investigación antes de generar el correo.' }, 409);
    if (body.action === 'sequence') {
      const { isCampaignsV2Enabled } = await import('@/lib/server/campaigns-v2/feature-access');
      if (!await isCampaignsV2Enabled(auth.organizationId)) return json({ error: 'Las secuencias no están habilitadas en esta organización.' }, 409);
    }
    const { createNativeDraft } = await import('@/lib/server/native-drafts');
    const result = await createNativeDraft({ ...access, snapshotId: research.researchSnapshotId,
      userInstruction: body.instruction,
      idempotencyKey: `extension:${auth.organizationId}:${auth.user.id}:${row.id}:${research.researchSnapshotId}:${(await import('node:crypto')).createHash('sha256').update(body.instruction).digest('hex')}` });
    if (result.status !== 'drafted') return json({ error: result.code, message: result.message }, result.status === 'blocked' ? 422 : 503);
    const draft = result.draft;
    const composeUrl = `/contact/compose?draftId=${encodeURIComponent(draft.draftId)}`;
    if (body.action === 'email-draft') return json({ draft, composeUrl });
    const { createFirstContactPlan } = await import('@/lib/server/campaigns-v2/plan');
    const response = await createFirstContactPlan({ ...access, body: {
      draftId: draft.draftId, versionId: draft.versionId, sequenceInstruction: body.instruction,
      steps: body.offsets.map((offsetDays, i) => ({ offsetDays, name: `Seguimiento ${i + 1}`,
        instruction: `${body.instruction}. Seguimiento ${i + 1}: aporta un ángulo diferente sin repetir el primer contacto.` })),
    } });
    return json({ ...response, composeUrl, draftId: draft.draftId });
  } catch (error: any) {
    if (error instanceof AuthError) return handleAuthError(error);
    if (error?.name === 'LinkedinMessageQualityError') return json({ error: 'LINKEDIN_MESSAGE_REVIEW_REQUIRED', message: error.message }, 422);
    if (error?.name === 'ZodError' || error instanceof SyntaxError) return json({ error: 'Revisa los datos del formulario.', issues: error.issues }, 400);
    console.error('[extension] workspace operation failed', error);
    return json({ error: 'No se pudo completar la operación. Revisa el estado antes de reintentar.' }, 500);
  }
}
