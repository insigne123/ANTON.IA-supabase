import assert from 'node:assert/strict';
import test from 'node:test';
import { createAntoniaException } from './antonia-exceptions';

/** The exceptions table in memory: `refuse` says which insert fails, and with what Postgres code. `lead`: what looking the lead up answers. */
function database(refuse: (row: any, attempt: number) => string | null, existing: any = null, lead: 'saved' | 'missing' | 'unreadable' = 'saved') {
  const inserts: any[] = [];
  const client = {
    from: (table: string) => {
      if (table === 'leads') {
        const lookup: any = { select: () => lookup, eq: () => lookup,
          maybeSingle: async () => (lead === 'unreadable' ? { data: null, error: { code: '57014' } } : { data: lead === 'saved' ? { id: 'lead' } : null, error: null }) };
        return lookup;
      }
      assert.equal(table, 'antonia_exceptions');
      let inserted: any = null;
      const query: any = {
        insert: (row: any) => { inserted = row; inserts.push(row); return query; },
        select: () => query, eq: () => query,
        single: async () => { const code = refuse(inserted, inserts.length); return code ? { data: null, error: { code } } : { data: { id: `e-${inserts.length}`, ...inserted }, error: null }; },
        maybeSingle: async () => ({ data: existing, error: null }),
      };
      return query;
    },
  };
  return { client, inserts };
}

const input = { organizationId: 'org-1', leadId: '00000000-0000-4000-8000-000000000009', category: 'positive_reply', title: 'Lead solicito reunion',
  dedupeKey: 'positive_reply_c-1', payload: { contactedId: 'c-1' } };

test('an exception for a contact that is not a saved lead is kept without the lead link, not lost', async () => {
  const error = console.error; console.error = () => {};
  try {
    // A saved lead: one insert, with its link.
    const saved = database(() => null);
    const kept = await createAntoniaException(saved.client, input);
    assert.deepEqual([saved.inserts.length, kept.lead_id, kept.__meta.created], [1, input.leadId, true]);
    // The id is of «Por escribir», not of a saved lead: one insert, without the link, and nothing refused in the database.
    const unsaved = database(row => (row.lead_id ? '23503' : null), null, 'missing');
    const created = await createAntoniaException(unsaved.client, input);
    assert.equal(unsaved.inserts.length, 1);
    assert.deepEqual([created.lead_id, created.payload, created.__meta.created], [null, { contactedId: 'c-1', leadRef: input.leadId }, true]);
    // The lead could not be looked up, or was deleted in between: the link is refused and asked again without it.
    const raced = database(row => (row.lead_id ? '23503' : null), null, 'unreadable');
    const late = await createAntoniaException(raced.client, input);
    assert.equal(raced.inserts.length, 2);
    assert.deepEqual([late.lead_id, late.payload], [null, { contactedId: 'c-1', leadRef: input.leadId }]);
    // Already open for this contact: the second try finds it, as before.
    const open = database((row, attempt) => (attempt === 1 ? '23503' : '23505'), { id: 'e-open', status: 'open' });
    assert.deepEqual(await createAntoniaException(open.client, input), { id: 'e-open', status: 'open', __meta: { created: false } });
    // Another foreign key (a mission that is gone) is not hidden by dropping the lead: without a lead there is nothing to retry.
    const mission = database(() => '23503');
    assert.equal(await createAntoniaException(mission.client, { ...input, leadId: null, missionId: 'm-1' }), null);
    assert.equal(mission.inserts.length, 1);
    // Still refused without the link: reported as a failure, after exactly one retry.
    const broken = database(() => '23503');
    assert.equal(await createAntoniaException(broken.client, input), null);
    assert.equal(broken.inserts.length, 2);
  } finally { console.error = error; }
});
