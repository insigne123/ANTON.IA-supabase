import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCompanyResearchArtifactIdentity,
  claimCompanyResearchArtifact,
  isFreshReusableCompanyResearchArtifact,
  type CompanyResearchArtifact,
} from '@/lib/server/company-research-artifacts';

const migration = readFileSync('supabase/migrations/20260822133000_research_company_artifacts.sql', 'utf8');
const nativeResearchSource = readFileSync('src/lib/server/native-research.ts', 'utf8');

function identity(overrides: Record<string, unknown> = {}) {
  return buildCompanyResearchArtifactIdentity({
    organizationId: '00000000-0000-4000-8000-000000000001',
    companyDomain: 'https://www.Acme.test/about',
    companyName: 'ACME, Inc.',
    countryCode: 'CL',
    researchDepth: 'standard',
    researchLanguage: 'es',
    ...overrides,
  });
}

function artifactFor(value = identity()): CompanyResearchArtifact {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    ...value,
    revision: 1,
    status: 'completed',
    payload: { companySignals: { domain: 'acme.test', fetchedAt: '2026-08-22T12:00:00.000Z' } },
    expiresAt: '2026-08-23T12:00:00.000Z',
    errorCode: null,
    errorMessage: null,
    errorMetadata: {},
    createdAt: '2026-08-22T12:00:00.000Z',
    updatedAt: '2026-08-22T12:00:00.000Z',
    completedAt: '2026-08-22T12:00:00.000Z',
  };
}

test('company artifact identity normalizes company input and isolates every cache dimension', () => {
  const first = identity();
  const normalized = identity({ companyDomain: 'acme.test', companyName: 'Acme' });

  assert.equal(first.companyIdentity, 'domain:acme.test');
  assert.equal(first.cacheIdentity, normalized.cacheIdentity);
  assert.notEqual(first.cacheIdentity, identity({ organizationId: '00000000-0000-4000-8000-000000000002' }).cacheIdentity);
  assert.notEqual(first.cacheIdentity, identity({ countryCode: 'US' }).cacheIdentity);
  assert.notEqual(first.cacheIdentity, identity({ researchDepth: 'deep' }).cacheIdentity);
  assert.notEqual(first.cacheIdentity, identity({ researchLanguage: 'en' }).cacheIdentity);
  assert.notEqual(first.cacheIdentity, identity({ profileRevision: 'seller-profile/v2' }).cacheIdentity);
  assert.notEqual(first.cacheIdentity, identity({ icpHash: 'icp-v2' }).cacheIdentity);
  assert.notEqual(first.cacheIdentity, identity({ promptVersion: 'prompt/v2' }).cacheIdentity);
  assert.notEqual(first.cacheIdentity, identity({ providerVersion: 'provider/v2' }).cacheIdentity);
  assert.notEqual(first.cacheIdentity, identity({ providerContextFingerprint: `sha256:${'a'.repeat(64)}` }).cacheIdentity);
});

test('only fresh artifacts with the exact tenant identity are reusable', () => {
  const currentIdentity = identity();
  const current = artifactFor(currentIdentity);
  const now = Date.parse('2026-08-22T13:00:00.000Z');

  assert.equal(isFreshReusableCompanyResearchArtifact(current, currentIdentity, now), true);
  assert.equal(isFreshReusableCompanyResearchArtifact(current, identity({ organizationId: '00000000-0000-4000-8000-000000000002' }), now), false);
  assert.equal(isFreshReusableCompanyResearchArtifact({ ...current, expiresAt: '2026-08-22T12:00:00.000Z' }, currentIdentity, now), false);
  assert.equal(isFreshReusableCompanyResearchArtifact({ ...current, status: 'failed' }, currentIdentity, now), false);
});

test('artifact claims pass the full identity to the service-role RPC', async () => {
  const currentIdentity = identity();
  let call: { name: string; args: Record<string, unknown> } | null = null;
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      call = { name, args };
      return {
        data: {
          state: 'claimed',
          claimed: true,
          claim_token: '20000000-0000-4000-8000-000000000001',
          artifact: {
            id: '10000000-0000-4000-8000-000000000001',
            organization_id: currentIdentity.organizationId,
            cache_identity: currentIdentity.cacheIdentity,
            company_identity: currentIdentity.companyIdentity,
            country_code: currentIdentity.countryCode,
            research_depth: currentIdentity.researchDepth,
            research_language: currentIdentity.researchLanguage,
            profile_revision: currentIdentity.profileRevision,
            icp_hash: currentIdentity.icpHash,
            prompt_version: currentIdentity.promptVersion,
            provider: currentIdentity.provider,
            provider_version: currentIdentity.providerVersion,
            revision: 1,
            status: 'running',
            payload: {},
            expires_at: '2026-08-22T12:05:00.000Z',
            error_metadata: {},
            created_at: '2026-08-22T12:00:00.000Z',
            updated_at: '2026-08-22T12:00:00.000Z',
            completed_at: null,
          },
        },
        error: null,
      };
    },
  };

  const result = await claimCompanyResearchArtifact({ identity: currentIdentity, leaseSeconds: 240 }, admin);

  assert.equal(result.state, 'claimed');
  assert.equal(result.claimToken, '20000000-0000-4000-8000-000000000001');
  assert.deepEqual(call, {
    name: 'claim_research_company_artifact_v1',
    args: {
      p_organization_id: currentIdentity.organizationId,
      p_cache_identity: currentIdentity.cacheIdentity,
      p_company_identity: currentIdentity.companyIdentity,
      p_country_code: currentIdentity.countryCode,
      p_research_depth: currentIdentity.researchDepth,
      p_research_language: currentIdentity.researchLanguage,
      p_profile_revision: currentIdentity.profileRevision,
      p_icp_hash: currentIdentity.icpHash,
      p_prompt_version: currentIdentity.promptVersion,
      p_provider: currentIdentity.provider,
      p_provider_version: currentIdentity.providerVersion,
      p_force_refresh: false,
      p_lease_seconds: 240,
    },
  });
});

test('migration keeps artifacts client-readable but server-write-only and lease-protected', () => {
  assert.match(migration, /create table public\.research_company_artifacts/);
  assert.match(migration, /unique \(organization_id, cache_identity, revision\)/);
  assert.match(migration, /alter table public\.research_company_artifacts enable row level security/);
  assert.match(migration, /grant select on table public\.research_company_artifacts to authenticated/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all) on table public\.research_company_artifacts to authenticated/);
  assert.match(migration, /create or replace function public\.claim_research_company_artifact_v1/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /create or replace function public\.complete_research_company_artifact_v1/);
  assert.match(migration, /create or replace function public\.release_research_company_artifact_claim_v1/);
  assert.match(migration, /grant execute on function public\.claim_research_company_artifact_v1[^\n]+to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.claim_research_company_artifact_v1[^\n]+to authenticated/);
  assert.match(nativeResearchSource, /buildCompanyResearchArtifactIdentity/);
  assert.match(nativeResearchSource, /claimCompanyResearchArtifact/);
  assert.match(nativeResearchSource, /completeCompanyResearchArtifact/);
  assert.doesNotMatch(nativeResearchSource, /NATIVE_CACHE_PROVIDER/);
});
