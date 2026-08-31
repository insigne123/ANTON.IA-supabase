import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const functionsSource = readFileSync('functions/index.ts', 'utf8');
const legacyCronRoute = readFileSync('src/app/api/cron/antonia/route.ts', 'utf8');
const legacyWorkerSource = readFileSync('functions/src/antonia-worker.ts', 'utf8');
const firebaseSchedulerAuth = readFileSync('src/app/api/cron/_firebase-scheduler-auth.ts', 'utf8');
const deploymentDocs = readFileSync('docs/deployment.md', 'utf8');
const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: Array<{ path?: string }> };

const firebaseBridgeRoutes = [
    'process-campaigns',
    'campaigns-v2',
    'outbound-reconciliation',
    'fullenrich-enrichment-reconciliation',
    'reply-sync',
    'privacy-retention',
    'antonia-rollups',
].map((route) => ({
    route,
    source: readFileSync(`src/app/api/cron/${route}/route.ts`, 'utf8'),
}));

function sourceBlock(startMarker: string, endMarker: string) {
    const start = functionsSource.indexOf(startMarker);
    const end = functionsSource.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `Could not find source block for ${startMarker}`);
    return functionsSource.slice(start, end);
}

test('Firebase scheduled Functions own the Antonia worker and its private manual trigger', () => {
    const scheduledTick = sourceBlock('export const antoniaTick =', '// Manual use is IAM-restricted before it reaches this defense-in-depth secret check.');
    const manualTick = sourceBlock('export const antoniaTickHttp =', '// Helper for grouping');

    assert.match(scheduledTick, /functions\.scheduler\.onSchedule/);
    assert.match(scheduledTick, /schedule: 'every 1 minutes'/);
    assert.match(manualTick, /invoker: 'private'/);
    assert.match(manualTick, /ANTONIA_MANUAL_TICK_SECRET/);
    assert.match(scheduledTick, /ENRICHMENT_SERVICE_SECRET/);
    assert.match(manualTick, /ENRICHMENT_SERVICE_SECRET/);
    assert.match(manualTick, /hasManualTickAuthorization/);
    assert.match(functionsSource, /x-manual-trigger-secret/);
    assert.doesNotMatch(manualTick, /\bANTONIA_TICK_SECRET\b|invoker: 'public'|x-cron-secret/);
});

test('retired Antonia entrypoints cannot forward or process work', () => {
    assert.match(functionsSource, /export \{ antoniaWorker \} from '\.\/src\/antonia-worker';/);
    assert.match(legacyCronRoute, /LEGACY_ANTONIA_CRON_DEPRECATED/);
    assert.match(legacyCronRoute, /status: 410/);
    assert.match(legacyCronRoute, /'X-Scheduler-Owner': 'firebase-functions'/);
    assert.doesNotMatch(
        legacyCronRoute,
        /ANTONIA_FIREBASE_TICK_URL|ANTONIA_FIREBASE_TICK_SECRET|antoniaTickHttp|skipFirebaseForward|forceBackupProcessing/,
    );
    assert.match(legacyWorkerSource, /LEGACY_ANTONIA_WORKER_DEPRECATED/);
    assert.match(legacyWorkerSource, /status\(410\)/);
    assert.match(legacyWorkerSource, /invoker: 'private'/);
    assert.doesNotMatch(legacyWorkerSource, /functions\.config\(|ANTONIA_FIREBASE_TICK_SECRET|ANTONIA_LEGACY_WORKER_SECRET|\/api\/cron\/antonia/);
});

test('Firebase owns all production scheduler bridges and Vercel only schedules Suplia', () => {
    const scheduledPaths = (vercelConfig.crons || []).map((cron) => cron.path);
    assert.deepEqual(scheduledPaths, ['/api/cron/suplia']);

    const schedules = [
        ['campaignProcessingTick', "every 5 minutes", '/api/cron/process-campaigns'],
        ['outboundReconciliationTick', "every 5 minutes", '/api/cron/outbound-reconciliation'],
        ['fullEnrichEnrichmentReconciliationTick', "every 5 minutes", '/api/cron/fullenrich-enrichment-reconciliation'],
        ['replySyncTick', "every 5 minutes", '/api/cron/reply-sync'],
        ['privacyRetentionTick', '30 3 * * *', '/api/cron/privacy-retention'],
        ['antoniaRollupsTick', '10 0 * * *', '/api/cron/antonia-rollups'],
    ];
    for (const [name, cadence, path] of schedules) {
        const start = functionsSource.indexOf(`export const ${name} =`);
        assert.ok(start >= 0, `${name} is missing`);
        const block = functionsSource.slice(start, start + 700);
        assert.match(block, /functions\.scheduler\.onSchedule/);
        assert.match(block, new RegExp(`schedule: '${cadence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
        assert.match(block, /secrets: \['FIREBASE_SCHEDULER_SECRET'\]/);
        assert.match(block, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    assert.match(firebaseSchedulerAuth, /FIREBASE_SCHEDULER_SECRET/);
    assert.match(firebaseSchedulerAuth, /x-firebase-scheduler-secret/);
    assert.match(firebaseSchedulerAuth, /x-scheduler-owner/);
    assert.match(firebaseSchedulerAuth, /matchesConfiguredSecret/);
    for (const { route, source } of firebaseBridgeRoutes) {
        assert.match(source, /isFirebaseSchedulerRequest/, `${route} must require the Firebase bridge`);
        assert.doesNotMatch(source, /CRON_SECRET|x-cron-secret/, `${route} must not accept Vercel cron credentials`);
    }

    const campaignTick = sourceBlock('export const campaignProcessingTick =', 'export const outboundReconciliationTick =');
    assert.match(campaignTick, /\/api\/cron\/process-campaigns\?dryRun=true/);
    assert.match(campaignTick, /\/api\/cron\/campaigns-v2/);
    assert.match(campaignTick, /name: 'campaign-v2-due-state'/);
    assert.match(campaignTick, /Promise\.allSettled/);
    assert.ok(
        campaignTick.indexOf("name: 'campaign-processing'")
        < campaignTick.indexOf('const failures = results.filter'),
    );
    assert.ok(
        campaignTick.indexOf("name: 'campaign-v2-due-state'")
        < campaignTick.indexOf('const failures = results.filter'),
    );

    const replySyncSource = firebaseBridgeRoutes.find(({ route }) => route === 'reply-sync')!.source;
    assert.doesNotMatch(replySyncSource, /\.from\('provider_tokens'\)/);
    assert.match(replySyncSource, /\.from\('contacted_leads'\)/);
    assert.match(replySyncSource, /\.is\('replied_at', null\)/);
    assert.match(replySyncSource, /\.range\(ownerOffset, ownerOffset \+ candidateLimit - 1\)/);

    assert.match(deploymentDocs, /Firebase Scheduled Functions es la [^\n]+ propietaria/);
    assert.match(deploymentDocs, /`antoniaTick`/);
    assert.match(deploymentDocs, /`nativeResearchTick`/);
    assert.match(deploymentDocs, /`campaignProcessingTick`/);
    assert.match(deploymentDocs, /`fullEnrichEnrichmentReconciliationTick`/);
    assert.match(deploymentDocs, /20260830120000_fullenrich_callback_reconciliation\.sql/);
    assert.match(deploymentDocs, /`FIREBASE_SCHEDULER_SECRET`/);
    assert.match(deploymentDocs, /ocho ticks/);
    assert.match(deploymentDocs, /roles\/run\.invoker/);
    assert.match(deploymentDocs, /Firebase gestione la binding del job de Cloud Scheduler/);
    assert.match(deploymentDocs, /Retirar en un cambio separado las bindings de App Hosting/);
});
