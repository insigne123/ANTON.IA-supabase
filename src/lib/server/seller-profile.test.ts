import assert from 'node:assert/strict';
import test from 'node:test';

import { sellerProfileInternals } from './seller-profile';

test('seller profile normalization reads extended context and splits service strings', () => {
  const profile = sellerProfileInternals.normalizeSellerProfile({
    full_name: 'Grace Hopper',
    job_title: 'Fundadora',
    company_name: 'Northstar',
    company_domain: 'northstar.example',
    signatures: {
      profile_extended: {
        sector: 'Operaciones',
        services: 'Automatizacion, CRM\nAnalitica',
        value_proposition: 'Reducimos trabajo manual.',
        proof_points: 'Caso A | Caso B',
      },
    },
  });

  assert.equal(profile.name, 'Grace Hopper');
  assert.equal(profile.jobTitle, 'Fundadora');
  assert.equal(profile.companyName, 'Northstar');
  assert.deepEqual(profile.services, ['Automatizacion', 'CRM', 'Analitica']);
  assert.equal(profile.valueProposition, 'Reducimos trabajo manual.');
  assert.deepEqual(profile.proofPoints, ['Caso A', 'Caso B']);
});
