import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupBulkCampaignSubject, projectBulkCampaignSubject } from './bulk-campaign-privacy';

test('privacy export excludes other recipients and shared brief/overrides', () => {
  const subject = { email: 'ana@example.com', messages: [{ body: 'For Ana' }] };
  const result = projectBulkCampaignSubject([{ id: 'campaign', organization_id: 'org', user_id: 'user', status: 'draft', created_at: 'now',
    definition: { objective: 'Other confidential context', overrides: [{ email: 'other@example.com' }] },
    recipients: [subject, { email: 'other@example.com', messages: [{ body: 'For somebody else' }] }],
  }], ' ANA@example.com ');
  assert.equal(result.length, 1); assert.deepEqual(result[0].recipient, subject);
  assert.equal(JSON.stringify(result).includes('other@example.com'), false);
  assert.equal(JSON.stringify(result).includes('confidential'), false);
  assert.deepEqual(projectBulkCampaignSubject([{ recipients: [subject] }], 'absent@example.com'), []);
});
test('privacy export paginates and fails closed on database errors', async () => {
  const ranges: number[] = [];
  const client = (error: any = null): any => ({ from: () => ({
    select() { return this; }, contains(_key: string, value: unknown) { assert.deepEqual(value, [{ email: 'ana@example.com' }]); return this; },
    order() { return this; }, async range(start: number) {
      ranges.push(start); return { error, data: Array.from({ length: start === 0 ? 500 : 1 }, (_, index) => ({ id: String(start + index), recipients: [{ email: 'ana@example.com' }] })) };
    },
  }) });
  assert.equal((await lookupBulkCampaignSubject('ana@example.com', client())).length, 501);
  assert.deepEqual(ranges, [0, 500]);
  assert.deepEqual(await lookupBulkCampaignSubject('ana@example.com', client({ code: '42P01' })), []);
  await assert.rejects(lookupBulkCampaignSubject('ana@example.com', client({ code: '42501' })));
});
