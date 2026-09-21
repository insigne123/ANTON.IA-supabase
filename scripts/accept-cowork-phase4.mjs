// Reproducible local acceptance. SQL checks use an embedded DB, never Supabase.
// This command does not certify the remaining domain writes or production UX.
import { spawnSync } from 'node:child_process';
const checks = [
  ['scripts/verify-cowork.mjs'],
  ['--loader','./scripts/ts-test-loader.mjs','--test',
    'src/lib/server/campaigns-v2/inbox.test.ts','src/lib/server/privacy-subject-data.test.ts'],
  ['scripts/test-cowork-operation-leases-sql.mjs'],
  ['scripts/test-cowork-specialist-queue-sql.mjs'],
  ['scripts/test-cowork-specialist-integration.mjs'],
];
const native = process.argv.includes('--native');
const browser = process.argv.includes('--browser');
if (native) checks.push(['scripts/test-cowork-specialist-queue-sql.mjs', '--native'], ['scripts/test-cowork-specialist-integration.mjs', '--native']);
if (browser) checks.push(['scripts/test-cowork-profile-browser.mjs'], ['scripts/test-cowork-reviews-browser.mjs']);
const results=[];
for(const args of checks){
  const started=Date.now();
  const child=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
  results.push({command:`node ${args.join(' ')}`,passed:child.status===0,durationMs:Date.now()-started});
  if(child.error || child.status!==0){
    console.error(JSON.stringify({accepted:false,checks:results},null,2));
    process.exit(child.status||1);
  }
}
console.log(JSON.stringify({accepted:true,scope:'implemented_operations_and_runtime_local_only',checks:results,
  coverage:{conversationBudgetConcurrent:native,specialistClaimsConcurrent:native,profileRendered:browser,reviewCardsRendered:browser},
  notCovered:['remaining_domain_mutations','real_provider_quality','production_authenticated_flow',
    'remaining_rendered_accessibility','remaining_multi_connection_postgres_races']},null,2));
