// Repeatable Cowork release check. Does not load env files or call production.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const suites = ['src/lib/cowork', 'src/lib/server/cowork'].flatMap(directory =>
  readdirSync(directory).filter(name => name.endsWith('.test.ts')).map(name => `${directory}/${name}`));
const checks = [
  ['--test', 'scripts/compare-cowork-evals.test.mjs'],
  ['scripts/test-cowork-company-results.mjs'],
  ['scripts/test-cowork-contact-names.mjs'],
  ['scripts/test-cowork-prepare-batch.mjs'],
  ['scripts/test-cowork-prepare-batch-card.mjs'],
  ['scripts/test-cowork-search-results-ui.mjs'],
  ['scripts/test-cowork-profile-search-ui.mjs'],
  ['scripts/test-cowork-research-notice.mjs'],
  ['scripts/test-cowork-research-progress-ui.mjs'],
  ['scripts/test-cowork-campaign-people-ui.mjs'],
  ['scripts/test-stage-suggestions-ui.mjs'],
  ['scripts/test-team-lock-ui.mjs'],
  ['scripts/test-pipeline-flow-ui.mjs'],
  ['scripts/test-default-sender-ui.mjs'],
  ['scripts/test-cowork-guide-ui.mjs'],
  ['scripts/test-conversation-close-ui.mjs'],
  ['scripts/test-research-report-writing-ui.mjs'],
  ['--loader', './scripts/ts-test-loader.mjs', '--test', 'scripts/cowork-thread-corpus.test.ts'],
  ['--loader', './scripts/ts-test-loader.mjs', '--test', 'scripts/cowork-thread-send-corpus.test.ts'],
  ['--loader', './scripts/ts-test-loader.mjs', '--test', 'scripts/cowork-batch-corpus.test.ts'],
  ['--loader', './scripts/ts-test-loader.mjs', '--test', 'scripts/cowork-agenda-corpus.test.ts'],
  ['scripts/test-cowork-message-context.mjs'],
  ['scripts/test-cowork-enrich-batch.mjs'],
  ['scripts/test-cowork-send-batch.mjs'],
  ['scripts/test-cowork-linkedin-jobs.mjs'],
  ['--loader', './scripts/ts-test-loader.mjs', '--test', ...suites, 'scripts/cowork-axis-replay.test.ts', 'scripts/cowork-conversation-corpus.test.ts'],
  ...['scheduler','save-contact','external-search','autonomy','native-draft','draft-polling','start-research','thread','export-route','block-export-route','overview-route','contacts-import','reply-thread','campaign-retry','enrich-phone','linkedin-batch','campaign-edit','search-queue-ui','workspace','conversation-flow','draft','wake','effects','enrich-contact','campaigns','queue-fairness','code-execution','artifact-preview','specialist-queue','domains','domain-effects','domain-effects-2','domain-effects-3','live-draft','writer','judge','contacts-route','held-answer','quick-actions','email-review-ui']
    .map(name => [`scripts/test-cowork-${name}.mjs`]),
  ['--loader', './scripts/ts-test-loader.mjs', 'scripts/test-cowork-send-email.mjs'],
  ['--loader', './scripts/ts-test-loader.mjs', '--test', 'scripts/cowork-axis-paquete.test.ts'],
  ['--loader', './scripts/ts-test-loader.mjs', '--test', 'scripts/cowork-axis-resto.test.ts'],
];
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Cowork isolated verification passed. Production, browser rendering and SQL concurrency are not covered by this command.');
