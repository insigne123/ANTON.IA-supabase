import assert from 'node:assert/strict';
import test from 'node:test';
import Papa from 'papaparse';
import { buildCoworkLeadCsv } from './lead-export';

const id = '00000000-0000-4000-8000-000000000001';
test('observed company results export domains and remain distinct from people', () => {
  const result = { scope: 'external_company_search', items: [{ id: 'apollo-company:org-1', name: 'Empresa', domain: 'example.com', employees: 80, website: 'https://example.com' }] };
  const csv = buildCoworkLeadCsv([{ action: 'prospecting.search', result }]);
  assert.ok(csv);
  const row = Papa.parse<Record<string, string>>(csv, { header: true }).data[0];
  assert.equal(row.domain, 'example.com'); assert.equal(row.employees, '80');
  assert.equal(row.company_website, 'https://example.com');
  assert.equal(buildCoworkLeadCsv([{ action: 'leads.search', result }]), null);
});
test('CSV roundtrips quoted data and neutralizes formula injection', () => {
  const result = { scope: 'own_saved_contacts', items: [{ id, name: '=HYPERLINK("bad")', company: 'Empresa, "ejemplo"\nChile', email: 'test@example.com' }] };
  const csv = buildCoworkLeadCsv([{ action: 'leads.search', result }]);
  assert.ok(csv);
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.data[0].name, '\'=HYPERLINK("bad")');
  assert.equal(parsed.data[0].company, 'Empresa, "ejemplo"\nChile');
});

test('exports only validated tool observations and deduplicates IDs', () => {
  const result = { scope: 'own_saved_contacts', items: [{ id, name: 'Ejemplo', secret: 'hidden' }] };
  const csv = buildCoworkLeadCsv([{ action: 'leads.search', result }, { action: 'leads.get', result }]);
  assert.ok(csv);
  assert.equal(Papa.parse(csv, { header: true }).data.length, 1);
  assert.equal(csv.includes('hidden'), false);
  assert.equal(buildCoworkLeadCsv([{ action: 'answer', result }]), null);
  assert.equal(buildCoworkLeadCsv([{ action: 'leads.search', result: { ...result, scope: 'other' } }]), null);
});

test('external results keep provider identity separate from saved contacts', () => {
  const result = { scope: 'external_search', items: [{ id: 'apollo:external-1', name: 'Nuevo', email: null }] };
  const csv = buildCoworkLeadCsv([{ action: 'prospecting.search', result }]);
  assert.ok(csv);
  assert.match(csv, /apollo:external-1/);
  assert.equal(buildCoworkLeadCsv([{ action: 'leads.search', result }]), null);
  assert.equal(buildCoworkLeadCsv([{ action: 'prospecting.search', result: { ...result, items: [{ id }] } }]), null);
});
