import { matchesConfiguredSecret } from '@/lib/server/internal-api-auth';

const FIREBASE_SCHEDULER_HEADER = 'x-firebase-scheduler-secret';

export function isFirebaseSchedulerRequest(request: Request) {
  const secret = String(process.env.FIREBASE_SCHEDULER_SECRET || '').trim();
  const provided = request.headers.get(FIREBASE_SCHEDULER_HEADER);
  const owner = String(request.headers.get('x-scheduler-owner') || '').trim();
  return owner === 'firebase-functions' && matchesConfiguredSecret(secret, provided);
}

export function firebaseSchedulerResponseHeaders() {
  return {
    'Cache-Control': 'no-store',
    'X-Scheduler-Owner': 'firebase-functions',
  };
}
