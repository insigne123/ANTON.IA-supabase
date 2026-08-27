import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { assertSafeTestTarget } from './assert-test-target.mjs';

const E2E_EMAIL_DOMAIN = 'antonia.test';
const DEFAULT_TTL_MINUTES = 240;
const NULLING_ORGANIZATION_TABLES = [
  'antonia_event_rollups_daily',
  'antonia_event_ledger',
  'antonia_usage_increments',
  'antonia_lead_events',
  'antonia_logs',
  'antonia_reports',
  'antonia_tasks',
  'enriched_leads',
  'leads',
  'antonia_missions',
];

function requireValue(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for local E2E identities.`);
  return value;
}

function localAdmin(env) {
  const target = assertSafeTestTarget(env);
  if (target.kind !== 'local') {
    throw new Error('E2E identity operations may only target the local Supabase stack.');
  }
  const admin = createClient(target.supabaseUrl, requireValue(env, 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { admin, target };
}

async function expectQuery(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function findUserByEmail(admin, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data.users || [];
    const user = users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (users.length < 1000) return null;
  }
}

async function findOrganization(admin, name) {
  const organizations = await expectQuery(
    `Could not find E2E organization ${name}`,
    admin.from('organizations').select('id, name').eq('name', name).limit(2),
  );
  if ((organizations || []).length > 1) {
    throw new Error(`Refusing to use duplicate E2E organizations named ${name}.`);
  }
  return organizations?.[0] || null;
}

function assertOwnedE2eUser(user, runId) {
  if (!user) return;
  const metadata = user.user_metadata || {};
  if (metadata.qa_fixture !== true || metadata.e2e_run_id !== runId) {
    throw new Error(`Refusing to modify ${user.email}; it is not owned by E2E run ${runId}.`);
  }
}

function readTtlMinutes(env, requestedTtl) {
  const value = Number(requestedTtl ?? env.E2E_TEST_TTL_MINUTES ?? DEFAULT_TTL_MINUTES);
  if (!Number.isInteger(value) || value < 5 || value > 1440) {
    throw new Error('E2E_TEST_TTL_MINUTES must be an integer between 5 and 1440.');
  }
  return value;
}

export function validateE2eRunId(value) {
  const runId = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{2,46}[a-z0-9]$/.test(runId)) {
    throw new Error('E2E run ID must be 4-48 lowercase letters, digits, or hyphens, without edge hyphens.');
  }
  return runId;
}

export function loadLocalTestEnvironment(env = process.env) {
  const envPath = path.join(process.cwd(), '.env.test.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.test.local. Run npm run test:env:local first.');
  }
  Object.assign(env, dotenv.parse(fs.readFileSync(envPath)));
  const target = assertSafeTestTarget(env);
  if (target.kind !== 'local') {
    throw new Error('.env.test.local must point to the local Supabase stack.');
  }
  return env;
}

export async function createE2eIdentity(runIdValue, options = {}) {
  const runId = validateE2eRunId(runIdValue);
  const env = options.env || process.env;
  const { admin, target } = localAdmin(env);
  const password = requireValue(env, 'QA_TEST_PASSWORD');
  if (password.length < 12) throw new Error('QA_TEST_PASSWORD must contain at least 12 characters.');

  const email = `e2e-${runId}@${E2E_EMAIL_DOMAIN}`;
  const organizationName = `ANTON.IA E2E ${runId}`;
  const expiresAt = new Date(
    (options.now?.getTime() ?? Date.now()) + readTtlMinutes(env, options.ttlMinutes) * 60_000,
  ).toISOString();
  let user = await findUserByEmail(admin, email);
  assertOwnedE2eUser(user, runId);

  const baseMetadata = {
    ...(user?.user_metadata || {}),
    full_name: `E2E ${runId}`,
    qa_fixture: true,
    e2e_run_id: runId,
    e2e_expires_at: expiresAt,
  };
  if (user) {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: baseMetadata,
    });
    if (error) throw error;
    user = data.user || user;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: baseMetadata,
    });
    if (error || !data.user) throw error || new Error(`Could not create ${email}.`);
    user = data.user;
  }

  let organization = await findOrganization(admin, organizationName);
  if (!organization) {
    organization = await expectQuery(
      `Could not create E2E organization ${organizationName}`,
      admin.from('organizations').insert({ name: organizationName }).select('id, name').single(),
    );
  } else {
    const members = await expectQuery(
      `Could not verify E2E organization ${organizationName}`,
      admin.from('organization_members').select('user_id').eq('organization_id', organization.id),
    );
    if ((members || []).some((member) => member.user_id !== user.id)) {
      throw new Error(`Refusing to reuse ${organizationName}; it contains a different user.`);
    }
  }

  await expectQuery(
    `Could not remove stale memberships for ${email}`,
    admin.from('organization_members').delete().eq('user_id', user.id).neq('organization_id', organization.id),
  );
  await expectQuery(
    `Could not create membership for ${email}`,
    admin.from('organization_members').upsert({
      organization_id: organization.id,
      user_id: user.id,
      role: 'owner',
    }, { onConflict: 'organization_id,user_id' }),
  );
  await expectQuery(
    `Could not set profile for ${email}`,
    admin.from('profiles').upsert({
      id: user.id,
      email,
      full_name: `E2E ${runId}`,
      company_name: organizationName,
      company_domain: 'example.test',
      job_title: 'E2E Test User',
      company_profile: { qa_fixture: true, e2e_run_id: runId },
      updated_at: new Date(options.now?.getTime() ?? Date.now()).toISOString(),
    }, { onConflict: 'id' }),
  );

  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...baseMetadata,
      e2e_organization_id: organization.id,
    },
  });
  if (updateError) throw updateError;

  return {
    runId,
    email,
    password,
    userId: updated.user?.id || user.id,
    organizationId: organization.id,
    organizationName,
    expiresAt,
    target: target.kind,
  };
}

export async function cleanupE2eRun(runIdValue, options = {}) {
  const runId = validateE2eRunId(runIdValue);
  const env = options.env || process.env;
  const { admin, target } = localAdmin(env);
  const email = `e2e-${runId}@${E2E_EMAIL_DOMAIN}`;
  const organizationName = `ANTON.IA E2E ${runId}`;
  const user = await findUserByEmail(admin, email);
  const organization = await findOrganization(admin, organizationName);
  assertOwnedE2eUser(user, runId);

  if (organization) {
    const members = await expectQuery(
      `Could not inspect members of ${organizationName}`,
      admin.from('organization_members').select('user_id').eq('organization_id', organization.id),
    );
    if ((members || []).some((member) => !user || member.user_id !== user.id)) {
      throw new Error(`Refusing to delete ${organizationName}; it contains a non-E2E member.`);
    }
  }

  if (user) {
    await expectQuery(
      `Could not remove user-owned missions for ${email}`,
      admin.from('antonia_missions').delete().eq('user_id', user.id),
    );
  }

  if (organization) {
    for (const table of NULLING_ORGANIZATION_TABLES) {
      await expectQuery(
        `Could not clean ${table} for ${organizationName}`,
        admin.from(table).delete().eq('organization_id', organization.id),
      );
    }
    await expectQuery(
      `Could not delete ${organizationName}`,
      admin.from('organizations').delete().eq('id', organization.id),
    );
  }

  if (user) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  }

  return {
    runId,
    email,
    userDeleted: Boolean(user),
    organizationDeleted: Boolean(organization),
    target: target.kind,
  };
}
