import * as functions from 'firebase-functions/v2';

export async function invokeCoworkWorker(environment: Record<string, string | undefined> = process.env, request: typeof fetch = fetch) {
  if (environment.COWORK_SCHEDULER_ENABLED !== 'true') return { skipped: true };
  const secret = environment.COWORK_WORKER_SECRET?.trim();
  const origin = new URL(environment.ANTONIA_APP_URL || environment.APP_URL || 'https://studio--leadflowai-3yjcy.us-central1.hosted.app');
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('Invalid Cowork worker origin');
  if (!secret) throw new Error('Missing Cowork worker secret');
  const response = await request(new URL('/api/cron/cowork', origin), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(125000),
    headers: { 'x-cowork-worker-secret': secret, 'x-scheduler-owner': 'firebase-functions' },
  });
  if (!response.ok) throw new Error(`Cowork worker returned HTTP ${response.status}`);
  return { skipped: false };
}

export const coworkTick = functions.scheduler.onSchedule({
  schedule: 'every 1 minutes', timeoutSeconds: 150, memory: '256MiB',
  maxInstances: 1, retryCount: 0, secrets: ['COWORK_WORKER_SECRET'],
}, async () => { await invokeCoworkWorker(); });
