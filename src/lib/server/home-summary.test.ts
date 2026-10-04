import assert from 'node:assert/strict';
import test from 'node:test';

import { loadHomeSummary } from './home-summary';

type Row = Record<string, unknown>;

/** A small PostgREST stand-in: eq/in/or filters, exact HEAD counts, order, limit and range pages. */
function fakeClient(tables: Record<string, Row[]>, log: string[] = []) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let head = false;
      let limit = Infinity;
      const builder: any = {
        select(_columns: string, options?: { count?: string; head?: boolean }) { head = Boolean(options?.head); return builder; },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return builder; },
        or(expression: string) {
          // Only the shape loadHomeSummary uses: a.not.is.null, b.not.is.null, c.in.(x,y).
          const parts = expression.match(/[a-z_]+\.(?:not\.is\.null|in\.\([^)]*\))/g) || [];
          filters.push((row) => parts.some((part) => {
            const [column, ...rest] = part.split('.');
            const operator = rest.join('.');
            if (operator === 'not.is.null') return row[column] !== null && row[column] !== undefined;
            const values = operator.slice(4, -1).split(',');
            return values.includes(String(row[column]));
          }));
          return builder;
        },
        order() { return builder; },
        limit(value: number) { limit = value; return builder; },
        range(from: number, to: number) {
          log.push(`${table} ${from}-${to}`);
          const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
        then(resolve: (value: unknown) => void) {
          const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
          resolve(head ? { count: rows.length, error: null, data: null } : { data: rows.slice(0, limit), error: null, count: null });
        },
      };
      return builder;
    },
  } as never;
}

const ORG = 'org-1';
const USER = 'user-1';

test('counts are exact, replies are unique across both sources, and approved campaigns count as active', async () => {
  const contacted: Row[] = [];
  for (let index = 0; index < 1500; index += 1) {
    contacted.push({ id: `c${index}`, organization_id: ORG, lead_id: `l${index}`, email: `p${index}@x.cl`, replied_at: null, reply_intent: null, last_reply_text: null });
  }
  // 1,200 replies, more than one page, plus intents and text-only signals; an unknown intent does not count.
  for (let index = 0; index < 1200; index += 1) contacted[index].replied_at = '2026-10-01T00:00:00Z';
  contacted[1300].reply_intent = 'positive';
  contacted[1301].last_reply_text = 'Hola, ¿podemos hablar?';
  contacted[1302].reply_intent = 'something_else';
  const log: string[] = [];
  const client = fakeClient({
    contacted_leads: [...contacted, { id: 'other-org', organization_id: 'org-2', lead_id: 'lx', email: 'x@x.cl', replied_at: '2026-10-01', reply_intent: null, last_reply_text: null }],
    lead_responses: [
      { organization_id: ORG, contacted_id: 'c0', lead_id: 'l0', type: 'reply' },
      { organization_id: ORG, contacted_id: 'c1400', lead_id: 'l1400', type: 'reply' },
      { organization_id: ORG, contacted_id: 'c1401', lead_id: 'l1401', type: 'open' },
    ],
    enriched_leads: Array.from({ length: 1234 }, (_, index) => ({ id: `e${index}`, organization_id: ORG })),
    campaigns: [{ id: 'old', organization_id: ORG, status: 'active' }, { id: 'old2', organization_id: ORG, status: 'paused' }],
    bulk_campaigns: [
      { id: 'b1', organization_id: ORG, user_id: USER, status: 'approved', approved_at: '2026-10-02', definition: { name: 'Gerentes de RR. HH.' },
        recipients: [{ messages: [{ draftId: 'd1' }, { draftId: 'd2' }] }, { messages: [{ draftId: 'd3' }] }] },
      { id: 'b2', organization_id: ORG, user_id: USER, status: 'draft', definition: { name: 'Borrador' }, recipients: [] },
      { id: 'b3', organization_id: ORG, user_id: 'someone-else', status: 'approved', definition: { name: 'Ajena' }, recipients: [] },
    ],
    outbound_dispatches: [
      { organization_id: ORG, user_id: USER, draft_id: 'd1', status: 'sent' },
      { organization_id: ORG, user_id: USER, draft_id: 'd2', status: 'failed' },
    ],
  }, log);

  const summary = await loadHomeSummary(client, { organizationId: ORG, userId: USER });
  assert.equal(summary.contacted, 1500, 'exact count, not capped at 1,000');
  assert.equal(summary.enrichedLeads, 1234);
  // 1,200 replied_at + positive + text + one lead_responses reply outside them (l1400); c0 is the same person twice.
  assert.equal(summary.replied, 1203);
  assert.equal(summary.activeCampaigns, 2, 'one legacy active campaign and one approved campaign of this person');
  assert.deepEqual(summary.campaigns, [{ id: 'b1', name: 'Gerentes de RR. HH.', total: 3, sent: 1 }]);
  assert.ok(log.includes('contacted_leads 1000-1999'), 'the reply rows were read page by page');
});

test('an empty organization answers zeros, and a failed read is reported instead of hidden', async () => {
  const empty = await loadHomeSummary(fakeClient({}), { organizationId: ORG, userId: USER });
  assert.deepEqual(empty, { contacted: 0, replied: 0, enrichedLeads: 0, activeCampaigns: 0, campaigns: [] });

  const failing = {
    from(table: string) {
      const builder: any = {
        select() { return builder; }, eq() { return builder; }, in() { return builder; }, or() { return builder; }, order() { return builder; }, limit() { return builder; },
        range: () => Promise.resolve({ data: null, error: table === 'lead_responses' ? { message: 'permission denied' } : null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: [], count: 0, error: null }),
      };
      return builder;
    },
  } as never;
  await assert.rejects(loadHomeSummary(failing, { organizationId: ORG, userId: USER }), /permission denied/);
});
