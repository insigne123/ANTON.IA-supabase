import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkAudience } from './audience-read';

test('audience scan scopes every page, caps work and reports incomplete population', async () => {
  let pages = 0;
  const client = { from(table: string) {
    const chain = {
      select() { return chain; },
      eq(column: string, value: string) { assert.equal(column, 'organization_id'); assert.equal(value, 'org'); return chain; },
      order(column: string) { assert.equal(column, 'id'); return chain; },
      async range(start: number, end: number) {
        assert.equal(end - start, 499); pages++;
        return { error: null, data: table === 'leads' ? Array.from({ length: 500 }, (_, i) => ({ id: `${start+i}`, company: 'Example', industry: 'Software' })) : [] };
      },
    }; return chain;
  } };
  const result = await readCoworkAudience(client as never, 'org');
  assert.equal(pages, 11);
  assert.equal(result.coverage.leadsComplete, false);
  assert.equal(result.coverage.historyComplete, true);
  assert.equal(result.verticals[0].newCompanyPercent, null);
  assert.equal(result.contacts.length, 100);
  assert.equal(result.contactsTruncated, true);
});

test('audience query failure is not converted into zero activity', async () => {
  const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; },
    async range() { return { error: { message: 'private' }, data: null }; } };
  await assert.rejects(readCoworkAudience({ from: () => chain } as never, 'org'), /cobertura/);
});
