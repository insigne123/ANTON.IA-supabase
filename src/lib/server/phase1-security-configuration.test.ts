import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260822121500_phase1_security_rls.sql', 'utf8');
const appHosting = readFileSync('apphosting.yaml', 'utf8');
const tokenService = readFileSync('src/lib/services/token-service.ts', 'utf8');
const tokenStatusRoute = readFileSync('src/app/api/integrations/store-token/route.ts', 'utf8');
const gmailPage = readFileSync('src/app/(app)/gmail/page.tsx', 'utf8');
const outlookPage = readFileSync('src/app/(app)/outlook/page.tsx', 'utf8');
const antoniaPage = readFileSync('src/app/(app)/antonia/page.tsx', 'utf8');

test('phase 1 migration scopes tenant reads and keeps sensitive writes server-only', () => {
  assert.match(migration, /create or replace function public\.current_user_shares_organization/);
  assert.match(migration, /create policy "Tenant members can read profiles"/);
  assert.match(migration, /public\.current_user_shares_organization\(id\)/);

  assert.match(migration, /create policy "Tenant members can read lead responses"/);
  assert.match(migration, /revoke all on table public\.lead_responses from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.lead_responses to authenticated/);
  assert.match(migration, /create policy "Users can create owned saved searches"/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)[\s\S]*public\.is_current_user_organization_member\(organization_id\)/);
  assert.match(migration, /create policy "Tenant members can read email events"/);
  assert.match(migration, /revoke all on table public\.email_events from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.email_events to authenticated/);

  assert.match(migration, /revoke all on table public\.provider_tokens from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.provider_tokens to service_role/);
  assert.match(migration, /foreach table_name in array array\[/);
  assert.match(migration, /'axis_rondas'[\s\S]*'axis_empresas'[\s\S]*'axis_leads'[\s\S]*'axis_toques'[\s\S]*'axis_respuestas'/);
  assert.match(migration, /for all to service_role using \(true\) with check \(true\)/);
});

test('provider connection checks use the authenticated server boundary', () => {
  assert.match(tokenService, /getSupabaseAdminClient/);
  assert.match(tokenStatusRoute, /getSupabaseAdminClient\(\)/);

  for (const source of [gmailPage, outlookPage, antoniaPage]) {
    assert.doesNotMatch(source, /\.from\('provider_tokens'\)/);
    assert.match(source, /\/api\/integrations\/store-token/);
  }
});

test('App Hosting uses the buildpack and production OpenAI and FullEnrich settings', () => {
  assert.doesNotMatch(appHosting, /^build:/m);
  assert.match(appHosting, /- variable: FULLENRICH_API_KEY\s+secret: FULLENRICH_API_KEY\s+availability: \[RUNTIME\]/);
  assert.match(appHosting, /- variable: OPENAI_API_KEY\s+secret: OPENAI_API_KEY\s+availability: \[RUNTIME\]/);
  assert.match(appHosting, /- variable: AI_PROVIDER\s+value: openai\s+availability: \[RUNTIME\]/);
  assert.doesNotMatch(appHosting, /- variable: GLM_API_KEY/);
});
