// Repeatable Cowork release check. Does not load env files or call production.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const suites = ['src/lib/cowork', 'src/lib/server/cowork'].flatMap(directory =>
  readdirSync(directory).filter(name => name.endsWith('.test.ts')).map(name => `${directory}/${name}`));
const checks = [
  ['scripts/test-cowork-company-results.mjs'],
  ['scripts/test-cowork-message-context.mjs'],
  ['scripts/test-cowork-enrich-batch.mjs'],
  ['scripts/test-cowork-send-batch.mjs'],
  ['scripts/test-cowork-linkedin-jobs.mjs'],
  ['--loader', './scripts/ts-test-loader.mjs', '--test', ...suites, 'scripts/cowork-axis-replay.test.ts'],
  ...['scheduler','save-contact','external-search','autonomy','native-draft','draft-polling','start-research','thread','export-route','search-queue-ui','workspace','effects','enrich-contact','campaigns','queue-fairness','code-execution','artifact-preview','specialist-queue','domains','domain-effects','domain-effects-2','domain-effects-3']
    .map(name => [`scripts/test-cowork-${name}.mjs`]),
  ['--loader', './scripts/ts-test-loader.mjs', 'scripts/test-cowork-send-email.mjs'],
];
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Cowork isolated verification passed. Production, browser rendering and SQL concurrency are not covered by this command.');
