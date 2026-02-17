import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
dotenv.config({ path: path.join(ROOT, '.env.local') });

const PORT = Number(process.env.ANTONIA_EDIT_TEST_PORT || 9021);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function must(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

async function waitForServer() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/ai/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      if (res.status > 0) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}

function buildSessionCookie(storageKey, session) {
  const raw = JSON.stringify([
    session.access_token,
    session.refresh_token,
    session.provider_token,
    session.provider_refresh_token,
    session.user?.factors ?? null,
  ]);
  return `${storageKey}=${encodeURIComponent(raw)}`;
}

async function main() {
  const supabaseUrl = must('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = must('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = must('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const browserLike = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ANTONIA_FIREBASE_TICK_URL: '',
      ANTONIA_FIREBASE_TICK_SECRET: '',
      ANTONIA_NEXT_BACKUP_PROCESSING: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tailLogs = [];
  const pushLog = (side, chunk) => {
    const lines = String(chunk || '').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      tailLogs.push(`[${side}] ${line}`);
      if (tailLogs.length > 80) tailLogs.shift();
    }
  };
  server.stdout.on('data', (c) => pushLog('dev', c));
  server.stderr.on('data', (c) => pushLog('err', c));

  let userId = null;
  let organizationId = null;
  let missionId = null;

  try {
    const ready = await waitForServer();
    if (!ready) {
      throw new Error(`Next dev server not ready.\n${tailLogs.join('\n')}`);
    }

    const email = `antonia-e2e-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
    const password = `Aa!${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const { data: createdUser, error: createUserErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createUserErr || !createdUser?.user?.id) {
      throw new Error(`Failed creating test user: ${createUserErr?.message || 'unknown'}`);
    }
    userId = createdUser.user.id;

    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (orgErr) {
      throw new Error(`Failed loading organization: ${orgErr.message}`);
    }
    if (!org?.id) {
      throw new Error('No organization available for E2E test');
    }
    organizationId = org.id;

    const { error: membershipErr } = await admin.from('organization_members').insert({
      organization_id: organizationId,
      user_id: userId,
      role: 'member',
    });
    if (membershipErr) {
      throw new Error(`Failed creating organization membership: ${membershipErr.message}`);
    }

    const initialParams = {
      jobTitle: 'Director de Operaciones',
      location: 'Chile',
      industry: 'Outsourcing',
      keywords: 'automatizacion',
      companySize: '11-50',
      seniorities: ['director'],
      enrichmentLevel: 'basic',
      campaignName: 'Campana Inicial',
      campaignContext: 'Contexto inicial',
      dailySearchLimit: 1,
      dailyEnrichLimit: 10,
      dailyInvestigateLimit: 5,
      dailyContactLimit: 3,
    };

    const { data: mission, error: missionErr } = await admin
      .from('antonia_missions')
      .insert({
        organization_id: organizationId,
        user_id: userId,
        title: 'E2E Mission Edit',
        goal_summary: 'Mission edit e2e validation',
        status: 'active',
        params: initialParams,
        daily_search_limit: 1,
        daily_enrich_limit: 10,
        daily_investigate_limit: 5,
        daily_contact_limit: 3,
      })
      .select('id')
      .single();

    if (missionErr || !mission?.id) {
      throw new Error(`Failed creating mission: ${missionErr?.message || 'unknown'}`);
    }
    missionId = mission.id;

    const { error: taskErr } = await admin.from('antonia_tasks').insert([
      {
        mission_id: missionId,
        organization_id: organizationId,
        type: 'SEARCH',
        status: 'pending',
        payload: { ...initialParams, missionTitle: 'E2E Mission Edit' },
      },
      {
        mission_id: missionId,
        organization_id: organizationId,
        type: 'CONTACT_INITIAL',
        status: 'pending',
        payload: {
          campaignName: initialParams.campaignName,
          campaignContext: initialParams.campaignContext,
        },
      },
    ]);
    if (taskErr) {
      throw new Error(`Failed creating pending tasks: ${taskErr.message}`);
    }

    const { data: signInData, error: signInErr } = await browserLike.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signInData?.session) {
      throw new Error(`Failed sign-in: ${signInErr?.message || 'unknown'}`);
    }

    const storageKey = browserLike.auth.storageKey || 'sb-local-auth-token';
    const cookie = buildSessionCookie(storageKey, signInData.session);

    const authed = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${signInData.session.access_token}`,
        },
      },
    });

    const { data: missionVisible, error: missionVisibleErr } = await authed
      .from('antonia_missions')
      .select('id, title')
      .eq('id', missionId)
      .maybeSingle();

    const { data: membershipVisible, error: membershipVisibleErr } = await authed
      .from('organization_members')
      .select('organization_id, user_id, role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();

    console.log('[mission-edit-e2e] visibility check', {
      missionVisible: !!missionVisible,
      missionVisibleErr: missionVisibleErr?.message || null,
      membershipVisible: !!membershipVisible,
      membershipVisibleErr: membershipVisibleErr?.message || null,
    });

    const getRes = await fetch(`${BASE_URL}/api/antonia/missions/${missionId}/intelligence`, {
      method: 'GET',
      headers: {
        cookie,
        Authorization: `Bearer ${signInData.session.access_token}`,
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!getRes.ok) {
      const text = await getRes.text().catch(() => '');
      throw new Error(`GET intelligence failed: ${getRes.status} ${text}`);
    }

    const getJson = await getRes.json();
    if (!getJson?.mission?.id || getJson.mission.id !== missionId) {
      throw new Error('GET intelligence returned unexpected mission payload');
    }

    const updates = {
      title: 'E2E Mission Tuned',
      goalSummary: 'Updated by mission edit e2e',
      jobTitle: 'VP Comercial',
      campaignName: 'Campana Ajustada',
      campaignContext: 'Contexto ajustado',
      seniorities: ['vp', 'director'],
      dailySearchLimit: 2,
      dailyContactLimit: 7,
      enrichmentLevel: 'deep',
    };

    const patchRes = await fetch(`${BASE_URL}/api/antonia/missions/${missionId}/intelligence`, {
      method: 'PATCH',
      headers: {
        cookie,
        Authorization: `Bearer ${signInData.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ updates }),
      signal: AbortSignal.timeout(30000),
    });

    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '');
      throw new Error(`PATCH intelligence failed: ${patchRes.status} ${text}`);
    }

    const patchJson = await patchRes.json();
    if (!patchJson?.ok) {
      throw new Error('PATCH intelligence response missing ok=true');
    }

    const { data: missionAfter, error: missionAfterErr } = await admin
      .from('antonia_missions')
      .select('title, goal_summary, daily_search_limit, daily_contact_limit, params')
      .eq('id', missionId)
      .single();

    if (missionAfterErr || !missionAfter) {
      throw new Error(`Failed loading mission after patch: ${missionAfterErr?.message || 'unknown'}`);
    }

    if (missionAfter.title !== updates.title) throw new Error('Mission title was not updated');
    if (missionAfter.goal_summary !== updates.goalSummary) throw new Error('Mission goal summary was not updated');
    if (Number(missionAfter.daily_search_limit) !== 2) throw new Error('Mission daily_search_limit was not updated');
    if (Number(missionAfter.daily_contact_limit) !== 7) throw new Error('Mission daily_contact_limit was not updated');
    if ((missionAfter.params || {}).jobTitle !== updates.jobTitle) throw new Error('Mission params.jobTitle was not updated');
    if ((missionAfter.params || {}).campaignName !== updates.campaignName) throw new Error('Mission params.campaignName was not updated');
    if ((missionAfter.params || {}).enrichmentLevel !== updates.enrichmentLevel) throw new Error('Mission params.enrichmentLevel was not updated');

    const { data: pendingTasksAfter, error: pendingTasksAfterErr } = await admin
      .from('antonia_tasks')
      .select('type, payload')
      .eq('mission_id', missionId)
      .eq('status', 'pending')
      .in('type', ['SEARCH', 'CONTACT_INITIAL']);

    if (pendingTasksAfterErr) {
      throw new Error(`Failed loading pending tasks after patch: ${pendingTasksAfterErr.message}`);
    }

    const byType = Object.fromEntries((pendingTasksAfter || []).map((t) => [t.type, t.payload || {}]));
    if ((byType.SEARCH || {}).jobTitle !== updates.jobTitle) {
      throw new Error('SEARCH pending task payload did not receive updated jobTitle');
    }
    if ((byType.SEARCH || {}).missionTitle !== updates.title) {
      throw new Error('SEARCH pending task payload did not receive updated missionTitle');
    }
    if ((byType.CONTACT_INITIAL || {}).campaignName !== updates.campaignName) {
      throw new Error('CONTACT_INITIAL pending task payload did not receive updated campaignName');
    }
    if ((byType.CONTACT_INITIAL || {}).campaignContext !== updates.campaignContext) {
      throw new Error('CONTACT_INITIAL pending task payload did not receive updated campaignContext');
    }

    console.log('[mission-edit-e2e] PASS');
    console.log(JSON.stringify({
      missionId,
      patchedPendingTasks: patchJson.patchedPendingTasks,
      updatedTitle: missionAfter.title,
      updatedJobTitle: missionAfter.params?.jobTitle,
      updatedDailyContactLimit: missionAfter.daily_contact_limit,
    }, null, 2));
  } finally {
    if (missionId) {
      await admin.from('antonia_logs').delete().eq('mission_id', missionId);
      await admin.from('antonia_tasks').delete().eq('mission_id', missionId);
      await admin.from('antonia_missions').delete().eq('id', missionId);
    }

    if (userId && organizationId) {
      await admin.from('organization_members').delete().eq('organization_id', organizationId).eq('user_id', userId);
    }

    if (userId) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }

    if (!server.killed) {
      server.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error('[mission-edit-e2e] FAIL', error);
  process.exitCode = 1;
});
