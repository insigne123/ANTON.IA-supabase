import assert from 'node:assert/strict';
import test from 'node:test';

import { loadReportV2SellerConfiguration, sellerProfileInternals } from '@/lib/server/seller-profile';

function adminFixture(rows: Record<string, { data: unknown; error?: unknown }>) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async maybeSingle() { return { data: rows[table]?.data ?? null, error: rows[table]?.error ?? null }; },
      };
      return builder;
    },
  };
}

test('loads organization-owned Report V2 products, ICP, rollout mode, and stable context hash', async () => {
  const admin = adminFixture({
    antonia_workflow_settings: {
      data: {
        user_company_profile: {
          companyName: 'Northstar',
          products: [{ key: 'ops', name: 'Ops', services: ['Automation'], volumeAssumptions: { scenarioMultipliers: [1, 2, 3], minutesPerEvent: 5 } }],
        },
        icp: { products: { ops: { jurisdictions: ['CL'] } } },
        research_config: { reportV2Mode: 'visible' },
        profile_revision: 4,
      },
    },
  });
  const first = await loadReportV2SellerConfiguration({ organizationId: 'org', userId: 'user' }, admin);
  const second = await loadReportV2SellerConfiguration({ organizationId: 'org', userId: 'user' }, admin);

  assert.equal(first.mode, 'visible');
  assert.equal(first.profileRevision, 4);
  assert.equal(first.sellerProfile.companyName, 'Northstar');
  assert.equal(first.sellerProfile.products[0].key, 'ops');
  assert.deepEqual(first.sellerProfile.products[0].volumeAssumptions?.scenarioMultipliers, [1, 2, 3]);
  assert.equal(first.icpRules?.products.ops.jurisdictions[0], 'CL');
  assert.equal(first.synthesisContextHash, second.synthesisContextHash);
  assert.equal(admin.calls.includes('profiles'), false);
});

test('uses the personal offer only as fallback when the organization has no shared products', async () => {
  const admin = adminFixture({
    antonia_workflow_settings: {
      data: { user_company_profile: {}, icp: {}, research_config: { report_v2_mode: 'shadow' }, profile_revision: 1 },
    },
    profiles: {
      data: {
        full_name: 'Ada',
        company_name: 'Personal Co',
        signatures: { profile_extended: { services: ['Workflow design'], value_proposition: 'Reduce manual work.' } },
      },
    },
  });
  const configuration = await loadReportV2SellerConfiguration({ organizationId: 'org', userId: 'user' }, admin);

  assert.equal(configuration.mode, 'shadow');
  assert.equal(configuration.sellerProfile.products[0].key, 'personal-offer');
  assert.deepEqual(configuration.sellerProfile.products[0].capabilities, ['Workflow design']);
  assert.ok(admin.calls.includes('profiles'));
});

test('does not silently accept malformed organization ICP settings', async () => {
  const admin = adminFixture({
    antonia_workflow_settings: {
      data: {
        user_company_profile: { products: [{ key: 'ops', name: 'Ops' }] },
        icp: { products: { ops: { jurisdictions: [42] } } },
        research_config: { reportV2Mode: 'visible' },
        profile_revision: 1,
      },
    },
  });
  await assert.rejects(
    () => loadReportV2SellerConfiguration({ organizationId: 'org', userId: 'user' }, admin),
    /REPORT_V2_ICP_CONFIGURATION_INVALID/,
  );
});

test('rollout mode remains default-off for unknown values', () => {
  assert.equal(sellerProfileInternals.reportV2Mode('enabled'), 'off');
});
