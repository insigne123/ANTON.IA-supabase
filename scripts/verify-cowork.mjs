// Repeatable Cowork release check. Does not load env files or call production.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const suites = ['src/lib/cowork', 'src/lib/server/cowork'].flatMap(directory =>
  readdirSync(directory).filter(name => name.endsWith('.test.ts')).map(name => `${directory}/${name}`));
const checks = [
  ['--loader', './scripts/ts-test-loader.mjs', '--test', ...suites],
  ...['scheduler','save-contact','external-search','autonomy','native-draft','draft-polling','start-research','thread','export-route','search-queue-ui','workspace']
    .map(name => [`scripts/test-cowork-${name}.mjs`]),
];
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Cowork isolated verification passed. Production, browser rendering and SQL concurrency are not covered by this command.');
