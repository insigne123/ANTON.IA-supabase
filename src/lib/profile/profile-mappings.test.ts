import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyProfileSuggestion,
  buildProfileUpdate,
  createEmptyProfileForm,
  getDefaultSuggestionSelection,
  mapProfileToForm,
  normalizeCompanyWebsite,
  type CompanyProfileSuggestion,
} from '@/lib/profile/profile-mappings';

test('normalizes a company website to a safe canonical URL and domain', () => {
  assert.deepEqual(normalizeCompanyWebsite('  HTTP://www.Example.COM/products/  '), {
    website: 'https://example.com/products',
    domain: 'example.com',
  });
});

test('rejects unsafe or non-public website values', () => {
  assert.deepEqual(normalizeCompanyWebsite('javascript:alert(1)'), { website: '', domain: '' });
  assert.deepEqual(normalizeCompanyWebsite('https://user:pass@example.com'), { website: '', domain: '' });
  assert.deepEqual(normalizeCompanyWebsite('http://localhost:3000'), { website: '', domain: '' });
  assert.deepEqual(normalizeCompanyWebsite('https://internal.local'), { website: '', domain: '' });
});

test('maps legacy and list profile values into editable strings', () => {
  const form = mapProfileToForm({
    full_name: 'Ana',
    job_title: null,
    company_name: 'Acme',
    company_domain: 'www.acme.com',
    signatures: {
      profile_extended: {
        role: 'Directora',
        industry: 'Software',
        services: ['Automatizacion', 'Analitica'],
        value_proposition: 'Decisiones mas rapidas',
        proof_points: ['25% menos tiempo de gestion', '40 equipos implementados'],
      },
    },
  });

  assert.equal(form.role, 'Directora');
  assert.equal(form.sector, 'Software');
  assert.equal(form.services, 'Automatizacion, Analitica');
  assert.equal(form.valueProposition, 'Decisiones mas rapidas');
  assert.equal(form.proofPoints, '25% menos tiempo de gestion\n40 equipos implementados');
  assert.equal(form.website, 'https://acme.com');
});

test('buildProfileUpdate preserves every outer and nested signature key', () => {
  const form = {
    ...createEmptyProfileForm(),
    name: 'Ana',
    role: 'CEO',
    companyName: 'Acme',
    website: 'https://www.acme.com/about',
    sector: 'Tecnologia',
    services: 'Software',
    proofPoints: '25% menos tiempo de gestion\n\n  40 equipos implementados  ',
  };
  const update = buildProfileUpdate(form, {
    signatures: {
      gmail: { enabled: true, html: '<p>Firma</p>' },
      profile_extended: {
        customField: { nested: true },
        value_proposition: 'Valor anterior',
      },
    },
  });

  assert.equal(update.company_domain, 'acme.com');
  assert.deepEqual(update.signatures.gmail, { enabled: true, html: '<p>Firma</p>' });
  assert.deepEqual((update.signatures.profile_extended as Record<string, unknown>).customField, { nested: true });
  assert.equal((update.signatures.profile_extended as Record<string, unknown>).value_proposition, 'Valor anterior');
  assert.deepEqual((update.signatures.profile_extended as Record<string, unknown>).proofPoints, [
    '25% menos tiempo de gestion',
    '40 equipos implementados',
  ]);
});

test('AI suggestions select empty fields only and never apply empty values', () => {
  const form = {
    ...createEmptyProfileForm(),
    sector: 'Sector escrito por usuario',
  };
  const suggestion: CompanyProfileSuggestion = {
    sector: 'Tecnologia',
    website: 'https://acme.com',
    description: 'Empresa de software',
    services: '',
    valueProposition: 'Automatizacion simple',
    targetRoles: 'Gerente de Operaciones',
  };
  const selection = getDefaultSuggestionSelection(form, suggestion);

  assert.equal(selection.sector, false);
  assert.equal(selection.website, true);
  assert.equal(selection.services, false);
  assert.equal(selection.targetRoles, true, 'new fields are proposed like the old ones');
  assert.equal(selection.painPoints, false, 'nothing to apply, nothing selected');

  const applied = applyProfileSuggestion(form, suggestion, { ...selection, services: true });
  assert.equal(applied.sector, 'Sector escrito por usuario');
  assert.equal(applied.website, 'https://acme.com');
  assert.equal(applied.services, '');
});

test('the new profile fields round-trip, and a profile that never used them is written back unchanged', async () => {
  const { profileCompleteness, websiteFromWorkEmail } = await import('@/lib/profile/profile-mappings');
  const stored = {
    full_name: 'Ana', job_title: 'Ejecutiva', company_name: 'Acme', company_domain: 'acme.cl',
    signatures: { profile_extended: { role: 'Ejecutiva', sector: 'Outsourcing', description: 'D', services: 'S', valueProposition: 'V', proofPoints: ['P'] } },
  };
  const untouched = buildProfileUpdate(mapProfileToForm(stored), stored);
  assert.deepEqual(untouched.signatures.profile_extended, stored.signatures.profile_extended,
    'no empty new keys: Cowork compares the stored JSON to name what changed');

  const form = {
    ...mapProfileToForm(stored),
    painPoints: 'Rotación alta\n\nProcesos lentos ',
    differentiators: 'Cobertura nacional',
    referenceClients: 'Falabella, Sodimac',
    targetRoles: 'Gerente de Personas, Jefe de Operaciones',
    targetIndustries: 'Retail, Logística',
    targetCompanySize: '201-500',
    targetLocations: 'Chile',
  };
  const update = buildProfileUpdate(form, stored);
  const extended = update.signatures.profile_extended as Record<string, unknown>;
  assert.deepEqual(extended.painPoints, ['Rotación alta', 'Procesos lentos']);
  assert.deepEqual(extended.targetRoles, ['Gerente de Personas', 'Jefe de Operaciones']);
  assert.equal(extended.targetCompanySize, '201-500');
  const back = mapProfileToForm({ ...stored, signatures: update.signatures });
  assert.equal(back.painPoints, 'Rotación alta\nProcesos lentos');
  assert.equal(back.referenceClients, 'Falabella, Sodimac');
  assert.equal(back.targetCompanySize, '201-500');

  const cleared = buildProfileUpdate({ ...back, painPoints: '', targetCompanySize: 'enorme' }, { ...stored, signatures: update.signatures });
  assert.deepEqual((cleared.signatures.profile_extended as Record<string, unknown>).painPoints, [], 'a field that existed is cleared, not left behind');
  assert.equal((cleared.signatures.profile_extended as Record<string, unknown>).targetCompanySize, '', 'only known sizes are kept');

  assert.equal(websiteFromWorkEmail('Ana@GrupoExpro.com'), 'grupoexpro.com');
  assert.equal(websiteFromWorkEmail('ana@gmail.com'), '');
  assert.equal(websiteFromWorkEmail('sin-arroba'), '');

  const empty = profileCompleteness(createEmptyProfileForm());
  assert.equal(empty.done, 0);
  assert.equal(empty.canDraft, false);
  assert.equal(empty.missing[0].id, 'services', 'what unblocks drafting comes first');
  const full = profileCompleteness({ ...form, name: 'Ana', role: 'Ejecutiva', website: 'https://acme.cl', description: 'Empresa', services: 'Outsourcing', valueProposition: 'Personal listo en 48 horas', proofPoints: '' });
  assert.equal(full.done, 10, 'a named client counts as proof');
  assert.equal(full.percent, 100);
  assert.equal(full.canDraft, true);
});
