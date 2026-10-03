import assert from 'node:assert/strict';
import test from 'node:test';

import type { EnrichedLead, Lead } from '@/lib/types';
import {
  enrichedExportRow,
  enrichedLeadPhoneState,
  extractDomainFromEmail,
  filterEnrichedLeads,
  hasNativeResearchResult,
  normalizeSearchText,
  splitFilterTerms,
  withCompanyFromSaved,
  type EnrichedLeadFilters,
} from './enriched-view';

const lead = (overrides: Partial<EnrichedLead>): EnrichedLead => ({
  id: 'e1', fullName: 'Andrea Soto', title: 'Gerente de Gestión de Personas', companyName: 'Retail Andino', email: 'andrea@retailandino.cl',
  createdAt: '2026-10-01T12:00:00Z', ...overrides,
} as EnrichedLead);

const NO_FILTERS: EnrichedLeadFilters = {
  searchTerm: '', companyFilter: '', nameFilter: '', titleFilter: '', industryFilter: 'all', phoneFilter: 'all', createdFrom: '', createdTo: '',
  applied: { incCompany: '', incLead: '', incTitle: '', excCompany: '', excLead: '', excTitle: '' },
};

test('text helpers ignore case and accents, and split comma groups', () => {
  assert.equal(normalizeSearchText('Gestión'), 'gestion');
  assert.deepEqual(splitFilterTerms(' Retail, , Minería '), ['retail', 'mineria']);
  assert.equal(extractDomainFromEmail('Ana@Retail.CL'), 'retail.cl');
  assert.equal(extractDomainFromEmail('sin-arroba'), undefined);
});

test('the phone state reads a shown phone, a running lookup or nothing', () => {
  const now = new Date().toISOString();
  assert.equal(enrichedLeadPhoneState(lead({ primaryPhone: '+56 9 1111 2222' })), 'ready');
  assert.equal(enrichedLeadPhoneState(lead({ primaryPhone: 'Not Found' })), 'missing', '«Not Found» is not a phone');
  assert.equal(enrichedLeadPhoneState(lead({ phoneNumbers: [{ sanitized_number: '+5622' }] as never })), 'ready');
  assert.equal(enrichedLeadPhoneState(lead({ enrichmentStatus: 'pending_phone', updatedAt: now })), 'pending');
  assert.equal(enrichedLeadPhoneState(lead({ enrichmentStatus: 'pending_phone', updatedAt: '2020-01-01T00:00:00Z' })), 'missing', 'an old lookup is not running');
});

test('filters: search across fields, include any of a group, exclude, industry, phone and dates', () => {
  const leads = [
    lead({ id: 'a' }),
    lead({ id: 'b', fullName: 'Matías Rojas', companyName: 'Logística Sur', title: 'Jefe de Reclutamiento', industry: 'Logística', createdAt: '2026-09-01T12:00:00Z' }),
    lead({ id: 'c', fullName: 'Tomás Espinoza', companyName: 'Seguridad Austral', title: 'Jefe de Seguridad', primaryPhone: '+5691' }),
  ];
  const ids = (filters: Partial<EnrichedLeadFilters>) => filterEnrichedLeads(leads, { ...NO_FILTERS, ...filters, applied: { ...NO_FILTERS.applied, ...filters.applied } }).map((item) => item.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c']);
  assert.deepEqual(ids({ searchTerm: 'gestion' }), ['a'], 'accents do not matter');
  assert.deepEqual(ids({ applied: { incCompany: 'retail, austral' } as never }), ['a', 'c']);
  assert.deepEqual(ids({ applied: { excTitle: 'jefe' } as never }), ['a']);
  assert.deepEqual(ids({ industryFilter: 'Logística' }), ['b']);
  assert.deepEqual(ids({ phoneFilter: 'ready' }), ['c']);
  assert.deepEqual(ids({ createdFrom: '2026-09-15' }), ['a', 'c']);
  assert.deepEqual(ids({ createdTo: '2026-09-15' }), ['b']);
});

test('a missing company or domain comes from the saved contact, the website or the email', () => {
  const saved = [{ id: 's1', name: 'Andrea Soto', company: 'Retail Andino', companyWebsite: 'https://www.retailandino.cl/contacto', linkedinUrl: 'https://linkedin.com/in/andrea' }] as Lead[];
  const [fromSaved] = withCompanyFromSaved([lead({ companyDomain: undefined, linkedinUrl: 'https://linkedin.com/in/andrea' })], saved);
  assert.equal(fromSaved.companyDomain, 'retailandino.cl');
  const [fromEmail] = withCompanyFromSaved([lead({ id: 'x', fullName: 'Otra Persona', companyName: 'Otra', companyDomain: undefined, email: 'otra@otra.cl' })], saved);
  assert.equal(fromEmail.companyDomain, 'otra.cl');
  const complete = lead({ companyDomain: 'ya.cl' });
  assert.equal(withCompanyFromSaved([complete], saved)[0], complete, 'a complete contact is left as is');
});

test('the export row keeps the column order and marks a locked email', () => {
  assert.deepEqual(
    enrichedExportRow(lead({ email: undefined, emailStatus: 'locked' as never, phoneNumbers: [{ sanitized_number: '+5622' }] as never, linkedinUrl: 'https://linkedin.com/in/a', companyDomain: 'retailandino.cl' })),
    ['Andrea Soto', 'Gerente de Gestión de Personas', 'Retail Andino', '(locked)', '+5622', 'https://linkedin.com/in/a', 'retailandino.cl'],
  );
});

test('a research result counts only when it finished', () => {
  assert.equal(hasNativeResearchResult(null), false);
  assert.equal(hasNativeResearchResult({ status: 'running', result: {} } as never), false);
  assert.equal(hasNativeResearchResult({ status: 'insufficient_data', result: {} } as never), true);
  assert.equal(hasNativeResearchResult({ status: 'completed', result: null } as never), false);
});
