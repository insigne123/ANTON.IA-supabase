import assert from 'node:assert/strict';
import test from 'node:test';

import { hasLeadsFinderAccess, leadsFinderAllowedEmails } from './access';
import { splitLeadsFinderItems } from './client';
import { enrichedLeadRow, revealedEmailStatus, revealedLead } from './reveal';
import { forgetInVault, readFromVault, storeInVault } from './vault';

const ITEM = {
  first_name: 'Ana', last_name: 'Pérez', full_name: 'Ana Pérez', email: 'Ana.Perez@empresa-demo.cl', personal_email: 'ana@gmail.com',
  mobile_number: '+56 9 1234 5678', linkedin: 'linkedin.com/in/ana-perez-demo', email_status: 'validated', job_title: 'Gerenta de Personas',
  city: 'Santiago', country: 'Chile', seniority_level: 'manager', company_name: 'Empresa Demo SpA', company_domain: 'empresa-demo.cl',
  industry: 'staffing & recruiting', company_size: 120,
};
const [entry] = splitLeadsFinderItems([ITEM]);

/** An in-memory stand-in for the vault table with the calls the module makes. */
function vaultTable() {
  let rows: Array<Record<string, any>> = [];
  const deletes: string[] = [];
  const filters = (list: Array<[string, string, unknown]>) => (row: Record<string, any>) => list.every(([op, column, value]) =>
    op === 'eq' ? row[column] === value : op === 'in' ? (value as unknown[]).includes(row[column]) : op === 'lt' ? row[column] < (value as string) : true);
  const builder = (mode: 'select' | 'delete') => {
    const list: Array<[string, string, unknown]> = [];
    const chain: any = {
      eq(column: string, value: unknown) { list.push(['eq', column, value]); return chain; },
      in(column: string, value: unknown) { list.push(['in', column, value]); return chain; },
      lt(column: string, value: unknown) { list.push(['lt', column, value]); return chain; },
      then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
        try {
          if (mode === 'delete') {
            const before = rows.length;
            rows = rows.filter(row => !filters(list)(row));
            deletes.push(`${before - rows.length}`);
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows.filter(filters(list)), error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return chain;
  };
  const client = {
    from(table: string) {
      assert.equal(table, 'lead_search_vault');
      return {
        delete: () => builder('delete'),
        select: () => builder('select'),
        upsert: async (incoming: Array<Record<string, any>>, options: { onConflict: string }) => {
          assert.equal(options.onConflict, 'organization_id,provider,provider_lead_id');
          for (const row of incoming) {
            rows = rows.filter(existing => !(existing.organization_id === row.organization_id && existing.provider_lead_id === row.provider_lead_id));
            rows.push(row);
          }
          return { error: null };
        },
      };
    },
  };
  return { client, rows: () => rows, deletes };
}

test('Leads Finder opens only with the flag and only for the listed emails', () => {
  const env = { LEADS_FINDER_ENABLED: 'true', LEADS_FINDER_ALLOWED_EMAILS: ' Nicolas@Empresa.cl, otra@empresa.cl;tercera@empresa.cl ' };
  assert.deepEqual([...leadsFinderAllowedEmails(env)], ['nicolas@empresa.cl', 'otra@empresa.cl', 'tercera@empresa.cl']);
  assert.equal(hasLeadsFinderAccess('nicolas@empresa.cl', env), true);
  assert.equal(hasLeadsFinderAccess('NICOLAS@empresa.cl', env), true, 'case does not matter');
  assert.equal(hasLeadsFinderAccess('alguien@empresa.cl', env), false, 'not on the list');
  assert.equal(hasLeadsFinderAccess('nicolas@empresa.cl', { ...env, LEADS_FINDER_ENABLED: 'false' }), false, 'off: nobody');
  assert.equal(hasLeadsFinderAccess('nicolas@empresa.cl', { LEADS_FINDER_ENABLED: 'true' }), false, 'an empty list lets nobody in');
  assert.equal(hasLeadsFinderAccess('', env), false);
});

test('the vault keeps each person encrypted for 30 days, renews a repeated search and forgets after revealing', async () => {
  const table = vaultTable();
  const now = Date.parse('2026-10-05T12:00:00Z');
  assert.equal(await storeInVault(table.client, { organizationId: 'org', userId: 'u1', entries: [entry], now }), 1);
  const [row] = table.rows();
  assert.equal(row.provider, 'leads_finder');
  assert.match(row.provider_lead_id, /^lf_[0-9a-f]{24}$/);
  assert.match(row.contact_encrypted, /^enc:v1\./, 'only the encrypted envelope is stored');
  for (const secret of ['ana.perez@empresa-demo.cl', '1234 5678', 'ana-perez-demo', 'Pérez']) {
    assert.equal(row.contact_encrypted.includes(secret), false, `«${secret}» is not readable in the row`);
  }
  assert.equal(row.expires_at, '2026-11-04T12:00:00.000Z');
  // A second search of the same person renews the row instead of adding one.
  await storeInVault(table.client, { organizationId: 'org', userId: 'u2', entries: [entry], now: now + 1000 });
  assert.equal(table.rows().length, 1);
  assert.equal(table.rows()[0].searched_by, 'u2');

  const found = await readFromVault(table.client, { organizationId: 'org', ids: [entry.lead.id, 'lf_000000000000000000000000', 'not-an-id'], now: now + 2000 });
  assert.deepEqual([...found.keys()], [entry.lead.id]);
  assert.equal(found.get(entry.lead.id)?.contact.email, 'ana.perez@empresa-demo.cl');
  assert.equal((await readFromVault(table.client, { organizationId: 'otra', ids: [entry.lead.id], now })).size, 0, 'another organization reads nothing');
  assert.equal((await readFromVault(table.client, { organizationId: 'org', ids: [entry.lead.id], now: now + 31 * 86_400_000 })).size, 0, 'expired');

  await forgetInVault(table.client, { organizationId: 'org', ids: [entry.lead.id] });
  assert.equal(table.rows().length, 0);
});

test('a revealed person becomes the same enriched lead as Apollo leaves, with leads_finder as provider', () => {
  const now = '2026-10-05T12:00:00.000Z';
  const row = enrichedLeadRow(entry, { id: 'row-1', userId: 'u1', organizationId: 'org', revealEmail: true, revealPhone: false, now });
  assert.equal(row.full_name, 'Ana Pérez', 'the real name, no longer masked');
  assert.equal(row.email, 'ana.perez@empresa-demo.cl', 'the work email, never the personal one');
  assert.equal(JSON.stringify(row).includes('gmail.com'), false);
  assert.equal(row.email_status, 'verified', 'Apify «validated» reads as Apollo «verified»');
  assert.equal(row.primary_phone, null, 'the phone only when it was asked for');
  assert.deepEqual(row.phone_numbers, []);
  assert.equal(row.linkedin_url, 'https://linkedin.com/in/ana-perez-demo');
  assert.equal(row.company_name, 'Empresa Demo SpA');
  assert.equal(row.organization_domain, 'empresa-demo.cl');
  assert.equal(row.source_provider, 'leads_finder');
  assert.equal(row.source_provider_id, entry.lead.id);
  assert.equal(row.enrichment_status, 'completed');

  const withPhone = enrichedLeadRow(entry, { id: 'row-2', userId: 'u1', organizationId: 'org', revealEmail: false, revealPhone: true, now });
  assert.equal(withPhone.email, null);
  assert.equal(withPhone.primary_phone, '+56 9 1234 5678');
  assert.deepEqual(withPhone.phone_numbers, [{ raw_number: '+56 9 1234 5678', sanitized_number: '+56 9 1234 5678', type: 'mobile' }]);

  const nothing = enrichedLeadRow({ ...entry, contact: { ...entry.contact, email: null } }, { id: 'row-3', userId: 'u1', organizationId: 'org', revealEmail: true, revealPhone: false, now });
  assert.equal(nothing.enrichment_status, 'failed', 'no email to reveal reads like Apollo «no encontrado»');

  const answer = revealedLead(row, { clientRef: 'saved-1', revealEmail: true, revealPhone: false });
  assert.equal(answer.clientRef, 'saved-1', '«Por completar» matches the answer to the saved contact');
  assert.equal(answer.email, 'ana.perez@empresa-demo.cl');
  assert.equal(answer.primaryPhone, undefined);
  assert.equal(answer.firstName, 'Ana');
  assert.equal(answer.lastName, 'Pérez');
  assert.equal(revealedEmailStatus('not_validated'), 'unverified');
  assert.equal(revealedEmailStatus(null), 'unknown');
});
