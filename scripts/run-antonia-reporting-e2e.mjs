import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
dotenv.config({ path: path.join(ROOT, '.env.local') });

const PORT = Number(process.env.ANTONIA_REPORT_TEST_PORT || 9014);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CRON_SECRET = String(process.env.CRON_SECRET || '').trim();

async function waitForServer() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/api/ai/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      if (r.status > 0) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Server did not become ready in time');
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!CRON_SECRET) {
    throw new Error('CRON_SECRET is required for reporting E2E test');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase service credentials');
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: mission, error: missionErr } = await supabase
    .from('antonia_missions')
    .select('id, organization_id, user_id, title, status, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (missionErr) throw missionErr;
  if (!mission) throw new Error('No missions available for reporting test');

  const testStartedAt = new Date().toISOString();

  const insertedTaskIds = [];

  const insertTask = async (payload) => {
    const { data, error } = await supabase
      .from('antonia_tasks')
      .insert({
        mission_id: mission.id,
        organization_id: mission.organization_id,
        type: 'GENERATE_REPORT',
        status: 'pending',
        payload,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;
    insertedTaskIds.push(data.id);
    return data.id;
  };

  const missionTaskId = await insertTask({
    reportType: 'mission_historic',
    missionId: mission.id,
    userId: mission.user_id,
  });

  const dailyTaskId = await insertTask({
    reportType: 'daily',
    missionId: mission.id,
    userId: mission.user_id,
  });

  const cmd = process.execPath;
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const args = [nextBin, 'dev', '-p', String(PORT)];

  const server = spawn(cmd, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ANTONIA_FIREBASE_TICK_URL: '',
      ANTONIA_FIREBASE_TICK_SECRET: '',
      ANTONIA_NEXT_BACKUP_PROCESSING: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const recentLogs = [];
  const capture = (chunk, side) => {
    const lines = String(chunk || '').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      recentLogs.push(`[${side}] ${line}`);
      if (recentLogs.length > 120) recentLogs.shift();
    }
  };
  server.stdout.on('data', (chunk) => capture(chunk, 'dev'));
  server.stderr.on('data', (chunk) => capture(chunk, 'err'));

  try {
    await waitForServer();

    for (let i = 0; i < 6; i += 1) {
      await fetch(`${BASE_URL}/api/cron/antonia`, {
        method: 'GET',
        headers: { 'x-cron-secret': CRON_SECRET },
        signal: AbortSignal.timeout(45000),
      });
      await sleep(1200);
    }

    const { data: taskRows, error: taskErr } = await supabase
      .from('antonia_tasks')
      .select('id, status, error_message, updated_at')
      .in('id', insertedTaskIds);

    if (taskErr) throw taskErr;

    const missionTask = (taskRows || []).find((t) => t.id === missionTaskId);
    const dailyTask = (taskRows || []).find((t) => t.id === dailyTaskId);

    const { data: reports, error: reportErr } = await supabase
      .from('antonia_reports')
      .select('id, type, mission_id, summary_data, content, sent_to, created_at')
      .eq('organization_id', mission.organization_id)
      .gte('created_at', testStartedAt)
      .order('created_at', { ascending: false })
      .limit(20);

    if (reportErr) throw reportErr;

    const missionReport = (reports || []).find((r) => r.type === 'mission_historic' && r.mission_id === mission.id);
    const dailyReport = (reports || []).find((r) => r.type === 'daily');

    const checks = {
      missionTaskCompleted: missionTask?.status === 'completed',
      dailyTaskCompleted: dailyTask?.status === 'completed',
      missionReportExists: Boolean(missionReport),
      dailyReportExists: Boolean(dailyReport),
      missionHasContacted: Boolean(missionReport?.summary_data?.leadsContacted || missionReport?.summary_data?.audit?.contactedSent >= 0),
      missionHasInvestigated: Boolean(missionReport?.summary_data?.investigated || missionReport?.summary_data?.audit?.investigated >= 0),
      missionHtmlHasLabels: /Leads Contactados|Contactados/i.test(String(missionReport?.content || '')) && /Leads Investigados|Investigados/i.test(String(missionReport?.content || '')),
      dailyHasInvestigated: Boolean(dailyReport?.summary_data?.leadsInvestigated >= 0),
      dailyHasContacted: Boolean(dailyReport?.summary_data?.contacted >= 0),
      dailyHtmlHasLabels: /Leads Investigados|Investigados/i.test(String(dailyReport?.content || '')) && /Leads Contactados|Contactados/i.test(String(dailyReport?.content || '')),
    };

    const report = {
      generatedAt: new Date().toISOString(),
      mission: {
        id: mission.id,
        title: mission.title,
      },
      insertedTasks: insertedTaskIds,
      taskStatus: taskRows || [],
      missionReport: missionReport
        ? {
            id: missionReport.id,
            created_at: missionReport.created_at,
            sent_to: missionReport.sent_to,
            summary: missionReport.summary_data,
          }
        : null,
      dailyReport: dailyReport
        ? {
            id: dailyReport.id,
            created_at: dailyReport.created_at,
            sent_to: dailyReport.sent_to,
            summary: dailyReport.summary_data,
          }
        : null,
      checks,
      passed: Object.values(checks).every(Boolean),
    };

    const outPath = path.join(ROOT, 'scripts', 'antonia-reporting-e2e-report.json');
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

    console.log('[reporting-e2e] report:', 'scripts/antonia-reporting-e2e-report.json');
    console.log('[reporting-e2e] checks:', JSON.stringify(checks));

    if (!report.passed) {
      throw new Error('Reporting E2E checks did not pass');
    }
  } finally {
    if (!server.killed) server.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error('[reporting-e2e] fatal:', e);
  process.exitCode = 1;
});
