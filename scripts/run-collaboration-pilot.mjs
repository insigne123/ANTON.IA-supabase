import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import { assertSafeTestTarget } from './assert-test-target.mjs';
import { QA_ORGANIZATIONS } from './bootstrap-test-identities.mjs';
import { NONPROD_PROJECT_REF } from './supabase-nonprod.mjs';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env.test.nonprod.local');
const action = process.argv[2];

if (!['report', 'enable', 'disable'].includes(action)) {
  throw new Error('Use report, enable, or disable.');
}
if (!fs.existsSync(ENV_PATH)) {
  throw new Error('Missing .env.test.nonprod.local. Run npm run test:env:nonprod.');
}

const env = dotenv.parse(fs.readFileSync(ENV_PATH));
const target = assertSafeTestTarget(env);
if (target.kind !== 'nonprod' || target.projectRef !== NONPROD_PROJECT_REF) {
  throw new Error('Collaboration pilot only runs against approved nonprod.');
}
if (env.OUTBOUND_DELIVERY_MODE !== 'disabled' || env.ALLOW_EXTERNAL_SIDE_EFFECTS !== 'false') {
  throw new Error('External side effects must remain disabled for the pilot.');
}

const admin = createClient(target.supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertNoError(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

async function readPilotOrganization() {
  return assertNoError(await admin
    .from('organizations')
    .select('id,name,collaboration_v1_enabled')
    .eq('name', QA_ORGANIZATIONS.primary)
    .single(), 'Read pilot organization');
}

async function readReport(organizationId) {
  const report = assertNoError(await admin.rpc('organization_collaboration_rollout_report_v1', {
    p_organization_id: organizationId,
  }), 'Read collaboration rollout report');
  return {
    ambiguousRecipientCount: Number(report?.ambiguousRecipientCount || 0),
    confirmedRecipientCount: Number(report?.confirmedRecipientCount || 0),
    contactThreadCount: Number(report?.contactThreadCount || 0),
    inFlightOrUnknownDispatchCount: Number(report?.inFlightOrUnknownDispatchCount || 0),
  };
}

const organization = await readPilotOrganization();
const before = await readReport(organization.id);

if (action === 'report') {
  console.log(JSON.stringify({
    target: target.projectRef,
    organization: organization.name,
    enabled: organization.collaboration_v1_enabled,
    report: before,
  }, null, 2));
  process.exit(0);
}

if (action === 'enable') {
  if (before.inFlightOrUnknownDispatchCount !== 0) {
    throw new Error('Pilot blocked: in-flight or unknown dispatches exist.');
  }
  if (before.ambiguousRecipientCount !== 0) {
    throw new Error('Pilot blocked: ambiguous recipients require manual review.');
  }
}

const enabled = action === 'enable';
const reason = enabled
  ? `Controlled synthetic nonprod pilot approved 2026-08-26 (${NONPROD_PROJECT_REF})`
  : `Controlled synthetic nonprod pilot rollback 2026-08-26 (${NONPROD_PROJECT_REF})`;
assertNoError(await admin.rpc('set_organization_collaboration_v1_enabled', {
  p_organization_id: organization.id,
  p_enabled: enabled,
  p_reason: reason,
}), `${enabled ? 'Enable' : 'Disable'} collaboration pilot`);

const afterOrganization = await readPilotOrganization();
const after = await readReport(organization.id);
if (afterOrganization.collaboration_v1_enabled !== enabled) {
  throw new Error('Pilot flag did not reach the requested state.');
}

console.log(JSON.stringify({
  target: target.projectRef,
  organization: afterOrganization.name,
  enabled: afterOrganization.collaboration_v1_enabled,
  report: after,
}, null, 2));
