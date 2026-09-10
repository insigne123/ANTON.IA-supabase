import test from 'node:test';
import assert from 'node:assert/strict';
import { saveExtensionLead, findExtensionLead, extensionResearchSubject } from './extension-leads';
import { ExtensionProfileSchema } from '../extension-contracts';

function database() {
  const rows = new Map<string, any>();
  return { rows, from: () => {
    const filters: Array<(row: any) => boolean> = [];
    let update: any;
    const query: any = {
      select: () => query, order: () => query, limit: () => query,
      eq: (key: string, value: any) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: any[]) => { filters.push(row => values.includes(row[key])); return query; },
      update: (fields: any) => { update = fields; return query; },
      maybeSingle: async () => { const row = [...rows.values()].find(row => filters.every(filter => filter(row))); return { data: row || null, error: null }; },
      single: async () => { const result = await query.maybeSingle(); if (result.data && update) Object.assign(result.data, update); return result; },
      upsert: async (row: any, options: any) => { assert.equal(options.ignoreDuplicates, true); if (!rows.has(row.id)) rows.set(row.id, row); return { error: null }; },
    }; return query;
  } };
}
const org = '550e8400-e29b-41d4-a716-446655440000';
const profile = ExtensionProfileSchema.parse({ linkedinUrl: 'https://www.linkedin.com/in/test', fullName: 'Ana' });
test('concurrent saves in the same workspace converge and do not overwrite creator', async () => {
  const db = database();
  const auth: any = { supabase: db, organizationId: org, user: { id: 'creator' } };
  await Promise.all([saveExtensionLead(auth, profile), saveExtensionLead({ ...auth, user: { id: 'colleague' } }, profile)]);
  assert.equal(db.rows.size, 1);
  const first = [...db.rows.values()][0];
  const owner = first.user_id;
  await saveExtensionLead({ ...auth, user: { id: 'third' } }, { ...profile, title: 'Directora' });
  assert.equal(first.user_id, owner);
  assert.equal(first.title, 'Directora');
  assert.equal(first.full_name, 'Ana');
  assert.equal(await findExtensionLead({ ...auth, organizationId: 'other' }, profile), null);
});
test('reuses preexisting slash URL and preserves unrelated enriched data', async () => {
  const db = database();
  db.rows.set('old-id', { id: 'old-id', linkedin_url: `${profile.linkedinUrl}/`, organization_id: org, user_id: 'owner', full_name: 'Ana', email: 'ana@example.com', data: { important: true } });
  const result = await saveExtensionLead({ supabase: db, organizationId: org, user: { id: 'member' } } as any, profile);
  assert.equal(db.rows.size, 1);
  assert.equal(result.lead.id, 'old-id');
  assert.equal(result.lead.email, 'ana@example.com');
  assert.deepEqual(result.lead.data, { important: true });
  assert.equal(extensionResearchSubject({ ...result.lead, email: 'not found' }).email, undefined);
});
