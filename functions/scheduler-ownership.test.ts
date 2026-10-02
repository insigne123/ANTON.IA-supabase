import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const functionsSource = readFileSync('functions/index.ts', 'utf8');
const appHosting = readFileSync('apphosting.yaml', 'utf8');
const firebaseSchedulerAuth = readFileSync('src/app/api/cron/_firebase-scheduler-auth.ts', 'utf8');
const deploymentDocs = readFileSync('docs/deployment.md', 'utf8');
const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: Array<{ path?: string }> };

const firebaseBridgeRoutes = [
    'process-campaigns',
    'campaigns-v2',
    'research-sequences',
    'outbound-reconciliation',
    'apollo-reconciliation',
    'apollo-usage',
    'reply-sync',
    'privacy-retention',
    'antonia-rollups',
    'commercial-opportunities',
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

test('the retired mission agent has no scheduler, manual trigger, legacy worker or cron left', () => {
    assert.doesNotMatch(functionsSource, /export (?:const|\{)[^\n]*(?:antoniaTick\b|antoniaTickHttp\b|antoniaWorker\b)|\bfunction runAntoniaTick\b/);
    assert.doesNotMatch(functionsSource, /from\('antonia_tasks'\)|from\('antonia_missions'\)/);
    assert.equal(existsSync('src/app/api/cron/antonia/route.ts'), false);
    assert.equal(existsSync('functions/src/antonia-worker.ts'), false);
    assert.doesNotMatch(appHosting, /ANTONIA_FIREBASE_TICK_URL|ANTONIA_FIREBASE_TICK_SECRET/);
    assert.match(functionsSource, /x-manual-trigger-secret/);
});

test('Firebase owns all production scheduler bridges and Vercel only schedules Suplia', () => {
    const scheduledPaths = (vercelConfig.crons || []).map((cron) => cron.path);
    assert.deepEqual(scheduledPaths, ['/api/cron/suplia']);

    const schedules = [
        ['researchSequencePreparationTick', 'every 1 minutes', '/api/cron/research-sequences'],
        ['campaignProcessingTick', "every 5 minutes", '/api/cron/process-campaigns'],
        ['outboundReconciliationTick', "every 5 minutes", '/api/cron/outbound-reconciliation'],
        ['apolloReconciliationTick', "every 5 minutes", '/api/cron/apollo-reconciliation'],
        ['apolloUsageTick', "every 1 hours", '/api/cron/apollo-usage'],
        ['replySyncTick', "every 5 minutes", '/api/cron/reply-sync'],
        ['privacyRetentionTick', '30 3 * * *', '/api/cron/privacy-retention'],
        ['antoniaRollupsTick', '10 0 * * *', '/api/cron/antonia-rollups'],
        ['commercialOpportunitiesTick', '15 11 * * *', '/api/cron/commercial-opportunities'],
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
    // Cooling-down threads must not be rescanned every tick; replied threads stay
    // in scope for conversation sync and failed threads back off by error state.
    assert.match(replySyncSource, /replySyncDueFilter/);
    assert.match(replySyncSource, /\.order\('reply_sync_attempted_at'/);
    assert.doesNotMatch(replySyncSource, /\.is\('replied_at', null\)/);
    assert.doesNotMatch(replySyncSource, /ownerOffset/);

    assert.match(deploymentDocs, /Firebase Scheduled Functions es la [^\n]+ propietaria/);
    assert.match(deploymentDocs, /El agente de misiones[^\n]+se retiró/);
    assert.match(deploymentDocs, /`nativeResearchTick`/);
    assert.match(deploymentDocs, /`campaignProcessingTick`/);
    assert.match(deploymentDocs, /`FIREBASE_SCHEDULER_SECRET`/);
    assert.match(deploymentDocs, /roles\/run\.invoker/);
    assert.match(deploymentDocs, /Firebase gestione la binding del job de Cloud Scheduler/);
    assert.match(deploymentDocs, /ya se retiraron de `apphosting.yaml` junto con el agente/);
});
