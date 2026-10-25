import assert from 'node:assert/strict';
import test from 'node:test';

import { loadReportV2SellerConfiguration, loadSellerProfile, sellerProfileInternals } from '@/lib/server/seller-profile';
import { buildProfileUpdate, createEmptyProfileForm } from '@/lib/profile/profile-mappings';

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
        research_config: { reportV2Mode: 'visible', reportQuestionnaireMode: 'visible' },
        profile_revision: 4,
      },
    },
  });
  const first = await loadReportV2SellerConfiguration({ organizationId: 'org', userId: 'user' }, admin);
  const second = await loadReportV2SellerConfiguration({ organizationId: 'org', userId: 'user' }, admin);

  assert.equal(first.mode, 'visible');
  assert.equal(first.questionnaireMode, 'visible');
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

test('the personal offer carries its proof points and the name of a single named service', async () => {
  const admin = adminFixture({
    antonia_workflow_settings: { data: { user_company_profile: {}, icp: {}, research_config: {}, profile_revision: 1 } },
    profiles: {
      data: {
        full_name: 'Ada',
        company_name: 'Yago SpA',
        signatures: { profile_extended: {
          services: ['AXIS: consultas judiciales automáticas para revisar antecedentes laborales'],
          proofPoints: ['Un cliente en piloto ya lo usa a diario'],
        } },
      },
    },
  });
  const configuration = await loadReportV2SellerConfiguration({ organizationId: 'org', userId: 'user' }, admin);
  assert.equal(configuration.sellerProfile.products[0].name, 'AXIS');
  assert.deepEqual(configuration.sellerProfile.products[0].proofPoints, ['Un cliente en piloto ya lo usa a diario']);
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

test('rollout mode: the current report without a setting, an explicit choice wins, unknown values stay off', () => {
  assert.equal(sellerProfileInternals.reportV2Mode(undefined), 'visible');
  assert.equal(sellerProfileInternals.reportV2Mode(''), 'visible');
  assert.equal(sellerProfileInternals.reportV2Mode('off'), 'off');
  assert.equal(sellerProfileInternals.reportV2Mode('shadow'), 'shadow');
  assert.equal(sellerProfileInternals.reportV2Mode('enabled'), 'off');
  assert.equal(sellerProfileInternals.reportQuestionnaireMode('enabled'), 'off');
  assert.equal(sellerProfileInternals.reportQuestionnaireMode(undefined), 'off');
});

test('rollout remains part of synthesis identity until transactional delivery promotion is supported', async () => {
  const hashes = [];
  for (const mode of ['off', 'shadow', 'visible']) {
    const admin = adminFixture({ antonia_workflow_settings: { data: {
      user_company_profile: { products: [{ key: 'ops' }] }, research_config: { reportV2Mode: mode }, profile_revision: 1,
    } } });
    const configuration = await loadReportV2SellerConfiguration({ organizationId: 'org', userId: 'owner' }, admin);
    assert.equal(configuration.mode, mode);
    hashes.push(configuration.synthesisContextHash);
  }
  assert.equal(new Set(hashes).size, 3);
});

test('with a company profile, every draft sells what the company sells, signed by the person (APP-06)', async () => {
  const personal = buildProfileUpdate({ ...createEmptyProfileForm(), name: 'Camila R.', role: 'Ejecutiva comercial', companyName: 'Yago',
    services: 'Mi servicio propio', valueProposition: 'Mi propia versión de la oferta' });
  const company = { services: 'AXIS: consultas judiciales en el PJUD', valueProposition: 'Revisamos antecedentes laborales en minutos.', companyName: 'Yago SpA',
    proofPoints: 'Procesa 1.000 personas en unos 30 minutos.' };
  const admin = adminFixture({ profiles: { data: personal }, organization_company_profile: { data: { fields: company } } });
  const seller = await loadSellerProfile('user', 'org', admin);
  assert.equal(seller.name, 'Camila R.');
  assert.equal(seller.jobTitle, 'Ejecutiva comercial');
  assert.equal(seller.companyName, 'Yago SpA');
  assert.match(JSON.stringify(seller), /Revisamos antecedentes laborales en minutos/);
  assert.doesNotMatch(JSON.stringify(seller), /Mi propia versión|Mi servicio propio/);
  // No owner's offer is borrowed: the company profile already says it.
  assert.equal(admin.calls.includes('organization_members'), false);
  // Without a company profile, the person's own offer, as before.
  const own = await loadSellerProfile('user', 'org', adminFixture({ profiles: { data: personal } }));
  assert.match(JSON.stringify(own), /Mi propia versión de la oferta/);
});
