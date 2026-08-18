import assert from 'node:assert/strict';
import test from 'node:test';

import { claimPendingSupliaAction } from './suplia-action-claim';

type Row = Record<string, any>;

class Query {
  private readonly filters: Array<(row: Row) => boolean> = [];
  private patch: Row | null = null;

  constructor(private readonly rows: Row[]) {}

  update(patch: Row) { this.patch = patch; return this; }
  select() { return this; }
  eq(key: string, value: unknown) { this.filters.push((row) => row[key] === value); return this; }

  async maybeSingle() {
    const row = this.rows.find((candidate) => this.filters.every((filter) => filter(candidate))) || null;
    if (row && this.patch) Object.assign(row, structuredClone(this.patch));
    return { data: row ? structuredClone(row) : null, error: null };
  }
}

function fakeAdmin(rows: Row[]) {
  return { from: () => new Query(rows) };
}

test('only one concurrent approval request claims a pending SUPL.IA action', async () => {
  const rows = [{ id: 'action-1', organization_id: 'org-1', status: 'pending' }];
  const admin = fakeAdmin(rows);
  const input = {
    admin,
    actionId: 'action-1',
    organizationId: 'org-1',
    approvedBy: 'user-1',
    approvedAt: '2026-08-13T12:00:00.000Z',
  };

  const claims = await Promise.all([claimPendingSupliaAction(input), claimPendingSupliaAction(input)]);

  assert.equal(claims.filter((claim) => claim.claimed).length, 1);
  assert.equal(claims.filter((claim) => !claim.claimed).length, 1);
  assert.equal(rows[0].status, 'approved');
});
