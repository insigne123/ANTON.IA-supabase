import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const clamp = (value: any, min: number, max: number, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const normalizeText = (value: any) => String(value ?? '').trim();

const normalizeSeniorities = (value: any, fallback: string[] = []) => {
  if (Array.isArray(value)) {
    const out = value
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    return [...new Set(out)];
  }
  if (typeof value === 'string') {
    const out = value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return [...new Set(out)];
  }
  return fallback;
};

function buildMissionSnapshot(mission: any) {
  const params = mission?.params || {};
  return {
    id: mission.id,
    organizationId: mission.organization_id,
    userId: mission.user_id,
    title: mission.title,
    status: mission.status,
    goalSummary: mission.goal_summary || '',
    params,
    limits: {
      dailySearchLimit: Number(mission.daily_search_limit || params.dailySearchLimit || 1),
      dailyEnrichLimit: Number(mission.daily_enrich_limit || params.dailyEnrichLimit || 10),
      dailyInvestigateLimit: Number(mission.daily_investigate_limit || params.dailyInvestigateLimit || 5),
      dailyContactLimit: Number(mission.daily_contact_limit || params.dailyContactLimit || 3),
    },
    updatedAt: mission.updated_at,
    createdAt: mission.created_at,
  };
}

function buildRecommendations(metrics: any, mission: any) {
  const recs: Array<{ id: string; title: string; why: string; confidence: number; patch: any }> = [];
  const patch: any = {};

  const current = {
    search: Number(mission.daily_search_limit || mission.params?.dailySearchLimit || 1),
    enrich: Number(mission.daily_enrich_limit || mission.params?.dailyEnrichLimit || 10),
    investigate: Number(mission.daily_investigate_limit || mission.params?.dailyInvestigateLimit || 5),
    contact: Number(mission.daily_contact_limit || mission.params?.dailyContactLimit || 3),
    enrichmentLevel: String(mission.params?.enrichmentLevel || 'basic'),
    companySize: String(mission.params?.companySize || ''),
    seniorities: Array.isArray(mission.params?.seniorities) ? mission.params.seniorities : [],
  };

  if (metrics.searchRuns24h > 0 && metrics.found24h <= Math.max(1, metrics.searchRuns24h)) {
    const nextSearch = Math.min(5, current.search + 1);
    const nextPatch: any = { dailySearchLimit: nextSearch };
    if (current.companySize) {
      nextPatch.companySize = '';
    }
    recs.push({
      id: 'expand-search-scope',
      title: 'Ampliar alcance de búsqueda',
      why: `La misión ejecutó ${metrics.searchRuns24h} búsqueda(s) y encontró ${metrics.found24h} lead(s) en 24h.`,
      confidence: 0.82,
      patch: nextPatch,
    });
    Object.assign(patch, nextPatch);
  }

  const enrichTotal = metrics.enrichEmail24h + metrics.enrichNoEmail24h;
  if (enrichTotal >= 4 && metrics.enrichNoEmail24h / Math.max(1, enrichTotal) >= 0.45 && current.enrichmentLevel !== 'deep') {
    const nextPatch = {
      enrichmentLevel: 'deep',
      dailyInvestigateLimit: Math.min(50, Math.max(current.investigate, current.enrich)),
    };
    recs.push({
      id: 'upgrade-enrichment-quality',
      title: 'Subir calidad de enriquecimiento',
      why: `${metrics.enrichNoEmail24h} de ${enrichTotal} leads enriquecidos quedaron sin email en 24h.`,
      confidence: 0.77,
      patch: nextPatch,
    });
    Object.assign(patch, nextPatch);
  }

  const remainingContactByCurrentLogic = Math.max(0, current.contact - metrics.orgContactsToday);
  if (metrics.queueEnrichedWithEmail > remainingContactByCurrentLogic) {
    const desired = Math.min(50, current.contact + Math.min(10, metrics.queueEnrichedWithEmail - remainingContactByCurrentLogic));
    const nextPatch = { dailyContactLimit: desired };
    recs.push({
      id: 'unblock-contact-backlog',
      title: 'Destrabar cola de contacto',
      why: `Hay ${metrics.queueEnrichedWithEmail} lead(s) listos para contacto y solo ${remainingContactByCurrentLogic} cupo(s) disponible(s) hoy.`,
      confidence: 0.9,
      patch: nextPatch,
    });
    Object.assign(patch, nextPatch);
  }

  if (metrics.contactFailed24h >= 3) {
    const desired = Math.max(1, current.contact - 2);
    const nextPatch = { dailyContactLimit: desired };
    recs.push({
      id: 'stabilize-contact-delivery',
      title: 'Estabilizar entrega de contactos',
      why: `Se detectaron ${metrics.contactFailed24h} fallos de contacto en 24h.`,
      confidence: 0.68,
      patch: nextPatch,
    });
    patch.dailyContactLimit = nextPatch.dailyContactLimit;
  }

  if (current.seniorities.length === 0) {
    const nextPatch = { seniorities: ['director', 'manager', 'head'] };
    recs.push({
      id: 'add-seniority-focus',
      title: 'Definir seniorities objetivo',
      why: 'La misión no tiene seniorities configurados; esto puede reducir precisión.',
      confidence: 0.61,
      patch: nextPatch,
    });
    if (!patch.seniorities) {
      patch.seniorities = nextPatch.seniorities;
    }
  }

  return {
    recommendations: recs,
    suggestedPatch: patch,
    reasoning: recs.length > 0
      ? 'Sugerencias calculadas según rendimiento de búsqueda, enriquecimiento y contacto en las últimas 24h.'
      : 'La misión está balanceada en la última ventana; no se requieren ajustes automáticos urgentes.',
  };
}

async function getMissionForUser(authClient: any, missionId: string, userId: string) {
  const { data: mission, error } = await authClient
    .from('antonia_missions')
    .select('*')
    .eq('id', missionId)
    .maybeSingle();

  if (error || !mission) return null;

  const { data: membership } = await authClient
    .from('organization_members')
    .select('id')
    .eq('organization_id', mission.organization_id)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (!membership) return null;
  return mission;
}

async function computeMissionMetrics(admin: any, mission: any) {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';

  const { data: eventRows } = await admin
    .from('antonia_lead_events')
    .select('event_type, outcome')
    .eq('mission_id', mission.id)
    .gte('created_at', last24h)
    .limit(5000);

  const metrics = {
    found24h: 0,
    enrichEmail24h: 0,
    enrichNoEmail24h: 0,
    investigated24h: 0,
    contactSent24h: 0,
    contactFailed24h: 0,
    contactBlocked24h: 0,
    searchRuns24h: 0,
    queueSaved: 0,
    queueEnrichedWithEmail: 0,
    queueDoNotContact: 0,
    orgContactsToday: 0,
    missionContactsToday: 0,
  };

  for (const e of (eventRows || [])) {
    const type = String(e.event_type || '');
    const outcome = String(e.outcome || '');
    if (type === 'lead_found') metrics.found24h += 1;
    if (type === 'lead_enrich_completed') {
      if (outcome === 'email_found') metrics.enrichEmail24h += 1;
      if (outcome === 'no_email') metrics.enrichNoEmail24h += 1;
    }
    if (type === 'lead_investigate_completed') metrics.investigated24h += 1;
    if (type === 'lead_contact_sent') metrics.contactSent24h += 1;
    if (type === 'lead_contact_failed') metrics.contactFailed24h += 1;
    if (type === 'lead_contact_blocked') metrics.contactBlocked24h += 1;
  }

  const { count: searchRuns24h } = await admin
    .from('antonia_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('mission_id', mission.id)
    .eq('type', 'SEARCH')
    .eq('status', 'completed')
    .gte('updated_at', last24h);
  metrics.searchRuns24h = searchRuns24h || 0;

  const { count: queueSaved } = await admin
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('mission_id', mission.id)
    .eq('status', 'saved');
  metrics.queueSaved = queueSaved || 0;

  const { count: queueEnrichedWithEmail } = await admin
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('mission_id', mission.id)
    .eq('status', 'enriched')
    .not('email', 'is', null);
  metrics.queueEnrichedWithEmail = queueEnrichedWithEmail || 0;

  const { count: queueDoNotContact } = await admin
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('mission_id', mission.id)
    .eq('status', 'do_not_contact');
  metrics.queueDoNotContact = queueDoNotContact || 0;

  const { count: orgContactsToday } = await admin
    .from('contacted_leads')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', mission.organization_id)
    .gte('created_at', todayStart);
  metrics.orgContactsToday = orgContactsToday || 0;

  const { count: missionContactsToday } = await admin
    .from('contacted_leads')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', mission.organization_id)
    .eq('mission_id', mission.id)
    .gte('created_at', todayStart);
  metrics.missionContactsToday = missionContactsToday || 0;

  return metrics;
}

export async function GET(_req: NextRequest, context: { params: Promise<{ missionId: string }> }) {
  try {
    const { missionId } = await context.params;
    const authClient = createRouteHandlerClient({ cookies });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mission = await getMissionForUser(authClient, missionId, user.id);
    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const metrics = await computeMissionMetrics(admin, mission);
    const intelligence = buildRecommendations(metrics, mission);

    return NextResponse.json({
      mission: buildMissionSnapshot(mission),
      metrics,
      ...intelligence,
    });
  } catch (e: any) {
    console.error('[mission-intelligence][GET] error:', e);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ missionId: string }> }) {
  try {
    const { missionId } = await context.params;
    const authClient = createRouteHandlerClient({ cookies });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mission = await getMissionForUser(authClient, missionId, user.id);
    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const updates = (body?.updates && typeof body.updates === 'object') ? body.updates : body;

    const currentParams = mission.params || {};
    const nextParams: any = {
      ...currentParams,
      jobTitle: Object.prototype.hasOwnProperty.call(updates, 'jobTitle') ? normalizeText(updates.jobTitle) : normalizeText(currentParams.jobTitle),
      location: Object.prototype.hasOwnProperty.call(updates, 'location') ? normalizeText(updates.location) : normalizeText(currentParams.location),
      industry: Object.prototype.hasOwnProperty.call(updates, 'industry') ? normalizeText(updates.industry) : normalizeText(currentParams.industry),
      keywords: Object.prototype.hasOwnProperty.call(updates, 'keywords') ? normalizeText(updates.keywords) : normalizeText(currentParams.keywords),
      companySize: Object.prototype.hasOwnProperty.call(updates, 'companySize') ? normalizeText(updates.companySize) : normalizeText(currentParams.companySize),
      campaignName: Object.prototype.hasOwnProperty.call(updates, 'campaignName') ? normalizeText(updates.campaignName) : normalizeText(currentParams.campaignName),
      campaignContext: Object.prototype.hasOwnProperty.call(updates, 'campaignContext') ? normalizeText(updates.campaignContext) : normalizeText(currentParams.campaignContext),
      enrichmentLevel: Object.prototype.hasOwnProperty.call(updates, 'enrichmentLevel')
        ? (String(updates.enrichmentLevel) === 'deep' ? 'deep' : 'basic')
        : (String(currentParams.enrichmentLevel) === 'deep' ? 'deep' : 'basic'),
      seniorities: Object.prototype.hasOwnProperty.call(updates, 'seniorities')
        ? normalizeSeniorities(updates.seniorities, normalizeSeniorities(currentParams.seniorities, []))
        : normalizeSeniorities(currentParams.seniorities, []),
      autoGenerateCampaign: Object.prototype.hasOwnProperty.call(updates, 'autoGenerateCampaign')
        ? Boolean(updates.autoGenerateCampaign)
        : Boolean(currentParams.autoGenerateCampaign),
    };

    const dailySearchLimit = clamp(
      Object.prototype.hasOwnProperty.call(updates, 'dailySearchLimit') ? updates.dailySearchLimit : (mission.daily_search_limit || currentParams.dailySearchLimit || 1),
      1,
      5,
      1
    );
    const dailyEnrichLimit = clamp(
      Object.prototype.hasOwnProperty.call(updates, 'dailyEnrichLimit') ? updates.dailyEnrichLimit : (mission.daily_enrich_limit || currentParams.dailyEnrichLimit || 10),
      1,
      50,
      10
    );
    const dailyInvestigateLimit = clamp(
      Object.prototype.hasOwnProperty.call(updates, 'dailyInvestigateLimit') ? updates.dailyInvestigateLimit : (mission.daily_investigate_limit || currentParams.dailyInvestigateLimit || 5),
      1,
      50,
      5
    );
    const dailyContactLimit = clamp(
      Object.prototype.hasOwnProperty.call(updates, 'dailyContactLimit') ? updates.dailyContactLimit : (mission.daily_contact_limit || currentParams.dailyContactLimit || 3),
      1,
      50,
      3
    );

    nextParams.dailySearchLimit = dailySearchLimit;
    nextParams.dailyEnrichLimit = dailyEnrichLimit;
    nextParams.dailyInvestigateLimit = dailyInvestigateLimit;
    nextParams.dailyContactLimit = dailyContactLimit;

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const missionPatch: any = {
      params: nextParams,
      daily_search_limit: dailySearchLimit,
      daily_enrich_limit: dailyEnrichLimit,
      daily_investigate_limit: dailyInvestigateLimit,
      daily_contact_limit: dailyContactLimit,
      updated_at: new Date().toISOString(),
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'title')) {
      missionPatch.title = normalizeText(updates.title) || mission.title;
      nextParams.missionName = missionPatch.title;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'goalSummary')) {
      missionPatch.goal_summary = normalizeText(updates.goalSummary);
    }

    const { data: updatedMission, error: updateMissionErr } = await admin
      .from('antonia_missions')
      .update(missionPatch)
      .eq('id', missionId)
      .select('*')
      .single();

    if (updateMissionErr || !updatedMission) {
      return NextResponse.json({ error: updateMissionErr?.message || 'Failed to update mission' }, { status: 500 });
    }

    const { data: pendingTasks } = await admin
      .from('antonia_tasks')
      .select('id, type, payload')
      .eq('mission_id', missionId)
      .eq('status', 'pending')
      .in('type', ['SEARCH', 'ENRICH', 'INVESTIGATE', 'CONTACT', 'CONTACT_INITIAL', 'GENERATE_CAMPAIGN']);

    let patchedPendingTasks = 0;
    for (const t of (pendingTasks || [])) {
      const payload = { ...(t.payload || {}) };
      const commonPatch = {
        jobTitle: nextParams.jobTitle,
        location: nextParams.location,
        industry: nextParams.industry,
        keywords: nextParams.keywords,
        companySize: nextParams.companySize,
        seniorities: nextParams.seniorities,
        enrichmentLevel: nextParams.enrichmentLevel,
        campaignName: nextParams.campaignName,
        campaignContext: nextParams.campaignContext,
        missionTitle: updatedMission.title,
      };

      let nextPayload = payload;
      if (t.type === 'SEARCH' || t.type === 'GENERATE_CAMPAIGN') {
        nextPayload = { ...payload, ...commonPatch };
      } else if (t.type === 'ENRICH' || t.type === 'INVESTIGATE') {
        nextPayload = {
          ...payload,
          enrichmentLevel: nextParams.enrichmentLevel,
          campaignName: nextParams.campaignName,
          campaignContext: nextParams.campaignContext,
        };
      } else if (t.type === 'CONTACT' || t.type === 'CONTACT_INITIAL') {
        nextPayload = {
          ...payload,
          campaignName: nextParams.campaignName,
          campaignContext: nextParams.campaignContext,
        };
      }

      const { error: taskErr } = await admin
        .from('antonia_tasks')
        .update({ payload: nextPayload, updated_at: new Date().toISOString() })
        .eq('id', t.id);

      if (!taskErr) patchedPendingTasks += 1;
    }

    await admin.from('antonia_logs').insert({
      mission_id: missionId,
      organization_id: updatedMission.organization_id,
      level: 'info',
      message: 'Mision ajustada en marcha (inteligencia)',
      details: {
        patchedPendingTasks,
        applied: {
          title: updatedMission.title,
          dailySearchLimit,
          dailyEnrichLimit,
          dailyInvestigateLimit,
          dailyContactLimit,
          enrichmentLevel: nextParams.enrichmentLevel,
          companySize: nextParams.companySize,
          seniorities: nextParams.seniorities,
        },
      },
      created_at: new Date().toISOString(),
    });

    const metrics = await computeMissionMetrics(admin, updatedMission);
    const intelligence = buildRecommendations(metrics, updatedMission);

    return NextResponse.json({
      ok: true,
      patchedPendingTasks,
      mission: buildMissionSnapshot(updatedMission),
      metrics,
      ...intelligence,
    });
  } catch (e: any) {
    console.error('[mission-intelligence][PATCH] error:', e);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
