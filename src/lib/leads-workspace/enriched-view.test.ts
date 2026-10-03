import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { EnrichedLead, Lead } from '@/lib/types';
import {
  enrichedExportRow,
  enrichedLeadPhoneState,
  ENRICHED_STAGE_LABELS,
  ENRICHED_STAGE_ORDER,
  enrichedSelectionAction,
  enrichedStage,
  extractDomainFromEmail,
  filterEnrichedLeads,
  hasUsableEmail,
  hasNativeResearchResult,
  normalizeSearchText,
  pendingPhoneLookupKey,
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

test('the pending phone key changes only when the set of running lookups changes', () => {
  const now = new Date().toISOString();
  const a = lead({ id: 'b', enrichmentStatus: 'pending_phone', updatedAt: now });
  const b = lead({ id: 'a', enrichmentStatus: 'pending_phone', updatedAt: now });
  const done = lead({ id: 'c', enrichmentStatus: 'completed', updatedAt: now });
  const stale = lead({ id: 'd', enrichmentStatus: 'pending_phone', updatedAt: '2020-01-01T00:00:00Z' });
  assert.equal(pendingPhoneLookupKey([a, done, b, stale]), 'a,b', 'sorted, without finished or abandoned lookups');
  assert.equal(pendingPhoneLookupKey([{ ...b }, { ...a }]), 'a,b', 'a reload with new objects keeps the same key');
  assert.equal(pendingPhoneLookupKey([done]), '');
});

test('«Por escribir» reloads once per burst, checks phones per set and confirms in the app dialog', () => {
  const page = readFileSync('src/app/(app)/saved/leads/enriched/Client.tsx', 'utf8');
  assert.match(page, /createCoalescedRunner\(/);
  assert.doesNotMatch(page, /void loadData\(\);\s*\}\s*\)\s*\.subscribe/, 'a realtime event no longer reloads at once');
  assert.match(page, /\[pendingPhoneKey, syncPendingPhoneLeads\]/, 'the phone check follows the set of running lookups, not every reload');
  assert.doesNotMatch(page, /[^.\w]confirm\(['`]/, 'no browser confirm()');
  assert.match(page, /const targets = listed\.filter\(hasReportStrict\)/, '«Borrar investigaciones» acts on the list in view (filters and stage)');
  assert.match(page, /'x-quota-ticket': getQuotaTicket\(\)/);
  assert.match(page, /contactos-por-escribir-/);
});

test('each contact has one stage, in working order: research, then write', () => {
  const base = { hasEmail: true, researching: false, viewable: false, ready: false };
  assert.equal(enrichedStage(base), 'to_research');
  assert.equal(enrichedStage({ ...base, researching: true }), 'researching');
  assert.equal(enrichedStage({ ...base, viewable: true }), 'review', 'a report that cannot draft yet asks for a look');
  assert.equal(enrichedStage({ ...base, viewable: true, ready: true }), 'ready');
  assert.equal(enrichedStage({ ...base, hasEmail: false, ready: true }), 'no_email', 'without an email nothing else applies');
  assert.deepEqual(Object.keys(ENRICHED_STAGE_LABELS).sort(), [...ENRICHED_STAGE_ORDER].sort());
  assert.ok(hasUsableEmail('ana@retail.cl'));
  assert.ok(!hasUsableEmail('Not Found') && !hasUsableEmail('') && !hasUsableEmail(null));
});

test('the action bar names what it will do with the selection', () => {
  assert.equal(enrichedSelectionAction({ total: 0, toResearch: 0, ready: 0 }), null);
  assert.equal(enrichedSelectionAction({ total: 3, toResearch: 0, ready: 3 }), 'Escribir a 3 contactos');
  assert.equal(enrichedSelectionAction({ total: 1, toResearch: 0, ready: 1 }), 'Escribir a 1 contacto');
  assert.equal(enrichedSelectionAction({ total: 4, toResearch: 4, ready: 0 }), 'Investigar (4)');
  assert.equal(enrichedSelectionAction({ total: 5, toResearch: 3, ready: 2 }), 'Investigar y escribir (5)');
});
