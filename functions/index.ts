/**
 * ANTON.IA Cloud Functions: the schedulers that wake the app's own workers.
 * The mission agent (antoniaTick, antoniaTickHttp and the legacy antoniaWorker) was retired on 2026-10-01; its work now lives in
 * Cowork. See docs/retiro-agente-antonia.md.
 */
import * as functions from 'firebase-functions/v2';
import { randomUUID } from 'crypto';

export { coworkTick } from './cowork-scheduler';

// NOTE: Keep the default for backwards compatibility, but prefer env vars in production.
const DEFAULT_APP_URL = 'https://studio--leadflowai-3yjcy.us-central1.hosted.app';

function getAppUrl(): string {
    return (
        process.env.ANTONIA_APP_URL ||
        process.env.APP_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        DEFAULT_APP_URL
    );
}

function nativeResearchSchedulerEnabled() {
    return String(process.env.NATIVE_RESEARCH_SCHEDULER_ENABLED || 'false').toLowerCase() === 'true';
}

function hasManualTickAuthorization(req: any, expectedSecret: string) {
    if (!expectedSecret) return false;
    const headerSecret = String(req.get('x-manual-trigger-secret') || '').trim();
    return headerSecret === expectedSecret;
}

type FirebaseSchedulerBridgeTarget = {
    name: string;
    path: string;
    method: 'GET' | 'POST';
};

async function invokeFirebaseSchedulerBridge(target: FirebaseSchedulerBridgeTarget) {
    const appUrl = getAppUrl().replace(/\/$/, '');
    const secret = String(process.env.FIREBASE_SCHEDULER_SECRET || '').trim();
    if (!appUrl || !secret) {
        throw new Error(`${target.name} scheduler requires APP_URL and FIREBASE_SCHEDULER_SECRET.`);
    }

    const response = await fetch(`${appUrl}${target.path}`, {
        method: target.method,
        headers: {
            Accept: 'application/json',
            'x-firebase-scheduler-secret': secret,
            'x-scheduler-owner': 'firebase-functions',
            'x-request-id': `firebase-scheduler:${target.name}:${randomUUID()}`,
        },
    });
    await response.text().catch(() => '');

    if (!response.ok) {
        throw new Error(`${target.name} scheduler bridge returned ${response.status}.`);
    }

    console.log(`[FirebaseScheduler] ${target.name} completed with ${response.status}.`);
}

async function runNativeResearchTick() {
    if (!nativeResearchSchedulerEnabled()) {
        console.log('[NativeResearchTick] Scheduler disabled.');
        return { skipped: true };
    }

    const appUrl = getAppUrl().replace(/\/$/, '');
    const secret = String(process.env.LEAD_RESEARCH_WORKER_SECRET || '').trim();
    if (!appUrl || !secret) {
        throw new Error('Native research scheduler requires APP_URL and LEAD_RESEARCH_WORKER_SECRET.');
    }

    const limit = Math.max(1, Math.min(25, Math.trunc(Number(process.env.NATIVE_RESEARCH_SCHEDULER_LIMIT || 5))));
    const response = await fetch(`${appUrl}/api/cron/native-research?limit=${limit}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'x-lead-research-worker-secret': secret,
        },
    });
    const body = await response.text();
    let payload: any = null;
    try {
        payload = body ? JSON.parse(body) : null;
    } catch {
        payload = { raw: body.slice(0, 500) };
    }
    if (!response.ok) {
        throw new Error(`Native research scheduler returned ${response.status}: ${payload?.error || payload?.message || 'unknown error'}`);
    }
    console.log('[NativeResearchTick] Processed native research queue.', payload);
    return payload;
}

export const nativeResearchTick = functions.scheduler.onSchedule({
    schedule: 'every 1 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['LEAD_RESEARCH_WORKER_SECRET'],
}, async () => {
    await runNativeResearchTick();
});

// Manual use is IAM-restricted before it reaches this defense-in-depth secret check.
export const nativeResearchTickHttp = functions.https.onRequest({
    timeoutSeconds: 540,
    memory: '1GiB',
    invoker: 'private',
    secrets: ['NATIVE_RESEARCH_MANUAL_TICK_SECRET', 'LEAD_RESEARCH_WORKER_SECRET'],
} as any, async (req: any, res: any) => {
    try {
        const secret = String(process.env.NATIVE_RESEARCH_MANUAL_TICK_SECRET || '').trim();

        if (!hasManualTickAuthorization(req, secret)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const result = await runNativeResearchTick();
        res.status(200).json({ ok: true, manual: true, schedulerOwner: 'firebase-functions', ...result });
    } catch (e: any) {
        console.error('[nativeResearchTickHttp] error', e);
        res.status(500).json({ error: e?.message || 'Internal error' });
    }
});

// These schedules are the only production owners of their respective Next.js bridges.
export const researchSequencePreparationTick = functions.scheduler.onSchedule({
    schedule: 'every 1 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'research-sequence-preparation',
        path: '/api/cron/research-sequences',
        method: 'POST',
    });
});

export const campaignProcessingTick = functions.scheduler.onSchedule({
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    const results = await Promise.allSettled([
        invokeFirebaseSchedulerBridge({
            name: 'campaign-processing',
            path: '/api/cron/process-campaigns?dryRun=true',
            method: 'GET',
        }),
        invokeFirebaseSchedulerBridge({
            name: 'campaign-v2-due-state',
            path: '/api/cron/campaigns-v2',
            method: 'POST',
        }),
        invokeFirebaseSchedulerBridge({
            name: 'bulk-campaign-delivery',
            path: '/api/cron/bulk-campaigns',
            method: 'GET',
        }),
    ]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length > 0) {
        throw new Error(`Campaign scheduler bridge failures: ${failures.map((failure) => String(failure.reason)).join('; ')}`);
    }
});

export const outboundReconciliationTick = functions.scheduler.onSchedule({
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'outbound-reconciliation',
        path: '/api/cron/outbound-reconciliation',
        method: 'POST',
    });
});

export const apolloReconciliationTick = functions.scheduler.onSchedule({
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'apollo-reconciliation',
        path: '/api/cron/apollo-reconciliation',
        method: 'POST',
    });
});

export const apolloUsageTick = functions.scheduler.onSchedule({
    schedule: 'every 1 hours',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'apollo-usage',
        path: '/api/cron/apollo-usage',
        method: 'POST',
    });
});

export const replySyncTick = functions.scheduler.onSchedule({
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'reply-sync',
        path: '/api/cron/reply-sync',
        method: 'POST',
    });
});

export const privacyRetentionTick = functions.scheduler.onSchedule({
    schedule: '30 3 * * *',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'privacy-retention',
        path: '/api/cron/privacy-retention',
        method: 'POST',
    });
});

export const commercialOpportunitiesTick = functions.scheduler.onSchedule({
    schedule: '15 11 * * *',
    timeZone: 'Etc/UTC',
    // A retry would repeat the paid JSearch queries of a run that already spent them; the next morning searches again.
    retryCount: 0,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    // Oportunidades (plan 8, phase 3): public tenders and the cheap hiring source, every morning (08:15 in Chile).
    await invokeFirebaseSchedulerBridge({
        name: 'commercial-opportunities',
        path: '/api/cron/commercial-opportunities',
        method: 'POST',
    });
});

export const antoniaRollupsTick = functions.scheduler.onSchedule({
    schedule: '10 0 * * *',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'antonia-rollups',
        path: '/api/cron/antonia-rollups',
        method: 'POST',
    });
});
