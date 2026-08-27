import { createE2eIdentity, loadLocalTestEnvironment } from './e2e-test-identity.mjs';

async function main() {
  loadLocalTestEnvironment();
  const result = await createE2eIdentity(process.argv[2] || process.env.E2E_RUN_ID);
  const { password: _password, ...safeResult } = result;
  console.log(JSON.stringify(safeResult, null, 2));
}

main().catch((error) => {
  console.error(`[test:e2e:identity:create] ${error.message}`);
  process.exitCode = 1;
});
