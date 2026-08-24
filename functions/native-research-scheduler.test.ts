import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('functions/index.ts', 'utf8');
const bridgeSource = readFileSync('src/app/api/cron/native-research/route.ts', 'utf8');

test('native research scheduler is opt-in and delegates with its dedicated worker secret', () => {
    assert.match(source, /process\.env\.NATIVE_RESEARCH_SCHEDULER_ENABLED \|\| 'false'/);
    assert.match(source, /\/api\/cron\/native-research\?limit=\$\{limit\}/);
    assert.match(source, /process\.env\.LEAD_RESEARCH_WORKER_SECRET/);
    assert.match(source, /'x-lead-research-worker-secret': secret/);
    assert.match(source, /export const nativeResearchTick = functions\.scheduler\.onSchedule/);
    assert.match(source, /secrets: \['LEAD_RESEARCH_WORKER_SECRET'\]/);
    assert.match(bridgeSource, /matchesConfiguredSecret/);
    assert.match(bridgeSource, /x-lead-research-worker-secret/);
    assert.doesNotMatch(bridgeSource, /CRON_SECRET|INTERNAL_API_SECRET|x-cron-secret/);
});

test('native research manual trigger is private and does not reuse the legacy tick secret', () => {
    const manualTriggerStart = source.indexOf('export const nativeResearchTickHttp');
    const antoniaScheduleStart = source.indexOf('// Main scheduler function', manualTriggerStart);
    assert.ok(manualTriggerStart >= 0 && antoniaScheduleStart > manualTriggerStart);

    const manualTrigger = source.slice(manualTriggerStart, antoniaScheduleStart);
    assert.match(manualTrigger, /invoker: 'private'/);
    assert.match(manualTrigger, /NATIVE_RESEARCH_MANUAL_TICK_SECRET/);
    assert.match(manualTrigger, /hasManualTickAuthorization/);
    assert.match(source, /x-manual-trigger-secret/);
    assert.doesNotMatch(manualTrigger, /\bANTONIA_TICK_SECRET\b|invoker: 'public'|x-cron-secret/);
});
