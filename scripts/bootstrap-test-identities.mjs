import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { assertSafeTestTarget } from './assert-test-target.mjs';

export const QA_ORGANIZATIONS = {
  primary: 'ANTON.IA QA',
  outsider: 'ANTON.IA QA Externa',
};

export const QA_IDENTITIES = {
  owner: {
    email: 'qa-owner@antonia.test',
    fullName: 'QA Owner',
    organization: 'primary',
    role: 'owner',
  },
  member: {
    email: 'qa-member@antonia.test',
    fullName: 'QA Member',
    organization: 'primary',
    role: 'member',
  },
  outsider: {
    email: 'qa-outsider@antonia.test',
    fullName: 'QA Outsider',
    organization: 'outsider',
    role: 'owner',
  },
};

function requireValue(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} is required to bootstrap QA identities.`);
  return value;
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

async function ensureUser(admin, identity, password) {
  const existing = await findUserByEmail(admin, identity.email);
  const attributes = {
    password,
    email_confirm: true,
    user_metadata: {
      full_name: identity.fullName,
      qa_fixture: true,
    },
  };

  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, attributes);
    if (error) throw error;
    return data.user || existing;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: identity.email,
    ...attributes,
  });
  if (error || !data.user) throw error || new Error(`Could not create ${identity.email}.`);
  return data.user;
}

async function ensureProfile(admin, userId, email) {
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`The profile trigger did not create a profile for ${email}.`);
}

async function ensureOrganization(admin, name) {
  const { data: organizations, error: readError } = await admin
    .from('organizations')
    .select('id, name')
    .eq('name', name)
    .limit(1);
  if (readError) throw readError;
  if (organizations?.[0]) return organizations[0];

  const { data, error } = await admin
    .from('organizations')
    .insert({ name })
    .select('id, name')
    .single();
  if (error || !data) throw error || new Error(`Could not create QA organization ${name}.`);
  return data;
}

async function ensureMembership(admin, organizationId, userId, role) {
  const { error: cleanupError } = await admin
    .from('organization_members')
    .delete()
    .eq('user_id', userId)
    .neq('organization_id', organizationId);
  if (cleanupError) throw cleanupError;

  const { error } = await admin
    .from('organization_members')
    .upsert(
      { organization_id: organizationId, user_id: userId, role },
      { onConflict: 'organization_id,user_id' },
    );
  if (error) throw error;
}

export async function ensureQaIdentities(env = process.env) {
  const target = assertSafeTestTarget(env);
  const serviceRoleKey = requireValue(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const password = requireValue(env, 'QA_TEST_PASSWORD');
  if (password.length < 12) {
    throw new Error('QA_TEST_PASSWORD must contain at least 12 characters.');
  }

  const admin = createClient(target.supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const organizations = {
    primary: await ensureOrganization(admin, QA_ORGANIZATIONS.primary),
    outsider: await ensureOrganization(admin, QA_ORGANIZATIONS.outsider),
  };
  const users = {};

  for (const [name, identity] of Object.entries(QA_IDENTITIES)) {
    const user = await ensureUser(admin, identity, password);
    await ensureProfile(admin, user.id, identity.email);
    await ensureMembership(admin, organizations[identity.organization].id, user.id, identity.role);
    users[name] = user;
  }

  return { target, organizations, users };
}

async function main() {
  const useNonprod = process.argv.includes('--nonprod');
  const envPath = path.join(
    process.cwd(),
    useNonprod ? '.env.test.nonprod.local' : '.env.test.local',
  );
  if (!fs.existsSync(envPath)) {
    throw new Error(
      useNonprod
        ? 'Missing .env.test.nonprod.local. Run npm run test:env:nonprod first.'
        : 'Missing .env.test.local. Run npm run test:env:local first.',
    );
  }

  Object.assign(process.env, dotenv.parse(fs.readFileSync(envPath)));
  const result = await ensureQaIdentities();
  console.log(`[test:identity:ensure] Ensured ${Object.keys(result.users).length} QA identities in ${result.target.kind}.`);
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[test:identity:ensure] ${error.message}`);
    process.exitCode = 1;
  });
}
