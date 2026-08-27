import { cleanupE2eRun, loadLocalTestEnvironment } from './e2e-test-identity.mjs';

async function main() {
  loadLocalTestEnvironment();
  const result = await cleanupE2eRun(process.argv[2] || process.env.E2E_RUN_ID);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`[test:cleanup] ${error.message}`);
  process.exitCode = 1;
});
